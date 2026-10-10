const { $, $$, h, esc, busy, toast, download, store } = Kit;

const WAVES = ['sine', 'triangle', 'square', 'sawtooth'];
const uid = () => Math.random().toString(36).slice(2, 9);
let song = null, songMood = '';
let library = store.get('library', []);
let mixer = Object.assign({ lead: 0.8, pad: 0.7, bass: 0.8, drums: 0.7 }, store.get('mixer', {}));
let custom = store.get('drums.custom', { k: 'x.....x...x.....', s: '....x.......x...', h: 'x.x.x.x.x.x.x.xx', swing: 0 });

/* ================= audio engine (works with live and offline contexts) ================= */
function makeEngine(ac) {
  const master = ac.createGain(); master.gain.value = 0.8;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp); comp.connect(ac.destination);
  const conv = ac.createConvolver();
  const len = Math.floor(ac.sampleRate * 2.4), ir = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
  conv.buffer = ir;
  const wet = ac.createGain(); wet.gain.value = 0.28;
  conv.connect(wet); wet.connect(master);
  const bus = {};
  ['lead', 'pad', 'bass', 'drums'].forEach((k) => { bus[k] = ac.createGain(); bus[k].gain.value = mixer[k]; bus[k].connect(master); });
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const nd = noise.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  return { ac, master, conv, bus, noise };
}
const freq = (m) => 440 * Math.pow(2, (m - 69) / 12);
function route(E, node, track, reverb) { node.connect(E.bus[track]); if (reverb) node.connect(E.conv); }
function voice(E, track, m, t, dur, type, vol, a, rel, cutoff, reverb) {
  const ac = E.ac, o = ac.createOscillator(), g = ac.createGain(), f = ac.createBiquadFilter();
  o.type = type; o.frequency.value = freq(m);
  f.type = 'lowpass'; f.frequency.value = cutoff;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + a);
  g.gain.exponentialRampToValueAtTime(vol * 0.7, t + a + 0.12);
  g.gain.setValueAtTime(vol * 0.7, t + Math.max(a + 0.12, dur));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + rel);
  o.connect(f); f.connect(g); route(E, g, track, reverb);
  o.start(t); o.stop(t + dur + rel + 0.05);
}
function drum(E, kind, t, vel, reverb) {
  const ac = E.ac;
  if (kind === 'k') {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.9 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g); g.connect(E.bus.drums); o.start(t); o.stop(t + 0.4);
  } else {
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = E.noise; f.type = 'highpass'; f.frequency.value = kind === 's' ? 1400 : 7500;
    const dur = kind === 's' ? 0.18 : 0.045;
    g.gain.setValueAtTime((kind === 's' ? 0.45 : 0.16) * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); route(E, g, 'drums', reverb); s.start(t); s.stop(t + dur + 0.02);
  }
}
function sound(E, e, t, spb, o) {
  const j = o.humanize ? (Math.random() - 0.5) * 0.018 : 0, vel = o.humanize ? 0.85 + Math.random() * 0.3 : 1;
  if (e.kind === 'pad') e.notes.forEach((m) => voice(E, 'pad', m, t, e.dur * spb, o.pad, 0.035 * vel, 0.25, 0.6, 1500, o.reverb));
  else if (e.kind === 'bass') voice(E, 'bass', e.notes[0], t + j, e.dur * spb, 'triangle', 0.16 * vel, 0.01, 0.1, 800, false);
  else if (e.kind === 'lead') voice(E, 'lead', e.notes[0], t + j, e.dur * spb, o.lead, (o.lead === 'square' || o.lead === 'sawtooth' ? 0.05 : 0.11) * vel, 0.012, 0.25, 4200, o.reverb);
  else drum(E, e.kind, t + j * 0.5, vel, o.reverb);
}

let live = null;
function engine() {
  if (!live) live = makeEngine(new (window.AudioContext || window.webkitAudioContext)());
  live.ac.resume();
  return live;
}

