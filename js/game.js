var Game = (function() {
  'use strict';
  var MIN_OFFLINE_SECONDS = 60;
  // Dark matter: floor(sqrt(reputation over all universes / this)) in total.
  var DARK_MATTER_SCALE = 1e8;
  var DARK_MATTER_BONUS = 0.1;  // production per dark matter
  // Lab state that survives an expansion: the name and lifetime totals.
  var LIFETIME_LAB_STATE = ['name', 'clicks', 'time', 'anomalies',
                            'moneyCollected', 'moneySpent', 'dataCollected',
                            'dataSpent'];

  var Game = function() {
    this.lab = new GameObjects.Lab();
    // The player's level and boosts, and the dark matter, are kept when the
    // universe expands; everything else in the lab starts over.
    this.player = new GameObjects.Record('player', {
      level: 1, xp: 0, totalXp: 0, points: 0, boostsChosen: 0,
      offerA: -1, offerB: -1, offerC: -1,
      // Lifetime totals, for achievements.
      upgradesBought: 0, staffHired: 0, researchLevels: 0, totalsCounted: 0
    });
    this.prestige = new GameObjects.Record('prestige', {
      expansions: 0, darkMatter: 0, darkMatterTotal: 0,
      reputationBanked: 0, upgradesBought: 0
    });
    this.secrets = new GameObjects.Record('secrets', {
      konami: 0, nightOwl: 0, homeSweetHome: 0, reflexes: 0, missed: 0,
      darkSide: 0, speedOfLight: 0, infoPages: 0, curious: 0,
      saveShortcut: 0, skinsTried: 0, fashionista: 0
    });
    this.research = null;
    this.workers = null;
    this.upgrades = null;
    this.achievements = null;
    this.boosts = null;
    this.darkMatterUpgrades = null;
    this.allObjects = {lab: this.lab, player: this.player,
                       prestige: this.prestige, secrets: this.secrets};
    this.initialStates = {};
    this.bonus = {};
    this.lab.bonus = this.bonus;
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
    this.boosts = Helpers.loadFile('json/boosts.json');
    this.darkMatterUpgrades = Helpers.loadFile('json/prestige.json');
    var player = this.player.state, prestige = this.prestige.state;
    this.boosts.forEach(function(b) { player[b.key] = 0; });
    this.darkMatterUpgrades.forEach(function(u) { prestige[u.key] = 0; });

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
    // Saves from before the lifetime totals existed start from the current lab.
    var player = this.player.state;
    if (!player.totalsCounted) {
      player.staffHired = this.workers.reduce(function(sum, w) { return sum + w.state.hired; }, 0);
      player.researchLevels = this.research.reduce(function(sum, r) { return sum + r.state.level; }, 0);
      player.upgradesBought = this.upgrades.filter(function(u) { return u.state.used; }).length;
      player.totalsCounted = 1;
    }
    this.updateBonuses();
    this.loaded = true;
  };

  /** Recompute the multipliers from level boosts and dark matter. */
  Game.prototype.updateBonuses = function() {
    var types = ['data', 'click', 'funding', 'reputation', 'xp', 'anomalyRate',
                 'anomalyLifetime', 'offlineHours', 'autoClicks',
                 'darkMatterBonus', 'everything', 'startMoney', 'startData',
                 'startStaff'];
    var fromLevels = {}, fromDarkMatter = {};
    types.forEach(function(t) { fromLevels[t] = 0; fromDarkMatter[t] = 0; });
    var player = this.player.state, prestige = this.prestige.state;
    this.boosts.forEach(function(b) {
      fromLevels[b.type] += b.amount * player[b.key];
    });
    this.darkMatterUpgrades.forEach(function(u) {
      if (prestige[u.key]) {
        u.effects.forEach(function(e) { fromDarkMatter[e.type] += e.amount; });
      }
    });
    var perDarkMatter = DARK_MATTER_BONUS + fromDarkMatter.darkMatterBonus;
    var darkMatter = 1 + perDarkMatter * prestige.darkMatterTotal;
    var everything = fromDarkMatter.everything ? 2 : 1;
    var b = this.bonus;
    b.perDarkMatter = perDarkMatter;
    b.darkMatter = darkMatter;
    b.data = (1 + fromLevels.data) * (1 + fromDarkMatter.data) * darkMatter * everything;
    b.click = (1 + fromLevels.click) * (1 + fromDarkMatter.click) * darkMatter * everything;
    b.funding = (1 + fromLevels.funding) * (1 + fromDarkMatter.funding) * darkMatter * everything;
    b.reputation = 1 + fromLevels.reputation;
    b.xp = (1 + fromLevels.xp) * (1 + fromDarkMatter.xp);
    b.anomalyRate = (1 + fromLevels.anomalyRate) * (1 + fromDarkMatter.anomalyRate);
    b.anomalyLifetime = fromLevels.anomalyLifetime;
    b.offlineHours = fromLevels.offlineHours + fromDarkMatter.offlineHours;
    b.autoClicks = fromDarkMatter.autoClicks;
    b.startMoney = fromDarkMatter.startMoney;
    b.startData = fromDarkMatter.startData;
    b.startStaff = fromDarkMatter.startStaff > 0;
  };

  /** Data produced per second by all hired workers. */
  Game.prototype.getDataRate = function() {
    return this.workers.reduce(function(sum, w) { return sum + w.getTotal(); }, 0) *
        this.bonus.data;
  };

  /** Data per second from the automated trigger (dark matter upgrades). */
  Game.prototype.getAutoRate = function() {
    return this.lab.state.detector * this.bonus.click * this.bonus.autoClicks;
  };

  /** XP needed to get from this level to the next. Grows steadily, so that
   * level 50 takes a few dozen hours of play and level 100 a few hundred. */
  Game.prototype.xpForLevel = function(level) {
    return Math.floor(50 * Math.pow(level, 1.5)) + 50;
  };

  /** Add XP (before bonuses). Returns the number of levels gained. */
  Game.prototype.addXp = function(amount) {
    var p = this.player.state, levels = 0;
    var gain = amount * this.bonus.xp;
    p.xp += gain;
    p.totalXp += gain;
    while (p.xp >= this.xpForLevel(p.level)) {
      p.xp -= this.xpForLevel(p.level);
      p.level++;
      p.points++;
      levels++;
    }
    return levels;
  };

  /** The three boosts on offer for the next boost point, or null if there
   * are no points. The offer is saved so reloading does not reroll it. */
  Game.prototype.getBoostOffer = function() {
    var p = this.player.state, boosts = this.boosts;
    if (p.points <= 0) {
      return null;
    }
    var valid = function(i) { return i >= 0 && i < boosts.length; };
    if (!valid(p.offerA) || !valid(p.offerB) || !valid(p.offerC)) {
      var order = boosts.map(function(b, i) { return i; });
      for (var i = order.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = order[i]; order[i] = order[j]; order[j] = t;
      }
      p.offerA = order[0]; p.offerB = order[1]; p.offerC = order[2];
    }
    return [boosts[p.offerA], boosts[p.offerB], boosts[p.offerC]];
  };

  /** Spend a boost point on one of the offered boosts. */
  Game.prototype.chooseBoost = function(key) {
    var offer = this.getBoostOffer();
    if (!offer || !offer.some(function(b) { return b.key === key; })) {
      return false;
    }
    var p = this.player.state;
    p[key] += 1;
    p.points -= 1;
    p.boostsChosen += 1;
    p.offerA = p.offerB = p.offerC = -1;
    this.updateBonuses();
    return true;
  };

  /** Dark matter the player would get by expanding now. */
  Game.prototype.darkMatterGain = function() {
    var total = this.prestige.state.reputationBanked + this.lab.state.reputation;
    return Math.max(0, Math.floor(Math.sqrt(total / DARK_MATTER_SCALE)) -
                           this.prestige.state.darkMatterTotal);
  };

  /** Reputation needed in this universe for the next dark matter. */
  Game.prototype.nextDarkMatterAt = function() {
    var pr = this.prestige.state;
    var next = pr.darkMatterTotal + this.darkMatterGain() + 1;
    return Math.max(0, next * next * DARK_MATTER_SCALE - pr.reputationBanked);
  };

  Game.prototype.canBuyDarkMatterUpgrade = function(u) {
    var pr = this.prestige.state;
    return !pr[u.key] && pr.darkMatter >= u.cost && (!u.requires || !!pr[u.requires]);
  };

  Game.prototype.buyDarkMatterUpgrade = function(key) {
    var u = this.darkMatterUpgrades.filter(function(x) { return x.key === key; })[0];
    if (!u || !this.canBuyDarkMatterUpgrade(u)) {
      return false;
    }
    var pr = this.prestige.state;
    pr.darkMatter -= u.cost;
    pr[u.key] = 1;
    pr.upgradesBought += 1;
    this.updateBonuses();
    return true;
  };

  /** Expand the universe: write a fresh lab to local storage, keeping the
   * achievements, level, boosts, secrets and dark matter, and add the dark
   * matter earned. The page has to be reloaded afterwards. Returns what was
   * gained. */
  Game.prototype.expand = function(now) {
    var gain = this.darkMatterGain();
    if (gain < 1) {
      throw new Error('Not enough reputation to expand the universe yet.');
    }
    var keep = {player: true, prestige: true, secrets: true};
    var fresh = {};
    for (var key in this.allObjects) {
      var o = this.allObjects[key];
      if (keep[key] || o instanceof GameObjects.Achievement) {
        fresh[key] = $.extend(true, {}, o.state);
      } else {
        fresh[key] = JSON.parse(this.initialStates[key]);
      }
    }
    var lab = fresh.lab;
    LIFETIME_LAB_STATE.forEach(function(p) { lab[p] = this.lab.state[p]; }, this);
    lab.lastSeen = now;
    lab.money = this.bonus.startMoney;
    lab.data = this.bonus.startData;
    if (this.bonus.startStaff) {
      var hireFree = function(workerKey, count) {
        var w = this.allObjects[workerKey], state = fresh[workerKey];
        for (var i = 0; i < count; i++) {
          state.hired += 1;
          state.cost = Math.floor(state.cost * w.cost_increase);
        }
      };
      hireFree.call(this, 'workers-masterstudents', 10);
      hireFree.call(this, 'workers-phdstudents', 5);
    }
    var pr = fresh.prestige;
    pr.expansions += 1;
    pr.darkMatter += gain;
    pr.darkMatterTotal += gain;
    pr.reputationBanked += this.lab.state.reputation;
    for (var k in fresh) {
      ObjectStorage.save(k, fresh[k]);
    }
    return {gain: gain, universe: pr.expansions + 1};
  };

  /** Credit the data and funding the lab would have earned while the game
   * was closed. Returns what was awarded, or null if nothing was.
   */
  Game.prototype.applyOfflineProgress = function(now) {
    var lastSeen = this.lab.state.lastSeen;
    if (!lastSeen || now <= lastSeen) {
      return null;
    }
    var maxHours = this.lab.state.offlineHours + this.bonus.offlineHours;
    var maxTime = maxHours * 60 * 60 * 1000;
    var elapsed = Math.min(now - lastSeen, maxTime);
    var seconds = Math.floor(elapsed / 1000);
    if (seconds < MIN_OFFLINE_SECONDS) {
      return null;
    }
    var data = (this.getDataRate() + this.getAutoRate()) * seconds;
    var money = this.lab.getGrantRate() * seconds;
    if (data <= 0 && money <= 0) {
      return null;
    }
    this.lab.acquireData(data);
    this.lab.receiveMoney(money);
    return {time: elapsed, capped: now - lastSeen > maxTime,
            maxHours: maxHours, data: data, money: money};
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
    var settings = ObjectStorage.load(Settings.KEY);
    ObjectStorage.clear();
    ObjectStorage.save('saveVersion', Helpers.saveVersion);
    ObjectStorage.save('updatesSeen', updatesSeen);
    if (settings) {
      ObjectStorage.save(Settings.KEY, settings);
    }
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
