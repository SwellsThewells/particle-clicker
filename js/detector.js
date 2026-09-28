var detector =
{
    core:
    {
        canvas: null,
        ctx: null
    },

    events:
    {
        canvas: null,
        ctx: null,
        list: [],
    },

    visible: true,
    running: false,

    // Colours of the event display. The core is redrawn when the theme changes.
    palettes:
    {
        light: {space: '#FFFFFF', electron: '#0016EA', jet: '#0B7700', muon: '#775400',
                pion: '#8A8A8A', dark: '#7B1FA2', photon: '#C99700', met: '#D50000',
                deposit: '#FF6D00', glow: '#FFB300', flash: '#FFD54F'},
        dark: {space: '#1B1C1F', electron: '#7C95FF', jet: '#4CD964', muon: '#E5A445',
               pion: '#9AA0A6', dark: '#C792EA', photon: '#FFD54F', met: '#FF5C5C',
               deposit: '#FF8A3D', glow: '#FFC400', flash: '#FFE082'}
    },
    palette: null,

    // Which extra kinds of events the lab has unlocked (set by the app from
    // upgrades, research and dark matter), and how many to draw.
    effects:
    {
        energy: 0, lumi: 0, photons: false, jets: false, golden: false,
        pileup: false, shockwave: false, displaced: false, met: false,
        annihilation: false, heavyIon: false, darkTracks: false, boost: false
    },
    quality: 'full',
    maxEvents: 600,

    width: 400,
    height: 400,

    ratio: 1,

    colors: 
    {
        siliconRing: '#FFF371',
        siliconRingLine: '#EAC918',
        ecal: '#C5FF82',
        ecalLine: '#9EFF28',
        hcal: '#E1FF79',
        hcalLine: '#C9FF2D',
        lightRing: '#A0B3FF',
        lightRingLine: '#A0B3FF',
        darkRing: '#7280B8',
        darkRingLine: '#7280B8',

        mucalLight: '#FFDFB7',
        mucalLightLine: '#FFDFB7',
        mucalDark: '#EA301F',
        mucalDarkLine: '#C5291A'
    },

    radius:
    {
        siliconInner: 10,
        silicon: 30,
        siliconSpace: 35,
        ecal: 50,
        hcal: 80,
        darkRing1: 83,
        darkRing1Space: 86,
        lightRing: 92,
        lightRingSpace: 94,
        darkRing2: 100,

        mucal: 107,
        mucalLight: 8,
        mucalDark: 18
    },

    tracks:
    [
        {
            name: 'electron',
            color: '#0016EA'
        },

        {
            name: 'jet',
            color: '#0B7700'
        },
        
        {
            name: 'muon',
            color: '#775400'
        }
    ],

    lastRender: 0,

    animate: function(time)
    {
        var duration = typeof time !== 'undefined' ? time - detector.lastRender : 16;
        detector.lastRender = time;

        requestAnimFrame(detector.animate);
        detector.draw(duration);
    },

    init: function(baseSize)
    {
        detector.core.canvas = document.getElementById('detector-core');
        detector.core.ctx = detector.core.canvas.getContext('2d');
        //detector.core.ctx = new C2S(400,400);

        detector.events.canvas = document.getElementById('detector-events');
        detector.events.ctx = detector.events.canvas.getContext('2d');

        var devicePixelRatio = window.devicePixelRatio || 1;
        var backingStoreRatio = detector.core.ctx.webkitBackingStorePixelRatio ||
                                detector.core.ctx.mozBackingStorePixelRatio ||
                                detector.core.ctx.msBackingStorePixelRatio ||
                                detector.core.ctx.oBackingStorePixelRatio ||
                                detector.core.ctx.backingStorePixelRatio || 1;

        var ratio = devicePixelRatio / backingStoreRatio;

        detector.ratio = baseSize / 400;

        detector.width = baseSize;
        detector.height = baseSize;

        detector.core.canvas.width = baseSize;
        detector.core.canvas.height = baseSize;

        detector.events.canvas.width = baseSize;
        detector.events.canvas.height = baseSize;

        if (devicePixelRatio !== backingStoreRatio) {
            var oldWidth = detector.core.canvas.width;
            var oldHeight = detector.core.canvas.height;

            detector.core.canvas.width = oldWidth * ratio;
            detector.core.canvas.height = oldHeight * ratio;
            detector.core.canvas.style.width = oldWidth + 'px';
            detector.core.canvas.style.height = oldHeight + 'px';

            detector.events.canvas.width = oldWidth * ratio;
            detector.events.canvas.height = oldHeight * ratio;
            detector.events.canvas.style.width = oldWidth + 'px';
            detector.events.canvas.style.height = oldHeight + 'px';

            // now scale the context to counter
            // the fact that we've manually scaled
            // our canvas element
            detector.core.ctx.scale(ratio, ratio);
            detector.events.ctx.scale(ratio, ratio);
        }

        detector.coreDraw();
        // init runs again on every resize; only ever start one drawing loop.
        if (!detector.running) {
            detector.running = true;
            detector.animate();
        }
    },

    setTheme: function(dark)
    {
        detector.palette = dark ? detector.palettes.dark : detector.palettes.light;
        if (detector.core.ctx) {
            detector.coreDraw();
        }
    },

    coreDraw: function()
    {
        var ctx = detector.core.ctx;
        var cx = detector.width / 2;
        var cy = detector.height / 2;

        ctx.clearRect(0, 0, detector.width, detector.width);

        var muSplit = 2/12;
        for (var k = 3; k >= 1; k--) {
            ctx.strokeStyle = detector.colors.mucalDarkLine;
            ctx.fillStyle = detector.colors.mucalDark;
            
            ctx.beginPath();
            ctx.moveTo(cx + (detector.radius.mucal + k * detector.radius.mucalLight + k * detector.radius.mucalDark) * Math.cos(Math.PI * muSplit) * detector.ratio, cy + (detector.radius.mucal + k * detector.radius.mucalLight + k * detector.radius.mucalDark) * Math.sin(Math.PI * muSplit) * detector.ratio);
            for (var i = 1; i <= 13; i++) {
                ctx.lineTo(cx + (detector.radius.mucal + k * detector.radius.mucalLight + k * detector.radius.mucalDark) * Math.cos(Math.PI * i * muSplit) * detector.ratio, cy + (detector.radius.mucal + k * detector.radius.mucalLight + k * detector.radius.mucalDark) * Math.sin(Math.PI * i * muSplit) * detector.ratio);
            }
            ctx.stroke();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(cx + (detector.radius.mucal + k * detector.radius.mucalLight + (k-1) * detector.radius.mucalDark) * Math.cos(Math.PI * muSplit) * detector.ratio, cy + (detector.radius.mucal + k * detector.radius.mucalLight + (k-1) * detector.radius.mucalDark) * Math.sin(Math.PI * muSplit) * detector.ratio);
            for (var i = 1; i <= 13; i++) {
                ctx.lineTo(cx + (detector.radius.mucal + k * detector.radius.mucalLight + (k-1) * detector.radius.mucalDark) * Math.cos(Math.PI * i * muSplit) * detector.ratio, cy + (detector.radius.mucal + k * detector.radius.mucalLight + (k-1) * detector.radius.mucalDark) * Math.sin(Math.PI * i * muSplit) * detector.ratio);
            }
            ctx.stroke();
            ctx.fillStyle = detector.colors.mucalLight;
            ctx.fill();
        }

        ctx.strokeStyle = detector.colors.mucalDarkLine;
        ctx.beginPath();
        ctx.moveTo(cx + detector.radius.mucal * Math.cos(Math.PI * muSplit) * detector.ratio, cy + detector.radius.mucal * Math.sin(Math.PI * muSplit) * detector.ratio);
        for (var i = 1; i <= 13; i++) {
            ctx.lineTo(cx + detector.radius.mucal * Math.cos(Math.PI * i * muSplit) * detector.ratio, cy + detector.radius.mucal * Math.sin(Math.PI * i * muSplit) * detector.ratio);
        }
        ctx.stroke();
        ctx.fillStyle = detector.palette.space;
        ctx.fill();


        ctx.beginPath();
        ctx.strokeStyle = detector.colors.darkRingLine;
        ctx.fillStyle = detector.colors.darkRing;
        ctx.arc(cx, cy, detector.radius.darkRing2 * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = detector.palette.space;
        ctx.arc(cx, cy, detector.radius.lightRingSpace * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = detector.colors.lightRingLine;
        ctx.fillStyle = detector.colors.lightRing;
        ctx.arc(cx, cy, detector.radius.lightRing * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = detector.palette.space;
        ctx.arc(cx, cy, detector.radius.darkRing1Space * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();

        ctx.beginPath();
        ctx.strokeStyle = detector.colors.darkRingLine
        ctx.fillStyle = detector.colors.darkRing;
        ctx.arc(cx, cy, detector.radius.darkRing1 * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.fillStyle = detector.palette.space;
        ctx.arc(cx, cy, detector.radius.ecal * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();


        ctx.strokeStyle = detector.colors.hcalLine;
        ctx.fillStyle = detector.colors.hcal;
        var calSplit = 20/2;
        for (var i = 0; i < 20; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + detector.radius.ecal * Math.cos(Math.PI * i / calSplit) * detector.ratio, cy + detector.radius.ecal * Math.sin(Math.PI * i / calSplit) * detector.ratio);
            ctx.lineTo(cx + detector.radius.hcal * Math.cos(Math.PI * i / calSplit) * detector.ratio, cy + detector.radius.hcal * Math.sin(Math.PI * i / calSplit) * detector.ratio);
            ctx.arc(cx, cy, detector.radius.hcal * detector.ratio, Math.PI * i / calSplit, Math.PI * (i+1) / calSplit, false);
            ctx.lineTo(cx + detector.radius.ecal * Math.cos(Math.PI * (i+1) / calSplit) * detector.ratio, cy + detector.radius.ecal * Math.sin(Math.PI * (i+1) / calSplit) * detector.ratio);
            ctx.lineTo(cx + detector.radius.ecal * Math.cos(Math.PI * i / calSplit) * detector.ratio, cy + detector.radius.ecal * Math.sin(Math.PI * i / calSplit) * detector.ratio);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.strokeStyle = detector.colors.ecalLine;
        ctx.fillStyle = detector.colors.ecal;
        var calSplit = 20/2;
        for (var i = 0; i < 20; i++) {
            ctx.beginPath();
            ctx.moveTo(cx + detector.radius.siliconSpace * Math.cos(Math.PI * i / calSplit) * detector.ratio, cy + detector.radius.siliconSpace * Math.sin(Math.PI * i / calSplit) * detector.ratio);
            ctx.lineTo(cx + detector.radius.ecal * Math.cos(Math.PI * i / calSplit) * detector.ratio, cy + detector.radius.ecal * Math.sin(Math.PI * i / calSplit) * detector.ratio);
            ctx.lineTo(cx + detector.radius.ecal * Math.cos(Math.PI * (i+1) / calSplit) * detector.ratio, cy + detector.radius.ecal * Math.sin(Math.PI * (i+1) / calSplit) * detector.ratio);
            ctx.lineTo(cx + detector.radius.siliconSpace * Math.cos(Math.PI * (i+1) / calSplit) * detector.ratio, cy + detector.radius.siliconSpace * Math.sin(Math.PI * (i+1) / calSplit) * detector.ratio);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.beginPath();
        ctx.strokeStyle = detector.colors.siliconRingLine;
        ctx.fillStyle = detector.colors.siliconRing;
        ctx.arc(cx, cy, detector.radius.silicon * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.strokeStyle = detector.colors.siliconRingLine;
        ctx.fillStyle = detector.colors.siliconRing;
        ctx.arc(cx, cy, detector.radius.siliconInner * detector.ratio, 0, Math.PI * 2, true);
        ctx.fill();
        ctx.stroke();
    },

    randomTrack: function()
    {
        return detector.tracks[Math.floor(Math.random() * detector.tracks.length)];
    },

    push: function(type, count, external, opts)
    {
        detector.events.list.push(new ParticleEvent(type, count, external, opts));
    },

    /** An event from clicking the detector. What it contains depends on the
     * upgrades, research and dark matter the lab has. */
    addEvent: function()
    {
        var fx = detector.effects, full = detector.quality === 'full';
        var minimal = detector.quality === 'minimal';
        var num = Math.max(3, Math.ceil(15 * Math.random() * (1 + fx.lumi / 12)));
        if (minimal) {
            num = Math.ceil(num / 2);
        }
        for (var i = 0; i < num; i++) {
            detector.push(detector.randomTrack(), num);
        }
        if (minimal) {
            detector.trim();
            return;
        }
        var chance = function(p) { return Math.random() < p; };
        var direction = function() { return Math.random() * Math.PI * 2; };
        var r = detector.radius;

        if (fx.photons && chance(0.3)) {
            // Photons leave no track, only a hit in the ECAL.
            for (var p = 0, n = chance(0.5) ? 2 : 1; p < n; p++) {
                var d = direction();
                detector.push({name: 'photon'}, 1, false, {direction: d});
                detector.push({name: 'deposit'}, 1, false, {kind: 'deposit', direction: d, fade: 0.02});
            }
        }
        if (fx.jets && chance(0.3)) {
            // A spray of hadrons in a narrow cone, stopped in the HCAL.
            var axis = direction();
            for (var j = 0, m = 4 + Math.floor(5 * Math.random()); j < m; j++) {
                detector.push(detector.tracks[1], m, false,
                              {direction: axis + (Math.random() - 0.5) * 0.5});
            }
            detector.push({name: 'deposit'}, 1, false,
                          {kind: 'deposit', direction: axis, inner: r.ecal, outer: r.hcal,
                           spread: Math.PI / 12, fade: 0.02});
        }
        if (fx.golden && chance(0.08)) {
            // A textbook event: H -> two photons or Z -> two muons, back to back.
            var g = direction(), higgs = chance(0.5);
            for (var k = 0; k < 2; k++) {
                var dir = g + k * Math.PI;
                if (higgs) {
                    detector.push({name: 'photon'}, 2, false, {direction: dir, glow: true, width: 3, fade: 0.012});
                    detector.push({name: 'deposit'}, 1, false, {kind: 'deposit', direction: dir, fade: 0.012});
                } else {
                    detector.push(detector.tracks[2], 2, false, {direction: dir, glow: true, width: 3,
                                                                  radius: 900, fade: 0.012});
                }
            }
            detector.push({name: 'flash'}, 1, false, {kind: 'flash', size: 16, fade: 0.02});
        }
        if (fx.pileup && full) {
            // Many soft collisions in the same bunch crossing.
            for (var q = 0, pile = 6 + Math.floor(10 * Math.random()); q < pile; q++) {
                detector.push({name: 'pion'}, pile, false,
                              {origin: {x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6}});
            }
        }
        if (fx.shockwave && full) {
            detector.push({name: 'ring'}, 1, false, {kind: 'ring', fade: 0.025});
        }
        if (fx.displaced && chance(0.2)) {
            // A B meson flies a few millimetres before it decays.
            var v = direction(), dist = (6 + 14 * Math.random()) * detector.ratio;
            var origin = {x: Math.cos(v) * dist, y: Math.sin(v) * dist};
            for (var t = 0, tracks = 2 + Math.floor(2 * Math.random()); t < tracks; t++) {
                detector.push(detector.tracks[0], tracks, false,
                              {origin: origin, direction: v + (Math.random() - 0.5) * 1.2});
            }
        }
        if (fx.met && chance(0.15)) {
            // Missing energy: something invisible, like a neutrino, got away.
            detector.push({name: 'met'}, 1, false, {fade: 0.02});
        }
        if (fx.annihilation && chance(0.1)) {
            // Antimatter meets matter: a star of pions from one point.
            var a = direction(), rad = (r.siliconSpace + 5 * Math.random()) * detector.ratio;
            var star = {x: Math.cos(a) * rad, y: Math.sin(a) * rad};
            for (var s = 0; s < 5; s++) {
                detector.push({name: 'pion'}, 5, false,
                              {origin: star, direction: a + s * Math.PI * 2 / 5 + Math.random() * 0.4,
                               alpha: 1, width: 2, radius: 400, length: (r.ecal - 10) * detector.ratio});
            }
            detector.push({name: 'flash'}, 1, false, {kind: 'flash', origin: star, size: 10});
        }
        if (fx.heavyIon && chance(0.05)) {
            // Two lead nuclei collide: hundreds of particles at once.
            for (var h = 0, many = full ? 60 + Math.floor(40 * Math.random()) : 25; h < many; h++) {
                detector.push({name: 'pion'}, many, false, {fade: 0.02});
            }
        }
        if (fx.darkTracks && chance(0.2)) {
            detector.push({name: 'dark'}, 1);
        }
        detector.trim();
    },

    addEventExternal: function(numWorkers)
    {
        if (!detector.visible) {
            return;
        }

        var num = Math.min(20 * numWorkers / 10, 20);
        if (detector.quality === 'minimal') {
            num = Math.ceil(num / 3);
        }

        for (var i = 0; i < num; i++) {
            detector.push(detector.randomTrack(), num, true);
        }
        if (detector.quality === 'full' && detector.effects.pileup) {
            for (var p = 0; p < 5; p++) {
                detector.push({name: 'pion'}, 5, true);
            }
        }
        detector.trim();
    },

    /** Drop the oldest events if the display gets too busy. */
    trim: function()
    {
        var list = detector.events.list;
        if (list.length > detector.maxEvents) {
            list.splice(0, list.length - detector.maxEvents);
        }
    },

    draw: function(duration)
    {
        detector.events.ctx.clearRect(0, 0, detector.width, detector.height);

        var alive = [];
        var list = detector.events.list;
        for (var i = 0; i < list.length; i++) {
            if (list[i].alpha > 0) {
                list[i].draw(duration);
                if (list[i].alpha > 0) {
                    alive.push(list[i]);
                }
            }
        }
        detector.events.list = alive;
    }
};

window.requestAnimFrame = (function(){
    return window.requestAnimationFrame       || 
           window.webkitRequestAnimationFrame || 
           window.mozRequestAnimationFrame    || 
           window.oRequestAnimationFrame      || 
           window.msRequestAnimationFrame     || 
           function(/* function */ callback, /* DOMElement */ element){
               window.setTimeout(callback, 1000 / 60);
           };
})();

(function() {
    detector.palette = detector.palettes.light;
    detector.init(400);
    $('#detector').width(400).height(400);
})();
