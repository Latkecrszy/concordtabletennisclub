(function () {
  "use strict";

  var FORMAT = "cttc-round-robin-session";
  var VERSION = 1;
  var STORAGE_PREFIX = "cttc-round-robin-organizer-";
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

  function storageKey(date) {
    return STORAGE_PREFIX + date;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function requireCondition(condition, message) {
    if (!condition) throw new Error(message);
  }

  function validateNameList(value, label) {
    requireCondition(Array.isArray(value), label + " must be a list.");
    value.forEach(function (name) {
      requireCondition(typeof name === "string" && name.trim() === name && name.length > 0, label + " contains an invalid player name.");
    });
    requireCondition(new Set(value).size === value.length, label + " contains duplicate players.");
  }

  function validatePromotions(promotions, participantNames) {
    requireCondition(isPlainObject(promotions), "Promotions must be an object.");
    Object.keys(promotions).forEach(function (name) {
      var promotion = promotions[name];
      requireCondition(participantNames.has(name), "A promotion references a player outside the roster.");
      requireCondition(isPlainObject(promotion), "A promotion entry is invalid.");
      requireCondition(DATE_PATTERN.test(promotion.date || ""), "A promotion has an invalid source date.");
      requireCondition(typeof promotion.previousGroup === "string", "A promotion has an invalid previous group.");
      requireCondition(Number.isInteger(promotion.fromGroup) && promotion.fromGroup > 0, "A promotion has an invalid source group.");
      requireCondition(Number.isInteger(promotion.toGroup) && promotion.toGroup > 0, "A promotion has an invalid target group.");
    });
  }

  function validGames(value) {
    return value === null || (Number.isInteger(value) && value >= 0 && value <= 3);
  }

  function validateMatchScores(matchScores, participantNames) {
    requireCondition(isPlainObject(matchScores), "Match scores must be an object.");
    Object.keys(matchScores).forEach(function (key) {
      var score = matchScores[key];
      requireCondition(isPlainObject(score), "A match score entry is invalid.");
      requireCondition(typeof score.playerOne === "string" && typeof score.playerTwo === "string", "A match score has invalid players.");
      requireCondition(score.playerOne !== score.playerTwo, "A match score lists the same player twice.");
      requireCondition(participantNames.has(score.playerOne) && participantNames.has(score.playerTwo), "A match score references a player outside the roster.");
      requireCondition(key === [score.playerOne, score.playerTwo].sort().map(encodeURIComponent).join("::"), "A match score key does not match its players.");
      requireCondition(validGames(score.playerOneGames) && validGames(score.playerTwoGames), "A match score must contain game values from 0 through 3.");
    });
  }

  function validateState(state) {
    requireCondition(isPlainObject(state), "Session state is missing.");
    validateNameList(state.participants, "Roster");
    requireCondition(Array.isArray(state.groups), "Groups must be a list.");
    state.groups.forEach(function (group) { validateNameList(group, "A group"); });

    var participantNames = new Set(state.participants);
    var groupedNames = state.groups.reduce(function (allNames, group) { return allNames.concat(group); }, []);
    requireCondition(new Set(groupedNames).size === groupedNames.length, "A player appears in more than one group.");
    requireCondition(groupedNames.length === state.participants.length, "Every rostered player must appear in exactly one group.");
    groupedNames.forEach(function (name) {
      requireCondition(participantNames.has(name), "A group contains a player outside the roster.");
    });
    requireCondition(typeof state.customizedGroups === "boolean", "The customized-groups flag is invalid.");
    validatePromotions(state.promotions || {}, participantNames);
    validateMatchScores(state.matchScores || {}, participantNames);

    return {
      participants: state.participants.slice(),
      groups: state.groups.map(function (group) { return group.slice(); }),
      promotions: state.promotions || {},
      customizedGroups: state.customizedGroups,
      matchScores: state.matchScores || {}
    };
  }

  function readSession(date) {
    requireCondition(DATE_PATTERN.test(date || ""), "Session date is invalid.");
    var raw = localStorage.getItem(storageKey(date));
    requireCondition(raw, "There is no saved session to export for this date.");
    return validateState(JSON.parse(raw));
  }

  function exportSession(date) {
    var backup = {
      format: FORMAT,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      sessionDate: date,
      customPlayers: window.CTTCCustomPlayers.load(),
      state: readSession(date)
    };
    var blob = new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "cttc-round-robin-" + date + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    return backup;
  }

  function parseBackup(text) {
    var backup;
    try {
      backup = JSON.parse(text);
    } catch (_error) {
      throw new Error("This is not a valid JSON backup file.");
    }
    requireCondition(isPlainObject(backup), "Backup file is invalid.");
    requireCondition(backup.format === FORMAT, "This file is not a CTTC round robin backup.");
    requireCondition(backup.version === VERSION, "This backup version is not supported.");
    requireCondition(DATE_PATTERN.test(backup.sessionDate || ""), "Backup session date is invalid.");
    return {
      sessionDate: backup.sessionDate,
      customPlayers: window.CTTCCustomPlayers.validate(backup.customPlayers || []),
      state: validateState(backup.state)
    };
  }

  function importSession(file, confirmOverwrite) {
    requireCondition(file, "Choose a backup file first.");
    requireCondition(file.size <= 5 * 1024 * 1024, "Backup file is too large.");
    return file.text().then(function (text) {
      var backup = parseBackup(text);
      return fetch("data/players.json")
        .then(function (response) {
          requireCondition(response.ok, "Could not validate players against the member database.");
          return response.json();
        })
        .then(function (playerData) {
          var knownNames = new Set((playerData.players || []).concat(window.CTTCCustomPlayers.load(), backup.customPlayers)
            .map(function (player) { return player.name.toLocaleLowerCase(); }));
          var unknownNames = backup.state.participants.filter(function (name) { return !knownNames.has(name.toLocaleLowerCase()); });
          requireCondition(!unknownNames.length, "Backup contains unknown player" + (unknownNames.length === 1 ? ": " : "s: ") + unknownNames.join(", "));
          return backup;
        });
    }).then(function (backup) {
      var key = storageKey(backup.sessionDate);
      if (localStorage.getItem(key) && !confirmOverwrite(backup.sessionDate)) {
        return null;
      }
      window.CTTCCustomPlayers.merge(backup.customPlayers);
      localStorage.setItem(key, JSON.stringify(backup.state));
      return backup;
    });
  }

  function wireControls(options) {
    var exportButton = document.getElementById(options.prefix + "-export");
    var importButton = document.getElementById(options.prefix + "-import");
    var fileInput = document.getElementById(options.prefix + "-import-file");
    var message = document.getElementById(options.prefix + "-backup-message");

    function showMessage(text, isError) {
      message.textContent = text;
      message.classList.toggle("session-backup-error", !!isError);
    }

    exportButton.addEventListener("click", function () {
      try {
        var backup = exportSession(options.getDate());
        showMessage("Downloaded backup for " + backup.sessionDate + ".", false);
      } catch (error) {
        showMessage(error.message || "Could not export this session.", true);
      }
    });

    importButton.addEventListener("click", function () {
      fileInput.value = "";
      fileInput.click();
    });

    fileInput.addEventListener("change", function () {
      var file = fileInput.files[0];
      if (!file) return;
      showMessage("Checking " + file.name + "...", false);
      importSession(file, function (date) {
        return window.confirm("Replace the saved round robin session for " + date + " with this backup?");
      }).then(function (backup) {
        if (!backup) {
          showMessage("Import canceled; saved data was not changed.", false);
          return;
        }
        return Promise.resolve(options.onImported(backup)).then(function () {
          showMessage("Restored backup for " + backup.sessionDate + ".", false);
        });
      }).catch(function (error) {
        showMessage(error.message || "Could not import this backup.", true);
      });
    });
  }

  window.CTTCSessionBackup = {
    exportSession: exportSession,
    importSession: importSession,
    parseBackup: parseBackup,
    wireControls: wireControls
  };
}());