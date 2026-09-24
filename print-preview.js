(function () {
  var STORAGE_PREFIX = "cttc-round-robin-organizer-";
  var parameters = new URLSearchParams(window.location.search);
  var requestedDate = parameters.get("date");
  var selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "") ? requestedDate : localDateString(new Date());
  var mode = parameters.get("mode") === "scores" ? "scores" : "groups";
  var returnToOrganizer = parameters.get("return") === "organizer";
  var state = readState();
  var groups = state && Array.isArray(state.groups) ? state.groups : [];
  var matchScores = state && state.matchScores ? state.matchScores : {};
  var playersByName = new Map();

  var backLink = document.getElementById("print-preview-back");
  var title = document.getElementById("print-preview-title");
  var summary = document.getElementById("print-preview-summary");
  var status = document.getElementById("print-preview-status");
  var emptyState = document.getElementById("print-preview-empty");
  var organizeLink = document.getElementById("print-preview-organize");
  var sheets = document.getElementById("print-preview-sheets");
  var printButton = document.getElementById("print-preview-print");

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

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_PREFIX + selectedDate) || "null");
    } catch (_error) {
      return null;
    }
  }

  function matchKey(firstName, secondName) {
    return [firstName, secondName].sort().map(encodeURIComponent).join("::");
  }

  function matchupsFor(group) {
    var rotation = group.slice();
    var matchups = [];
    if (rotation.length % 2) rotation.push(null);

    for (var round = 0; round < rotation.length - 1; round += 1) {
      for (var pair = 0; pair < rotation.length / 2; pair += 1) {
        var firstName = rotation[pair];
        var secondName = rotation[rotation.length - 1 - pair];
        if (firstName && secondName) {
          matchups.push(group.indexOf(firstName) < group.indexOf(secondName) ?
            [firstName, secondName] : [secondName, firstName]);
        }
      }
      rotation = [rotation[0], rotation[rotation.length - 1]].concat(rotation.slice(1, -1));
    }
    return matchups;
  }

  function gamesFor(score, name) {
    if (!score) return null;
    if (score.playerOne === name) return score.playerOneGames;
    if (score.playerTwo === name) return score.playerTwoGames;
    return null;
  }

  function appendCell(row, tagName, text, className) {
    var cell = document.createElement(tagName);
    cell.textContent = text;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function playerRating(name) {
    var player = playersByName.get(name);
    return player && Number.isFinite(player.currentRating) ? String(player.currentRating) : "--";
  }

  function playerRecord(name) {
    var player = playersByName.get(name);
    if (!player || !Number.isInteger(player.totalWins) || !Number.isInteger(player.totalLosses)) return "--/--";
    return player.totalWins + "/" + player.totalLosses;
  }

  function ratingAdjustmentFor(firstName, secondName) {
    var first = playersByName.get(firstName);
    var second = playersByName.get(secondName);
    if (!first || !second || !Number.isFinite(first.currentRating) || !Number.isFinite(second.currentRating)) {
      return "--/--";
    }

    var difference = Math.abs(first.currentRating - second.currentRating);
    var bands = [
      [12, 8, 8],
      [37, 7, 10],
      [62, 6, 13],
      [87, 5, 16],
      [112, 4, 20],
      [137, 3, 25],
      [162, 2, 30],
      [187, 2, 35],
      [212, 1, 40],
      [237, 1, 45],
      [Infinity, 0, 50]
    ];
    var band = bands.find(function (entry) { return difference <= entry[0]; });
    return band[1] + "/" + band[2];
  }

  function createSheetHeader(sheet, label, groupName) {
    var header = document.createElement("div");
    header.className = "print-sheet-header";

    var identity = document.createElement("div");
    var clubName = document.createElement("strong");
    clubName.textContent = "CONCORD TABLE TENNIS CLUB";
    var sheetLabel = document.createElement("span");
    sheetLabel.textContent = label;
    identity.appendChild(clubName);
    identity.appendChild(sheetLabel);
    header.appendChild(identity);

    var metadata = document.createElement("div");
    var date = document.createElement("strong");
    date.textContent = formatDate(selectedDate);
    var group = document.createElement("span");
    group.textContent = groupName;
    metadata.appendChild(date);
    metadata.appendChild(group);
    header.appendChild(metadata);
    sheet.appendChild(header);
  }

  function renderGroupListSheet() {
    var sheet = document.createElement("article");
    sheet.className = "print-sheet print-group-list-sheet";
    createSheetHeader(sheet, "ROUND ROBIN GROUPS", groups.length + (groups.length === 1 ? " group" : " groups"));

    var grid = document.createElement("div");
    grid.className = "print-group-grid";
    groups.forEach(function (group, groupIndex) {
      var groupSection = document.createElement("section");
      groupSection.className = "print-group-card";
      var heading = document.createElement("h2");
      heading.textContent = "Group " + (groupIndex + 1);
      groupSection.appendChild(heading);

      var list = document.createElement("ol");
      group.forEach(function (name) {
        var item = document.createElement("li");
        var playerName = document.createElement("strong");
        playerName.textContent = name;
        var rating = document.createElement("span");
        rating.textContent = playerRating(name) === "--" ? "Unrated" : playerRating(name);
        item.appendChild(playerName);
        item.appendChild(rating);
        list.appendChild(item);
      });
      groupSection.appendChild(list);
      grid.appendChild(groupSection);
    });
    sheet.appendChild(grid);
    sheets.appendChild(sheet);
  }

  function renderPlayerRegister(group) {
    var register = document.createElement("section");
    register.className = "tournament-player-register";
    var heading = document.createElement("div");
    heading.className = "tournament-player-key";
    heading.textContent = "Player [Club Rating] (Club Record) (League Record)";
    register.appendChild(heading);

    group.forEach(function (name) {
      var player = document.createElement("div");
      player.className = "tournament-player-row";
      player.textContent = name + " [" + playerRating(name) + "] (" + playerRecord(name) + ") (--/--)";
      register.appendChild(player);
    });
    return register;
  }

  function renderInstructions() {
    var instructions = [
      "No pre-match warm-ups! All warm-ups must be done before the start of the competition.",
      "Play each opponent a best-of-five 11-point-game match.",
      "Record games won lost.",
      "Winners are responsible for recording match results.",
      "The table winner advances to a higher table the next week",
      "Put your table away after completion of the last match."
    ];
    var list = document.createElement("ul");
    list.className = "tournament-instructions";
    instructions.forEach(function (instruction) {
      var item = document.createElement("li");
      var checkbox = document.createElement("span");
      checkbox.className = "tournament-checkbox";
      checkbox.setAttribute("aria-hidden", "true");
      var text = document.createElement("span");
      text.textContent = instruction;
      item.appendChild(checkbox);
      item.appendChild(text);
      list.appendChild(item);
    });
    return list;
  }

  function renderTournamentHeader() {
    var header = document.createElement("div");
    header.className = "tournament-brand";
    var logo = document.createElement("img");
    logo.src = "assets/logo-transparent.png";
    logo.alt = "";
    var name = document.createElement("div");
    var clubName = document.createElement("span");
    clubName.textContent = "Concord Table Tennis Club";
    var sheetName = document.createElement("strong");
    sheetName.textContent = "Tournament Sheet";
    name.appendChild(clubName);
    name.appendChild(sheetName);
    header.appendChild(logo);
    header.appendChild(name);
    return header;
  }

  function renderMatchSchedule(group) {
    var schedule = document.createElement("section");
    schedule.className = "tournament-schedule";
    var heading = document.createElement("div");
    heading.className = "tournament-schedule-heading";
    var title = document.createElement("strong");
    title.textContent = "Match Schedules/Results";
    var adjustment = document.createElement("span");
    adjustment.innerHTML = "Rating Adj.<br>Expected/Upset";
    heading.appendChild(title);
    heading.appendChild(adjustment);
    schedule.appendChild(heading);

    var matches = document.createElement("div");
    matches.className = "tournament-matches";
    matchupsFor(group).forEach(function (matchup) {
      var score = matchScores[matchKey(matchup[0], matchup[1])] || null;
      var firstGames = gamesFor(score, matchup[0]);
      var secondGames = gamesFor(score, matchup[1]);
      var match = document.createElement("div");
      match.className = "tournament-match";

      var names = document.createElement("div");
      names.className = "tournament-match-names";
      [matchup[0], matchup[1]].forEach(function (name) {
        var player = document.createElement("span");
        player.textContent = name;
        names.appendChild(player);
      });

      var result = document.createElement("div");
      result.className = "tournament-match-result";
      [firstGames, secondGames].forEach(function (games) {
        var box = document.createElement("span");
        box.textContent = Number.isInteger(games) ? String(games) : "";
        result.appendChild(box);
      });

      var ratingAdjustment = document.createElement("span");
      ratingAdjustment.className = "tournament-rating-adjustment";
      ratingAdjustment.textContent = ratingAdjustmentFor(matchup[0], matchup[1]);
      match.appendChild(names);
      match.appendChild(result);
      match.appendChild(ratingAdjustment);
      matches.appendChild(match);
    });
    schedule.appendChild(matches);
    return schedule;
  }

  function renderScoreSheets() {
    groups.forEach(function (group, groupIndex) {
      var sheet = document.createElement("article");
      sheet.className = "print-sheet print-score-sheet print-tournament-sheet";
      var columns = document.createElement("div");
      columns.className = "tournament-sheet-columns";

      var left = document.createElement("div");
      left.className = "tournament-sheet-left";
      var metadata = document.createElement("div");
      metadata.className = "tournament-metadata";
      var date = document.createElement("span");
      date.textContent = "Date:  " + formatDate(selectedDate);
      var tableNumber = document.createElement("span");
      tableNumber.textContent = "Table #  " + (groupIndex + 1);
      metadata.appendChild(date);
      metadata.appendChild(tableNumber);
      left.appendChild(metadata);
      left.appendChild(renderPlayerRegister(group));
      left.appendChild(renderInstructions());

      var right = document.createElement("div");
      right.className = "tournament-sheet-right";
      right.appendChild(renderTournamentHeader());
      right.appendChild(renderMatchSchedule(group));

      columns.appendChild(left);
      columns.appendChild(right);
      sheet.appendChild(columns);
      sheets.appendChild(sheet);
    });
  }

  function render() {
    sheets.innerHTML = "";
    var scoreMode = mode === "scores";
    title.textContent = scoreMode ? "Tournament Sheet Preview" : "Group List Preview";
    summary.textContent = formatDate(selectedDate) + " · " + (scoreMode ? groups.length +
      (groups.length === 1 ? " tournament sheet" : " tournament sheets") : "1 group list");
    var backToOrganizer = !scoreMode || returnToOrganizer;
    backLink.href = (backToOrganizer ? "organizer.html" : "scores.html") + "?date=" + encodeURIComponent(selectedDate);
    backLink.textContent = backToOrganizer ? "\u2190 Back to organizer" : "\u2190 Back to scores";
    organizeLink.href = "organizer.html?date=" + encodeURIComponent(selectedDate);
    printButton.disabled = groups.length === 0;

    document.querySelectorAll("[data-preview-mode]").forEach(function (button) {
      var isActive = button.getAttribute("data-preview-mode") === mode;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    status.hidden = true;
    emptyState.hidden = groups.length > 0;
    sheets.hidden = groups.length === 0;
    if (!groups.length) return;
    if (scoreMode) renderScoreSheets();
    else renderGroupListSheet();
  }

  document.querySelectorAll("[data-preview-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      mode = button.getAttribute("data-preview-mode");
      window.history.replaceState(null, "", "print-preview.html?date=" + encodeURIComponent(selectedDate) + "&mode=" + mode +
        (returnToOrganizer ? "&return=organizer" : ""));
      render();
    });
  });

  printButton.addEventListener("click", function () {
    window.print();
  });

  fetch("data/players.json")
    .then(function (response) {
      if (!response.ok) throw new Error("Player ratings could not be loaded.");
      return response.json();
    })
    .then(function (playerData) {
      window.CTTCCustomPlayers.combine(playerData.players || []).forEach(function (player) {
        playersByName.set(player.name, player);
      });
      render();
    })
    .catch(function () {
      render();
    });
}());