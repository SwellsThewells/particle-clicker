/** A particle (or other signal) in the event display.
 *
 * type is one of detector.tracks (or {name: ...} for the special kinds) and
 * decides the colour. opts can override:
 *   kind      'arc' (charged track), 'line' (photon, missing energy),
 *             'deposit' (calorimeter hit), 'ring' (shockwave), 'flash'
 *   direction angle in radians, length and radius (curvature) in pixels
 *   origin    {x, y} offset from the centre, for displaced vertices
 *   alpha, fade (alpha lost per 16 ms), width, dash, glow, arrow
 */
function ParticleEvent(type, count, external, opts)
{
    opts = opts || {};
    this.work = typeof external !== 'undefined' ? external : false;
    this.type = type;
    this.kind = opts.kind || 'arc';
    this.length = 0;
    this.radius = 0;
    this.direction = Math.random() * Math.PI * 2;
    this.sign = (Math.random() - 0.5 >= 0) ? 1 : -1;
    this.alpha = this.work ? 0.5 : 1;
    this.fade = 0.03;
    this.width = 2;
    this.count = count;
    this.origin = {x: 0, y: 0};
    this.hue = Math.floor(Math.random() * 360);  // for the Rainbow and Aurora skins

    var r = detector.radius, ratio = detector.ratio;
    switch (this.type.name)
    {
        case 'electron':
            this.length = r.siliconSpace * ratio + Math.round((r.ecal * ratio + 10 - r.siliconSpace * ratio) * Math.random());
            this.radius = 20 + Math.round((100 - 20) * Math.random());
            break;
        case 'jet':
            this.length = r.ecal * ratio + Math.round((r.mucal * ratio - r.ecal * ratio) * Math.random());
            this.radius = 40 + Math.round((200 - 40) * Math.random());
            break;
        case 'muon':
            this.length = r.mucal * ratio + 3 * r.mucalDark * ratio + Math.round((4 * r.mucalLight * ratio + 2 * r.mucalDark * ratio) * Math.random());
            this.radius = 200 + Math.round((600 - 200) * Math.random());
            break;
        case 'pion':
            this.length = (r.silicon + (r.ecal - r.silicon) * Math.random()) * ratio;
            this.radius = 15 + Math.round(45 * Math.random());
            this.width = 1;
            this.alpha = 0.35;
            break;
        case 'dark':
            this.length = (r.hcal + (r.mucal - r.hcal) * Math.random()) * ratio;
            this.radius = 150 + Math.round(300 * Math.random());
            this.dash = [3, 4];
            break;
        case 'photon':
            this.kind = opts.kind || 'line';
            this.length = r.ecal * ratio;
            this.dash = [5, 3];
            break;
        case 'met':
            this.kind = 'line';
            this.length = (r.hcal + (r.mucal - r.hcal) * Math.random()) * ratio;
            this.dash = [7, 4];
            this.arrow = true;
            this.width = 3;
            break;
    }

    // The more energetic the collisions, the straighter the tracks.
    this.radius *= 1 + (detector.effects.energy || 0) / 4;
    for (var key in opts) {
        if (opts.hasOwnProperty(key) && key !== 'kind') {
            this[key] = opts[key];
        }
    }
    // A chord longer than the diameter cannot be drawn as an arc.
    this.radius = Math.max(this.radius, this.length / 2 + 1);
    this.glow = this.glow || (detector.effects.boost && !this.work);

    this.draw(16, true);
};

ParticleEvent.prototype.color = function()
{
    return detector.palette[this.type.name] || this.type.color;
};

ParticleEvent.prototype.draw = function(duration, init)
{
    init = typeof init !== 'undefined' ? init : false;

    var ctx = detector.events.ctx;
    var cx = detector.width / 2;
    var cy = detector.height / 2;
    var color = this.color();

    ctx.save();

    ctx.globalAlpha = Math.max(0, this.alpha);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = this.width;
    if (this.dash && ctx.setLineDash) {
        ctx.setLineDash(this.dash);
    }
    if (this.glow && detector.quality === 'full') {
        ctx.shadowColor = detector.palette.glow;
        ctx.shadowBlur = 8;
    }

    ctx.translate(cx + this.origin.x, cy + this.origin.y);
    ctx.rotate(this.direction);
    if (this.kind === 'arc' || this.kind === 'line') {
        detector.applySkin(ctx, this);
    }

    var r = detector.radius, ratio = detector.ratio;
    switch (this.kind)
    {
        case 'arc':
            var h = Math.sqrt(Math.max(this.radius * this.radius - this.length * this.length / 4, 0));
            var a = Math.asin(Math.min(1, this.length / (2 * this.radius)));
            ctx.beginPath();
            ctx.arc(this.length / 2, this.sign * h, this.radius, - this.sign * Math.PI / 2 - a, - this.sign * Math.PI / 2 + a, false);
            ctx.stroke();
            break;
        case 'line':
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(this.length, 0);
            ctx.stroke();
            if (this.arrow) {
                if (ctx.setLineDash) {
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.moveTo(this.length + 4, 0);
                ctx.lineTo(this.length - 6, -5);
                ctx.lineTo(this.length - 6, 5);
                ctx.closePath();
                ctx.fill();
            }
            break;
        case 'deposit':
            // A calorimeter cell lighting up where a particle stopped.
            var inner = (this.inner || r.siliconSpace) * ratio;
            var outer = (this.outer || r.ecal) * ratio;
            var half = this.spread || Math.PI / 20;
            ctx.globalAlpha = Math.max(0, this.alpha) * 0.7;
            ctx.fillStyle = detector.palette.deposit;
            ctx.beginPath();
            ctx.arc(0, 0, outer, -half, half, false);
            ctx.arc(0, 0, inner, half, -half, true);
            ctx.closePath();
            ctx.fill();
            break;
        case 'ring':
            // A shockwave that grows as it fades.
            ctx.lineWidth = 2;
            ctx.strokeStyle = detector.palette.flash;
            ctx.beginPath();
            ctx.arc(0, 0, (10 + (1 - this.alpha) * (r.mucal + 60)) * ratio, 0, Math.PI * 2, false);
            ctx.stroke();
            break;
        case 'flash':
            var radius = (this.size || 12) * ratio;
            var gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
            gradient.addColorStop(0, detector.palette.flash);
            gradient.addColorStop(1, 'rgba(255, 213, 79, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2, false);
            ctx.fill();
            break;
    }

    ctx.restore();

    if (!init) {
        this.alpha -= this.fade / 16 * duration;
    }
};
