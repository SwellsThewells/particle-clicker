/** @module ParticleId
 * The Particle ID mini-game: a slice through a detector like CMS, with the
 * signature of one particle flying out of a collision on the left. The player
 * names the particle.
 */
var ParticleId = (function() {
  'use strict';

  var TYPES = [
    {key: 'photon', a: 'a photon', name: 'Photon', symbol: 'γ',
     why: 'Photons have no charge, so they leave no track, and they stop in the electromagnetic calorimeter (ECAL).'},
    {key: 'electron', a: 'an electron', name: 'Electron', symbol: 'e',
     why: 'Electrons leave a curved track, and they stop in the electromagnetic calorimeter (ECAL).'},
    {key: 'muon', a: 'a muon', name: 'Muon', symbol: 'μ',
     why: 'Muons are the only particles that leave a track and make it all the way out to the muon chambers.'},
    {key: 'charged', a: 'a charged hadron', name: 'Charged hadron', symbol: 'π±',
     why: 'Charged hadrons, such as pions and protons, leave a track and stop in the hadron calorimeter (HCAL).'},
    {key: 'neutral', a: 'a neutral hadron', name: 'Neutral hadron', symbol: 'n',
     why: 'Neutral hadrons, such as neutrons, leave no track and stop in the hadron calorimeter (HCAL).'},
    {key: 'neutrino', a: 'a neutrino', name: 'Neutrino', symbol: 'ν',
     why: 'Neutrinos pass through everything without a trace. Physicists only notice the energy they carry away.'}
  ];

  // The slice, from the collision on the left outwards (x in SVG units).
  var W = 360, H = 240, IP = {x: 14, y: 120};
  var TRACKER = [IP.x, 130], ECAL = [130, 170], HCAL = [170, 232], MAGNET = [232, 244];
  var MUON = [[244, 262, 'iron'], [262, 276, 'chamber'], [276, 294, 'iron'], [294, 308, 'chamber'],
              [308, 326, 'iron'], [326, 340, 'chamber'], [340, 356, 'iron']];

  var rect = function(x0, x1, cls) {
    return '<rect class="' + cls + '" x="' + x0 + '" y="8" width="' + (x1 - x0) + '" height="' + (H - 36) + '"/>';
  };

  var label = function(x, text) {
    return '<text class="pid-label" x="' + x + '" y="' + (H - 10) + '" text-anchor="middle">' + text + '</text>';
  };

  /** The empty slice: the layers and their names. */
  var layers = function() {
    var out = [rect(TRACKER[0], TRACKER[1], 'pid-tracker')];
    [40, 64, 88, 112].forEach(function(x) {
      out.push('<line class="pid-layer" x1="' + x + '" y1="8" x2="' + x + '" y2="' + (H - 28) + '"/>');
    });
    out.push(rect(ECAL[0], ECAL[1], 'pid-ecal'), rect(HCAL[0], HCAL[1], 'pid-hcal'), rect(MAGNET[0], MAGNET[1], 'pid-magnet'));
    MUON.forEach(function(m) { out.push(rect(m[0], m[1], 'pid-' + m[2])); });
    out.push('<circle class="pid-ip" cx="' + IP.x + '" cy="' + IP.y + '" r="4"/>');
    out.push(label(72, 'Tracker'), label(150, 'ECAL'), label(201, 'HCAL'), label(300, 'Muon chambers'));
    return out.join('');
  };

  var round1 = function(x) {
    return Math.round(x * 10) / 10;
  };

  /** A particle's path: straight, or curved in the tracker's magnetic field
   * if it is charged. Returns y for a given x. */
  var path = function(slope, bend) {
    var end = TRACKER[1] - IP.x;
    return function(x) {
      var d = x - IP.x;
      if (d <= end) {
        return IP.y + slope * d + bend * d * d;
      }
      return IP.y + slope * end + bend * end * end + (slope + 2 * bend * end) * (d - end);
    };
  };

  var track = function(y, x1) {
    var points = [];
    for (var x = IP.x; x <= x1; x += 6) {
      points.push(round1(x) + ',' + round1(y(x)));
    }
    points.push(x1 + ',' + round1(y(x1)));
    return '<polyline class="pid-track" points="' + points.join(' ') + '"/>';
  };

  /** An energy deposit (a shower) in a calorimeter, around the path. */
  var deposit = function(y, x0, x1, size) {
    var mid = (x0 + x1) / 2, cy = y(mid), h = size;
    return '<rect class="pid-deposit" x="' + (x0 + 2) + '" y="' + round1(cy - h / 2) + '" width="' + (x1 - x0 - 4) +
           '" height="' + h + '" rx="' + Math.min(6, h / 2) + '"/>';
  };

  /** The SVG for a particle of this type, at a random angle. */
  var draw = function(type, random) {
    random = random || Math.random;
    var slope = (random() - 0.5) * 0.24;
    var charged = type === 'electron' || type === 'muon' || type === 'charged';
    var bend = charged ? (random() < 0.5 ? -1 : 1) * (0.0003 + random() * 0.0003) : 0;
    var y = path(slope, bend), out = [layers()];
    if (type === 'photon') {
      out.push(deposit(y, ECAL[0], ECAL[1] - 4, 16));
    } else if (type === 'electron') {
      out.push(track(y, ECAL[0]), deposit(y, ECAL[0], ECAL[1] - 4, 16));
    } else if (type === 'muon') {
      out.push(track(y, W - 6));
      MUON.forEach(function(m) {
        if (m[2] === 'chamber') {
          var cx = (m[0] + m[1]) / 2;
          out.push('<rect class="pid-hit" x="' + (cx - 4) + '" y="' + round1(y(cx) - 4) + '" width="8" height="8"/>');
        }
      });
    } else if (type === 'charged') {
      out.push(track(y, ECAL[0]), deposit(y, ECAL[0], ECAL[0] + 14, 8), deposit(y, HCAL[0], HCAL[1] - 6, 24));
    } else if (type === 'neutral') {
      out.push(deposit(y, HCAL[0], HCAL[1] - 6, 24));
    }
    return '<svg class="pid-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="A detector slice">' +
           out.join('') + '</svg>';
  };

  /** A new question: a random particle, not the same as the last one. */
  var question = function(lastKey, random) {
    random = random || Math.random;
    var choices = TYPES.filter(function(t) { return t.key !== lastKey; });
    var type = choices[Math.floor(random() * choices.length)];
    return {type: type, svg: draw(type.key, random)};
  };

  return {TYPES: TYPES, draw: draw, question: question};
}());
