(function () {
  var STORAGE_PREFIX = "cttc-round-robin-organizer-";
  var parameters = new URLSearchParams(window.location.search);
  var requestedDate = parameters.get("date");
  var selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "") ? requestedDate : localDateString(new Date());
  var mode = parameters.get("mode") === "scores" ? "scores" : "groups";
  var state = readState();
  var groups = state && Array.isArray(state.groups) ? state.groups : [];
  var matchScores = state && state.matchScores ? state.matchScores : {};
  var ratings = new Map();

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
    var matchups = [];
    for (var first = 0; first < group.length; first += 1) {
      for (var second = first + 1; second < group.length; second += 1) {
        matchups.push([group[first], group[second]]);
      }
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
        rating.textContent = ratings.has(name) ? String(ratings.get(name)) : "Unrated";
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

  function renderRosterTable(group) {
    var table = document.createElement("table");
    table.className = "print-roster-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["No.", "Player", "Rating"].forEach(function (label) {
      appendCell(headRow, "th", label);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement("tbody");
    group.forEach(function (name, index) {
      var row = document.createElement("tr");
      appendCell(row, "td", String(index + 1));
      appendCell(row, "td", name, "print-player-name");
      appendCell(row, "td", ratings.has(name) ? String(ratings.get(name)) : "-");
      body.appendChild(row);
    });
    table.appendChild(body);
    return table;
  }

  function renderMatchesTable(group) {
    var table = document.createElement("table");
    table.className = "print-matches-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["No.", "Player A", "Result", "Player B", "Winner"].forEach(function (label) {
      appendCell(headRow, "th", label);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement("tbody");
    matchupsFor(group).forEach(function (matchup, index) {
      var score = matchScores[matchKey(matchup[0], matchup[1])] || null;
      var firstGames = gamesFor(score, matchup[0]);
      var secondGames = gamesFor(score, matchup[1]);
      var hasResult = Number.isInteger(firstGames) && Number.isInteger(secondGames);
      var winner = hasResult && firstGames !== secondGames ? (firstGames > secondGames ? matchup[0] : matchup[1]) : "";
      var row = document.createElement("tr");
      appendCell(row, "td", String(index + 1));
      appendCell(row, "td", matchup[0], "print-player-name");
      appendCell(row, "td", hasResult ? firstGames + " - " + secondGames : "", "print-result-cell");
      appendCell(row, "td", matchup[1], "print-player-name");
      appendCell(row, "td", winner, "print-winner-cell");
      body.appendChild(row);
    });
    table.appendChild(body);
    return table;
  }

  function renderStandingsTable(group) {
    var table = document.createElement("table");
    table.className = "print-final-table";
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["No.", "Player", "Wins", "Losses", "Place"].forEach(function (label) {
      appendCell(headRow, "th", label);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement("tbody");
    group.forEach(function (name, index) {
      var row = document.createElement("tr");
      appendCell(row, "td", String(index + 1));
      appendCell(row, "td", name, "print-player-name");
      appendCell(row, "td", "");
      appendCell(row, "td", "");
      appendCell(row, "td", "");
      body.appendChild(row);
    });
    table.appendChild(body);
    return table;
  }

  function renderScoreSheets() {
    groups.forEach(function (group, groupIndex) {
      var sheet = document.createElement("article");
      sheet.className = "print-sheet print-score-sheet";
      createSheetHeader(sheet, "ROUND ROBIN SCORE SHEET", "Group " + (groupIndex + 1));

      var rosterHeading = document.createElement("h2");
      rosterHeading.textContent = "Players";
      sheet.appendChild(rosterHeading);
      sheet.appendChild(renderRosterTable(group));

      var matchesHeading = document.createElement("h2");
      matchesHeading.textContent = "Matches - best of five games";
      sheet.appendChild(matchesHeading);
      sheet.appendChild(renderMatchesTable(group));

      var standingsHeading = document.createElement("h2");
      standingsHeading.textContent = "Final standings";
      sheet.appendChild(standingsHeading);
      sheet.appendChild(renderStandingsTable(group));

      var signoff = document.createElement("div");
      signoff.className = "print-sheet-signoff";
      var winner = document.createElement("span");
      winner.textContent = "Group winner: ______________________________";
      var recorder = document.createElement("span");
      recorder.textContent = "Recorded by: ______________________________";
      signoff.appendChild(winner);
      signoff.appendChild(recorder);
      sheet.appendChild(signoff);
      sheets.appendChild(sheet);
    });
  }

  function render() {
    sheets.innerHTML = "";
    var scoreMode = mode === "scores";
    title.textContent = scoreMode ? "Score Sheet Preview" : "Group List Preview";
    summary.textContent = formatDate(selectedDate) + " · " + (scoreMode ? groups.length +
      (groups.length === 1 ? " score sheet" : " score sheets") : "1 group list");
    backLink.href = (scoreMode ? "scores.html" : "organizer.html") + "?date=" + encodeURIComponent(selectedDate);
    backLink.textContent = scoreMode ? "\u2190 Back to scores" : "\u2190 Back to organizer";
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
      window.history.replaceState(null, "", "print-preview.html?date=" + encodeURIComponent(selectedDate) + "&mode=" + mode);
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
        if (Number.isFinite(player.currentRating)) ratings.set(player.name, player.currentRating);
      });
      render();
    })
    .catch(function () {
      render();
    });
}());