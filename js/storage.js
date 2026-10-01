/** Allows to save objects to HTML5 local storage.
 * However, it can only save properties, not functions.
 * When the browser refuses local storage (a private window, blocked site
 * data, an embedded preview), the game keeps its state in memory instead and
 * ObjectStorage.persistent becomes false.
 */
var ObjectStorage = (function() {
  'use strict';
  var memory = {};
  var api = {
    persistent: true,
    save: function(key, item) {
      var json = JSON.stringify(item, function(key, val) {
        if (key == '$$hashKey') {
          return undefined;
        }
        return val;
      });
      memory[key] = json;
      try {
        localStorage.setItem(key, json);
      } catch (e) {
        api.persistent = false;
      }
    },
    load: function(key) {
      var json = null;
      try {
        json = localStorage.getItem(key);
      } catch (e) {
        api.persistent = false;
      }
      if (json === null && memory.hasOwnProperty(key)) {
        json = memory[key];
      }
      try {
        return JSON.parse(json);
      } catch (e) {
        return null;
      }
    },
    clear: function() {
      memory = {};
      try {
        localStorage.clear();
      } catch (e) {
        api.persistent = false;
      }
    }
  };
  return api;
}());
