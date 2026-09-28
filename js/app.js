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

  var app = angular.module('particleClicker', []);

  app.filter('niceNumber', ['$filter', function($filter) {
      return Helpers.formatNumberPostfix;
  }]);

  app.filter('niceTime', ['$filter', function($filter) {
      return Helpers.formatTime;
  }]);

  app.filter('currency', ['$filter', function($filter) {
    return function(input) {
      return 'JTN ' + $filter('niceNumber')(input);
    };
  }]);

  app.filter('reverse', ['$filter', function($filter) {
    return function(items) {
      return items.slice().reverse();
    };
  }]);

  app.controller('DetectorController', function() {
    this.click = function() {
      var amount = lab.clickDetector(dataMultiplier());
      detector.addEvent();
      UI.showUpdateValue("#update-data", amount);
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
      return game.getDataRate() * dataMultiplier();
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
      var sum = game.getDataRate() * dataMultiplier();
      if (sum > 0) {
        lab.acquireData(sum);
        UI.showUpdateValue("#update-data", sum);
        detector.addEventExternal(workers.map(function(w) {
          return w.state.hired;
        }).reduce(function(a, b){return a + b}, 0));
      }
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
    this.doResearch = function(item) {
      var reputation = 0;
      var cost = this.bulk.buy(item, function() {
        reputation += item.state.reputation;
        return item.research(lab);
      });
      if (cost > 0) {
        UI.showUpdateValue("#update-data", -cost);
        UI.showUpdateValue("#update-reputation", reputation);
      }
    };
    this.showInfo = function(r) {
      UI.showModal(r.name, r.getInfo());
      UI.showLevels(r.state.level);
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
    this.hire = function(worker) {
      var total = this.bulk.buy(worker, function() { return worker.hire(lab); });
      if (total > 0) {
        UI.showUpdateValue("#update-funding", -total);
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
      if (upgrade.buy(lab, allObjects)) {
        UI.showUpdateValue("#update-funding", upgrade.cost);
      }
    }
  });

  app.controller('AchievementsController', function($scope) {
    $scope.achievements = achievements;
    $scope.progress = function() {
      return achievements.filter(function(a) { return a.validate(lab, allObjects, lastSaved); }).length;
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
        ObjectStorage.clear();
        ObjectStorage.save('saveVersion', Helpers.saveVersion);
        ObjectStorage.save('updatesSeen', updatesSeen);
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

    var schedule = function(range) {
      var seconds = (range[0] + Math.random() * (range[1] - range[0])) /
          lab.state.anomalyRate;
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
      fadeTimer = $timeout(function() {
        $scope.anomaly = null;
        schedule(DELAY);
      }, lab.state.anomalyLifetime * 1000);
    };
    $scope.anomaly = null;
    $scope.catchAnomaly = function() {
      if (!$scope.anomaly) {
        return;
      }
      $timeout.cancel(fadeTimer);
      $scope.anomaly = null;
      lab.state.anomalies += 1;
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

  app.controller('StatsController', function($scope) {
    $scope.lab = lab;
    $scope.dataRate = function() {
      return game.getDataRate();
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
