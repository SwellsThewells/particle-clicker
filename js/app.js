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

  // After the reload that follows an expansion, welcome the new universe.
  var expansionInfo = null;
  try {
    expansionInfo = JSON.parse(window.sessionStorage.getItem('expansion'));
    window.sessionStorage.removeItem('expansion');
  } catch (e) {}
  if (expansionInfo) {
    $(function() { UI.showUniverseIntro(expansionInfo); });
  }

  /** XP for each kind of progress, before bonuses. */
  var XP = {click: 1, hire: 5, research: 10, upgrade: 25, anomaly: 30, achievement: 50};
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

  Settings.onChange(function(values) {
    detector.quality = values.effects;
    detector.setTheme(Settings.isDark());
    if (Settings.isDark()) {
      secrets.darkSide = 1;
    }
  });

  // Secret achievements that are checked every second.
  var checkSecrets = function() {
    if (new Date().getHours() < 5) {
      secrets.nightOwl = 1;
    }
    if (String(lab.state.name).trim().toLowerCase() === 'cern') {
      secrets.homeSweetHome = 1;
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
    }, 1000);
  }]);

  app.controller('ResearchController', ['$compile', function($compile) {
    this.research = research;
    this.bulk = new BulkBuyer(function() { return lab.state.data; });
    this.isVisible = function(item) {
      return item.isVisible(lab);
    };
    this.isAvailable = function(item) {
      return this.bulk.canAfford(item);
    };
    this.reputationBonus = function() {
      return game.bonus.reputation;
    };
    this.doResearch = function(item) {
      var reputation = 0, levels = 0;
      var cost = this.bulk.buy(item, function() {
        var before = lab.state.reputation;
        var paid = item.research(lab);
        if (paid >= 0) {
          reputation += lab.state.reputation - before;
          levels++;
        }
        return paid;
      });
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
    this.workers = workers;
    this.bulk = new BulkBuyer(function() { return lab.state.money; });
    this.isVisible = function(worker) {
      return worker.isVisible(lab);
    };
    this.isAvailable = function(worker) {
      return this.bulk.canAfford(worker);
    };
    this.dataBonus = function() {
      return game.bonus.data;
    };
    this.hire = function(worker) {
      var hired = 0;
      var total = this.bulk.buy(worker, function() {
        var paid = worker.hire(lab);
        hired += paid >= 0 ? 1 : 0;
        return paid;
      });
      if (total > 0) {
        UI.showUpdateValue("#update-funding", -total);
        gainXp(XP.hire * hired);
      }
    };
  });

  app.controller('UpgradesController', function() {
    this.upgrades = upgrades;
    this.isVisible = function(upgrade) {
      return upgrade.isVisible(lab, allObjects);
    };
    this.isAvailable = function(upgrade) {
      return upgrade.isAvailable(lab, allObjects);
    };
    this.upgrade = function(upgrade) {
      if (upgrade.buy(lab, allObjects) > 0) {
        UI.showUpdateValue("#update-funding", -upgrade.cost);
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

  app.controller('SaveController',
      ['$scope', '$interval', function($scope, $interval) {
    $scope.lastSaved = lastSaved;
    $scope.saveNow = function() {
      saveGame();
      $scope.lastSaved = lastSaved;
    };
    $scope.restart = function() {
      if (window.confirm(
        'Do you really want to restart the game? All progress will be lost.'
      )) {
        savingEnabled = false;
        var settings = ObjectStorage.load(Settings.KEY);
        ObjectStorage.clear();
        ObjectStorage.save('saveVersion', Helpers.saveVersion);
        ObjectStorage.save('updatesSeen', updatesSeen);
        if (settings) {
          ObjectStorage.save(Settings.KEY, settings);
        }
        window.location.reload(true);
      }
    };
    $interval($scope.saveNow, 10000);
    // Also save when the page is closed so no progress is lost.
    window.addEventListener('pagehide', saveGame);
  }]);

  app.controller('TransferController', ['$scope', function($scope) {
    var reset = function() {
      saveGame();
      $scope.exportCode = game.exportSave();
      $scope.importCode = '';
      $scope.error = '';
      $scope.copied = false;
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
    $scope.load = function() {
      $scope.error = '';
      if (!$scope.importCode || !$scope.importCode.trim()) {
        $scope.error = 'Paste a save code first.';
        return;
      }
      if (!window.confirm(
        'Loading this save replaces your current progress. Continue?'
      )) {
        return;
      }
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
      return prestige.expansions > 0 || $scope.canExpand();
    };
  }]);

  app.controller('ExpansionController', ['$scope', function($scope) {
    $scope.prestige = prestige;
    $scope.bonus = game.bonus;
    $scope.upgrades = game.darkMatterUpgrades;
    $scope.gain = function() {
      return game.darkMatterGain();
    };
    $scope.nextAt = function() {
      return game.nextDarkMatterAt();
    };
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
      if ($scope.expanding || game.darkMatterGain() < 1 || !window.confirm(
        'Expand the universe? Your data, funding, reputation, staff, research ' +
        'and upgrades start over. You keep your achievements, level, boosts ' +
        'and dark matter.'
      )) {
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

  analytics.init();
  analytics.sendScreen(analytics.screens.main);
})();
