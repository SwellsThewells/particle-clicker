var Game = (function() {
  'use strict';
  var MIN_OFFLINE_SECONDS = 60;
  // Dark matter comes from the data collected in all universes of the
  // current multiverse together: the first at 1T data, and cbrt(data / 1T)
  // in total (10 at 1P, 100 at 1E).
  var DARK_MATTER_DATA = 1e12;
  var DARK_MATTER_BONUS = 0.1;  // production per dark matter
  // The multiverse opens in universe 5. Entering a new one turns dark matter
  // into strings: cbrt(dark matter / 4), so 1 at 4, 2 at 32 and 10 at 4k.
  var MULTIVERSE_UNIVERSE = 5;
  var STRING_DARK_MATTER = 4;
  var STRING_BONUS = 0.25;      // production per string
  var SYMBOL_BONUS = 0.005;     // data and funding per symbol of the equation
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
      upgradesBought: 0, staffHired: 0, researchLevels: 0, totalsCounted: 0,
      experimentsDone: 0
    });
    // Universes and dark matter of the current multiverse, and lifetime
    // totals for the achievements.
    this.prestige = new GameObjects.Record('prestige', {
      expansions: 0, darkMatter: 0, darkMatterTotal: 0, upgradesBought: 0,
      lastExpansionAt: 0, lifetimeExpansions: 0, lifetimeDarkMatter: 0
    });
    // Strings and their upgrades are kept forever.
    this.multiverse = new GameObjects.Record('multiverse', {
      jumps: 0, strings: 0, stringsTotal: 0, upgradesBought: 0,
      dataBase: 0,  // data collected (in all multiverses) when this one began
      lastJumpAt: 0
    });
    // The equation, built from detector clicks. Kept forever too.
    this.equation = new GameObjects.Record('equation', {terms: 0, spent: 0});
    // The experiment that is running, if any. Like the rest of the lab, it
    // stops when the universe expands.
    this.experiment = new GameObjects.Record('experiment', {
      running: '', startedAt: 0, endsAt: 0
    });
    this.secrets = new GameObjects.Record('secrets', {
      konami: 0, nightOwl: 0, homeSweetHome: 0, reflexes: 0, missed: 0,
      darkSide: 0, speedOfLight: 0, infoPages: 0, curious: 0,
      saveShortcut: 0, skinsTried: 0, fashionista: 0,
      namesake: 0, patience: 0, piTime: 0, streak: 0, hotStreak: 0, allIn: 0,
      themeSwitches: 0, nerd: 0, dejaVu: 0
    });
    this.research = null;
    this.workers = null;
    this.upgrades = null;
    this.achievements = null;
    this.boosts = null;
    this.darkMatterUpgrades = null;
    this.multiverseUpgrades = null;
    this.terms = null;
    this.experiments = null;
    this.allObjects = {lab: this.lab, player: this.player,
                       prestige: this.prestige, multiverse: this.multiverse,
                       equation: this.equation, secrets: this.secrets,
                       experiment: this.experiment};
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
    this.multiverseUpgrades = Helpers.loadFile('json/multiverse.json');
    this.terms = Helpers.loadFile('json/equation.json');
    this.experiments = Helpers.loadFile('json/experiments.json');
    var player = this.player.state, prestige = this.prestige.state;
    var multiverse = this.multiverse.state;
    this.boosts.forEach(function(b) { player[b.key] = 0; });
    this.darkMatterUpgrades.forEach(function(u) { prestige[u.key] = 0; });
    this.multiverseUpgrades.forEach(function(u) { multiverse[u.key] = 0; });

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
    // Before the multiverse, the universes and dark matter were lifetime totals.
    var pr = this.prestige.state;
    pr.lifetimeExpansions = Math.max(pr.lifetimeExpansions, pr.expansions);
    pr.lifetimeDarkMatter = Math.max(pr.lifetimeDarkMatter, pr.darkMatterTotal);
    this.updateBonuses();
    this.loaded = true;
  };

  /** Recompute the multipliers from level boosts, dark matter, strings and
   * the equation. */
  Game.prototype.updateBonuses = function() {
    var types = ['data', 'click', 'funding', 'reputation', 'xp', 'anomalyRate',
                 'anomalyLifetime', 'offlineHours', 'autoClicks',
                 'darkMatterBonus', 'everything', 'startMoney', 'startData',
                 'startStaff', 'startUniverse', 'darkMatterGain',
                 'keepDarkMatterUpgrades', 'equationCost', 'all',
                 'autoHire', 'autoResearch', 'autoUpgrade'];
    var fromLevels = {}, fromDarkMatter = {}, fromStrings = {};
    types.forEach(function(t) {
      fromLevels[t] = 0; fromDarkMatter[t] = 0; fromStrings[t] = 0;
    });
    var player = this.player.state, prestige = this.prestige.state;
    var multiverse = this.multiverse.state;
    this.boosts.forEach(function(b) {
      fromLevels[b.type] += b.amount * player[b.key];
    });
    var add = function(state, upgrades, into) {
      upgrades.forEach(function(u) {
        if (state[u.key]) {
          u.effects.forEach(function(e) { into[e.type] += e.amount; });
        }
      });
    };
    add(prestige, this.darkMatterUpgrades, fromDarkMatter);
    add(multiverse, this.multiverseUpgrades, fromStrings);
    var perDarkMatter = DARK_MATTER_BONUS + fromDarkMatter.darkMatterBonus +
        fromStrings.darkMatterBonus;
    var darkMatter = 1 + perDarkMatter * prestige.darkMatterTotal;
    var everything = fromDarkMatter.everything ? 2 : 1;
    var strings = 1 + STRING_BONUS * multiverse.stringsTotal;
    var equation = 1 + SYMBOL_BONUS * this.equationSize();
    // Dark matter, strings and the equation count for all data and funding.
    var all = darkMatter * everything * strings * equation * (1 + fromStrings.all);
    var b = this.bonus;
    b.perDarkMatter = perDarkMatter;
    b.darkMatter = darkMatter;
    b.perString = STRING_BONUS;
    b.strings = strings;
    b.perSymbol = SYMBOL_BONUS;
    b.equation = equation;
    b.data = (1 + fromLevels.data) * (1 + fromDarkMatter.data) * all;
    b.click = (1 + fromLevels.click) * (1 + fromDarkMatter.click) *
        (1 + fromStrings.click) * all;
    b.funding = (1 + fromLevels.funding) * (1 + fromDarkMatter.funding) * all;
    b.reputation = (1 + fromLevels.reputation) * (1 + fromStrings.reputation);
    b.xp = (1 + fromLevels.xp) * (1 + fromDarkMatter.xp) * (1 + fromStrings.xp);
    b.anomalyRate = (1 + fromLevels.anomalyRate) * (1 + fromDarkMatter.anomalyRate) *
        (1 + fromStrings.anomalyRate);
    b.anomalyLifetime = fromLevels.anomalyLifetime;
    b.offlineHours = fromLevels.offlineHours + fromDarkMatter.offlineHours;
    b.autoClicks = fromDarkMatter.autoClicks + fromStrings.autoClicks;
    b.startMoney = fromDarkMatter.startMoney;
    b.startData = fromDarkMatter.startData;
    b.startStaff = fromDarkMatter.startStaff > 0;
    b.darkMatterGain = 1 + fromStrings.darkMatterGain;
    b.startUniverse = 1 + fromStrings.startUniverse;
    b.keepDarkMatterUpgrades = fromStrings.keepDarkMatterUpgrades > 0;
    b.equationCost = 1 - fromStrings.equationCost;
    // The Lab Manager: dark matter upgrades that hire, research and buy.
    b.autoHire = fromDarkMatter.autoHire > 0;
    b.autoResearch = fromDarkMatter.autoResearch > 0;
    b.autoUpgrade = fromDarkMatter.autoUpgrade > 0;
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

  /** Add XP (before bonuses, unless exact). Returns the number of levels
   * gained. */
  Game.prototype.addXp = function(amount, exact) {
    var p = this.player.state, levels = 0;
    var gain = exact ? amount : amount * this.bonus.xp;
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

  /** The universe the lab is in, counted from 1 in each multiverse. */
  Game.prototype.universe = function() {
    return this.prestige.state.expansions + 1;
  };

  /** Data collected in all universes of the current multiverse. */
  Game.prototype.multiverseData = function() {
    return Math.max(0, this.lab.state.dataCollected - this.multiverse.state.dataBase);
  };

  /** Data (collected in this multiverse) that earns n dark matter in total. */
  Game.prototype.darkMatterAt = function(n) {
    var x = n / this.bonus.darkMatterGain;
    return x * x * x * DARK_MATTER_DATA;
  };

  /** Dark matter the player would get by expanding now. It counts the data
   * collected in every universe of this multiverse. */
  Game.prototype.darkMatterGain = function() {
    var earned = Math.floor(Math.cbrt(this.multiverseData() / DARK_MATTER_DATA) *
                            this.bonus.darkMatterGain + 1e-9);
    return Math.max(0, earned - this.prestige.state.darkMatterTotal);
  };

  /** Data collected (in this multiverse) needed for the next dark matter. */
  Game.prototype.nextDarkMatterAt = function() {
    return this.darkMatterAt(this.prestige.state.darkMatterTotal + this.darkMatterGain() + 1);
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

  /** The states of a new universe: the objects in keep and the achievements
   * are copied, everything else starts over, except for the lab's name and
   * lifetime totals. */
  Game.prototype.freshStates = function(keep, now) {
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
    return fresh;
  };

  /** The funding, data and staff that dark matter upgrades give a new
   * universe. */
  Game.prototype.giveStartBonuses = function(fresh) {
    var lab = fresh.lab;
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
  };

  /** Write the states of a new universe to local storage. */
  var saveStates = function(fresh) {
    for (var k in fresh) {
      ObjectStorage.save(k, fresh[k]);
    }
  };

  /** Expand the universe: write a fresh lab to local storage, keeping the
   * achievements, level, boosts, secrets, dark matter, strings and the
   * equation, and add the dark matter earned. The page has to be reloaded
   * afterwards. Returns what was gained. */
  Game.prototype.expand = function(now) {
    var gain = this.darkMatterGain();
    if (gain < 1) {
      throw new Error('Not enough data to expand the universe yet.');
    }
    var fresh = this.freshStates({player: true, prestige: true, secrets: true,
                                  multiverse: true, equation: true}, now);
    this.giveStartBonuses(fresh);
    var pr = fresh.prestige;
    // Secret: expand twice within ten minutes.
    if (pr.lastExpansionAt && now - pr.lastExpansionAt < 10 * 60 * 1000) {
      fresh.secrets.dejaVu = 1;
    }
    pr.lastExpansionAt = now;
    pr.expansions += 1;
    pr.lifetimeExpansions += 1;
    pr.darkMatter += gain;
    pr.darkMatterTotal += gain;
    pr.lifetimeDarkMatter += gain;
    saveStates(fresh);
    return {gain: gain, universe: pr.expansions + 1};
  };

  /** Strings for a given amount of dark matter. */
  Game.prototype.stringsFor = function(darkMatter) {
    return Math.floor(Math.cbrt(darkMatter / STRING_DARK_MATTER) + 1e-9);
  };

  /** Whether the lab has reached the universe where the multiverse opens. */
  Game.prototype.multiverseOpen = function() {
    return this.universe() >= MULTIVERSE_UNIVERSE;
  };

  /** Strings the player would get by entering a new multiverse now. */
  Game.prototype.stringGain = function() {
    if (!this.multiverseOpen()) {
      return 0;
    }
    return this.stringsFor(this.prestige.state.darkMatterTotal);
  };

  /** Dark matter (in total, in one multiverse) that is worth n strings. */
  Game.prototype.stringsAt = function(n) {
    return n * n * n * STRING_DARK_MATTER;
  };

  /** Dark matter (in total, in this multiverse) needed for the next string. */
  Game.prototype.nextStringAt = function() {
    return this.stringsAt(this.stringsFor(this.prestige.state.darkMatterTotal) + 1);
  };

  Game.prototype.canBuyMultiverseUpgrade = function(u) {
    var mv = this.multiverse.state;
    return !mv[u.key] && mv.strings >= u.cost && (!u.requires || !!mv[u.requires]);
  };

  Game.prototype.buyMultiverseUpgrade = function(key) {
    var u = this.multiverseUpgrades.filter(function(x) { return x.key === key; })[0];
    if (!u || !this.canBuyMultiverseUpgrade(u)) {
      return false;
    }
    var mv = this.multiverse.state;
    mv.strings -= u.cost;
    mv[u.key] = 1;
    mv.upgradesBought += 1;
    this.updateBonuses();
    return true;
  };

  /** Enter a new multiverse: like an expansion, but the universes, the dark
   * matter and (without Brane Memory) the dark matter upgrades start over
   * too, and the dark matter becomes strings. The page has to be reloaded
   * afterwards. Returns what was gained. */
  Game.prototype.enterMultiverse = function(now) {
    var gain = this.stringGain();
    if (gain < 1) {
      throw new Error('The multiverse is not open yet.');
    }
    var fresh = this.freshStates({player: true, secrets: true, multiverse: true,
                                  equation: true}, now);
    var old = this.prestige.state, pr = fresh.prestige;
    pr.lifetimeExpansions = old.lifetimeExpansions;
    pr.lifetimeDarkMatter = old.lifetimeDarkMatter;
    pr.lastExpansionAt = old.lastExpansionAt;
    if (this.bonus.keepDarkMatterUpgrades) {
      this.darkMatterUpgrades.forEach(function(u) {
        pr[u.key] = old[u.key];
        pr.upgradesBought += old[u.key] ? 1 : 0;
      });
      this.giveStartBonuses(fresh);
    }
    pr.expansions = this.bonus.startUniverse - 1;
    var mv = fresh.multiverse;
    mv.jumps += 1;
    mv.strings += gain;
    mv.stringsTotal += gain;
    mv.dataBase = this.lab.state.dataCollected;
    mv.lastJumpAt = now;
    saveStates(fresh);
    return {gain: gain, multiverse: mv.jumps + 1, universe: pr.expansions + 1};
  };

  /** The size of the equation: the number of symbols in its terms. */
  Game.prototype.equationSize = function() {
    var size = 0, n = Math.min(this.equation.state.terms, this.terms.length);
    for (var i = 0; i < n; i++) {
      size += this.terms[i].size;
    }
    return size;
  };

  /** Detector clicks not yet spent on the equation. */
  Game.prototype.clicksToSpend = function() {
    return Math.max(0, this.lab.state.clicks - this.equation.state.spent);
  };

  /** The next term of the equation, or null once it is complete. */
  Game.prototype.nextTerm = function() {
    return this.terms[this.equation.state.terms] || null;
  };

  /** Clicks that the given term costs. */
  Game.prototype.termCost = function(term) {
    return Math.ceil(term.cost * this.bonus.equationCost);
  };

  Game.prototype.canBuyTerm = function() {
    var term = this.nextTerm();
    return !!term && this.clicksToSpend() >= this.termCost(term);
  };

  /** Add the next term to the equation. */
  Game.prototype.buyTerm = function() {
    if (!this.canBuyTerm()) {
      return false;
    }
    var eq = this.equation.state;
    eq.spent += this.termCost(this.nextTerm());
    eq.terms += 1;
    this.updateBonuses();
    return true;
  };

  /** Whether requirements ({key, property, threshold}) are met. */
  Game.prototype.meets = function(requirements) {
    var all = this.allObjects;
    return (requirements || []).every(function(r) {
      return all[r.key].state[r.property] >= r.threshold;
    });
  };

  /** The data or funding the lab makes per second, for experiments. */
  Game.prototype.experimentRate = function(type) {
    return type === 'data' ? this.getDataRate() + this.getAutoRate() : this.lab.getGrantRate();
  };

  /** Seconds an experiment takes, after upgrades. */
  Game.prototype.experimentDuration = function(e) {
    return e.duration * this.lab.state.experimentSpeed;
  };

  /** What the experiment gives if it ends now. Data and funding are some
   * seconds of the lab's rate when it ends (with a small minimum early on),
   * so the reward keeps up with a lab that grows while it runs; XP is a part
   * of what the next level needs. */
  Game.prototype.experimentReward = function(e) {
    var r = e.reward, amount;
    if (r.type === 'xp') {
      amount = r.amount * this.xpForLevel(this.player.state.level);
    } else if (r.type === 'data') {
      amount = r.seconds * Math.max(this.experimentRate('data'),
                                    0.5 * this.lab.state.detector * this.bonus.click);
    } else {
      amount = r.seconds * Math.max(this.experimentRate('funding'), 5);
    }
    return amount * this.lab.state.experimentReward;
  };

  Game.prototype.experimentUnlocked = function(e) {
    return this.meets(e.requirements);
  };

  /** The experiment that is running (or finished but not yet counted). */
  Game.prototype.runningExperiment = function() {
    var key = this.experiment.state.running;
    return key ? this.experiments.filter(function(e) { return e.key === key; })[0] || null : null;
  };

  /** Experiments are free; one runs at a time. */
  Game.prototype.canStartExperiment = function(e) {
    return !this.runningExperiment() && this.experimentUnlocked(e);
  };

  Game.prototype.startExperiment = function(key, now) {
    var e = this.experiments.filter(function(x) { return x.key === key; })[0];
    if (!e || !this.canStartExperiment(e)) {
      return false;
    }
    var x = this.experiment.state;
    x.running = e.key;
    x.startedAt = now;
    x.endsAt = now + this.experimentDuration(e) * 1000;
    return true;
  };

  /** Hand out the reward of a finished experiment. Returns the experiment,
   * the type of reward and the amount, or null if none has finished. XP is
   * left to the caller, which shows level-ups. */
  Game.prototype.finishExperiment = function(now) {
    var e = this.runningExperiment(), x = this.experiment.state;
    if (!e || now < x.endsAt) {
      if (!e) {
        x.running = '';
      }
      return null;
    }
    var result = {experiment: e, type: e.reward.type, amount: this.experimentReward(e)};
    if (result.type === 'data') {
      this.lab.acquireData(result.amount);
    } else if (result.type === 'funding') {
      this.lab.receiveMoney(result.amount);
    }
    x.running = '';
    this.player.state.experimentsDone += 1;
    return result;
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
