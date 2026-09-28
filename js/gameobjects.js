var GameObjects = (function() {
  'use strict';
  var GLOBAL_VISIBILITY_THRESHOLD = 0.5;

  /** Total cost of buying n items whose price starts at cost and is
   * multiplied by increase (and rounded down) after every purchase. */
  var bulkCost = function(cost, increase, n) {
    var total = 0;
    for (var i = 0; i < n; i++) {
      total += cost;
      cost = Math.floor(cost * increase);
    }
    return total;
  };

  /** How many such items the budget buys, but at most limit. */
  var bulkAffordable = function(cost, increase, budget, limit) {
    var n = 0;
    while (n < limit && budget >= cost) {
      budget -= cost;
      cost = Math.floor(cost * increase);
      n++;
    }
    return n;
  };

  /** @class GameObject
   * Base class for all objects in the game. This works together with the
   * saving mechanism.
   */
  var GameObject = function(obj) {
    this.state = {};
    $.extend(this, obj);
    if (!this.key) {
      throw 'Error: GameObject has to have a key!';
    }
  };
  GameObject.prototype.loadState =
      function(state) { $.extend(this.state, state); };

  /** @class Lab
   */
  var Lab = function() {
    GameObject.apply(this, [{
                             key : 'lab',
                             state : {
                               name : 'Give your lab an awesome name!',
                               detector : 1,
                               factor : 5,
                               data : 0,
                               money : 0,
                               reputation : 0,
                               clicks : 0,
                               moneyCollected : 0,
                               moneySpent : 0,
                               dataCollected : 0,
                               dataSpent : 0,
                               time: 0,
                               lastSeen: 0,
                               anomalies: 0,
                               // Upgradable settings for anomalies and time away
                               anomalyRate: 1,       // how often anomalies appear
                               anomalyLifetime: 12,  // seconds on the detector
                               anomalyReward: 1,     // factor on bursts and windfalls
                               boostFactor: 2,       // data multiplier of a beam boost
                               boostDuration: 30,    // seconds
                               offlineHours: 24      // cap on progress while away
                             }
                           }]);
  };

  Lab.prototype = Object.create(GameObject.prototype);

  Lab.prototype.constructor = Lab;

  /** Multipliers from levels and dark matter; the game replaces this. */
  Lab.prototype.bonus = {click: 1, funding: 1, reputation: 1};

  Lab.prototype.getGrantRate = function() {
    return this.state.reputation * this.state.factor * this.bonus.funding;
  };

  Lab.prototype.getGrant = function() {
    var addition = this.getGrantRate();
    this.receiveMoney(addition);
    return addition;
  };

  Lab.prototype.receiveMoney = function(amount) {
    this.state.money += amount;
    this.state.moneyCollected += amount;
  };

  Lab.prototype.acquireData = function(amount) {
    this.state.data += amount;
    this.state.dataCollected += amount;
  };

  Lab.prototype.clickDetector = function(multiplier) {
    var amount = this.state.detector * this.bonus.click * (multiplier || 1);
    this.state.clicks += 1;
    this.acquireData(amount);
    return amount;
  };

  Lab.prototype.research = function(cost, reputation) {
    if (this.state.data >= cost) {
      this.state.data -= cost;
      this.state.dataSpent += cost;
      this.state.reputation += reputation * this.bonus.reputation;
      return true;
    }
    return false;
  };

  Lab.prototype.buy = function(cost) {
    if (this.state.money >= cost) {
      this.state.money -= cost;
      this.state.moneySpent += cost;
      return true;
    }
    return false;
  };

  /** @class Research
   */
  var Research = function(obj) {
    GameObject.apply(this, [obj]);
    this.state.level = 0;
    this.state.interesting = false;
  };

  Research.prototype = Object.create(GameObject.prototype);

  Research.prototype.constructor = Research;

  Research.prototype.isVisible = function(lab) {
    if (!lab) {
      return false;
    }
    return this.state.level > 0 ||
           lab.state.data >= this.state.cost * GLOBAL_VISIBILITY_THRESHOLD;
  };

  Research.prototype.isAvailable = function(lab) {
    if (!lab) {
      return false;
    }
    return lab.state.data >= this.state.cost;
  };

  Research.prototype.research = function(lab) {
    if (lab && lab.research(this.state.cost, this.state.reputation)) {
      this.state.level++;
      if (this.state.info_levels.length > 0 &&
          this.state.level === this.state.info_levels[0]) {
        this.state.interesting = true;
        this.state.info_levels.splice(0, 1);
      }
      var old_cost = this.state.cost;
      this.state.cost = Math.floor(this.state.cost * this.cost_increase);
      return old_cost;
    }
    return -1;
  };

  Research.prototype.getCost = function(n) {
    return bulkCost(this.state.cost, this.cost_increase, n);
  };

  Research.prototype.getAffordable = function(data, limit) {
    return bulkAffordable(this.state.cost, this.cost_increase, data, limit);
  };

  Research.prototype.getInfo = function() {
    if (!this._info) {
      this._info = Helpers.loadFile(this.info);
    }
    this.state.interesting = false;
    return this._info;
  };

  /** @class Worker
   * Implement an auto-clicker in the game.
   */
  var Worker = function(obj) {
    GameObject.apply(this, [obj]);
    this.state.hired = 0;
  };

  Worker.prototype = Object.create(GameObject.prototype);

  Worker.prototype.constructor = Worker;

  Worker.prototype.isVisible = function(lab) {
    if (!lab) {
      return false;
    }
    return this.state.hired > 0 ||
           lab.state.money >= this.state.cost * GLOBAL_VISIBILITY_THRESHOLD;
  };

  Worker.prototype.isAvailable = function(lab) {
    if (!lab) {
      return false;
    }
    return lab.state.money >= this.state.cost;
  };

  Worker.prototype.hire = function(lab) {
    if (lab && lab.buy(this.state.cost)) {
      this.state.hired++;
      var cost = this.state.cost;
      this.state.cost = Math.floor(cost * this.cost_increase);
      return cost;
    }
    return -1;  // not enough money
  };

  Worker.prototype.getCost = function(n) {
    return bulkCost(this.state.cost, this.cost_increase, n);
  };

  Worker.prototype.getAffordable = function(money, limit) {
    return bulkAffordable(this.state.cost, this.cost_increase, money, limit);
  };

  Worker.prototype.getTotal =
      function() { return this.state.hired * this.state.rate; };

  /** @class Upgrade
   */
  var Upgrade = function(obj) {
    GameObject.apply(this, [obj]);
    this.state.visible = false;
    this.state.used = false;
  };

  Upgrade.prototype = Object.create(GameObject.prototype);

  Upgrade.prototype.constructor = Upgrade;

  Upgrade.prototype.meetsRequirements = function(allObjects) {
    if (!allObjects) {
      return false;
    }
    for (var i = 0; i < this.requirements.length; i++) {
      var req = this.requirements[i];
      if (allObjects[req.key].state[req.property] < req.threshold) {
        return false;
      }
    }
    return true;
  };

  Upgrade.prototype.isAvailable = function(lab, allObjects) {
    if (!lab || !allObjects) {
      return false;
    }
    return !this.state.used && lab.state.money >= this.cost &&
           this.meetsRequirements(allObjects);
  };

  Upgrade.prototype.isVisible = function(lab, allObjects) {
    if (!lab || !allObjects) {
      return false;
    }
    if (!this.state.used &&
        (this.state.visible ||
         lab.state.money >= this.cost * GLOBAL_VISIBILITY_THRESHOLD &&
             this.meetsRequirements(allObjects))) {
      this._visible = true;
      return true;
    }
    return false;
  };

  Upgrade.prototype.buy = function(lab, allObjects) {
    if (lab && allObjects && !this.state.used && lab.buy(this.cost)) {
      for (var i = 0; i < this.targets.length; i++) {
        var t = this.targets[i];
        allObjects[t.key].state[t.property] *= this.factor || 1;
        allObjects[t.key].state[t.property] += this.constant || 0;
      }
      this.state.used = true;  // How about actually REMOVING used upgrades?
      this.state.visible = false;
      return this.cost;
    }
    return -1;
  };


  /** @class Achievement
   */
  var Achievement = function(obj) {
    GameObject.apply(this, [obj]);
    this.state.timeAchieved = null;
  };

  Achievement.prototype = Object.create(GameObject.prototype);

  Achievement.prototype.validate = function(lab, allObjects, saveTime) {
    if (this.state.timeAchieved) {
      return true;
    }
    if (allObjects.hasOwnProperty(this.targetKey) &&
        allObjects[this.targetKey].state.hasOwnProperty(this.targetProperty) &&
        allObjects[this.targetKey].state[this.targetProperty] >= this.threshold) {
      this.state.timeAchieved = lab.state.time + new Date().getTime() - saveTime;
      UI.showAchievement(this);
      if (Achievement.onUnlock) {
        Achievement.onUnlock(this);
      }
      return true;
    }
    return false;
  };

  Achievement.prototype.isAchieved = function() {
    if (this.state.timeAchieved) {
      return true;
    } else {
      return false;
    }
  };


  /** @class Record
   * Plain saved state that is not one of the game's items, such as the
   * player's level or the dark matter.
   */
  var Record = function(key, state) {
    GameObject.apply(this, [{key: key, state: state}]);
  };

  Record.prototype = Object.create(GameObject.prototype);

  Record.prototype.constructor = Record;

  // Expose classes in module.
  return {
    Record: Record,
    Lab: Lab,
    Research: Research,
    Worker: Worker,
    Upgrade: Upgrade,
    Achievement: Achievement
  };
}());
