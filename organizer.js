(function () {
  var ACCESS_KEY = "cttc-organizer-unlocked";
  var STORAGE_PREFIX = "cttc-round-robin-organizer-";
  var officialPlayers = [];
  var players = [];
  var playersByName = new Map();
  var sessions = [];
  var participants = [];
  var groups = [];
  var promotions = {};
  var matchScores = {};
  var previousWinners = new Map();
  var previousSession = null;
  var customizedGroups = false;
  var requestedDate = new URLSearchParams(window.location.search).get("date");
  var selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || "") ? requestedDate : localDateString(new Date());

  var dateInput = document.getElementById("organizer-date");
  var dateLabel = document.getElementById("organizer-date-label");
  var status = document.getElementById("organizer-status");
  var workspace = document.getElementById("organizer-workspace");
  var searchInput = document.getElementById("organizer-member-search");
  var memberResults = document.getElementById("organizer-member-results");
  var searchCount = document.getElementById("organizer-search-count");
  var newPlayerToggle = document.getElementById("organizer-new-player-toggle");
  var newPlayerForm = document.getElementById("organizer-new-player-form");
  var newPlayerName = document.getElementById("organizer-new-player-name");
  var newPlayerRating = document.getElementById("organizer-new-player-rating");
  var newPlayerMessage = document.getElementById("organizer-new-player-message");
  var rosterList = document.getElementById("organizer-roster");
  var rosterCount = document.getElementById("organizer-roster-count");
  var groupSummary = document.getElementById("organizer-group-summary");
  var promotionContext = document.getElementById("organizer-promotion-context");
  var emptyState = document.getElementById("organizer-empty");
  var groupsContainer = document.getElementById("organizer-groups");

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

  function formatDate(dateString, options) {
    return parseLocalDate(dateString).toLocaleDateString("en-US", options || {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }

  function playerRating(name) {
    var player = playersByName.get(name);
    return player && Number.isFinite(player.currentRating) ? player.currentRating : 0;
  }

  function refreshPlayerDirectory() {
    players = window.CTTCCustomPlayers.combine(officialPlayers).sort(function (left, right) {
      return left.name.localeCompare(right.name);
    });
    playersByName.clear();
    players.forEach(function (player) { playersByName.set(player.name, player); });
  }

  function sortByRating(names) {
    return names.slice().sort(function (left, right) {
      return playerRating(right) - playerRating(left) || left.localeCompare(right);
    });
  }

  function storageKey() {
    return STORAGE_PREFIX + selectedDate;
  }

  function saveState() {
    localStorage.setItem(storageKey(), JSON.stringify({
      participants: participants,
      groups: groups,
      promotions: promotions,
      customizedGroups: customizedGroups,
      matchScores: matchScores
    }));
  }

  function loadState() {
    participants = [];
    groups = [];
    promotions = {};
    matchScores = {};
    customizedGroups = false;

    try {
      var saved = JSON.parse(localStorage.getItem(storageKey()) || "null");
      if (!saved) return;
      participants = (saved.participants || []).filter(function (name) { return playersByName.has(name); });
      var activeNames = new Set(participants);
      groups = (saved.groups || []).map(function (group) {
        return group.filter(function (name) { return activeNames.has(name); });
      }).filter(function (group) { return group.length; });
      promotions = saved.promotions || {};
      matchScores = saved.matchScores || {};
      customizedGroups = !!saved.customizedGroups;
    } catch (_error) {
      localStorage.removeItem(storageKey());
    }
  }

  function groupSizes(playerCount) {
    if (!playerCount) return [];

    var minimumGroups = Math.ceil(playerCount / 6);
    var maximumGroups = Math.floor(playerCount / 5);
    var groupCount = minimumGroups <= maximumGroups ? minimumGroups : Math.max(1, minimumGroups);
    var baseSize = Math.floor(playerCount / groupCount);
    var largerGroups = playerCount % groupCount;
    var sizes = [];

    for (var index = 0; index < groupCount; index += 1) {
      sizes.push(baseSize + (index < largerGroups ? 1 : 0));
    }
    return sizes;
  }

  function currentGroupIndex(name) {
    return groups.findIndex(function (group) { return group.indexOf(name) !== -1; });
  }

  function applyWinnerPromotions() {
    promotions = {};
    if (!previousSession || groups.length < 2) return;

    var eligibleNames = new Set(previousWinners.keys());
    previousWinners.forEach(function (winner, name) {
      var fromGroup = currentGroupIndex(name);
      var targetGroup = winner.groupIndex - 1;
      if (fromGroup < 0 || targetGroup < 0 || targetGroup >= groups.length || fromGroup <= targetGroup) return;

      var winnerPosition = groups[fromGroup].indexOf(name);
      var swapPosition = -1;
      for (var index = groups[targetGroup].length - 1; index >= 0; index -= 1) {
        if (!eligibleNames.has(groups[targetGroup][index])) {
          swapPosition = index;
          break;
        }
      }
      if (swapPosition === -1) swapPosition = groups[targetGroup].length - 1;
      if (swapPosition < 0) return;

      var displacedName = groups[targetGroup][swapPosition];
      groups[targetGroup][swapPosition] = name;
      groups[fromGroup][winnerPosition] = displacedName;
      groups[targetGroup] = sortByRating(groups[targetGroup]);
      groups[fromGroup] = sortByRating(groups[fromGroup]);
      promotions[name] = {
        date: previousSession.date,
        previousGroup: winner.groupName,
        fromGroup: fromGroup + 1,
        toGroup: targetGroup + 1
      };
    });
  }

  function organizeByRating() {
    var ordered = sortByRating(participants);
    var sizes = groupSizes(ordered.length);
    var offset = 0;
    groups = sizes.map(function (size) {
      var group = ordered.slice(offset, offset + size);
      offset += size;
      return group;
    });
    customizedGroups = false;
    applyWinnerPromotions();
    saveState();
    render();
  }

  function addToCustomizedGroups(name) {
    if (!groups.length) {
      groups = [[name]];
      return;
    }

    var ordered = sortByRating(participants);
    var rank = ordered.indexOf(name);
    var targetIndex = Math.min(groups.length - 1, Math.floor(rank * groups.length / ordered.length));
    groups[targetIndex].push(name);
    groups[targetIndex] = sortByRating(groups[targetIndex]);

    for (var index = targetIndex; index < groups.length; index += 1) {
      if (groups[index].length <= 6) break;
      var displaced = groups[index].pop();
      if (!groups[index + 1]) groups[index + 1] = [];
      groups[index + 1].push(displaced);
      groups[index + 1] = sortByRating(groups[index + 1]);
    }
  }

  function addPlayer(name) {
    if (participants.indexOf(name) !== -1) return;
    participants.push(name);
    if (customizedGroups) {
      addToCustomizedGroups(name);
      saveState();
      render();
    } else {
      organizeByRating();
    }
  }

  function setNewPlayerFormOpen(isOpen) {
    newPlayerForm.hidden = !isOpen;
    newPlayerToggle.setAttribute("aria-expanded", String(isOpen));
    if (!isOpen) {
      newPlayerForm.reset();
      newPlayerMessage.textContent = "";
    } else {
      newPlayerName.focus();
    }
  }

  function addCustomPlayer() {
    var name = window.CTTCCustomPlayers.normalizeName(newPlayerName.value);
    var matchingPlayer = players.find(function (player) {
      return player.name.toLocaleLowerCase() === name.toLocaleLowerCase();
    });
    if (matchingPlayer) {
      addPlayer(matchingPlayer.name);
      searchInput.value = matchingPlayer.name;
      setNewPlayerFormOpen(false);
      return;
    }

    var rating = newPlayerRating.value === "" ? null : Number(newPlayerRating.value);
    var player = window.CTTCCustomPlayers.add(name, rating);
    player.isCustom = true;
    players.push(player);
    players.sort(function (left, right) { return left.name.localeCompare(right.name); });
    playersByName.set(player.name, player);
    searchInput.value = player.name;
    addPlayer(player.name);
    setNewPlayerFormOpen(false);
  }

  function removePlayer(name) {
    participants = participants.filter(function (participant) { return participant !== name; });
    delete promotions[name];
    groups = groups.map(function (group) {
      return group.filter(function (participant) { return participant !== name; });
    }).filter(function (group) { return group.length; });

    if (!customizedGroups) {
      organizeByRating();
      return;
    }
    saveState();
    render();
  }

  function movePlayer(name, direction) {
    var fromGroup = currentGroupIndex(name);
    var targetGroup = fromGroup + direction;
    if (fromGroup < 0 || targetGroup < 0 || targetGroup >= groups.length) return;

    groups[fromGroup] = groups[fromGroup].filter(function (participant) { return participant !== name; });
    groups[targetGroup].push(name);
    groups[targetGroup] = sortByRating(groups[targetGroup]);
    groups = groups.filter(function (group) { return group.length; });
    delete promotions[name];
    customizedGroups = true;
    saveState();
    render();
  }

  function makeButton(className, text, label, clickHandler) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    if (label) {
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    button.addEventListener("click", clickHandler);
    return button;
  }

  function renderMembers() {
    var query = searchInput.value.trim().toLowerCase();
    var matching = players.filter(function (player) {
      return !query || player.name.toLowerCase().indexOf(query) !== -1;
    });
    memberResults.innerHTML = "";
    searchCount.textContent = matching.length + (matching.length === 1 ? " member" : " members");

    matching.forEach(function (player) {
      var item = document.createElement("li");
      var identity = document.createElement("div");
      identity.className = "organizer-member-identity";
      var name = document.createElement("strong");
      name.textContent = player.name;
      var rating = document.createElement("span");
      rating.textContent = "Rating " + (player.currentRating || "Unrated") + (player.isCustom ? " · Added manually" : "");
      identity.appendChild(name);
      identity.appendChild(rating);
      item.appendChild(identity);

      var isAdded = participants.indexOf(player.name) !== -1;
      var addButton = makeButton("organizer-add-button", isAdded ? "Added" : "Add", null, function () {
        addPlayer(player.name);
      });
      addButton.disabled = isAdded;
      item.appendChild(addButton);
      memberResults.appendChild(item);
    });
  }

  function renderRoster() {
    rosterList.innerHTML = "";
    rosterCount.textContent = participants.length;
    document.getElementById("organizer-clear").disabled = !participants.length;

    if (!participants.length) {
      var empty = document.createElement("li");
      empty.className = "organizer-roster-empty";
      empty.textContent = "No players added.";
      rosterList.appendChild(empty);
      return;
    }

    participants.slice().sort().forEach(function (name) {
      var item = document.createElement("li");
      var label = document.createElement("span");
      label.textContent = name;
      item.appendChild(label);
      item.appendChild(makeButton("organizer-remove-button", "\u00d7", "Remove " + name, function () {
        removePlayer(name);
      }));
      rosterList.appendChild(item);
    });
  }

  function renderGroupMember(name, groupIndex) {
    var item = document.createElement("li");
    if (promotions[name]) item.className = "organizer-promoted-player";

    var details = document.createElement("div");
    details.className = "organizer-group-player-details";
    var identity = document.createElement("div");
    identity.className = "organizer-group-player-name";
    var playerName = document.createElement("strong");
    playerName.textContent = name;
    var rating = document.createElement("span");
    rating.textContent = String(playerRating(name) || "Unrated");
    identity.appendChild(playerName);
    identity.appendChild(rating);
    details.appendChild(identity);

    if (promotions[name]) {
      var promotion = document.createElement("span");
      promotion.className = "organizer-promotion-badge";
      promotion.textContent = "Promoted: won " + promotions[name].previousGroup + " on " + formatDate(promotions[name].date, { month: "short", day: "numeric" });
      details.appendChild(promotion);
    }
    item.appendChild(details);

    var controls = document.createElement("div");
    controls.className = "organizer-player-controls";
    var upButton = makeButton("organizer-icon-button", "\u2191", "Move " + name + " up one group", function () {
      movePlayer(name, -1);
    });
    upButton.disabled = groupIndex === 0;
    controls.appendChild(upButton);
    var downButton = makeButton("organizer-icon-button", "\u2193", "Move " + name + " down one group", function () {
      movePlayer(name, 1);
    });
    downButton.disabled = groupIndex === groups.length - 1;
    controls.appendChild(downButton);
    controls.appendChild(makeButton("organizer-icon-button organizer-remove-button", "\u00d7", "Remove " + name, function () {
      removePlayer(name);
    }));
    item.appendChild(controls);
    return item;
  }

  function renderGroups() {
    groupsContainer.innerHTML = "";
    emptyState.hidden = participants.length > 0;
    document.getElementById("organizer-rebuild").disabled = !participants.length;
    document.getElementById("organizer-print").disabled = !participants.length;
    var finishButton = document.getElementById("organizer-finish");
    finishButton.disabled = !participants.length;
    finishButton.textContent = Object.keys(matchScores).length ? "Return to scores \u2192" : "Done organizing \u2192";

    if (!participants.length) {
      groupSummary.textContent = "";
      return;
    }

    var sizes = groups.map(function (group) { return group.length; });
    var outsidePreferredSize = sizes.some(function (size) { return size < 5 || size > 6; });
    groupSummary.textContent = participants.length + (participants.length === 1 ? " player in " : " players in ") + groups.length +
      (groups.length === 1 ? " group" : " groups") + " \u00b7 " + sizes.join(" / ") +
      (outsidePreferredSize ? " \u00b7 rebalance recommended" : "");

    groups.forEach(function (group, groupIndex) {
      var section = document.createElement("section");
      section.className = "organizer-group";
      if (group.length < 5 || group.length > 6) section.classList.add("organizer-group-needs-balance");
      var heading = document.createElement("div");
      heading.className = "organizer-group-heading";
      var title = document.createElement("h3");
      title.textContent = "Group " + (groupIndex + 1);
      var count = document.createElement("span");
      count.textContent = group.length + (group.length === 1 ? " player" : " players");
      heading.appendChild(title);
      heading.appendChild(count);
      section.appendChild(heading);

      var list = document.createElement("ol");
      list.className = "organizer-group-list";
      group.forEach(function (name) {
        list.appendChild(renderGroupMember(name, groupIndex));
      });
      section.appendChild(list);
      groupsContainer.appendChild(section);
    });
  }

  function renderPromotionContext() {
    if (!previousSession) {
      promotionContext.textContent = "No earlier " + formatDate(selectedDate, { weekday: "long" }) + " session was found for promotion history.";
      return;
    }
    promotionContext.textContent = "Promotion reference: " + formatDate(previousSession.date, {
      weekday: "long",
      month: "long",
      day: "numeric"
    }) + ". Winners are guaranteed one group above the group they won, unless their rating already places them there or higher.";
  }

  function render() {
    dateLabel.textContent = formatDate(selectedDate);
    renderMembers();
    renderRoster();
    renderGroups();
    renderPromotionContext();
  }

  function findPreviousSameWeekdaySession() {
    var selectedDay = parseLocalDate(selectedDate).getDay();
    return sessions.find(function (session) {
      return session.date < selectedDate && parseLocalDate(session.date).getDay() === selectedDay;
    }) || null;
  }

  function loadPromotionHistory() {
    previousWinners = new Map();
    previousSession = findPreviousSameWeekdaySession();
    if (!previousSession) return Promise.resolve();

    var year = previousSession.date.slice(0, 4);
    return fetch("data/session-details-" + year + ".json")
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load previous session details.");
        return response.json();
      })
      .then(function (yearSessions) {
        var details = yearSessions.find(function (session) { return session.date === previousSession.date; });
        if (!details || !details.groups) return;
        details.groups.forEach(function (group, groupIndex) {
          if (groupIndex === 0 || !group.players || !group.players.length) return;
          previousWinners.set(group.players[0].name, {
            groupName: group.name,
            groupIndex: groupIndex
          });
        });
      });
  }

  function loadSelectedDate() {
    selectedDate = dateInput.value;
    window.history.replaceState(null, "", "organizer.html?date=" + encodeURIComponent(selectedDate));
    loadState();
    return loadPromotionHistory().then(function () {
      if (participants.length && !groups.length) {
        organizeByRating();
      } else {
        render();
      }
    });
  }

  function initialize() {
    dateInput.value = selectedDate;
    Promise.all([
      fetch("data/players.json").then(function (response) {
        if (!response.ok) throw new Error("Could not load player ratings.");
        return response.json();
      }),
      fetch("data/sessions.json").then(function (response) {
        if (!response.ok) throw new Error("Could not load session history.");
        return response.json();
      })
    ]).then(function (results) {
      officialPlayers = results[0].players;
      refreshPlayerDirectory();
      sessions = results[1];
      return loadSelectedDate();
    }).then(function () {
      status.hidden = true;
      workspace.hidden = false;
      searchInput.focus();
    }).catch(function (error) {
      status.className = "organizer-status organizer-status-error";
      status.textContent = error.message || "Could not load organizer data.";
    });
  }

  searchInput.addEventListener("input", renderMembers);
  newPlayerToggle.addEventListener("click", function () {
    setNewPlayerFormOpen(newPlayerForm.hidden);
  });
  document.getElementById("organizer-new-player-cancel").addEventListener("click", function () {
    setNewPlayerFormOpen(false);
  });
  newPlayerForm.addEventListener("submit", function (event) {
    event.preventDefault();
    try {
      addCustomPlayer();
    } catch (error) {
      newPlayerMessage.textContent = error.message || "Could not add this player.";
    }
  });
  dateInput.addEventListener("change", function () {
    loadSelectedDate().catch(function (error) {
      status.hidden = false;
      status.className = "organizer-status organizer-status-error";
      status.textContent = error.message || "Could not load promotion history.";
    });
  });
  document.getElementById("organizer-rebuild").addEventListener("click", organizeByRating);
  document.getElementById("organizer-print").addEventListener("click", function () {
    window.location.href = "print-preview.html?date=" + encodeURIComponent(selectedDate) + "&mode=scores&return=organizer";
  });
  document.getElementById("organizer-finish").addEventListener("click", function () {
    saveState();
    window.location.href = "scores.html?date=" + encodeURIComponent(selectedDate);
  });
  document.getElementById("organizer-clear").addEventListener("click", function () {
    if (!participants.length || !window.confirm("Remove everyone from the " + formatDate(selectedDate, { month: "long", day: "numeric" }) + " roster?")) return;
    participants = [];
    groups = [];
    promotions = {};
    customizedGroups = false;
    saveState();
    render();
  });
  document.getElementById("organizer-lock").addEventListener("click", function () {
    sessionStorage.removeItem(ACCESS_KEY);
    window.location.href = "roundrobins.html";
  });

  window.CTTCSessionBackup.wireControls({
    prefix: "organizer",
    getDate: function () { return selectedDate; },
    onImported: function (backup) {
      refreshPlayerDirectory();
      dateInput.value = backup.sessionDate;
      return loadSelectedDate();
    }
  });

  initialize();
}());