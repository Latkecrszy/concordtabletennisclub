(function () {
  "use strict";

  var STORAGE_KEY = "cttc-round-robin-custom-players";
  var MAX_NAME_LENGTH = 80;
  var MAX_RATING = 4000;

  function normalizeName(value) {
    return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  }

  function normalizePlayer(player) {
    if (!player || typeof player !== "object" || Array.isArray(player)) {
      throw new Error("A manually added player is invalid.");
    }
    var name = normalizeName(player.name);
    if (!name || name.length > MAX_NAME_LENGTH) {
      throw new Error("Player names must be between 1 and " + MAX_NAME_LENGTH + " characters.");
    }
    var rating = player.currentRating;
    if (rating === "" || typeof rating === "undefined") rating = null;
    if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > MAX_RATING)) {
      throw new Error("Player ratings must be whole numbers from 0 through " + MAX_RATING + ".");
    }
    return { name: name, currentRating: rating };
  }

  function validate(players) {
    if (!Array.isArray(players)) throw new Error("Manually added players must be a list.");
    var normalized = players.map(normalizePlayer);
    var names = new Set();
    normalized.forEach(function (player) {
      var key = player.name.toLocaleLowerCase();
      if (names.has(key)) throw new Error("Manually added players contain duplicate names.");
      names.add(key);
    });
    return normalized;
  }

  function load() {
    try {
      return validate(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
    } catch (_error) {
      return [];
    }
  }

  function save(players) {
    var normalized = validate(players);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function add(name, rating) {
    var player = normalizePlayer({ name: name, currentRating: rating });
    var players = load();
    var key = player.name.toLocaleLowerCase();
    if (players.some(function (existing) { return existing.name.toLocaleLowerCase() === key; })) {
      throw new Error(player.name + " is already in the player list.");
    }
    players.push(player);
    save(players);
    return player;
  }

  function merge(playersToAdd) {
    var players = load();
    var names = new Set(players.map(function (player) { return player.name.toLocaleLowerCase(); }));
    validate(playersToAdd).forEach(function (player) {
      var key = player.name.toLocaleLowerCase();
      if (names.has(key)) return;
      players.push(player);
      names.add(key);
    });
    return save(players);
  }

  function combine(officialPlayers) {
    var combined = officialPlayers.slice();
    var officialNames = new Set(officialPlayers.map(function (player) { return player.name.toLocaleLowerCase(); }));
    load().forEach(function (player) {
      if (officialNames.has(player.name.toLocaleLowerCase())) return;
      combined.push({
        name: player.name,
        currentRating: player.currentRating,
        isCustom: true
      });
    });
    return combined;
  }

  window.CTTCCustomPlayers = {
    add: add,
    combine: combine,
    load: load,
    merge: merge,
    normalizeName: normalizeName,
    validate: validate
  };
}());