/* One transport shared by the composer, the chord lab and the drum machine. */
const transport = {
  owner: null, timer: null, raf: null, idx: 0, loopN: 0, startAt: 0, events: [], loop: 4,
  start(owner, events, loop, bpm, opts, onFrame, onEvent) {
    this.stop();
    const E = engine();
    Object.assign(this, { owner, events, loop, bpm, opts, onFrame, onEvent, idx: 0, loopN: 0, startAt: E.ac.currentTime + 0.08 });
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
    const tick = () => { if (this.owner !== owner) return; onFrame && onFrame(((E.ac.currentTime - this.startAt) / this.spb()) % loop); this.raf = requestAnimationFrame(tick); };
    tick();
    syncButtons();
  },
  spb() { return 60 / (typeof this.bpm === 'function' ? this.bpm() : this.bpm); },
  schedule() {
    const E = live, ahead = E.ac.currentTime + 0.15;
    if (!this.events.length) return;
    for (;;) {
      if (this.idx >= this.events.length) { this.idx = 0; this.loopN++; }
      const e = this.events[this.idx];
      const t = this.startAt + (this.loopN * this.loop + e.t) * this.spb();
      if (t > ahead) break;
      sound(E, e, t, this.spb(), this.opts);
      if (this.onEvent) { const owner = this.owner; setTimeout(() => this.owner === owner && this.onEvent(e), Math.max(0, (t - E.ac.currentTime) * 1000)); }
      this.idx++;
    }
  },
  stop() {
    const was = this.owner;
    this.owner = null;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    if (live && was) { const g = live.master.gain, now = live.ac.currentTime; g.cancelScheduledValues(now); g.setValueAtTime(g.value, now); g.linearRampToValueAtTime(0, now + 0.05); setTimeout(() => { if (!transport.owner) { g.cancelScheduledValues(0); g.value = 0.8; } }, 120); }
    if (was === 'song') { drawRoll(-1); $$('#chords span').forEach((s) => s.classList.remove('on')); }
    if (was === 'lab') $$('#romans button').forEach((b) => b.classList.remove('on'));
    if (was === 'drums') $$('#seq button').forEach((b) => b.classList.remove('now'));
    syncButtons();
  },
};
function syncButtons() {
  $('#play').textContent = transport.owner === 'song' ? 'Stop' : 'Play';
  $('#labPlay').textContent = transport.owner === 'lab' ? 'Stop' : 'Play progression';
  $('#drumPlay').textContent = transport.owner === 'drums' ? 'Stop' : 'Play';
}
const playOpts = () => ({ humanize: $('#humanize').checked, reverb: $('#reverb').checked, lead: $('#lead').value, pad: $('#pad').value });

/* ================= composer ================= */
const SYS = `You are a composer. Turn a mood into a short loopable piece. Return JSON:
{"title":"evocative title","description":"one sentence about the musical choices","key":"C|C#|D|Eb|E|F|F#|G|Ab|A|Bb|B","mode":"major|minor|dorian|mixolydian|lydian|phrygian|harmonic minor","tempo":50-180,
 "chords":[{"symbol":"e.g. Am7, Fmaj7, G, Dsus4, E7, Bm7b5, C/E","beats":2|4}],
 "melody":[{"note":"scientific pitch like E5 or rest","beats":0.5|0.75|1|1.5|2|3|4}],
 "drum_style":"none|soft|four|halftime|swing|trap","lead":"sine|triangle|square|sawtooth","pad":"sine|triangle|square|sawtooth"}
Rules: 8 chords totalling 32 beats; melody totals 32 beats, in octaves 4-5, singable, with a motif that repeats with variation; strong beats land on chord tones.`;

async function compose(mood) {
  const raw = await AI.chat([{ role: 'system', content: SYS }, { role: 'user', content: 'Mood: ' + mood }], { json: true, temperature: 0.9, maxTokens: 2500, demo: () => localCompose(mood) });
  songMood = mood;
  load(raw);
}
async function vary() {
  const base = { title: song.title, key: song.key, mode: song.mode, tempo: song.tempo, chords: song.chords, melody: melodyOf(song), drum_style: song.drum_style };
  const raw = await AI.chat([{ role: 'system', content: SYS }, { role: 'user', content: 'Write a variation of this piece: keep the key, mode and harmonic feel, but rewrite the melody (new rhythm and contour, call-and-response with the original motif) and you may re-voice or substitute 1-2 chords. Give it a new related title.\n' + JSON.stringify(base) }],
    { json: true, temperature: 0.9, maxTokens: 2500, demo: () => Object.assign(localCompose(songMood || $('#mood').value, Math.floor(Math.random() * 1e6)), { key: song.key, mode: song.mode, tempo: song.tempo, chords: song.chords, title: song.title.replace(/ \(Variation\)$/, '') + ' (Variation)' }) });
  load(raw, true);
}

