'use strict';
/* Aurora Clock: the Static Aurora glow follows the time of day.
 * Five moods (night, dawn, day, golden hour, dusk) blend smoothly into each other, mixed in OKLCH so the
 * in-between colours stay bright. Your AshOtis players win while they play; the clock takes over again after. */
const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

const VARS = ['--sa-c1', '--sa-c2', '--sa-c3'];          // Static Aurora's glow colours
const OPEN = ['--clock-c1', '--clock-c2', '--clock-c3'];  // the same colours for any theme, always set
const MOOD_CLASS = { 'Night': 'clock-night', 'Dawn': 'clock-dawn', 'Day': 'clock-day', 'Golden hour': 'clock-golden', 'Dusk': 'clock-dusk' };
// [peak hour, name, [glow 1, glow 2, glow 3], optional hue (OKLCH, radians) the blend to the next mood passes through]
const MOODS = [
  [1.0,  'Night',       [[52, 211, 153], [20, 184, 166], [37, 99, 235]]],
  [6.5,  'Dawn',        [[251, 146, 120], [244, 114, 182], [167, 139, 250]]],
  [12.0, 'Day',         [[45, 212, 191], [56, 189, 248], [96, 165, 250]], 1.9],   // into golden hour by way of yellow, not pink
  [17.5, 'Golden hour', [[251, 191, 36], [249, 115, 22], [244, 63, 94]]],
  [20.5, 'Dusk',        [[168, 85, 247], [236, 72, 153], [79, 70, 229]]]
];
const DEFAULTS = { enabled: true, afterMusic: 'return', notesGlow: false, notesStrength: 35, notesDim: 50 };

