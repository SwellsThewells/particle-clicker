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
  var MAX_BULK_HIRE = 1000;

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
      lab.clickDetector();
      detector.addEvent();
      UI.showUpdateValue("#update-data", lab.state.detector);
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
      return game.getDataRate();
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
      var sum = game.getDataRate();
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
    this.isVisible = function(item) {
      return item.isVisible(lab);
    };
    this.isAvailable = function(item) {
      return item.isAvailable(lab);
    };
    this.doResearch = function(item) {
      var cost = item.research(lab);
      if (cost > 0) {
        UI.showUpdateValue("#update-data", -cost);
        UI.showUpdateValue("#update-reputation", item.state.reputation);
      }
    };
    this.showInfo = function(r) {
      UI.showModal(r.name, r.getInfo());
      UI.showLevels(r.state.level);
    };
  }]);

  app.controller('HRController', function() {
    this.workers = workers;
    this.amounts = [1, 10, 'max'];
    this.amount = 1;
    this.setAmount = function(amount) {
      this.amount = amount;
    };
    /** Number of workers the hire button will hire. With 'max' this is as
     * many as the lab can afford, but at least one so the price of the next
     * hire is still shown. */
    this.count = function(worker) {
      if (this.amount === 'max') {
        return Math.max(1, worker.getAffordable(lab.state.money, MAX_BULK_HIRE));
      }
      return this.amount;
    };
    this.cost = function(worker) {
      return worker.getCost(this.count(worker));
    };
    this.isVisible = function(worker) {
      return worker.isVisible(lab);
    };
    this.isAvailable = function(worker) {
      return lab.state.money >= this.cost(worker);
    };
    this.hire = function(worker) {
      if (!this.isAvailable(worker)) {
        return;
      }
      var n = this.count(worker), total = 0;
      for (var i = 0; i < n; i++) {
        var cost = worker.hire(lab);
        if (cost < 0) {
          break;
        }
        total += cost;
      }
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
