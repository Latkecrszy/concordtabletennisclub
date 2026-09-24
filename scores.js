(function () {
  var ACCESS_KEY = "cttc-organizer-unlocked";
  var STORAGE_PREFIX = "cttc-round-robin-organizer-";
  var requestedDate = new URLSearchParams(window.location.search).get("date");
  var selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "") ? requestedDate : localDateString(new Date());
  var state = null;
  var groups = [];
  var matchScores = {};
  var ratingsByName = new Map();

  var dateInput = document.getElementById("scorebook-date");
  var dateLabel = document.getElementById("scorebook-date-label");
  var status = document.getElementById("scorebook-status");
  var workspace = document.getElementById("scorebook-workspace");
  var progress = document.getElementById("scorebook-progress");
  var saveStatus = document.getElementById("scorebook-save-status");
  var emptyState = document.getElementById("scorebook-empty");
  var groupsContainer = document.getElementById("scorebook-groups");
  var backLink = document.getElementById("scorebook-back");
  var emptyLink = document.getElementById("scorebook-empty-link");

  function localDateString(date) {
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function parseLocalDate(dateString) {
    var parts = dateString.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], 12);
  }

  function formatDate(dateString) {
    return parseLocalDate(dateString).toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function storageKey() {
    return STORAGE_PREFIX + selectedDate;
  }

  function matchKey(firstName, secondName) {
    return [firstName, secondName].sort().map(encodeURIComponent).join("::");
  }

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey()) || "null");
    } catch (_error) {
      return null;
    }
  }

  function saveState() {
    state = state || {};
    state.matchScores = matchScores;
    localStorage.setItem(storageKey(), JSON.stringify(state));
    saveStatus.textContent = "Saved just now";
  }

  function scoreFor(firstName, secondName) {
    return matchScores[matchKey(firstName, secondName)] || null;
  }

  function gamesFor(score, name) {
    if (!score) return null;
    if (score.playerOne === name) return score.playerOneGames;
    if (score.playerTwo === name) return score.playerTwoGames;
    return null;
  }

  function scoreState(score) {
    if (!score || (score.playerOneGames === null && score.playerTwoGames === null)) return "pending";
    if (score.playerOneGames === null || score.playerTwoGames === null) return "incomplete";
    var first = score.playerOneGames;
    var second = score.playerTwoGames;
    if ((first === 3 && second >= 0 && second <= 2) || (second === 3 && first >= 0 && first <= 2)) {
      return "complete";
    }
    return "invalid";
  }

  function matchupsFor(group) {
    var matchups = [];
    for (var first = 0; first < group.length; first += 1) {
      for (var second = first + 1; second < group.length; second += 1) {
        matchups.push([group[first], group[second]]);
      }
    }
    return matchups;
  }

  function ratingFor(name) {
    var rating = ratingsByName.get(name);
    return Number.isFinite(rating) ? rating : 0;
  }

  // When exactly three players tie for the most wins, the lowest rated of the
  // three is the table winner.
  function applyThreeWayTieRule(standings, isComplete) {
    if (!isComplete || !standings.length) return standings;
    var topWins = standings[0].wins;
    var tied = standings.filter(function (standing) { return standing.wins === topWins; });
    if (tied.length !== 3) return standings;

    var winner = tied.reduce(function (lowest, standing) {
      return ratingFor(standing.name) < ratingFor(lowest.name) ? standing : lowest;
    });
    return [winner].concat(standings.filter(function (standing) { return standing !== winner; }));
  }

  function standingsFor(group) {
    var originalOrder = new Map();
    var standings = new Map();
    group.forEach(function (name, index) {
      originalOrder.set(name, index);
      standings.set(name, { name: name, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0 });
    });

    matchupsFor(group).forEach(function (matchup) {
      var score = scoreFor(matchup[0], matchup[1]);
      if (scoreState(score) !== "complete") return;
      var firstGames = gamesFor(score, matchup[0]);
      var secondGames = gamesFor(score, matchup[1]);
      var firstStanding = standings.get(matchup[0]);
      var secondStanding = standings.get(matchup[1]);
      firstStanding.gamesWon += firstGames;
      firstStanding.gamesLost += secondGames;
      secondStanding.gamesWon += secondGames;
      secondStanding.gamesLost += firstGames;
      if (firstGames > secondGames) {
        firstStanding.wins += 1;
        secondStanding.losses += 1;
      } else {
        secondStanding.wins += 1;
        firstStanding.losses += 1;
      }
    });

    var sorted = Array.from(standings.values()).sort(function (left, right) {
      var leftDifferential = left.gamesWon - left.gamesLost;
      var rightDifferential = right.gamesWon - right.gamesLost;
      return right.wins - left.wins || rightDifferential - leftDifferential ||
        originalOrder.get(left.name) - originalOrder.get(right.name);
    });
    var isComplete = matchupsFor(group).every(function (matchup) {
      return scoreState(scoreFor(matchup[0], matchup[1])) === "complete";
    });
    var ordered = applyThreeWayTieRule(sorted, isComplete);
    if (isComplete && ordered.length) ordered[0].isWinner = true;
    return ordered;
  }

  function makeScoreSelect(playerName, opponentName, value) {
    var select = document.createElement("select");
    select.className = "scorebook-score-select";
    select.setAttribute("aria-label", "Games won by " + playerName + " against " + opponentName);
    ["", "0", "1", "2", "3"].forEach(function (optionValue) {
      var option = document.createElement("option");
      option.value = optionValue;
      option.textContent = optionValue || "-";
      option.selected = value !== null && String(value) === optionValue;
      select.appendChild(option);
    });
    return select;
  }

  function updateMatch(firstName, secondName, firstSelect, secondSelect) {
    var firstGames = firstSelect.value === "" ? null : Number(firstSelect.value);
    var secondGames = secondSelect.value === "" ? null : Number(secondSelect.value);
    var key = matchKey(firstName, secondName);
    if (firstGames === null && secondGames === null) {
      delete matchScores[key];
    } else {
      var orderedNames = [firstName, secondName].sort();
      matchScores[key] = {
        playerOne: orderedNames[0],
        playerTwo: orderedNames[1],
        playerOneGames: orderedNames[0] === firstName ? firstGames : secondGames,
        playerTwoGames: orderedNames[1] === secondName ? secondGames : firstGames
      };
    }
    saveState();
    renderGroups();
  }

  function renderStandings(group) {
    var table = document.createElement("table");
    table.className = "scorebook-standings";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["Player", "W-L", "Games"].forEach(function (label) {
      var cell = document.createElement("th");
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement("tbody");
    standingsFor(group).forEach(function (standing) {
      var row = document.createElement("tr");
      var name = document.createElement("td");
      name.textContent = (standing.isWinner ? "\uD83C\uDFC6 " : "") + standing.name;
      row.appendChild(name);
      [standing.wins + "-" + standing.losses, standing.gamesWon + "-" + standing.gamesLost].forEach(function (value) {
        var cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });
      body.appendChild(row);
    });
    table.appendChild(body);
    return table;
  }

  function renderMatchup(firstName, secondName) {
    var score = scoreFor(firstName, secondName);
    var currentState = scoreState(score);
    var row = document.createElement("div");
    row.className = "scorebook-match scorebook-match-" + currentState;

    var firstPlayer = document.createElement("span");
    firstPlayer.className = "scorebook-player scorebook-player-first";
    firstPlayer.textContent = firstName;
    row.appendChild(firstPlayer);

    var scoreInputs = document.createElement("div");
    scoreInputs.className = "scorebook-score-inputs";
    var firstSelect = makeScoreSelect(firstName, secondName, gamesFor(score, firstName));
    var separator = document.createElement("span");
    separator.textContent = "-";
    var secondSelect = makeScoreSelect(secondName, firstName, gamesFor(score, secondName));
    scoreInputs.appendChild(firstSelect);
    scoreInputs.appendChild(separator);
    scoreInputs.appendChild(secondSelect);
    row.appendChild(scoreInputs);

    var secondPlayer = document.createElement("span");
    secondPlayer.className = "scorebook-player scorebook-player-second";
    secondPlayer.textContent = secondName;
    row.appendChild(secondPlayer);

    var matchStatus = document.createElement("span");
    matchStatus.className = "scorebook-match-status";
    if (currentState === "complete") {
      matchStatus.textContent = "Complete";
    } else if (currentState === "incomplete") {
      matchStatus.textContent = "Enter both";
    } else if (currentState === "invalid") {
      matchStatus.textContent = "Winner needs 3";
    } else {
      matchStatus.textContent = "Pending";
    }
    row.appendChild(matchStatus);

    firstSelect.addEventListener("change", function () {
      updateMatch(firstName, secondName, firstSelect, secondSelect);
    });
    secondSelect.addEventListener("change", function () {
      updateMatch(firstName, secondName, firstSelect, secondSelect);
    });
    return row;
  }

  function progressCounts() {
    var total = 0;
    var complete = 0;
    groups.forEach(function (group) {
      matchupsFor(group).forEach(function (matchup) {
        total += 1;
        if (scoreState(scoreFor(matchup[0], matchup[1])) === "complete") complete += 1;
      });
    });
    return { total: total, complete: complete };
  }

  function renderGroups() {
    groupsContainer.innerHTML = "";
    var counts = progressCounts();
    progress.textContent = counts.complete + " of " + counts.total + " matches complete";

    groups.forEach(function (group, groupIndex) {
      var section = document.createElement("section");
      section.className = "scorebook-group";
      var matchups = matchupsFor(group);
      var completedMatches = matchups.filter(function (matchup) {
        return scoreState(scoreFor(matchup[0], matchup[1])) === "complete";
      }).length;

      var heading = document.createElement("div");
      heading.className = "scorebook-group-heading";
      var title = document.createElement("h2");
      title.textContent = "Group " + (groupIndex + 1);
      var count = document.createElement("span");
      count.textContent = completedMatches + " / " + matchups.length + " complete";
      heading.appendChild(title);
      heading.appendChild(count);
      section.appendChild(heading);

      var layout = document.createElement("div");
      layout.className = "scorebook-group-layout";
      var standings = document.createElement("div");
      standings.className = "scorebook-standings-wrap";
      var standingsHeading = document.createElement("h3");
      standingsHeading.textContent = "Standings";
      standings.appendChild(standingsHeading);
      standings.appendChild(renderStandings(group));
      layout.appendChild(standings);

      var matches = document.createElement("div");
      matches.className = "scorebook-matches";
      var matchesHeading = document.createElement("h3");
      matchesHeading.textContent = "Matchups";
      matches.appendChild(matchesHeading);
      matchups.forEach(function (matchup) {
        matches.appendChild(renderMatchup(matchup[0], matchup[1]));
      });
      layout.appendChild(matches);
      section.appendChild(layout);
      groupsContainer.appendChild(section);
    });
  }

  function loadSelectedDate() {
    selectedDate = dateInput.value;
    state = readState();
    groups = state && Array.isArray(state.groups) ? state.groups : [];
    matchScores = state && state.matchScores ? state.matchScores : {};
    var organizerUrl = "organizer.html?date=" + encodeURIComponent(selectedDate);
    backLink.href = organizerUrl;
    emptyLink.href = organizerUrl;
    dateLabel.textContent = formatDate(selectedDate);
    window.history.replaceState(null, "", "scores.html?date=" + encodeURIComponent(selectedDate));
    saveStatus.textContent = "Saved in this browser";
    emptyState.hidden = groups.length > 0;
    groupsContainer.hidden = groups.length === 0;
    document.getElementById("scorebook-print").disabled = groups.length === 0;
    renderGroups();
  }

  fetch("data/players.json")
    .then(function (response) { return response.ok ? response.json() : { players: [] }; })
    .catch(function () { return { players: [] }; })
    .then(function (playerData) {
      window.CTTCCustomPlayers.combine(playerData.players || []).forEach(function (player) {
        ratingsByName.set(player.name, player.currentRating);
      });
      renderGroups();
    });

  dateInput.value = selectedDate;
  loadSelectedDate();
  status.hidden = true;
  workspace.hidden = false;

  dateInput.addEventListener("change", loadSelectedDate);
  document.getElementById("scorebook-print").addEventListener("click", function () {
    window.location.href = "print-preview.html?date=" + encodeURIComponent(selectedDate) + "&mode=scores";
  });
  document.getElementById("scorebook-lock").addEventListener("click", function () {
    sessionStorage.removeItem(ACCESS_KEY);
    window.location.href = "roundrobins.html";
  });

  window.CTTCSessionBackup.wireControls({
    prefix: "scorebook",
    getDate: function () { return selectedDate; },
    onImported: function (backup) {
      dateInput.value = backup.sessionDate;
      loadSelectedDate();
    }
  });
}());