/** @module Settings
 * Player preferences. They are stored under their own key in local storage,
 * so restarting, importing a save or expanding the universe keeps them.
 */
var Settings = (function() {
  'use strict';
  var KEY = 'settings';
  var media = function(query) {
    return window.matchMedia ? window.matchMedia(query) : null;
  };
  var systemDark = media('(prefers-color-scheme: dark)');
  var systemReducedMotion = media('(prefers-reduced-motion: reduce)');
  var defaults = {
    theme: 'light',        // 'light', 'dark' or 'system'
    numbers: 'short',      // 'short' (1.2M) or 'scientific' (1.2e6)
    effects: 'full',       // 'full', 'reduced' or 'minimal'
    floatingNumbers: true, // the +123 that float up from the counters
    popups: true,          // pop-ups for achievements, level-ups and skins
    reduceMotion: !!(systemReducedMotion && systemReducedMotion.matches),
    skin: 'classic',       // the particle skin in use (json/skins.json)
    skinsSeen: 1           // skins unlocked when the Skins tab was last opened
  };
  var values = $.extend({}, defaults);
  var listeners = [];

  var saved = ObjectStorage.load(KEY);
  if (saved && typeof saved === 'object') {
    for (var k in defaults) {
      if (saved.hasOwnProperty(k) && typeof saved[k] === typeof defaults[k]) {
        values[k] = saved[k];
      }
    }
  }

  var isDark = function() {
    return values.theme === 'dark' ||
        (values.theme === 'system' && !!systemDark && systemDark.matches);
  };

  var apply = function() {
    $(document.documentElement)
        .toggleClass('theme-dark', isDark())
        .toggleClass('reduce-motion', values.reduceMotion);
    for (var i = 0; i < listeners.length; i++) {
      listeners[i](values);
    }
  };

  var set = function(key, value) {
    if (!defaults.hasOwnProperty(key) || typeof value !== typeof defaults[key]) {
      return;
    }
    values[key] = value;
    ObjectStorage.save(KEY, values);
    apply();
  };

  if (systemDark && systemDark.addListener) {
    systemDark.addListener(function() {
      if (values.theme === 'system') {
        apply();
      }
    });
  }
  apply();

  return {
    KEY: KEY,
    get: function(key) { return values[key]; },
    set: set,
    isDark: isDark,
    /** Call fn(values) now and whenever a setting changes. */
    onChange: function(fn) {
      listeners.push(fn);
      fn(values);
    }
  };
}());
