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

  /** Factor applied to all data while a beam boost is active. */
  var dataMultiplier = function() {
    return new Date().getTime() < boostUntil ? lab.state.boostFactor : 1;
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
            achievement: 50};
  var gainXp = function(amount) {
    if (game.addXp(amount) > 0) {
      UI.showLevelUp(player.level);
    }
  };
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
      var amount = lab.clickDetector(dataMultiplier());
      detector.addEvent();
      UI.showUpdateValue("#update-data", amount);
      gainXp(XP.click);
      var now = new Date().getTime();
      recentClicks.push(now);
      while (now - recentClicks[0] > 2000) {
        recentClicks.shift();
      }
      if (recentClicks.length >= 15) {
        secrets.speedOfLight = 1;
      }
      return false;
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
    this.boostFactor = function() {
      return lab.state.boostFactor;
    };
    this.boostLeft = function() {
      return Math.max(0, Math.ceil((boostUntil - new Date().getTime()) / 1000));
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
      updateEffects();
      checkSecrets();
      checkSkins();
    }, 1000);
  }]);

  app.controller('ResearchController', ['$compile', function($compile) {
    this.research = cheapestFirst(research, function(r) { return r.baseCost; });
    this.bulk = new BulkBuyer(function() { return lab.state.data; });
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
      // Secret: read the page of every research topic.
      secrets.infoPages |= 1 << research.indexOf(r);
      if (secrets.infoPages === (1 << research.length) - 1) {
        secrets.curious = 1;
      }
    };
  }]);

  app.controller('HRController', function() {
    this.workers = cheapestFirst(workers, function(w) { return w.baseCost; });
    this.bulk = new BulkBuyer(function() { return lab.state.money; });
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
    }
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

    var spawnedAt = 0;
    var schedule = function(range) {
      var seconds = (range[0] + Math.random() * (range[1] - range[0])) /
          (lab.state.anomalyRate * game.bonus.anomalyRate);
      $timeout(spawn, seconds * 1000);
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

  /** Fills an element with the HTML of an equation term (from our own
   * json/equation.json). */
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

  app.controller('SettingsController', ['$scope', function($scope) {
    var keys = ['theme', 'numbers', 'effects', 'floatingNumbers', 'popups', 'reduceMotion'];
    $scope.s = {};
    keys.forEach(function(k) { $scope.s[k] = Settings.get(k); });
    $scope.set = function(key, value) {
      Settings.set(key, value);
      $scope.s[key] = Settings.get(key);
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
