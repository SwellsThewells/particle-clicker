'use strict';

/** Define UI specific stuff.
 */
var UI = (function () {
  /** Resize the scrollable containers and make sure they are resized whenever
   * the window is resized.
   * Also introduce FastClick for faster clicking on mobile.
   */
  $(function() {
    FastClick.attach(document.body);    
    
    var rateHeight = 17;  // height of the per-second rate line under the status
    var hudHeight = 46;   // the level bar and the gap around it
    var resize = function() {
      var h = $(window).height();
      var offset = 111;
      if ($(window).width() < 992) {
        offset = 112;
      }
      $('.scrollable').height(h - offset + 'px');

      var types = ['research', 'hr', 'upgrades'];

      if ($(window).width() < 992) {
        for (var i = 0; i < types.length; i++) {
          if ($('#' + types[i] + 'Content').parent().attr('id') == types[i] + 'Large') {
            $('#' + types[i] + 'Content').detach().appendTo('#' + types[i]);
          }
        }
      } else {
        for (var i = 0; i < types.length; i++) {
          if ($('#' + types[i] + 'Content').parent().attr('id') != types[i] + 'Large') {
            $('#' + types[i] + 'Content').detach().appendTo('#' + types[i] + 'Large');
          }
        }
      }

      if ($(window).width() < 600) {
        var newWidth = Math.max($(window).width() - ($(window).height() - 90 + 10), 300);
        $('#column-lab').width($(window).width() - newWidth);
        $('#column-tabs').width(newWidth);
      } else {
        $('#column-lab').removeAttr('style');
        $('#column-tabs').removeAttr('style');
      }

      // The level bar sits at the bottom of the lab column.
      var lab = $('#column-lab');
      var hudWidth = Math.min(lab.outerWidth() - 16, 460);
      $('#level-hud').css({left: lab.offset().left + lab.outerWidth() / 2 + 'px',
                           width: hudWidth + 'px'})
                     .toggleClass('compact', hudWidth < 330);

      var w = $(window).width(), h = $(window).height(), size;
      if (w < 768 && h - 90 - rateHeight - hudHeight < 300) {
        // Leave room below the detector for the status bar, its rates and
        // the level bar.
        size = w - Math.max(w - (h - 90 + 10), 300) - 10 - rateHeight - hudHeight;
      } else {
        size = w >= 1200 ? 500 : w >= 992 ? 400 : 300;
        if (w >= 768) {
          // On short windows, shrink the detector so the status bar and the
          // level bar stay on screen.
          var top = $('#detector').offset().top;
          var status = $('.status');
          var below = status.offset().top + status.outerHeight() - top - $('#detector').height();
          size = Math.max(200, Math.min(size, Math.floor(h - top - below - hudHeight)));
        }
      }
      if (detector.width != size) {
        $('#detector').width(size).height(size);
        detector.init(size);
      }
    }
    
    $(window).resize(resize);
    resize();
  });

  /** Show a bootstrap modal with dynamic content. */
  var showModal = function(title, text, level) {
    var $modal = $('#infoBox');
    $modal.find('#infoBoxLabel').html(title);
    $modal.find('.modal-body').html(text);
    $modal.modal({show: true});
  };

  /** Display only the elements with data-min-level above a certain
   * threshold.
   */
  var showLevels = function(level) {
    $('#infoBox').find('[data-min-level]').each(function() {
      if (level >= $(this).data('min-level')) {
        $(this).show();
      } else {
        $(this).hide();
      }
    });
  };

  var showUpdateValue = function(ident, num) {
    if (num != 0 && Settings.get('floatingNumbers')) {
      var formatted = Helpers.formatNumberPostfix(num);
      var insert;
      if (num > 0) {
        insert = $("<div></div>")
                  .attr("class", "update-plus")
                  .html("+" + formatted);
      } else {
        insert = $("<div></div>")
                  .attr("class", "update-minus")
                  .html(formatted);
      }
      showUpdate(ident, insert);
    }
  }

  var showUpdate = function(ident, insert) {
    var elem = $(ident);
    elem.append(insert);
    insert.animate({
      "bottom":"+=30px",
      "opacity": 0
    }, { duration: 500, complete: function() {
      $(this).remove();
    }});
  }

  var showAchievement = function(obj) {
    if (!Settings.get('popups')) {
      return;
    }
    var alert = '<div class="alert ' + (obj.secret ? 'alert-warning' : 'alert-success') + ' alert-dismissible" role="alert">';
    alert += '<button type="button" class="close" data-dismiss="alert"><span aria-hidden="true">&times;</span><span class="sr-only">Close</span></button>';
    alert += '<span class="fa ' + obj.icon + ' alert-glyph"></span> <span class="alert-text">' +
        (obj.secret ? 'Secret achievement: ' : '') + obj.description + '</span>';
    alert += '</div>';

    alert = $(alert);

    $('#achievements-container').prepend(alert);
    var remove = function(a)
    {
      return function()
      {
        a.slideUp(300, function() { a.remove(); });
      };
    };

    window.setTimeout(remove(alert), 2000);
  }

  /** Show a dismissible message in the bottom right corner. If timeout (ms)
   * is given, the message also disappears by itself. */
  var showMessage = function(icon, html, timeout) {
    var alert = '<div class="alert alert-info" role="alert">';
    alert += '<button type="button" class="btn btn-primary">OK</button>';
    alert += '<i class="fa ' + icon + ' alert-glyph"></i> <span class="alert-text">' + html + '</span>';
    alert += '</div>';
    alert = $(alert);
    alert.find('button').click(function() {
      alert.slideUp(300, function() { alert.remove(); });
    });
    $('#messages-container').append(alert);
    if (timeout) {
      window.setTimeout(function() {
        alert.slideUp(300, function() { alert.remove(); });
      }, timeout);
    }
    return alert;
  };

  /** Tell the player what their lab earned while the game was closed. */
  var showOfflineProgress = function(offline) {
    var earned = [];
    if (offline.data > 0) {
      earned.push('<strong>' + Helpers.formatNumberPostfix(offline.data) + ' data</strong>');
    }
    if (offline.money > 0) {
      earned.push('<strong>JTN ' + Helpers.formatNumberPostfix(offline.money) + '</strong> in funding');
    }
    var text = 'Welcome back! While you were away for ' +
        Helpers.formatTime(offline.time) + ', your lab collected ' +
        earned.join(' and ') + '.';
    if (offline.capped) {
      text += ' <small>(Progress while away is capped at ' + offline.maxHours +
          ' hours.)</small>';
    }
    showMessage('fa-clock-o', text).addClass('offline-progress');
  };

  if (typeof $.cookie('cookielaw') === 'undefined') {
    var alert = '<div id="cookielaw" class="alert alert-info" role="alert">';
    alert += '<button type="button" class="btn btn-primary">OK</button>';
    alert += '<i class="fa fa-info-circle alert-glyph"></i> <span class="alert-text">The Particle Simulation uses local storage to store your current progress.</span>';
    alert += '</div>';
    alert = $(alert);
    alert.find('button').click(function ()
    {
      $.cookie('cookielaw', 'informed', { expires: 365 });
      $('#cookielaw').slideUp(300, function() { $('#cookielaw').remove(); });
    })

    $('#messages-container').append(alert);
  }

  if (typeof $.cookie('cern60') === 'undefined') {
    var alert = '<div id="cern60" class="alert alert-info" role="alert">';
    alert += '<button type="button" class="btn btn-primary">Close</button>';
    alert += '<i class="fa fa-area-chart alert-glyph"></i> <span class="alert-text"><a class="alert-link" href="http://home.web.cern.ch/about/updates/2014/12/take-part-cern-60-public-computing-challenge" target="_blank">Join the CERN 60 computing challenge!</a></span>';
    alert += '</div>';
    alert = $(alert);
    alert.find('button').click(function ()
    {
      $.cookie('cern60', 'closed', { expires: 365 });
      $('#cern60').slideUp(300, function() { $('#cern60').remove(); });
    })

    $('#messages-container').append(alert);
  }

  /** A short "Level 12!" that rises from the level bar. */
  var showLevelUp = function(level) {
    var toast = $('<div class="level-up-toast" role="status"></div>')
        .text('Level ' + level + '!');
    $('#level-hud').append(toast);
    window.setTimeout(function() { toast.remove(); }, 2200);
  };

  /** The Big Bang: particles fall into the centre, flash, and fly out again
   * while the new universe is announced. Calls done() at the end. */
  var playExpansion = function(info, done) {
    var overlay = $('<div class="expansion-overlay" role="alert">' +
                    '<canvas></canvas><div class="expansion-text"><h2></h2><p></p></div></div>');
    overlay.find('h2').text('Universe #' + info.universe);
    overlay.find('p').text('+' + Helpers.formatNumberPostfix(info.gain) + ' dark matter');
    overlay.appendTo('body');
    if (Settings.get('reduceMotion')) {
      overlay.addClass('show-text');
      window.setTimeout(done, 1500);
      return;
    }
    var canvas = overlay.find('canvas')[0], ctx = canvas.getContext('2d');
    var ratio = window.devicePixelRatio || 1;
    var W = window.innerWidth, H = window.innerHeight, cx = W / 2, cy = H / 2;
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(ratio, ratio);
    var colors = ['#7C95FF', '#4CD964', '#E5A445', '#C792EA', '#FFD54F', '#FF5C5C'];
    var particles = [];
    for (var i = 0; i < 260; i++) {
      var a = Math.random() * Math.PI * 2, d = Math.max(W, H) * (0.3 + 0.5 * Math.random());
      particles.push({a: a, d: d, speed: 0.4 + Math.random(), size: 1 + 2 * Math.random(),
                      color: colors[i % colors.length]});
    }
    var IMPLODE = 1300, FLASH = 300, EXPLODE = 1900;
    var start = null;
    var frame = function(time) {
      if (start === null) {
        start = time;
      }
      var t = time - start;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(5, 6, 20, ' + Math.min(0.95, t / 600) + ')';
      ctx.fillRect(0, 0, W, H);
      particles.forEach(function(p) {
        var dist, angle = p.a;
        if (t < IMPLODE) {
          var k = t / IMPLODE;
          dist = p.d * (1 - k * k * k);
          angle += k * 2.5;                    // spiral inwards
        } else if (t < IMPLODE + FLASH) {
          dist = 0;
        } else {
          var e = (t - IMPLODE - FLASH) / EXPLODE;
          dist = Math.max(W, H) * 0.8 * p.speed * (1 - Math.pow(1 - Math.min(e, 1), 3));
        }
        ctx.globalAlpha = t < IMPLODE + FLASH ? 1 : Math.max(0, 1 - (t - IMPLODE - FLASH) / EXPLODE);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, p.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      if (t >= IMPLODE - 100 && t < IMPLODE + FLASH + 500) {
        // The flash of the Big Bang.
        var f = (t - IMPLODE + 100) / (FLASH + 600);
        var radius = Math.max(W, H) * f;
        var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(radius, 1));
        glow.addColorStop(0, 'rgba(255, 255, 255, ' + (1 - f) + ')');
        glow.addColorStop(1, 'rgba(255, 240, 200, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      }
      if (t > IMPLODE + FLASH) {
        overlay.addClass('show-text');
      }
      if (t < IMPLODE + FLASH + EXPLODE + 400) {
        requestAnimFrame(frame);
      } else {
        done();
      }
    };
    requestAnimFrame(frame);
  };

  /** After the reload that follows an expansion, fade in the new universe. */
  var showUniverseIntro = function(info) {
    var overlay = $('<div class="expansion-overlay show-text intro">' +
                    '<div class="expansion-text"><h2></h2><p></p></div></div>');
    overlay.find('h2').text('Universe #' + info.universe);
    overlay.find('p').text('+' + Helpers.formatNumberPostfix(info.gain) +
                           ' dark matter. Everything starts again, a little faster.');
    overlay.appendTo('body');
    window.setTimeout(function() {
      overlay.fadeOut(Settings.get('reduceMotion') ? 0 : 900, function() { overlay.remove(); });
    }, 1400);
  };

  return {
    showLevelUp: showLevelUp,
    playExpansion: playExpansion,
    showUniverseIntro: showUniverseIntro,
    showAchievement: showAchievement,
    showMessage: showMessage,
    showOfflineProgress: showOfflineProgress,
    showModal: showModal,
    showLevels: showLevels,
    showUpdateValue: showUpdateValue
  }
})();


// I don't know what this is for, so I leave it here for the moment...
(function() {
    var hidden = "hidden";

    // Standards:
    if (hidden in document)
        document.addEventListener("visibilitychange", onchange);
    else if ((hidden = "mozHidden") in document)
        document.addEventListener("mozvisibilitychange", onchange);
    else if ((hidden = "webkitHidden") in document)
        document.addEventListener("webkitvisibilitychange", onchange);
    else if ((hidden = "msHidden") in document)
        document.addEventListener("msvisibilitychange", onchange);
    // IE 9 and lower:
    else if ('onfocusin' in document)
        document.onfocusin = document.onfocusout = onchange;
    // All others:
    else
        window.onpageshow = window.onpagehide 
            = window.onfocus = window.onblur = onchange;

    function onchange (evt) {
        var v = 'visible', h = 'hidden',
            evtMap = { 
                focus:v, focusin:v, pageshow:v, blur:h, focusout:h, pagehide:h 
            };

        evt = evt || window.event;
        if (evt.type in evtMap)
            detector.visible = evtMap[evt.type] == 'visible';
        else        
            detector.visible = !this[hidden];
    }
})();