function load(raw, keepSettings = false, autoplay = true) {
  transport.stop();
  song = normalizeSong(raw);
  song.id = raw.id || null;
  $('#title').textContent = song.title || 'Untitled';
  $('#desc').textContent = song.description || '';
  $('#bpm').value = song.tempo; $('#bpmVal').textContent = song.tempo + ' BPM';
  if (!keepSettings) {
    $('#transpose').value = 0; $('#trVal').textContent = '0';
    if (WAVES.includes(raw.lead)) $('#lead').value = raw.lead;
    if (WAVES.includes(raw.pad)) $('#pad').value = raw.pad;
  }
  $('#groove').value = song.drum_style;
  $('#drums').checked = song.drum_style !== 'none';
  renderFacts();
  $('#chords').innerHTML = song.chords.map((c, i) => `<span data-i="${i}">${esc(c.symbol)}</span>`).join('');
  ['#play', '#vary', '#midi', '#wav', '#save'].forEach((s) => ($(s).disabled = false));
  $('#save').textContent = song.id ? 'Update in library' : 'Save to library';
  drawRoll(-1);
  if (autoplay) playSong();
}
function renderFacts() {
  $('#facts').innerHTML = [['Key', `${spell(song.keyPc + +$('#transpose').value, song.keyPc + +$('#transpose').value, song.mode)} ${song.mode}`], ['Bars', song.loop / 4], ['Groove', song.drum_style], ['Notes', song.notes.filter((n) => n.midi != null).length]]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`).join('');
}
const songEvents = () => buildEvents(song, { transpose: +$('#transpose').value, drums: $('#drums').checked, custom });
function playSong() {
  if (!song) return;
  transport.start('song', songEvents(), song.loop, () => +$('#bpm').value, playOpts(), (b) => drawRoll(b), (e) => {
    if (e.kind !== 'pad') return;
    $$('#chords span').forEach((s) => s.classList.toggle('on', +s.dataset.i === e.ci));
    $('#chordNow').textContent = song.chords[e.ci].symbol;
  });
  const entry = song.id && library.find((x) => x.id === song.id);
  if (entry) { entry.plays = (entry.plays || 0) + 1; saveLib(); }
}

/* ================= piano roll ================= */
function drawRoll(playBeat, cv = $('#roll'), s = song, mini = false) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (!W) return;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  if (!s) return;
  const css = getComputedStyle(document.body);
  const line = css.getPropertyValue('--line').trim(), muted = css.getPropertyValue('--muted').trim(), accent = css.getPropertyValue('--accent').trim() || '#d6457a';
  const ev = mini ? buildEvents(s, { drums: false }) : songEvents();
  const lo = mini ? 58 : 40, hi = mini ? 86 : 90, pad = mini ? 2 : 34;
  const x = (b) => pad + (b / s.loop) * (W - pad - (mini ? 2 : 6)), y = (m) => H - (mini ? 3 : 10) - ((m - lo) / (hi - lo)) * (H - (mini ? 6 : 20));
  const rowH = (H - (mini ? 6 : 20)) / (hi - lo);
  if (!mini) {
    for (let m = lo; m <= hi; m++) if ([1, 3, 6, 8, 10].includes(m % 12)) { g.fillStyle = line; g.globalAlpha = 0.35; g.fillRect(pad, y(m) - rowH / 2, W, rowH); }
    g.globalAlpha = 1; g.font = '10px Inter, sans-serif'; g.fillStyle = muted;
    for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) g.fillText('C' + (m / 12 - 1), 4, y(m) + 3);
    for (let b = 0; b <= s.loop; b++) { g.strokeStyle = line; g.globalAlpha = b % 4 ? 0.3 : 0.9; g.beginPath(); g.moveTo(x(b), 0); g.lineTo(x(b), H); g.stroke(); }
  }
  g.globalAlpha = 1;
  ev.forEach((e) => {
    if (!mini && (e.kind === 'pad' || e.kind === 'bass')) { g.fillStyle = e.kind === 'pad' ? '#7c5cd6' : '#2f7de1'; g.globalAlpha = 0.35; e.notes.forEach((m) => g.fillRect(x(e.t), y(m) - rowH / 2 + 0.5, x(e.t + e.dur) - x(e.t) - 1, Math.max(2, rowH - 1))); }
    if (e.kind === 'lead') { const on = playBeat >= e.t && playBeat < e.t + e.dur / 0.92; g.globalAlpha = 1; g.fillStyle = on ? '#fff' : accent; g.fillRect(x(e.t), y(e.notes[0]) - rowH / 2 - (mini ? 0 : 1), Math.max(mini ? 2 : 3, x(e.t + e.dur) - x(e.t)), Math.max(2, rowH + (mini ? 0 : 2))); }
  });
  g.globalAlpha = 1;
  if (playBeat >= 0) { g.strokeStyle = accent; g.lineWidth = 2; g.beginPath(); g.moveTo(x(playBeat), 0); g.lineTo(x(playBeat), H); g.stroke(); g.lineWidth = 1; }
}

/* ================= exports ================= */
const fileBase = () => (song.title || 'mood').replace(/\W+/g, '_');
function exportMIDI() { download(fileBase() + '.mid', new Blob([encodeMIDI(songEvents(), +$('#bpm').value)], { type: 'audio/midi' })); }
async function exportWAV() {
  const bars = 2, sr = 44100, spb = 60 / +$('#bpm').value, loopSec = song.loop * spb;
  const ac = new OfflineAudioContext(2, Math.ceil(sr * (loopSec * bars + 2.5)), sr);
  const E = makeEngine(ac), ev = songEvents(), o = playOpts();
  for (let n = 0; n < bars; n++) ev.forEach((e) => sound(E, e, 0.05 + (n * song.loop + e.t) * spb, spb, o));
  const buf = await ac.startRendering();
  download(fileBase() + '.wav', new Blob([encodeWAV([buf.getChannelData(0), buf.getChannelData(1)], sr)], { type: 'audio/wav' }));
  toast(`Rendered ${bars} loops (${Math.round(loopSec * bars)} s)`);
}

/* ================= mixer ================= */
function renderMixer() {
  $('#mixer').innerHTML = '';
  [['lead', 'Lead'], ['pad', 'Pad'], ['bass', 'Bass'], ['drums', 'Drums']].forEach(([k, label]) => {
    const val = h('span', { class: 'muted' }, Math.round(mixer[k] * 100) + '%');
    $('#mixer').append(h('label', {}, h('span', { class: 'row between' }, label, val),
      h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: mixer[k], 'aria-label': label + ' volume', oninput: (e) => {
        mixer[k] = +e.target.value; val.textContent = Math.round(mixer[k] * 100) + '%'; store.set('mixer', mixer);
        if (live) live.bus[k].gain.setTargetAtTime(mixer[k], live.ac.currentTime, 0.02);
      } })));
  });
}

/* ================= library ================= */
const saveLib = () => store.set('library', library);
function snapshot() {
  return { title: song.title, description: song.description, mood: songMood, key: song.key, mode: song.mode, tempo: +$('#bpm').value, chords: song.chords, melody: melodyOf(song), drum_style: $('#groove').value, lead: $('#lead').value, pad: $('#pad').value };
}
function saveSong() {
  const snap = snapshot();
  const ex = song.id && library.find((x) => x.id === song.id);
  if (ex) Object.assign(ex, snap, { updated: Date.now() });
  else { song.id = uid(); library.unshift(Object.assign({ id: song.id, created: Date.now(), plays: 0, fav: false }, snap)); }
  saveLib(); renderLibrary();
  $('#save').textContent = 'Update in library';
  toast(ex ? 'Library entry updated' : 'Saved to library');
}
function renderLibrary() {
  const q = $('#libSearch').value.trim().toLowerCase(), sort = $('#libSort').value;
  let list = library.filter((x) => !q || [x.title, x.mood, x.key + ' ' + x.mode].join(' ').toLowerCase().includes(q));
  const by = { new: (a, b) => b.created - a.created, plays: (a, b) => (b.plays || 0) - (a.plays || 0), tempo: (a, b) => a.tempo - b.tempo, title: (a, b) => a.title.localeCompare(b.title) }[sort];
  list = list.slice().sort((a, b) => (b.fav ? 1 : 0) - (a.fav ? 1 : 0) || by(a, b));
  const secs = Math.round(library.reduce((a, x) => a + (x.chords.reduce((s, c) => s + c.beats, 0) * 60) / x.tempo, 0)), plays = library.reduce((a, x) => a + (x.plays || 0), 0);
  $('#libSummary').textContent = library.length ? `${library.length} piece${library.length === 1 ? '' : 's'} · ${plays} play${plays === 1 ? '' : 's'} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} of loops` : 'Saved pieces show up here.';
  const box = $('#lib');
  box.innerHTML = '';
  if (!list.length) box.append(h('div', { class: 'empty' }, library.length ? 'Nothing matches.' : 'Compose something and press Save to library.'));
  list.forEach((x) => {
    const cv = h('canvas', { class: 'mini', 'aria-hidden': 'true' });
    const titleIn = h('input', { class: 'input', value: x.title, 'aria-label': 'Title', style: 'font-weight:600', onchange: (e) => { x.title = e.target.value.trim() || x.title; saveLib(); } });
    box.append(h('article', { class: 'card piece' },
      h('div', { class: 'row between' }, h('span', { class: 'tag' }, `${x.key} ${x.mode}`), h('span', { class: 'small muted' }, `${x.tempo} BPM · ${x.plays || 0} plays`)),
      titleIn,
      x.mood ? h('div', { class: 'small muted' }, '“' + x.mood + '”') : null,
      cv,
      h('div', { class: 'small mono muted' }, x.chords.map((c) => c.symbol).join('  ')),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary sm', onclick: () => { songMood = x.mood || ''; load(x); Router.go('compose'); } }, 'Open'),
        h('button', { class: 'btn sm', 'aria-pressed': String(!!x.fav), onclick: () => { x.fav = !x.fav; saveLib(); renderLibrary(); } }, x.fav ? 'Pinned' : 'Pin'),
        h('button', { class: 'btn ghost sm', onclick: () => download(x.title.replace(/\W+/g, '_') + '.json', JSON.stringify(x, null, 2)) }, 'JSON'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn ghost sm danger', onclick: () => { if (!confirm(`Delete "${x.title}"?`)) return; library = library.filter((y) => y !== x); if (song && song.id === x.id) song.id = null; saveLib(); renderLibrary(); } }, 'Delete'))));
    requestAnimationFrame(() => drawRoll(-1, cv, normalizeSong(x), true));
  });
}
$('#libSearch').oninput = renderLibrary;
$('#libSort').onchange = renderLibrary;
$('#libImport').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const items = (Array.isArray(data) ? data : [data]).filter((x) => x && Array.isArray(x.chords));
    items.forEach((x) => library.unshift(Object.assign({}, x, { id: uid(), created: Date.now(), plays: 0 })));
    saveLib(); renderLibrary(); toast(`Imported ${items.length} piece${items.length === 1 ? '' : 's'}`);
  } catch { toast('That file is not a saved piece', 'err'); }
  e.target.value = '';
};

/* ================= chord lab ================= */
let lab = null, labSel = 0;
const PROG_PRESETS = [['Pop', 'C G Am F'], ['Jazz ii–V–I', 'Dm7 G7 Cmaj7 Cmaj7'], ['Andalusian', 'Am G F E'], ['Doo-wop', 'C Am F G'], ['Blues', 'A7 D7 A7 E7'], ['Borrowed', 'C Fm C G'], ['Royal road', 'Fmaj7 G7 Em7 Am']];
$('#progPresets').append(...PROG_PRESETS.map(([n, p]) => h('button', { class: 'btn ghost sm', onclick: () => { $('#prog').value = p; analyze(); } }, n)));
for (let k = 0; k < 12; k++) ['major', 'minor'].forEach((m) => $('#labKey').append(h('option', { value: k + ':' + m }, `${NAMES[k]} ${m}`)));
function analyze() {
  const chords = parseProgression($('#prog').value);
  if (!chords.length) return toast('Enter chords like Am F C G', 'err');
  transport.owner === 'lab' && transport.stop();
  const sel = $('#labKey').value, ranked = detectKey(chordHistogram(chords));
  const key = sel === 'auto' ? ranked[0] : { keyPc: +sel.split(':')[0], mode: sel.split(':')[1] };
  const spelled = chords.map((c) => spellChord(c, key.keyPc, key.mode));
  if (spelled.join(' ') !== chords.join(' ')) $('#prog').value = spelled.join(' ');
  lab = analyzeProgression(spelled, key);
  labSel = Math.min(labSel, chords.length - 1);
  $('#keyGuess').innerHTML = `Key: <b>${spell(lab.keyPc, lab.keyPc, lab.mode)} ${lab.mode}</b>${sel === 'auto' ? ' (detected)' : ''} · ${lab.chords.filter((c) => c.diatonic).length}/${chords.length} chords diatonic`;
  $('#cadence').textContent = lab.cadence ? 'Cadence: ' + lab.cadence : 'No standard cadence at the end.';
  const best = ranked[0].score || 1;
  $('#keyCands').innerHTML = '';
  ranked.slice(0, 5).forEach((r) => $('#keyCands').append(h('div', { class: 'cand' }, h('span', {}, `${spell(r.keyPc, r.keyPc, r.mode)} ${r.mode}`), h('div', { class: 'bar' }, h('span', { style: `width:${Math.max(0, (100 * r.score) / best)}%` })), h('span', { class: 'small muted mono' }, r.score.toFixed(2)))));
  renderRomans();
}
function renderRomans() {
  $('#romans').innerHTML = '';
  lab.chords.forEach((c, i) => $('#romans').append(h('button', { class: (i === labSel ? 'sel ' : '') + (c.diatonic ? '' : 'chromatic'), onclick: () => { labSel = i; renderRomans(); } }, h('b', {}, c.symbol), h('span', { class: 'r' }, c.roman), h('span', { class: 'f' }, c.fn))));
  const c = lab.chords[labSel];
  $('#subs').innerHTML = '';
  $('#subs').append(h('div', { class: 'small', style: 'margin-bottom:6px' }, 'For ', h('b', { class: 'mono' }, c.symbol), ':'));
  substitutions(c.symbol, lab.keyPc, lab.mode).map((s) => Object.assign(s, { symbol: spellChord(s.symbol, lab.keyPc, lab.mode) })).forEach((s) => $('#subs').append(h('button', { class: 'sub', onclick: () => swapChord(labSel, s.symbol) }, h('span', {}, s.why), h('b', {}, s.symbol + ' · ' + romanOf(s.symbol, lab.keyPc, lab.mode).roman))));
}
function swapChord(i, sym) {
  const chords = lab.chords.map((c) => c.symbol);
  chords[i] = sym;
  $('#prog').value = chords.join(' ');
  analyze();
}
const labSong = () => normalizeSong({ key: NAMES[lab.keyPc], mode: lab.mode, tempo: 84, chords: lab.chords.map((c) => ({ symbol: c.symbol, beats: 4 })), melody: [{ note: 'rest', beats: 4 }], drum_style: 'none' });
$('#analyze').onclick = analyze;
$('#prog').addEventListener('keydown', (e) => e.key === 'Enter' && analyze());
$('#labKey').onchange = analyze;
$('#labPlay').onclick = () => {
  if (transport.owner === 'lab') return transport.stop();
  if (!lab) analyze();
  const s = labSong();
  transport.start('lab', buildEvents(s, { drums: false }), s.loop, 84, Object.assign(playOpts(), { humanize: false }), null, (e) => {
    if (e.kind === 'pad') $$('#romans button').forEach((b, i) => b.classList.toggle('on', i === e.ci));
  });
};
[['#labDown', -1], ['#labUp', 1]].forEach(([id, d]) => ($(id).onclick = () => { if (!lab) analyze(); $('#prog').value = lab.chords.map((c) => transposeChord(c.symbol, d)).join(' '); if ($('#labKey').value !== 'auto') $('#labKey').value = 'auto'; analyze(); }));
$('#labUse').onclick = () => {
  if (!lab) analyze();
  const syms = lab.chords.map((c) => c.symbol), mood = $('#mood').value;
  const base = localCompose(mood + ' ' + syms.join(' '));
  const chords = [];
  while (chords.length < 8) syms.forEach((s) => chords.length < 8 && chords.push({ symbol: s, beats: 4 }));
  songMood = mood;
  load(Object.assign(base, { key: NAMES[lab.keyPc], mode: lab.mode, chords, title: `${spell(lab.keyPc, lab.keyPc, lab.mode)} ${lab.mode} sketch`, description: 'Melody written over your chord-lab progression: ' + syms.join(' – ') + '.' }), false, false);
  Router.go('compose');
  toast('Loaded into the composer. Press Play.');
};
$('#aiReharm').onclick = (e) => busy(e.currentTarget, async () => {
  if (!lab) analyze();
  const syms = lab.chords.map((c) => c.symbol);
  const out = await AI.chat([
    { role: 'system', content: 'You are a jazz and pop arranger. Reharmonize the progression in three distinct ways (keep the same number of chords and the overall key feel). Return JSON {"options":[{"chords":["chord symbols"],"idea":"one sentence on the technique"}]}.' },
    { role: 'user', content: `Key: ${NAMES[lab.keyPc]} ${lab.mode}. Progression: ${syms.join(' ')}` },
  ], { json: true, temperature: 0.8, demo: () => ({ options: [
    { chords: syms.map((s, i) => (i % 2 ? spellChord(substitutions(s, lab.keyPc, lab.mode)[0].symbol, lab.keyPc, lab.mode) : s)), idea: 'Swap every other chord for its closest substitute.' },
    { chords: syms.map((s) => addSeventh(s, lab.keyPc, lab.mode)), idea: 'Add sevenths throughout for a softer, jazzier colour.' },
    { chords: syms.map((s, i) => (i === syms.length - 1 ? spell(lab.keyPc + 7, lab.keyPc, lab.mode) + '7' : s)), idea: 'End on the dominant so the loop pulls back to the start.' },
  ] }) });
  $('#aiReharmOut').innerHTML = '';
  (out.options || []).forEach((o) => $('#aiReharmOut').append(h('button', { class: 'sub', onclick: () => { $('#prog').value = o.chords.join(' '); analyze(); } }, h('span', {}, o.idea), h('b', {}, o.chords.join(' ')))));
});

/* ================= drum machine ================= */
const ROWS = [['k', 'Kick'], ['s', 'Snare'], ['h', 'Hi-hat']];
const saveCustom = () => store.set('drums.custom', custom);
function renderSeq() {
  const seq = $('#seq');
  seq.innerHTML = '';
  ROWS.forEach(([k, label]) => {
    seq.append(h('span', { class: 'lbl' }, label));
    for (let i = 0; i < 16; i++) {
      const on = (custom[k] || '')[i] === 'x';
      seq.append(h('button', { class: (on ? 'on ' : '') + (i % 4 === 0 ? 'beat' : ''), 'data-step': i, 'aria-label': `${label} step ${i + 1}`, 'aria-pressed': String(on), onclick: () => {
        const arr = (custom[k] || '................').padEnd(16, '.').split('');
        arr[i] = arr[i] === 'x' ? '.' : 'x';
        custom[k] = arr.join(''); saveCustom(); renderSeq();
        if (transport.owner === 'drums') playDrums(true);
        if (!arr[i].startsWith('.') && live) drum(engine(), k, live.ac.currentTime, 0.9, false);
      } }));
    }
  });
}
const drumSong = () => ({ loop: 4, chords: [{ symbol: 'C', beats: 4 }], notes: [], drum_style: 'custom' });
function playDrums(restart) {
  if (transport.owner === 'drums' && !restart) return transport.stop();
  transport.start('drums', buildEvents(drumSong(), { custom }), 4, () => +$('#drumBpm').value, { humanize: false, reverb: false }, (b) => {
    const step = Math.floor((b % 4) * 4);
    $$('#seq button').forEach((el) => el.classList.toggle('now', +el.dataset.step === step));
  });
}
Object.keys(PATTERNS).forEach((k) => $('#drumLoad').append(h('option', { value: k }, k[0].toUpperCase() + k.slice(1))));
$('#drumLoad').onchange = (e) => { if (!e.target.value) return; custom = Object.assign({ swing: custom.swing }, PATTERNS[e.target.value]); saveCustom(); renderSeq(); e.target.value = ''; if (transport.owner === 'drums') playDrums(true); };
$('#drumPlay').onclick = () => playDrums();
$('#drumClear').onclick = () => { custom = { k: '................', s: '................', h: '................', swing: custom.swing }; saveCustom(); renderSeq(); };
$('#drumRandom').onclick = () => {
  const r = (p) => Array.from({ length: 16 }, (_, i) => (Math.random() < p(i) ? 'x' : '.')).join('');
  custom = { k: r((i) => (i === 0 ? 1 : i % 4 === 0 ? 0.45 : i % 2 ? 0.08 : 0.22)), s: r((i) => (i === 4 || i === 12 ? 0.95 : i % 2 ? 0.06 : 0.1)), h: r((i) => (i % 2 ? 0.45 : 0.85)), swing: custom.swing };
  saveCustom(); renderSeq(); if (transport.owner === 'drums') playDrums(true);
};
$('#drumBpm').oninput = () => ($('#drumBpmVal').textContent = $('#drumBpm').value);
$('#drumSwing').value = custom.swing || 0;
$('#drumSwingVal').textContent = (custom.swing || 0) + '%';
$('#drumSwing').oninput = (e) => { custom.swing = +e.target.value; $('#drumSwingVal').textContent = custom.swing + '%'; saveCustom(); if (transport.owner === 'drums') playDrums(true); };
$('#drumUse').onclick = () => {
  if (!song) return toast('Compose a piece first', 'err');
  song.drum_style = 'custom'; $('#groove').value = 'custom'; $('#drums').checked = true;
  renderFacts(); toast('Current piece now uses your pattern');
  if (transport.owner === 'drums') transport.stop();
  Router.go('compose');
};

/* ================= wiring ================= */
const PRESETS = ['rainy sunday morning, cozy but a little nostalgic', 'neon city chase at 2am', 'floating through a nebula', 'victory after a long battle', 'summer road trip with the windows down', 'ancient desert ruins at dusk', 'late night jazz cafe'];
$('#presets').append(...PRESETS.map((p) => h('button', { class: 'btn sm ghost', onclick: () => { $('#mood').value = p; $('#compose').click(); } }, p)));
$('#compose').onclick = (e) => busy(e.currentTarget, () => compose($('#mood').value.trim() || 'calm'));
$('#mood').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#compose').click(); });
$('#play').onclick = () => (transport.owner === 'song' ? transport.stop() : playSong());
$('#vary').onclick = (e) => busy(e.currentTarget, vary);
$('#save').onclick = saveSong;
$('#midi').onclick = exportMIDI;
$('#wav').onclick = (e) => busy(e.currentTarget, exportWAV);
$('#bpm').oninput = () => { $('#bpmVal').textContent = $('#bpm').value + ' BPM'; };
$('#transpose').oninput = () => { $('#trVal').textContent = $('#transpose').value; renderFacts(); drawRoll(-1); };
const restart = () => { if (transport.owner === 'song') playSong(); else drawRoll(-1); };
$('#groove').onchange = () => { song.drum_style = $('#groove').value; $('#drums').checked = song.drum_style !== 'none'; renderFacts(); restart(); };
['#transpose', '#drums', '#lead', '#pad', '#humanize', '#reverb'].forEach((s) => ($(s).onchange = restart));
window.addEventListener('resize', () => song && drawRoll(-1));
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || /input|textarea|select|button/i.test(e.target.tagName)) return;
  e.preventDefault();
  if (Router.current === 'drums') playDrums(); else if (Router.current === 'chords') $('#labPlay').click(); else if (song) $('#play').click();
});
Router.on('library', renderLibrary);
Router.on('chords', () => lab || analyze());
Router.on('compose', () => song && drawRoll(-1));

renderMixer();
renderSeq();
renderLibrary();
load(localCompose($('#mood').value), false, false);
songMood = $('#mood').value;
