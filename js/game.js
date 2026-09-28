var Game = (function() {
  'use strict';
  var MIN_OFFLINE_SECONDS = 60;

  var Game = function() {
    this.lab = new GameObjects.Lab();
    this.research = null;
    this.workers = null;
    this.upgrades = null;
    this.achievements = null;
    this.allObjects = {lab : this.lab};
    this.initialStates = {};
    this.loaded = false;
  };

  Game.prototype.load = function() {
    if (this.loaded) {
      return;
    }

    // I know synchronous requests are bad as they will block the browser.
    // However, I don't see any other reasonable way to do this in order to
    // make it work with Angular. If you know a way, let me know, and I'll
    // give you a beer. - Kevin
    this.research = Helpers.loadFile('json/research.json');
    this.workers = Helpers.loadFile('json/workers.json');
    this.upgrades = Helpers.loadFile('json/upgrades.json');
    this.achievements = Helpers.loadFile('json/achievements.json');

    // Turn JSON files into actual game objects and fill map of all objects
    var _this = this;
    var makeGameObject = function(type, object) {
      // It's okay to define this function here since load is only called
      // once anyway...
      var o = new type(object);
      _this.allObjects[o.key] = o;
      return o;
    };
    this.research = this.research.map(
        function(r) { return makeGameObject(GameObjects.Research, r); });
    this.workers = this.workers.map(
        function(w) { return makeGameObject(GameObjects.Worker, w); });
    this.upgrades = this.upgrades.map(
        function(u) { return makeGameObject(GameObjects.Upgrade, u); });
    this.achievements = this.achievements.map(
        function(a) { return makeGameObject(GameObjects.Achievement, a); });
    // Load states from local store
    for (var key in this.allObjects) {
      var o = this.allObjects[key];
      this.initialStates[key] = JSON.stringify(o.state);
      o.loadState(ObjectStorage.load(key));
    }
    this.loaded = true;
  };

  /** Data produced per second by all hired workers. */
  Game.prototype.getDataRate = function() {
    return this.workers.reduce(function(sum, w) { return sum + w.getTotal(); }, 0);
  };

  /** Credit the data and funding the lab would have earned while the game
   * was closed. Returns what was awarded, or null if nothing was.
   */
  Game.prototype.applyOfflineProgress = function(now) {
    var lastSeen = this.lab.state.lastSeen;
    if (!lastSeen || now <= lastSeen) {
      return null;
    }
    var maxTime = this.lab.state.offlineHours * 60 * 60 * 1000;
    var elapsed = Math.min(now - lastSeen, maxTime);
    var seconds = Math.floor(elapsed / 1000);
    if (seconds < MIN_OFFLINE_SECONDS) {
      return null;
    }
    var data = this.getDataRate() * seconds;
    var money = this.lab.getGrantRate() * seconds;
    if (data <= 0 && money <= 0) {
      return null;
    }
    this.lab.acquireData(data);
    this.lab.receiveMoney(money);
    return {time: elapsed, capped: now - lastSeen > maxTime,
            maxHours: this.lab.state.offlineHours, data: data, money: money};
  };

  /** Serialise all object states into a portable save code. Objects that
   * are still in their initial state are left out to keep the code short.
   */
  Game.prototype.exportSave = function() {
    var withoutHashKey = function(k, v) {
      return k === '$$hashKey' ? undefined : v;
    };
    var states = {};
    for (var key in this.allObjects) {
      var state = this.allObjects[key].state;
      if (key === 'lab' ||
          JSON.stringify(state, withoutHashKey) !== this.initialStates[key]) {
        states[key] = state;
      }
    }
    var json = JSON.stringify({version: Helpers.saveVersion, states: states},
                              withoutHashKey);
    return window.btoa(unescape(encodeURIComponent(json)));
  };

  /** Validate a save code and write it to local storage. Only known objects
   * and properties whose type matches the current state are kept. Throws an
   * Error with a readable message if the code is invalid.
   */
  Game.prototype.importSave = function(code) {
    var save;
    try {
      save = JSON.parse(decodeURIComponent(escape(
          window.atob(String(code).replace(/\s+/g, '')))));
    } catch (e) {
      throw new Error('This does not look like a save code.');
    }
    if (!save || typeof save.states !== 'object' || !save.states) {
      throw new Error('This does not look like a save code.');
    }
    if (save.version !== Helpers.saveVersion) {
      throw new Error('This save code is from an incompatible version.');
    }
    if (!save.states.lab || typeof save.states.lab !== 'object') {
      throw new Error('This save code does not contain a lab.');
    }
    var sameType = function(current, value) {
      if (Array.isArray(current)) {
        return Array.isArray(value) && value.every(function(x) {
          return typeof x === 'number' && isFinite(x);
        });
      }
      if (current === null) {  // e.g. an achievement not yet achieved
        return value === null || (typeof value === 'number' && isFinite(value));
      }
      if (typeof current === 'number') {
        return typeof value === 'number' && isFinite(value);
      }
      return typeof value === typeof current;
    };
    var clean = {};
    for (var key in this.allObjects) {
      var imported = save.states[key];
      if (!imported || typeof imported !== 'object') {
        continue;
      }
      var current = this.allObjects[key].state;
      clean[key] = {};
      for (var prop in current) {
        if (imported.hasOwnProperty(prop) && sameType(current[prop], imported[prop])) {
          clean[key][prop] = imported[prop];
        }
      }
    }
    // Offline progress restarts from the moment the save is loaded.
    delete clean.lab.lastSeen;
    var updatesSeen = ObjectStorage.load('updatesSeen');
    ObjectStorage.clear();
    ObjectStorage.save('saveVersion', Helpers.saveVersion);
    ObjectStorage.save('updatesSeen', updatesSeen);
    for (var k in clean) {
      ObjectStorage.save(k, clean[k]);
    }
  };

  Game.prototype.save = function() {
    // Save every object's state to local storage
    for (var key in this.allObjects) {
      ObjectStorage.save(key, this.allObjects[key].state);
    }
  };

  return {Game : Game};
}());
