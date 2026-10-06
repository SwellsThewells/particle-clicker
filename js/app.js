'use strict';
(function() {
  Helpers.validateSaveVersion();

  var game = new Game.Game();
  game.load();

  var lab = game.lab;
  var research = game.research;
  var workers = game.workers;
  var upgrades = game.upgrades;
  var achievements = game.achievements;
  var allObjects = game.allObjects;
  var lastSaved = new Date().getTime();
  var savingEnabled = true;
  var MAX_BULK_BUY = 1000;
  var boostUntil = 0;
  var updates = Helpers.loadFile('json/updates.json');
  var updatesSeen = ObjectStorage.load('updatesSeen');

  /** Factor applied to all data: the beam boost from an anomaly, times the
   * lab action and Particle ID boosts that are running. */
  var dataMultiplier = function() {
    var now = new Date().getTime();
    return (now < boostUntil ? lab.state.boostFactor : 1) * game.actionFactor('data', now);
  };

  /** Clicking the detector quickly builds a combo: each click less than a
   * second after the one before adds 2% to the data per click, up to twice
   * as much. */
  var COMBO_GAP = 1000, COMBO_STEPS = 50, COMBO_STEP = 0.02;
  var combo = {steps: 0, last: 0};
  var comboFactor = function() {
    return new Date().getTime() - combo.last < COMBO_GAP ? 1 + COMBO_STEP * combo.steps : 1;
  };

  /** The research, staff and upgrades lists go from the cheapest to the most
   * expensive. Research and staff are sorted by their first price, so the
   * lists don't reshuffle as prices rise; items with the same price keep the
   * order of the JSON files. */
  var cheapestFirst = function(items, price) {
    return items.map(function(item, i) { return {item: item, i: i}; })
        .sort(function(a, b) { return price(a.item) - price(b.item) || a.i - b.i; })
        .map(function(x) { return x.item; });
  };

  /** Shared state for the x1 / x10 / Max toggles. getBudget returns what the
   * items are paid with; items implement getCost(n) and getAffordable(). */
  var BulkBuyer = function(getBudget) {
    this.amounts = [1, 10, 'max'];
    this.amount = 1;
    this.getBudget = getBudget;
  };
  BulkBuyer.prototype.setAmount = function(amount) {
    this.amount = amount;
  };
  /** Number of items the buy button will buy. With 'max' this is as many as
   * can be afforded, but at least one so the next price is still shown. */
  BulkBuyer.prototype.count = function(item) {
    if (this.amount === 'max') {
      return Math.max(1, item.getAffordable(this.getBudget(), MAX_BULK_BUY));
    }
    return this.amount;
  };
  BulkBuyer.prototype.cost = function(item) {
    return item.getCost(this.count(item));
  };
  BulkBuyer.prototype.canAfford = function(item) {
    return this.getBudget() >= this.cost(item);
  };
  /** Buy count(item) items with buyOne, which returns the price paid or a
   * negative number if the purchase failed. Returns the total paid. */
  BulkBuyer.prototype.buy = function(item, buyOne) {
    if (!this.canAfford(item)) {
      return 0;
    }
    var n = this.count(item), total = 0;
    for (var i = 0; i < n; i++) {
      var cost = buyOne();
      if (cost < 0) {
        break;
      }
      total += cost;
    }
    return total;
  };

  /** Save the game, keeping track of play time and when it was last open. */
  var saveGame = function() {
    if (!savingEnabled) {
      return;
    }
    var saveTime = new Date().getTime();
    lab.state.time += saveTime - lastSaved;
    lab.state.lastSeen = saveTime;
    game.save();
    lastSaved = saveTime;
  };

  // Reward the time the game was closed, and save straight away so the same
  // period cannot be counted twice.
  var offline = game.applyOfflineProgress(lastSaved);
  if (offline) {
    saveGame();
    UI.showOfflineProgress(offline);
  }

  var player = game.player.state;
  var prestige = game.prestige.state;
  var secrets = game.secrets.state;

  // After the reload that follows an expansion or a new multiverse, welcome
  // the new universe.
  var arrival = function(key) {
    try {
      var info = JSON.parse(window.sessionStorage.getItem(key));
      window.sessionStorage.removeItem(key);
      return info;
    } catch (e) {
      return null;
    }
  };
  var expansionInfo = arrival('expansion'), multiverseInfo = arrival('multiverse');
  if (expansionInfo) {
    $(function() { UI.showUniverseIntro(expansionInfo); });
  }
  if (multiverseInfo) {
    $(function() { UI.showMultiverseIntro(multiverseInfo); });
  }

  /** XP for each kind of progress, before bonuses. */
  var XP = {click: 1, hire: 5, research: 10, upgrade: 25, term: 25, anomaly: 30,
            achievement: 50, action: 10};
  /** Add XP, multiplied by the XP bonus unless exact. Level-ups can unlock
   * lab actions, which are announced. */
  var gainXp = function(amount, exact) {
    var before = player.level;
    if (game.addXp(amount, exact) > 0) {
      UI.showLevelUp(player.level);
      game.actions.forEach(function(a) {
        if (a.level > before && a.level <= player.level) {
          UI.showPopup('alert-info', a.icon, 'New lab action: <strong>' + a.name +
                       '</strong>. Find it under the detector.', 6000);
        }
      });
    }
  };

  /** Hand out the reward of an experiment that has finished, also one that
   * finished while the game was closed. */
  var finishExperiment = function() {
    var result = game.finishExperiment(new Date().getTime());
    if (!result) {
      return;
    }
    var amount = Helpers.formatNumberPostfix(result.amount), text;
    if (result.type === 'xp') {
      gainXp(result.amount, true);
      text = amount + ' XP';
    } else if (result.type === 'data') {
      UI.showUpdateValue('#update-data', result.amount);
      text = amount + ' data';
    } else {
      UI.showUpdateValue('#update-funding', result.amount);
      text = 'JTN ' + amount;
    }
    UI.showMessage(result.experiment.icon, '<strong>' + result.experiment.name +
        '</strong> is done! It brought in <strong>' + text + '</strong>.', 8000);
    saveGame();
  };
  finishExperiment();
  GameObjects.Achievement.onUnlock = function() {
    gainXp(XP.achievement);
  };

  /** Tell the event display what the lab has unlocked. */
  var updateEffects = function() {
    var used = function(key) { return !!allObjects[key].state.used; };
    var discovered = function(key) { return allObjects[key].state.level > 0; };
    var count = function(prefix, n) {
      var c = 0;
      for (var i = 1; i <= n; i++) {
        c += used(prefix + i) ? 1 : 0;
      }
      return c;
    };
    $.extend(detector.effects, {
      energy: count('upgrade-energy', 12),
      lumi: count('upgrade-lumi', 12),
      photons: used('upgrade-sps'),
      jets: used('upgrade-tevatron'),
      golden: used('upgrade-lhc'),
      pileup: used('upgrade-hllhc'),
      shockwave: used('upgrade-fcc'),
      displaced: discovered('research-beauty'),
      met: discovered('research-neutrino'),
      annihilation: discovered('research-antihydrogen'),
      heavyIon: discovered('research-qgp'),
      darkTracks: prestige.expansions > 0,
      boost: dataMultiplier() > 1
    });
  };
  updateEffects();

  var lastTheme = Settings.get('theme');
  Settings.onChange(function(values) {
    detector.quality = values.effects;
    detector.setTheme(Settings.isDark());
    if (values.theme === 'dark') {
      secrets.darkSide = 1;
    }
    if (values.theme !== lastTheme) {
      secrets.themeSwitches += 1;
      lastTheme = values.theme;
    }
    if (values.numbers === 'scientific') {
      secrets.nerd = 1;
    }
  });

  // Particle skins, unlocked by the number of achievements.
  var skins = Helpers.loadFile('json/skins.json');
  var achievedCount = function() {
    return achievements.filter(function(a) { return a.isAchieved(); }).length;
  };
  var skinUnlocked = function(skin) {
    return achievedCount() >= skin.requires;
  };
  var unlockedSkinCount = function() {
    var n = achievedCount();
    return skins.filter(function(s) { return n >= s.requires; }).length;
  };
  /** Use the chosen skin while it is unlocked, and the classic look if not
   * (after a restart, for example). */
  var applySkin = function() {
    var chosen = skins.filter(function(s) { return s.key === Settings.get('skin'); })[0];
    detector.skin = chosen && skinUnlocked(chosen) ? chosen : skins[0];
  };
  applySkin();
  var skinsKnown = unlockedSkinCount();
  var checkSkins = function() {
    var n = unlockedSkinCount();
    for (var i = skinsKnown; i < n; i++) {
      UI.showPopup('alert-info', 'fa-paint-brush', 'New particle skin: <strong>' + skins[i].name +
                   '</strong>. Try it under Skins in the top bar.', 4000);
    }
    skinsKnown = n;
    applySkin();
  };
  var useSkin = function(skin) {
    if (!skinUnlocked(skin)) {
      return;
    }
    Settings.set('skin', skin.key);
    applySkin();
    // Secret: try five different skins.
    secrets.skinsTried |= 1 << skins.indexOf(skin);
    var tried = 0;
    for (var i = 0; i < skins.length; i++) {
      tried += (secrets.skinsTried >> i) & 1;
    }
    if (tried >= 5) {
      secrets.fashionista = 1;
    }
  };

  // Secret achievements that are checked every second.
  var PARTICLES = /\b(electron|positron|muon|tau|neutrino|quark|gluon|photon|higgs|boson|proton|neutron|pion|kaon|hadron|lepton|meson|baryon|graviton|axion)s?\b/i;
  var lastInteraction = new Date().getTime();
  ['mousedown', 'keydown', 'touchstart'].forEach(function(type) {
    document.addEventListener(type, function() { lastInteraction = new Date().getTime(); }, true);
  });
  document.addEventListener('visibilitychange', function() {
    lastInteraction = new Date().getTime();
  });
  var checkSecrets = function() {
    var now = new Date();
    if (now.getHours() < 5) {
      secrets.nightOwl = 1;
    }
    if ((now.getHours() === 3 || now.getHours() === 15) && now.getMinutes() === 14) {
      secrets.piTime = 1;
    }
    var name = String(lab.state.name).trim();
    if (name.toLowerCase() === 'cern') {
      secrets.homeSweetHome = 1;
    }
    if (PARTICLES.test(name)) {
      secrets.namesake = 1;
    }
    // Ten minutes with the game in view and no clicks or keys.
    if (detector.visible && now.getTime() - lastInteraction >= 10 * 60 * 1000) {
      secrets.patience = 1;
    }
  };
  /** Secret: spend at least 99% of your funding (and at least JTN 1k) at once. */
  var checkAllIn = function(before, spent) {
    if (before >= 1000 && spent >= 0.99 * before) {
      secrets.allIn = 1;
    }
  };
  /** The Lab Manager (dark matter upgrades), when switched on: hires staff
   * and does research while they cost at most a tenth of the funding or data,
   * cheapest first, and buys every upgrade the lab can afford. Runs once a
   * second. */
  var AUTO_SHARE = 0.1, AUTO_MAX = 100;
  var upgradesByPrice = upgrades.slice().sort(function(a, b) { return a.cost - b.cost; });
  var autoOn = function(kind) {
    return !!game.bonus[kind] && !!Settings.get(kind);
  };
  /** The cheapest of items whose price fits the budget, or null. */
  var cheapest = function(items, budget) {
    var best = null;
    items.forEach(function(item) {
      if (item.state.cost <= budget && item.meetsRequirements(allObjects) &&
          (!best || item.state.cost < best.state.cost)) {
        best = item;
      }
    });
    return best;
  };
  var runLabManager = function() {
    var spent = 0, count = 0, i;
    if (autoOn('autoUpgrade')) {
      upgradesByPrice.forEach(function(u) {
        if (u.isAvailable(lab, allObjects) && u.buy(lab, allObjects) > 0) {
          spent += u.cost;
          count++;
        }
      });
      if (count > 0) {
        player.upgradesBought += count;
        gainXp(XP.upgrade * count);
        updateEffects();
      }
    }
    if (autoOn('autoHire')) {
      for (count = 0, i = 0; i < AUTO_MAX; i++) {
        var w = cheapest(workers, AUTO_SHARE * lab.state.money);
        var paid = w ? w.hire(lab, allObjects) : -1;
        if (paid < 0) {
          break;
        }
        spent += paid;
        count++;
      }
      if (count > 0) {
        player.staffHired += count;
        gainXp(XP.hire * count);
      }
    }
    if (spent > 0) {
      UI.showUpdateValue('#update-funding', -spent);
    }
    if (autoOn('autoResearch')) {
      var used = 0, reputation = lab.state.reputation;
      for (count = 0, i = 0; i < AUTO_MAX; i++) {
        var r = cheapest(research, AUTO_SHARE * lab.state.data);
        var cost = r ? r.research(lab, allObjects) : -1;
        if (cost < 0) {
          break;
        }
        used += cost;
        count++;
      }
      if (count > 0) {
        player.researchLevels += count;
        gainXp(XP.research * count);
        UI.showUpdateValue('#update-data', -used);
        UI.showUpdateValue('#update-reputation', lab.state.reputation - reputation);
        updateEffects();
      }
    }
  };

  var KONAMI = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65], konamiAt = 0;
  document.addEventListener('keydown', function(e) {
    konamiAt = e.keyCode === KONAMI[konamiAt] ? konamiAt + 1 : (e.keyCode === KONAMI[0] ? 1 : 0);
    if (konamiAt === KONAMI.length) {
      konamiAt = 0;
      secrets.konami = 1;
    }
  });

  var app = angular.module('particleClicker', []);

  app.filter('niceNumber', ['$filter', function($filter) {
      // Stateful: the result also depends on the number format setting.
      var filter = function(input) { return Helpers.formatNumberPostfix(input); };
      filter.$stateful = true;
      return filter;
  }]);

  app.filter('niceTime', ['$filter', function($filter) {
      return Helpers.formatTime;
  }]);

  app.filter('currency', ['$filter', function($filter) {
    var filter = function(input) {
      return 'JTN ' + $filter('niceNumber')(input);
    };
    filter.$stateful = true;
    return filter;
  }]);

  app.filter('reverse', ['$filter', function($filter) {
    return function(items) {
      return items.slice().reverse();
    };
  }]);

  app.controller('DetectorController', function() {
    var recentClicks = [];
    this.click = function() {
      var now = new Date().getTime();
      combo.steps = now - combo.last < COMBO_GAP ? Math.min(combo.steps + 1, COMBO_STEPS) : 0;
      combo.last = now;
      player.bestCombo = Math.max(player.bestCombo, combo.steps);
      var amount = lab.clickDetector(dataMultiplier() * game.actionFactor('click', now) *
                                     comboFactor());
      detector.addEvent();
      UI.showUpdateValue("#update-data", amount);
      gainXp(XP.click);
      recentClicks.push(now);
      while (now - recentClicks[0] > 2000) {
        recentClicks.shift();
      }
      if (recentClicks.length >= 15) {
        secrets.speedOfLight = 1;
      }
      return false;
    };
    /** The combo, shown on the detector once it reaches ×1.1. */
    this.combo = comboFactor;
    this.comboShown = function() {
      return comboFactor() >= 1 + 5 * COMBO_STEP - 1e-9;
    };
  });

  // Hack to prevent text highlighting
  document.getElementById('detector').addEventListener('mousedown', function(e) {
    e.preventDefault();
  });

  app.controller('LabController', ['$interval', function($interval) {
    this.lab = lab;
    this.dataRate = function() {
      return (game.getDataRate() + game.getAutoRate()) * dataMultiplier();
    };
    /** All data boosts together, e.g. 6 for a beam boost and Night Shift. */
    this.boostFactor = function() {
      return Math.round(dataMultiplier() * 10) / 10;
    };
    /** Seconds until the first of the running data boosts ends. */
    this.boostLeft = function() {
      var now = new Date().getTime();
      var left = [boostUntil - now, game.dataBoostLeft(now)].filter(function(t) { return t > 0; });
      return left.length ? Math.ceil(Math.min.apply(Math, left) / 1000) : 0;
    };
    this.showDetectorInfo = function() {
      if (!this._detectorInfo) {
        this._detectorInfo = Helpers.loadFile('html/detector.html');
      }
      UI.showModal('Detector', this._detectorInfo);
    };
    $interval(function() {  // one tick
      var grant = lab.getGrant();
      UI.showUpdateValue("#update-funding", grant);
      var sum = (game.getDataRate() + game.getAutoRate()) * dataMultiplier();
      if (sum > 0) {
        lab.acquireData(sum);
        UI.showUpdateValue("#update-data", sum);
        detector.addEventExternal(workers.map(function(w) {
          return w.state.hired;
        }).reduce(function(a, b){return a + b}, 0));
      }
      if (game.bonus.autoClicks > 0 && detector.visible) {
        detector.addEvent();  // the automated trigger at work
      }
      runLabManager();
      finishExperiment();
      if (dataMultiplier() >= 10) {
        secrets.stacked = 1;  // Secret: boosts stacked to ten times the data
      }
      updateEffects();
      checkSecrets();
      checkSkins();
    }, 1000);
  }]);

  /** The Lab Manager's switch for one kind of purchase, shown in its list
   * once the dark matter upgrade is bought. */
  var AutoSwitch = function(kind) {
    this.kind = kind;
  };
  AutoSwitch.prototype.owned = function() {
    return !!game.bonus[this.kind];
  };
  AutoSwitch.prototype.on = function() {
    return autoOn(this.kind);
  };
  AutoSwitch.prototype.toggle = function() {
    Settings.set(this.kind, !Settings.get(this.kind));
  };

  app.controller('ResearchController', ['$compile', function($compile) {
    this.research = cheapestFirst(research, function(r) { return r.baseCost; });
    this.bulk = new BulkBuyer(function() { return lab.state.data; });
    this.auto = new AutoSwitch('autoResearch');
    this.isVisible = function(item) {
      return item.isVisible(lab, allObjects);
    };
    this.isAvailable = function(item) {
      return item.meetsRequirements(allObjects) && this.bulk.canAfford(item);
    };
    this.reputationBonus = function() {
      return game.bonus.reputation;
    };
    this.doResearch = function(item) {
      var reputation = 0, levels = 0;
      var cost = this.bulk.buy(item, function() {
        var before = lab.state.reputation;
        var paid = item.research(lab, allObjects);
        if (paid >= 0) {
          reputation += lab.state.reputation - before;
          levels++;
        }
        return paid;
      });
      player.researchLevels += levels;
      if (cost > 0) {
        UI.showUpdateValue("#update-data", -cost);
        UI.showUpdateValue("#update-reputation", reputation);
        gainXp(XP.research * levels);
        updateEffects();
      }
    };
    this.showInfo = function(r) {
      UI.showModal(r.name, r.getInfo());
      UI.showLevels(r.state.level);
      // Secret: read the page of every research topic. One bit per topic;
      // with more than 31 topics, JavaScript's 32-bit | and << won't do.
      var bit = Math.pow(2, research.indexOf(r));
      if (Math.floor(secrets.infoPages / bit) % 2 === 0) {
        secrets.infoPages += bit;
      }
      if (secrets.infoPages === Math.pow(2, research.length) - 1) {
        secrets.curious = 1;
      }
    };
  }]);

  app.controller('HRController', function() {
    this.workers = cheapestFirst(workers, function(w) { return w.baseCost; });
    this.bulk = new BulkBuyer(function() { return lab.state.money; });
    this.auto = new AutoSwitch('autoHire');
    this.isVisible = function(worker) {
      return worker.isVisible(lab, allObjects);
    };
    this.isAvailable = function(worker) {
      return worker.meetsRequirements(allObjects) && this.bulk.canAfford(worker);
    };
    this.dataBonus = function() {
      return game.bonus.data;
    };
    this.hire = function(worker) {
      var hired = 0, before = lab.state.money;
      var total = this.bulk.buy(worker, function() {
        var paid = worker.hire(lab, allObjects);
        hired += paid >= 0 ? 1 : 0;
        return paid;
      });
      if (total > 0) {
        UI.showUpdateValue("#update-funding", -total);
        gainXp(XP.hire * hired);
        player.staffHired += hired;
        checkAllIn(before, total);
      }
    };
  });

  app.controller('UpgradesController', function() {
    this.upgrades = cheapestFirst(upgrades, function(u) { return u.cost; });
    this.auto = new AutoSwitch('autoUpgrade');
    this.isVisible = function(upgrade) {
      return upgrade.isVisible(lab, allObjects);
    };
    this.isAvailable = function(upgrade) {
      return upgrade.isAvailable(lab, allObjects);
    };
    this.upgrade = function(upgrade) {
      var before = lab.state.money;
      if (upgrade.buy(lab, allObjects) > 0) {
        checkAllIn(before, upgrade.cost);
        UI.showUpdateValue("#update-funding", -upgrade.cost);
        player.upgradesBought += 1;
        gainXp(XP.upgrade);
        updateEffects();
      }
    };
    /** How many of the upgrades on show the funding buys, cheapest first. */
    this.affordable = function() {
      var money = lab.state.money, n = 0;
      this.upgrades.forEach(function(u) {
        if (u.cost <= money && u.isVisible(lab, allObjects) && u.isAvailable(lab, allObjects)) {
          money -= u.cost;
          n++;
        }
      });
      return n;
    };
    /** Buy every upgrade on show that the funding allows, cheapest first. */
    this.buyAll = function() {
      var before = lab.state.money, total = 0, n = 0;
      this.upgrades.forEach(function(u) {
        if (u.isVisible(lab, allObjects) && u.isAvailable(lab, allObjects) && u.buy(lab, allObjects) > 0) {
          total += u.cost;
          n++;
        }
      });
      if (n > 0) {
        checkAllIn(before, total);
        UI.showUpdateValue("#update-funding", -total);
        player.upgradesBought += n;
        gainXp(XP.upgrade * n);
        updateEffects();
      }
    };
  });

  app.controller('AchievementsController', function($scope) {
    $scope.achievements = achievements;
    $scope.progress = function() {
      return achievements.filter(function(a) { return a.validate(lab, allObjects, lastSaved); }).length;
    };
    var secretOnes = achievements.filter(function(a) { return a.secret; });
    $scope.secretCount = secretOnes.length;
    $scope.secretsFound = function() {
      return secretOnes.filter(function(a) { return a.isAchieved(); }).length;
    };
  });

  /** Draws the preview of a skin (scope.s) and redraws it when the theme changes. */
  app.directive('skinPreview', function() {
    return {
      link: function(scope, element) {
        Settings.onChange(function() { detector.drawPreview(element[0], scope.s); });
      }
    };
  });

  app.controller('SkinsController', ['$scope', '$element', function($scope, $element) {
    $scope.skins = skins;
    $scope.achieved = achievedCount;
    $scope.unlocked = skinUnlocked;
    $scope.skinsNew = function() {
      return unlockedSkinCount() > Settings.get('skinsSeen');
    };
    // Opening the skins window clears the "New" label in the top bar.
    if ($element.is('#skins-modal')) {
      $element.on('shown.bs.modal', function() {
        $scope.$evalAsync(function() { Settings.set('skinsSeen', unlockedSkinCount()); });
      });
    }
    $scope.inUse = function(skin) {
      return detector.skin === skin;
    };
    $scope.use = useSkin;
  }]);

  app.controller('SaveController',
      ['$scope', '$interval', function($scope, $interval) {
    $scope.lastSaved = lastSaved;
    $scope.saveNow = function() {
      saveGame();
      $scope.lastSaved = lastSaved;
    };
    $interval($scope.saveNow, 10000);
    // Ctrl+S (Cmd+S on a Mac) saves the game instead of the web page.
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.keyCode === 83)) {
        e.preventDefault();
        secrets.saveShortcut = 1;
        $scope.$apply($scope.saveNow);
      }
    });
    // Also save when the page is closed so no progress is lost.
    window.addEventListener('pagehide', saveGame);
  }]);

  /** The Restart window: wipes the progress but keeps the settings. */
  app.controller('RestartController', ['$scope', function($scope) {
    $scope.restart = function() {
      savingEnabled = false;
      var settings = ObjectStorage.load(Settings.KEY);
      ObjectStorage.clear();
      ObjectStorage.save('saveVersion', Helpers.saveVersion);
      ObjectStorage.save('updatesSeen', updatesSeen);
      if (settings) {
        ObjectStorage.save(Settings.KEY, settings);
      }
      window.location.reload(true);
    };
  }]);

  app.controller('TransferController', ['$scope', function($scope) {
    var reset = function() {
      saveGame();
      $scope.exportCode = game.exportSave();
      $scope.importCode = '';
      $scope.error = '';
      $scope.copied = false;
      $scope.confirming = false;
    };
    reset();
    $('#transfer-modal').on('show.bs.modal', function() {
      $scope.$apply(reset);
    });
    $scope.copy = function() {
      var textarea = document.getElementById('export-code');
      textarea.select();
      var done = function() { $scope.copied = true; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText($scope.exportCode).then(function() {
          $scope.$apply(done);
        }, function() {
          document.execCommand('copy');
          $scope.$apply(done);
        });
      } else {
        document.execCommand('copy');
        done();
      }
    };
    /** Loading asks first, inside the window, because it replaces the
     * current progress. */
    $scope.load = function() {
      $scope.error = '';
      if (!$scope.importCode || !$scope.importCode.trim()) {
        $scope.error = 'Paste a save code first.';
        return;
      }
      $scope.confirming = true;
    };
    $scope.loadNow = function() {
      $scope.confirming = false;
      try {
        game.importSave($scope.importCode);
      } catch (e) {
        $scope.error = e.message;
        return;
      }
      savingEnabled = false;
      window.location.reload();
    };
  }]);

  /** Lets the Anomaly Hunt action reach the anomalies on the detector. */
  var anomalyControl = {
    showing: function() { return false; },
    spawnNow: function() { return false; }
  };

  app.controller('AnomalyController',
      ['$scope', '$timeout', function($scope, $timeout) {
    // Seconds until the first anomaly, and between anomalies before upgrades.
    // The lifetime, rewards and boost come from the lab so upgrades can
    // change them.
    var FIRST_DELAY = [45, 90];
    var DELAY = [120, 300];
    var fadeTimer;
    var format = Helpers.formatNumberPostfix;
    var rewards = [
      function() {
        var amount = Math.max(game.getDataRate() * 120, lab.state.detector * 50) *
            lab.state.anomalyReward;
        lab.acquireData(amount);
        UI.showUpdateValue('#update-data', amount);
        return 'Rare decay! Your detector recorded <strong>' +
            format(amount) + ' data</strong>.';
      },
      function() {
        var amount = Math.max(lab.getGrantRate() * 120, 250) * lab.state.anomalyReward;
        lab.receiveMoney(amount);
        UI.showUpdateValue('#update-funding', amount);
        return 'Press coverage! Sponsors sent <strong>JTN ' + format(amount) +
            '</strong> in extra funding.';
      },
      function() {
        var factor = lab.state.boostFactor, duration = lab.state.boostDuration;
        boostUntil = new Date().getTime() + duration * 1000;
        var effect = factor === 2 ? 'doubled' : factor === 3 ? 'tripled' :
            'multiplied by ' + factor;
        return 'Beam boost! All data is ' + effect + ' for <strong>' +
            duration + ' seconds</strong>.';
      }
    ];

    var spawnedAt = 0, nextTimer = null;
    var schedule = function(range) {
      var seconds = (range[0] + Math.random() * (range[1] - range[0])) /
          (lab.state.anomalyRate * game.bonus.anomalyRate);
      nextTimer = $timeout(spawn, seconds * 1000);
    };
    // The Anomaly Hunt action makes the next anomaly appear right away.
    anomalyControl.showing = function() {
      return !!$scope.anomaly;
    };
    anomalyControl.spawnNow = function() {
      if ($scope.anomaly) {
        return false;
      }
      $timeout.cancel(nextTimer);
      spawn();
      return true;
    };
    var spawn = function() {
      if (!detector.visible) {  // don't waste anomalies on a hidden tab
        schedule([5, 10]);
        return;
      }
      var size = $('#detector').width() || 300;
      var button = 50;
      $scope.anomaly = {
        x: Math.round(size * 0.1 + Math.random() * (size * 0.8 - button)),
        y: Math.round(size * 0.1 + Math.random() * (size * 0.8 - button))
      };
      spawnedAt = new Date().getTime();
      fadeTimer = $timeout(function() {
        $scope.anomaly = null;
        secrets.missed += 1;
        secrets.streak = 0;
        schedule(DELAY);
      }, (lab.state.anomalyLifetime + game.bonus.anomalyLifetime) * 1000);
    };
    $scope.anomaly = null;
    $scope.catchAnomaly = function() {
      if (!$scope.anomaly) {
        return;
      }
      $timeout.cancel(fadeTimer);
      $scope.anomaly = null;
      lab.state.anomalies += 1;
      if (new Date().getTime() - spawnedAt < 1000) {
        secrets.reflexes = 1;
      }
      secrets.streak += 1;
      if (secrets.streak >= 5) {
        secrets.hotStreak = 1;
      }
      gainXp(XP.anomaly);
      var reward = rewards[Math.floor(Math.random() * rewards.length)];
      UI.showMessage('fa-certificate', reward(), 6000).addClass('anomaly-message');
      schedule(DELAY);
    };
    schedule(FIRST_DELAY);
  }]);

  app.controller('UpdatesController',
      ['$scope', '$element', function($scope, $element) {
    $scope.updates = updates;
    $scope.version = updates[0].version;
    $scope.isNew = function() {
      return updatesSeen !== updates[0].version;
    };
    // Opening the update log marks the latest update as read.
    if ($element.is('#updates-modal')) {
      $element.on('show.bs.modal', function() {
        $scope.$apply(function() {
          updatesSeen = updates[0].version;
          ObjectStorage.save('updatesSeen', updatesSeen);
        });
      });
    }
  }]);

  app.controller('LevelController', ['$scope', function($scope) {
    $scope.floor = Math.floor;
    $scope.player = player;
    $scope.prestige = prestige;
    $scope.needed = function() {
      return game.xpForLevel(player.level);
    };
    $scope.percent = function() {
      return Math.min(100, 100 * player.xp / game.xpForLevel(player.level));
    };
    var offerKey = null, offer = null;
    $scope.offer = function() {
      var key = [player.points, player.offerA, player.offerB, player.offerC].join();
      if (key !== offerKey) {
        offer = game.getBoostOffer();
        offerKey = [player.points, player.offerA, player.offerB, player.offerC].join();
      }
      return offer;
    };
    /** What the player already has of this boost, e.g. "+15%". */
    $scope.total = function(boost) {
      var n = player[boost.key] * boost.amount;
      if (boost.type === 'anomalyLifetime') {
        return '+' + n + ' s';
      }
      if (boost.type === 'offlineHours') {
        return '+' + n + ' h';
      }
      return '+' + Math.round(n * 100) + '%';
    };
    $scope.choose = function(boost) {
      if (game.chooseBoost(boost.key) && player.points <= 0) {
        $('#boost-modal').modal('hide');
      }
    };
    $scope.canExpand = function() {
      return game.darkMatterGain() >= 1;
    };
    $scope.showExpansion = function() {
      return prestige.lifetimeExpansions > 0 || $scope.canExpand();
    };
    $scope.canEnterMultiverse = function() {
      return game.stringGain() >= 1;
    };
    $scope.showMultiverse = function() {
      return game.multiverse.state.jumps > 0 || game.multiverseOpen();
    };
  }]);

  /** Closing a window cancels a confirmation that was waiting in it. */
  var cancelOnClose = function($scope, $element) {
    $element.on('hidden.bs.modal', function() {
      $scope.$evalAsync(function() { $scope.confirming = false; });
    });
  };

  app.controller('ExpansionController', ['$scope', '$element', function($scope, $element) {
    $scope.prestige = prestige;
    $scope.experiment = function() {
      return game.runningExperiment();
    };
    $scope.confirming = false;
    cancelOnClose($scope, $element);
    $scope.bonus = game.bonus;
    $scope.upgrades = game.darkMatterUpgrades;
    $scope.gain = function() {
      return game.darkMatterGain();
    };
    $scope.nextAt = function() {
      return game.nextDarkMatterAt();
    };
    $scope.at = function(darkMatter) {
      return game.darkMatterAt(darkMatter);
    };
    $scope.collected = function() {
      return game.multiverseData();
    };
    $scope.universe = function() {
      return game.universe();
    };
    $scope.multiverse = game.multiverse.state;
    $scope.percent = function(darkMatter) {
      return Math.round(game.bonus.perDarkMatter * darkMatter * 100);
    };
    $scope.bought = function(u) {
      return !!prestige[u.key];
    };
    $scope.locked = function(u) {
      return !!u.requires && !prestige[u.requires];
    };
    $scope.canBuy = function(u) {
      return game.canBuyDarkMatterUpgrade(u);
    };
    $scope.requiredName = function(u) {
      var required = game.darkMatterUpgrades.filter(function(x) { return x.key === u.requires; })[0];
      return required ? required.name : '';
    };
    $scope.buy = function(u) {
      if (game.buyDarkMatterUpgrade(u.key)) {
        saveGame();
      }
    };
    $scope.expanding = false;
    $scope.expand = function() {
      if ($scope.expanding || game.darkMatterGain() < 1) {
        return;
      }
      $scope.expanding = true;
      saveGame();
      var info = game.expand(new Date().getTime());
      savingEnabled = false;
      try {
        window.sessionStorage.setItem('expansion', JSON.stringify(info));
      } catch (e) {}
      $('#expansion-modal').modal('hide');
      UI.playExpansion(info, function() { window.location.reload(); });
    };
  }]);

  app.controller('MultiverseController', ['$scope', '$element', function($scope, $element) {
    $scope.multiverse = game.multiverse.state;
    $scope.experiment = function() {
      return game.runningExperiment();
    };
    $scope.confirming = false;
    cancelOnClose($scope, $element);
    $scope.prestige = prestige;
    $scope.upgrades = game.multiverseUpgrades;
    $scope.universe = function() {
      return game.universe();
    };
    $scope.open = function() {
      return game.multiverseOpen();
    };
    $scope.gain = function() {
      return game.stringGain();
    };
    $scope.nextAt = function() {
      return game.nextStringAt();
    };
    $scope.at = function(strings) {
      return game.stringsAt(strings);
    };
    /** Production bonus of the given number of strings, in percent. */
    $scope.percent = function(strings) {
      return Math.round(game.bonus.perString * strings * 100);
    };
    $scope.darkMatterPercent = function() {
      return Math.round(game.bonus.perDarkMatter * prestige.darkMatterTotal * 100);
    };
    $scope.bought = function(u) {
      return !!game.multiverse.state[u.key];
    };
    $scope.locked = function(u) {
      return !!u.requires && !game.multiverse.state[u.requires];
    };
    $scope.canBuy = function(u) {
      return game.canBuyMultiverseUpgrade(u);
    };
    $scope.requiredName = function(u) {
      var required = game.multiverseUpgrades.filter(function(x) { return x.key === u.requires; })[0];
      return required ? required.name : '';
    };
    $scope.buy = function(u) {
      if (game.buyMultiverseUpgrade(u.key)) {
        saveGame();
      }
    };
    $scope.entering = false;
    $scope.enter = function() {
      if ($scope.entering || game.stringGain() < 1) {
        return;
      }
      $scope.entering = true;
      saveGame();
      var info = game.enterMultiverse(new Date().getTime());
      savingEnabled = false;
      try {
        window.sessionStorage.setItem('multiverse', JSON.stringify(info));
      } catch (e) {}
      $('#multiverse-modal').modal('hide');
      UI.playMultiverse(info, function() { window.location.reload(); });
    };
  }]);

  /** Fills an element with HTML the game made itself: an equation term from
   * json/equation.json, or a Particle ID detector slice. */
  app.directive('termHtml', function() {
    return {
      link: function(scope, element, attrs) {
        scope.$watch(attrs.termHtml, function(html) { element.html(html || ''); });
      }
    };
  });

  app.controller('EquationController', ['$scope', function($scope) {
    $scope.terms = game.terms;
    $scope.equation = game.equation.state;
    $scope.bought = function() {
      return game.terms.slice(0, game.equation.state.terms);
    };
    $scope.next = function() {
      return game.nextTerm();
    };
    $scope.cost = function(term) {
      return game.termCost(term);
    };
    $scope.clicks = function() {
      return game.clicksToSpend();
    };
    $scope.size = function() {
      return game.equationSize();
    };
    $scope.percent = function() {
      return Math.round((game.bonus.equation - 1) * 1000) / 10;
    };
    $scope.perSymbol = function() {
      return Math.round(game.bonus.perSymbol * 1000) / 10;
    };
    $scope.canBuy = function() {
      return game.canBuyTerm();
    };
    $scope.buy = function() {
      if (game.buyTerm()) {
        gainXp(XP.term);
        saveGame();
      }
    };
  }]);

  /** A short time for the top bar: 45s, 12m, 3h (rounded up). */
  var shortTime = function(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    if (s > 3600) {
      return Math.ceil(s / 3600) + 'h';
    }
    return s > 60 ? Math.ceil(s / 60) + 'm' : s + 's';
  };

  app.controller('ExperimentsController', ['$scope', function($scope) {
    $scope.experiments = game.experiments;
    $scope.player = player;
    $scope.running = function() {
      return game.runningExperiment();
    };
    $scope.isRunning = function(e) {
      return game.runningExperiment() === e;
    };
    $scope.unlocked = function(e) {
      return game.experimentUnlocked(e);
    };
    /** The list shows the unlocked experiments and the next one to come. */
    $scope.shown = function(e) {
      if (game.experimentUnlocked(e)) {
        return true;
      }
      var next = game.experiments.filter(function(x) { return !game.experimentUnlocked(x); })[0];
      return e === next;
    };
    $scope.canStart = function(e) {
      return game.canStartExperiment(e);
    };
    /** Whether an experiment could start now: shown as a nudge in the top bar. */
    $scope.ready = function() {
      return !game.runningExperiment() && game.experiments.some(function(e) {
        return game.canStartExperiment(e);
      });
    };
    $scope.start = function(e) {
      if (game.startExperiment(e.key, new Date().getTime())) {
        saveGame();
      }
    };
    $scope.duration = function(e) {
      return game.experimentDuration(e) * 1000;
    };
    $scope.left = function() {
      return Math.max(0, game.experiment.state.endsAt - new Date().getTime());
    };
    $scope.shortLeft = function() {
      return shortTime($scope.left());
    };
    $scope.percent = function() {
      var x = game.experiment.state, total = x.endsAt - x.startedAt;
      return total > 0 ? Math.min(100, Math.round(100 * (new Date().getTime() - x.startedAt) / total)) : 0;
    };
    var amount = function(type, n) {
      var s = Helpers.formatNumberPostfix(n);
      return type === 'funding' ? 'JTN ' + s : s + (type === 'xp' ? ' XP' : ' data');
    };
    /** What the experiment gives, e.g. "15 min of data": some of the lab's
     * production when it ends, or part of a level. */
    $scope.rewardText = function(e) {
      if (!e) {
        return '';
      }
      var r = e.reward, factor = lab.state.experimentReward;
      if (r.type === 'xp') {
        return Math.round(r.amount * factor * 100) + '% of a level';
      }
      return Helpers.formatTime(r.seconds * factor * 1000) + ' of ' + r.type;
    };
    /** The same in data, funding or XP at today's rates. */
    $scope.rewardNow = function(e) {
      return e ? amount(e.reward.type, game.experimentReward(e)) : '';
    };
    /** How to unlock an experiment, from its first unmet requirement. */
    $scope.hint = function(e) {
      var r = e.requirements.filter(function(r) { return !game.meets([r]); })[0];
      if (!r) {
        return '';
      }
      if (r.key === 'player') {
        return 'Unlocks at level ' + r.threshold + '.';
      }
      if (r.key === 'prestige') {
        return 'Unlocks once you have expanded the universe.';
      }
      return 'Unlocks with a new research discovery.';
    };
  }]);

  /** Lets the Particle ID action start a round in its window. */
  var particleId = {start: function() {}};

  /** Lab actions: buttons under the detector for boosts and rewards, each
   * with a cooldown. They unlock with the player's level. */
  app.controller('ActionsController', ['$scope', function($scope) {
    var now = function() { return new Date().getTime(); };
    $scope.actions = game.actions;
    $scope.unlocked = function(a) {
      return game.actionUnlocked(a);
    };
    /** The bar shows the unlocked actions and the next one to come. */
    $scope.shown = function(a) {
      return game.actionUnlocked(a) ||
          a === game.actions.filter(function(x) { return !game.actionUnlocked(x); })[0];
    };
    $scope.ready = function(a) {
      return game.canUseAction(a, now()) && !(a.effect.type === 'anomaly' && anomalyControl.showing());
    };
    $scope.active = function(a) {
      return game.actionLeft(a, now()) > 0;
    };
    /** How much of the cooldown is still to go, in percent. */
    $scope.cooling = function(a) {
      return Math.round(100 * game.actionWait(a, now()) / (game.actionCooldown(a) * 1000));
    };
    /** The time on the button: how long its boost lasts, or until it is ready. */
    $scope.time = function(a) {
      var left = game.actionLeft(a, now()), wait = game.actionWait(a, now());
      return left > 0 ? shortTime(left) : wait > 0 ? shortTime(wait) : '';
    };
    $scope.tooltip = function(a) {
      return game.actionUnlocked(a) ? a.name + ': ' + a.description : a.name + ' unlocks at level ' + a.level + '.';
    };
    $scope.cooldownText = function(a) {
      return Helpers.formatTime(game.actionCooldown(a) * 1000);
    };
    $scope.use = function(a) {
      if (!game.actionUnlocked(a)) {
        UI.showPopup('alert-info', 'fa-lock', '<strong>' + a.name + '</strong> unlocks at level ' + a.level + '.', 3000);
        return;
      }
      if (!$scope.ready(a)) {
        return;
      }
      var result = game.useAction(a.key, now());
      if (!result) {
        return;
      }
      gainXp(XP.action);
      if (result.type === 'funding') {
        UI.showUpdateValue('#update-funding', result.amount);
      } else if (result.type === 'dataNow') {
        UI.showUpdateValue('#update-data', result.amount);
      } else if (result.type === 'anomaly') {
        anomalyControl.spawnNow();
      } else if (result.type === 'game') {
        particleId.start();
      }
      if (result.type !== 'game') {
        UI.showPopup('alert-info', a.icon, '<strong>' + a.name + '</strong>: ' + a.description, 3000);
      }
      saveGame();
    };
  }]);

  /** Particle ID: five detector slices; name the particle in each. Every
   * right answer makes the data boost at the end bigger. Closing the window
   * early ends the round with the answers so far. */
  app.controller('ParticleIdController', ['$scope', '$element', function($scope, $element) {
    var ROUND = 5;
    $scope.types = ParticleId.TYPES;
    $scope.round = null;
    $scope.view = {legend: false};
    particleId.start = function() {
      $scope.round = {n: 1, total: ROUND, right: 0, question: ParticleId.question(null), answer: null, result: null};
      $element.modal('show');
    };
    $scope.answer = function(t) {
      var r = $scope.round;
      if (!r || r.answer || r.result) {
        return;
      }
      r.answer = t;
      if (t === r.question.type) {
        r.right += 1;
      }
    };
    $scope.correct = function() {
      return $scope.round && $scope.round.answer === $scope.round.question.type;
    };
    /** Once answered, the right answer turns green, and a wrong pick red. */
    $scope.answerClass = function(t) {
      var r = $scope.round;
      if (r && r.answer) {
        if (t === r.question.type) {
          return 'btn-success';
        }
        if (t === r.answer) {
          return 'btn-danger';
        }
      }
      return 'btn-default';
    };
    var finish = function() {
      var r = $scope.round;
      if (!r || r.result) {
        return;
      }
      r.result = game.finishParticleId(r.right, ROUND, new Date().getTime());
      if (r.result.xp > 0) {
        gainXp(r.result.xp, true);
      }
      saveGame();
    };
    $scope.next = function() {
      var r = $scope.round;
      if (r.n >= ROUND) {
        finish();
        return;
      }
      r.n += 1;
      r.question = ParticleId.question(r.question.type.key);
      r.answer = null;
    };
    $element.on('hide.bs.modal', function() {
      $scope.$evalAsync(finish);
    });
  }]);

  /** The news ticker: a headline every few seconds. Headlines about something
   * new in the lab come first, then a random one that hasn't come up lately. */
  var news = Helpers.loadFile('json/news.json');
  app.controller('NewsController', ['$scope', '$interval', '$timeout', function($scope, $interval, $timeout) {
    var NEWS_SECONDS = 15, recent = [], seen = {};
    var pick = function() {
      var open = news.filter(function(n) { return game.meets(n.requirements); });
      var fresh = open.filter(function(n) { return n.requirements && n.requirements.length && !seen[n.text]; });
      var pool = open.filter(function(n) { return recent.indexOf(n) < 0; });
      var n = fresh[0] || pool[Math.floor(Math.random() * pool.length)] || open[0];
      seen[n.text] = true;
      recent.push(n);
      if (recent.length > Math.min(20, open.length - 1)) {
        recent.shift();
      }
      return n;
    };
    // Headlines that were already true when the game was opened are old news.
    news.forEach(function(n) {
      if (game.meets(n.requirements)) {
        seen[n.text] = true;
      }
    });
    $scope.enabled = function() {
      return Settings.get('news');
    };
    $scope.headline = pick();
    $scope.fading = false;
    $interval(function() {
      if (!Settings.get('news') || !detector.visible) {
        return;
      }
      $scope.fading = true;
      $timeout(function() {
        $scope.headline = pick();
        $scope.fading = false;
      }, Settings.get('reduceMotion') ? 0 : 400);
    }, NEWS_SECONDS * 1000);
  }]);

  app.controller('SettingsController', ['$scope', '$timeout', function($scope, $timeout) {
    var keys = ['theme', 'numbers', 'effects', 'floatingNumbers', 'popups', 'reduceMotion', 'news'];
    $scope.s = {};
    keys.forEach(function(k) { $scope.s[k] = Settings.get(k); });
    $scope.set = function(key, value) {
      Settings.set(key, value);
      $scope.s[key] = Settings.get(key);
      if (key === 'news') {
        // The ticker takes room above the detector: size the detector again
        // once it has been shown or hidden.
        $timeout(function() { $(window).trigger('resize'); });
      }
    };
  }]);

  app.controller('StatsController', function($scope) {
    $scope.lab = lab;
    $scope.player = player;
    $scope.prestige = prestige;
    $scope.multiverse = game.multiverse.state;
    $scope.equation = game.equation.state;
    $scope.universe = function() {
      return game.universe();
    };
    $scope.equationSize = function() {
      return game.equationSize();
    };
    $scope.dataRate = function() {
      return game.getDataRate() + game.getAutoRate();
    };
    $scope.playTime = function() {
      return lab.state.time + new Date().getTime() - lastSaved;
    };
    $scope.staff = function() {
      return workers.reduce(function(sum, w) { return sum + w.state.hired; }, 0);
    };
    $scope.researchLevels = function() {
      return research.reduce(function(sum, r) { return sum + r.state.level; }, 0);
    };
    $scope.achieved = function() {
      return achievements.filter(function(a) { return a.isAchieved(); }).length;
    };
    $scope.achievementCount = achievements.length;
  });

  // Without local storage (a private window, blocked site data), progress
  // only lasts until the page is closed.
  if (!ObjectStorage.persistent) {
    $(function() {
      UI.showMessage('fa-exclamation-triangle', 'This browser is not keeping saves for ' +
          'this page, so your progress is lost when you close it. To keep it, use ' +
          '<strong>Saved &rsaquo; Export / import save</strong>.');
    });
  }

  // Start Angular once the page is ready. As a claude.ai artifact, the viewer
  // can swap in a new version of the page while it is open: save first, and
  // start through its hook. The game itself lives in local storage.
  var hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    hot.snapshot(function() {
      saveGame();
      return {};
    });
  }
  var start = function() {
    angular.bootstrap(document.documentElement, ['particleClicker']);
    $(window).trigger('resize');  // measure the layout with its contents shown
  };
  $(function() {
    if (hot && hot.ready) {
      hot.ready(start);
    } else {
      start();
    }
  });

  analytics.init();
  analytics.sendScreen(analytics.screens.main);
})();