/* ---------- colour maths: sRGB <-> OKLCH ---------- */
const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const gam = c => { c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, c)) * 255); };
function toLch([r, g, b]) {
  r = lin(r); g = lin(g); b = lin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function fromLch([L, C, H]) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = Math.pow(L + 0.3963377774 * A + 0.2158037573 * B, 3);
  const m = Math.pow(L - 0.1055613458 * A - 0.0638541728 * B, 3);
  const s = Math.pow(L - 0.0894841775 * A - 1.2914855480 * B, 3);
  return [gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
          gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
          gam(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)];
}
function mixLch(a, b, t, via) {
  const x = toLch(a), y = toLch(b);
  let dh = y[2] - x[2];
  if (dh > Math.PI) dh -= 2 * Math.PI; else if (dh < -Math.PI) dh += 2 * Math.PI;   // the short way round
  if (via != null) {                                                                  // ...unless told to pass a hue
    const passes = d => { let v = via - x[2]; v = ((v % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return d >= 0 ? v <= d : v >= 2 * Math.PI + d; };
    if (!passes(dh)) dh = dh > 0 ? dh - 2 * Math.PI : dh + 2 * Math.PI;
  }
  return fromLch([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + dh * t]);
}

// Colours for an hour of the day (0–24, fractional). Lingers at each peak, blends between them.
function coloursAt(hour) {
  const n = MOODS.length;
  let i = n - 1;
  for (let k = 0; k < n; k++) if (hour >= MOODS[k][0]) i = k;
  const a = MOODS[i], b = MOODS[(i + 1) % n];
  let span = b[0] - a[0]; if (span <= 0) span += 24;
  let into = hour - a[0]; if (into < 0) into += 24;
  let t = into / span; t = t * t * (3 - 2 * t);                       // smoothstep: slow near the peaks
  const cols = a[2].map((c, j) => mixLch(c, b[2][j], t, j < 2 ? a[3] : null));   // the deep third glow takes the short way
  cols[2] = cols[2].map(v => Math.round(v * 0.75));                     // third glow sits deeper, like the players
  return { cols, name: t < 0.5 ? a[1] : b[1] };
}
const rgb = c => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

module.exports = class AuroraClock extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.last = null;
    this.addSettingTab(new ClockSettings(this.app, this));
    this.addCommand({ id: 'preview-day', name: 'Preview a whole day (20 seconds)', callback: () => this.preview() });
    this.addCommand({ id: 'toggle', name: 'Turn time-of-day colours on or off', callback: () => this.setEnabled(!this.settings.enabled) });
    this.app.workspace.onLayoutReady(() => this.tick());
    this.paintNotes();
    this.registerInterval(window.setInterval(() => this.tick(), 60 * 1000));
    // a player checks every second; look a little more often so the clock comes back soon after music stops
    this.registerInterval(window.setInterval(() => this.checkOwner(), 2 * 1000));
    this.registerDomEvent(document, 'visibilitychange', () => { if (!document.hidden) this.tick(); });
    // the players say when they stop: take the glow back straight away instead of waiting for their stamp to go stale
    this.registerEvent(this.app.workspace.on('ashotis:stopped', src => window.setTimeout(() => this.onPlayerStopped(src), 50)));
  }

  onunload() { this.stopPreview(); this.clear(); this.unpublish(); this.paintNotes(true); }

  // the aurora behind your notes: a class on <body> plus two numbers, the drawing is all in styles.css
  paintNotes(off) {
    const s = this.settings, on = !off && s.notesGlow;
    document.body.toggleClass('ac-notes', on);
    if (on) document.body.setCssProps({ '--ac-glow': String(s.notesStrength / 100), '--ac-dim': String(s.notesDim / 100) });
    else document.body.setCssProps({ '--ac-glow': '', '--ac-dim': '' });
  }

  save() { return this.saveData(this.settings); }

  setEnabled(on) {
    this.settings.enabled = on; this.save();
    if (on) { this.last = null; this.tick(); } else { this.clear(); this.unpublish(); }
    new Notice(on ? 'Aurora Clock: on' : 'Aurora Clock: off');
  }

  // Is one of the players colouring the theme? They stamp data-sa-owner="id:time" every second while playing.
  playerActive() {
    const o = (document.body.dataset.saOwner || '').split(':');
    if (!o[0]) return false;
    if (this.settings.afterMusic === 'keep') return true;               // keep the music's colours until it's switched off
    return Date.now() - Number(o[1]) < 3000;
  }

  onPlayerStopped(src) {
    if (!this.settings.enabled || this.settings.afterMusic === 'keep') return;
    const owner = (document.body.dataset.saOwner || '').split(':')[0];
    if (owner && owner !== src) return;                 // a different player is still colouring the theme
    delete document.body.dataset.saOwner;
    this.last = null; this.tick();
  }

  // Every few seconds: if no player is colouring the theme but the glow isn't ours (a player stopped and
  // left its colours behind), take over straight away instead of waiting for the minute.
  checkOwner() {
    if (!this.settings.enabled || this.previewing || document.hidden || this.playerActive()) return;
    const cur = document.body.style.getPropertyValue(VARS[0]).trim();
    if (!this.last || cur !== rgb(this.last[0])) { this.last = null; this.tick(); }
  }

  tick() {
    if (!this.settings.enabled || this.previewing || document.hidden) return;
    const d = new Date(), hour = d.getHours() + d.getMinutes() / 60, now = coloursAt(hour);
    this.publish(hour, now);
    if (this.playerActive()) return;
    this.apply(now.cols);
  }

  // For any theme or plugin: a mood class, the colours and the hour, whatever the music is doing
  publish(hour, now) {
    const body = document.body, cls = MOOD_CLASS[now.name];
    if (cls !== this.moodClass) {
      Object.values(MOOD_CLASS).forEach(c => body.classList.remove(c));
      body.classList.add(cls); this.moodClass = cls;
    }
    body.style.setProperty('--clock-hour', hour.toFixed(2));
    now.cols.forEach((c, i) => body.style.setProperty(OPEN[i], rgb(c)));
    this.app.workspace.trigger('aurora-clock:tick', { hour, mood: now.name, colours: now.cols.map(rgb) });
  }

  unpublish() {
    const body = document.body;
    Object.values(MOOD_CLASS).forEach(c => body.classList.remove(c));
    OPEN.concat('--clock-hour').forEach(v => body.style.removeProperty(v));
    this.moodClass = null;
  }

  apply(cols) {
    // skip writes too small to see: every write restyles the window
    if (this.last && cols.every((c, i) => c.every((v, j) => Math.abs(v - this.last[i][j]) < 3))) return;
    const body = document.body;
    // clear a stale owner stamp so a player that starts again repaints its own colours straight away
    if (body.dataset.saOwner) delete body.dataset.saOwner;
    cols.forEach((c, i) => body.style.setProperty(VARS[i], rgb(c)));
    this.last = cols; this.mine = true;
  }

  clear() {
    if (!this.mine) return;
    if (!(document.body.dataset.saOwner || '')) VARS.forEach(v => document.body.style.removeProperty(v));
    this.mine = false; this.last = null;
  }

  preview() {
    if (this.previewing) return;
    if (this.playerActive()) { new Notice('Aurora Clock: stop the music first, it is colouring the theme.'); return; }
    this.previewing = true;
    const body = document.body, start = performance.now(), len = 20000;
    body.style.setProperty('transition', 'none');
    const note = new Notice('', len + 1000);
    const step = now => {
      if (!this.previewing) return;
      const p = Math.min(1, (now - start) / len), hour = (p * 24 + 5) % 24;   // start at 5am, run a full day
      const { cols, name } = coloursAt(hour);
      cols.forEach((c, i) => body.style.setProperty(VARS[i], rgb(c)));
      const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
      note.setMessage(`Aurora Clock preview: ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}  ${name}`);
      if (p < 1) this.raf = requestAnimationFrame(step); else { note.hide(); this.stopPreview(); }
    };
    this.raf = requestAnimationFrame(step);
  }

  stopPreview() {
    if (!this.previewing) return;
    cancelAnimationFrame(this.raf);
    this.previewing = false;
    document.body.style.removeProperty('transition');
    this.mine = true; this.last = null; this.tick();
  }
};

class ClockSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const p = this.plugin, s = p.settings, el = this.containerEl;
    el.empty();
    new Setting(el).setName('Colours follow the time of day')
      .setDesc('The Static Aurora glow drifts through night, dawn, day, golden hour and dusk.')
      .addToggle(t => t.setValue(s.enabled).onChange(v => p.setEnabled(v)));
    new Setting(el).setName('After the music stops')
      .setDesc('While Static FM, Hi-Fi Tuner, Aurora MP3 or another AshOtis player is playing, its colours always win.')
      .addDropdown(d => d.addOptions({ return: 'Go back to the time of day', keep: "Keep the music's colours" })
        .setValue(s.afterMusic).onChange(v => { s.afterMusic = v; p.save(); p.last = null; p.tick(); }));
    new Setting(el).setName('Preview a whole day').setDesc('Runs through 24 hours in 20 seconds.')
      .addButton(b => b.setButtonText('Preview').onClick(() => p.preview()));

    new Setting(el).setName('Behind your notes').setHeading();
    new Setting(el).setName('Aurora behind your notes')
      .setDesc('Draws the drifting aurora behind every note, in the colours of the moment (the time of day, or your music). Like Daily Board\'s Static Aurora background.')
      .addToggle(t => t.setValue(s.notesGlow).onChange(v => { s.notesGlow = v; p.save(); p.paintNotes(); this.display(); }));
    if (s.notesGlow) {
      new Setting(el).setName('Glow').setDesc('How strong the aurora is.')
        .addSlider(sl => sl.setLimits(10, 100, 5).setValue(s.notesStrength).setDynamicTooltip().onChange(v => { s.notesStrength = v; p.save(); p.paintNotes(); }));
      new Setting(el).setName('Darken').setDesc('Dim it so your writing stays easy to read.')
        .addSlider(sl => sl.setLimits(0, 90, 5).setValue(s.notesDim).setDynamicTooltip().onChange(v => { s.notesDim = v; p.save(); p.paintNotes(); }));
    }
  }
}
