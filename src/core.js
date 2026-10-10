/* Music theory, the algorithmic composer, event scheduling and MIDI/WAV encoding (pure, unit-tested). */

var PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
var NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
var MODES = {
  major: [0, 2, 4, 5, 7, 9, 11], ionian: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11], phrygian: [0, 1, 3, 5, 7, 8, 10],
  'harmonic minor': [0, 2, 3, 5, 7, 8, 11],
};
var QUAL = [
  ['maj9', [0, 4, 7, 11, 14]], ['maj7', [0, 4, 7, 11]], ['m7b5', [0, 3, 6, 10]], ['m9', [0, 3, 7, 10, 14]], ['m7', [0, 3, 7, 10]], ['mmaj7', [0, 3, 7, 11]],
  ['dim7', [0, 3, 6, 9]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]], ['sus2', [0, 2, 7]], ['sus4', [0, 5, 7]], ['add9', [0, 4, 7, 14]],
  ['m6', [0, 3, 7, 9]], ['6', [0, 4, 7, 9]], ['9', [0, 4, 7, 10, 14]], ['7', [0, 4, 7, 10]], ['m', [0, 3, 7]], ['', [0, 4, 7]],
];
var DRUM_STYLES = ['none', 'soft', 'four', 'halftime', 'swing', 'trap', 'custom'];
var PATTERNS = {
  soft: { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
  four: { k: 'x...x...x...x...', s: '....x.......x...', h: 'x.x.x.x.x.x.x.x.' },
  halftime: { k: 'x.........x.....', s: '........x.......', h: 'x...x...x...x...' },
  swing: { k: 'x.......x.......', s: '....x.......x...', h: 'x..x.xx..x.xx..x' },
  trap: { k: 'x......x..x.....', s: '........x.......', h: 'xxxxxxxxxxx.xxxx' },
};

function mod12(n) { return ((n % 12) + 12) % 12; }
function pcOf(s) { var m = String(s).match(/^([A-G])([#b]?)/); return m ? mod12(PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)) : 0; }
function chordTones(symbol) {
  var m = String(symbol).trim().match(/^([A-G][#b]?)(.*?)(?:\/([A-G][#b]?))?$/);
  if (!m) return { root: 0, ints: [0, 4, 7], bass: 0, quality: '' };
  var rest = m[2].replace(/^maj$/, '').replace(/^min/, 'm').replace(/^M7/, 'maj7').replace(/^-/, 'm');
  var q = QUAL.find(function (x) { return rest === x[0]; }) || QUAL.find(function (x) { return x[0] && rest.indexOf(x[0]) === 0; }) || ['', [0, 4, 7]];
  var root = pcOf(m[1]);
  return { root: root, ints: q[1], bass: m[3] ? pcOf(m[3]) : root, quality: q[0] };
}
function midiOf(n) { var m = String(n).match(/^([A-G])([#b]?)(-?\d)$/); return m ? 12 * (+m[3] + 1) + pcOf(m[1] + m[2]) : null; }
function nameOf(midi) { return NAMES[mod12(midi)] + (Math.floor(midi / 12) - 1); }
function transposeChord(symbol, n) {
  return String(symbol).replace(/([A-G][#b]?)/g, function (r) { return NAMES[mod12(pcOf(r) + n)]; });
}
var FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
var SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/* Flat keys: F, Bb, Eb, Ab, Db, Gb major and their relative minors. */
function usesFlats(keyPc, mode) { var rel = mod12(keyPc + (/minor|aeolian|dorian|phrygian/.test(mode) ? 3 : 0)); return [5, 10, 3, 8, 1].indexOf(rel) >= 0; }
function spell(pc, keyPc, mode) { return (usesFlats(keyPc, mode) ? FLATS : SHARPS)[mod12(pc)]; }
function spellChord(symbol, keyPc, mode) { return String(symbol).replace(/([A-G][#b]?)/g, function (r) { return spell(pcOf(r), keyPc, mode); }); }
/* A seventh chord that fits the key: dominant on V or outside the key, major seventh otherwise. */
function addSeventh(symbol, keyPc, mode) {
  var c = chordTones(symbol), m = String(symbol).match(/^([A-G][#b]?)/)[1];
  if (/7|9|6/.test(c.quality) || c.ints.indexOf(6) >= 0 || c.ints.indexOf(8) >= 0) return symbol;
  if (c.ints[1] === 3) return m + 'm7';
  var sc = MODES[mode] || MODES.major, rel = mod12(c.root - keyPc), deg = sc.indexOf(rel);
  if (deg < 0) return m + '7';
  return m + (mod12(sc[(deg + 6) % 7] - rel) === 11 ? 'maj7' : '7');
}
function parseProgression(text) {
  return String(text).split(/[\s,|\-–]+/).map(function (s) { return s.trim(); }).filter(function (s) { return /^[A-G][#b]?/.test(s); });
}

/* Snap off-key melody notes to the scale or current chord. */
function quantize(midi, keyPc, scale, chord) {
  var ok = function (p) { return scale.indexOf(mod12(p - keyPc)) >= 0 || chord.ints.some(function (i) { return mod12(chord.root + i) === mod12(p); }); };
  if (ok(midi)) return midi;
  for (var d = 1; d < 3; d++) { if (ok(midi + d)) return midi + d; if (ok(midi - d)) return midi - d; }
  return midi;
}

/* ---------- key detection & harmonic analysis ---------- */
var KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
var KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function corr(a, b) {
  var ma = a.reduce(function (x, y) { return x + y; }, 0) / 12, mb = b.reduce(function (x, y) { return x + y; }, 0) / 12, n = 0, da = 0, db = 0;
  for (var i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += Math.pow(a[i] - ma, 2); db += Math.pow(b[i] - mb, 2); }
  return da && db ? n / Math.sqrt(da * db) : 0;
}
/* Krumhansl–Schmuckler key finding over a pitch-class histogram. Returns ranked [{keyPc, mode, score}]. */
function detectKey(hist) {
  var out = [];
  for (var k = 0; k < 12; k++) {
    var rot = hist.slice(k).concat(hist.slice(0, k));
    out.push({ keyPc: k, mode: 'major', score: corr(rot, KK_MAJOR) }, { keyPc: k, mode: 'minor', score: corr(rot, KK_MINOR) });
  }
  return out.sort(function (a, b) { return b.score - a.score; });
}
function chordHistogram(symbols) {
  var h = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  symbols.forEach(function (s, i) {
    var c = chordTones(s);
    c.ints.forEach(function (iv, j) { h[mod12(c.root + iv)] += j === 0 ? 1.5 : 1; });
    if (i === 0 || i === symbols.length - 1) h[c.root] += 1;
  });
  return h;
}
var ROMAN_UP = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
/* Roman-numeral label of a chord in a key; borrowed/chromatic chords get b/# prefixes. */
function romanOf(symbol, keyPc, mode) {
  var c = chordTones(symbol), sc = MODES[mode] || MODES.major, rel = mod12(c.root - keyPc);
  var deg = sc.indexOf(rel), acc = '';
  if (deg < 0) {
    var up = sc.indexOf(mod12(rel - 1)), dn = sc.indexOf(mod12(rel + 1));
    if (dn >= 0) { deg = dn; acc = 'b'; } else { deg = up; acc = '#'; }
  }
  var minorish = c.ints[1] === 3, dim = c.ints.indexOf(6) >= 0 && c.ints[1] === 3, aug = c.ints.indexOf(8) >= 0 && c.ints[1] === 4;
  var r = ROMAN_UP[deg];
  if (minorish) r = r.toLowerCase();
  var suffix = dim ? (c.ints.indexOf(10) >= 0 ? 'ø7' : c.ints.indexOf(9) >= 0 ? '°7' : '°') : aug ? '+' : /maj7|maj9/.test(c.quality) ? 'maj7' : /7|9/.test(c.quality) ? '7' : /sus/.test(c.quality) ? c.quality : '';
  var diatonic = !acc && c.ints.slice(0, 3).every(function (iv) { return sc.indexOf(mod12(rel + iv)) >= 0; });
  return { roman: acc + r + suffix, diatonic: diatonic, degree: deg };
}
var FUNCTION_OF = { 0: 'tonic', 2: 'tonic', 5: 'tonic', 1: 'predominant', 3: 'predominant', 4: 'dominant', 6: 'dominant' };
function analyzeProgression(symbols, key) {
  var k = key || detectKey(chordHistogram(symbols))[0];
  return {
    keyPc: k.keyPc, mode: k.mode,
    chords: symbols.map(function (s) { var r = romanOf(s, k.keyPc, k.mode); return { symbol: s, roman: r.roman, diatonic: r.diatonic, fn: r.diatonic ? FUNCTION_OF[r.degree] : 'chromatic' }; }),
    cadence: cadenceOf(symbols, k),
  };
}
function cadenceOf(symbols, k) {
  if (symbols.length < 2) return null;
  var a = mod12(chordTones(symbols[symbols.length - 2]).root - k.keyPc), b = mod12(chordTones(symbols[symbols.length - 1]).root - k.keyPc);
  if (a === 7 && b === 0) return 'Authentic (V–I)';
  if (a === 5 && b === 0) return 'Plagal (IV–I)';
  if (b === 7) return 'Half (ends on V)';
  if (a === 7 && (b === 9 || b === 8)) return 'Deceptive (V–vi)';
  return null;
}
/* Reharmonization ideas for one chord. */
function substitutions(symbol, keyPc, mode) {
  var c = chordTones(symbol), root = NAMES[c.root], out = [];
  var dominant = c.ints[1] === 4 && c.ints.indexOf(10) >= 0;
  var major = c.ints[1] === 4 && c.ints.indexOf(8) < 0;
  if (dominant) out.push({ symbol: NAMES[mod12(c.root + 6)] + '7', why: 'Tritone substitution' });
  if (major) out.push({ symbol: NAMES[mod12(c.root + 9)] + 'm', why: 'Relative minor' });
  if (c.ints[1] === 3) out.push({ symbol: NAMES[mod12(c.root + 3)], why: 'Relative major' });
  out.push({ symbol: NAMES[mod12(c.root + 7)] + '7', why: 'Secondary dominant (V7 of ' + root + (c.ints[1] === 3 ? 'm' : '') + ')' });
  if (major && !/7|9/.test(c.quality)) out.push({ symbol: root + (mod12(c.root - keyPc) === 7 ? '7' : 'maj7'), why: 'Add a seventh' });
  if (c.ints[1] !== 3 || c.quality !== 'm') out.push({ symbol: root + 'sus4', why: 'Suspension' });
  if (mode === 'major' && mod12(c.root - keyPc) === 5 && major) out.push({ symbol: root + 'm', why: 'Borrowed iv from the parallel minor' });
  return out;
}

/* ---------- song model ---------- */
function chordAt(s, beat) {
  var t = 0;
  for (var i = 0; i < s.chords.length; i++) { var c = s.chords[i]; if (beat < t + c.beats) return Object.assign({}, c, { t: t }); t += c.beats; }
  return Object.assign({}, s.chords[0], { t: 0 });
}
function normalizeSong(raw) {
  var s = Object.assign({}, raw);
  s.mode = MODES[String(s.mode).toLowerCase()] ? String(s.mode).toLowerCase() : 'major';
  s.keyPc = pcOf(s.key || 'C');
  s.key = NAMES[s.keyPc];
  s.tempo = Math.max(50, Math.min(180, +s.tempo || 90));
  s.chords = (s.chords || []).filter(function (c) { return c.symbol; }).map(function (c) { return { symbol: c.symbol, beats: Math.max(1, Math.min(8, +c.beats || 4)) }; });
  if (!s.chords.length) s.chords = [{ symbol: 'C', beats: 4 }];
  var loop = s.chords.reduce(function (a, c) { return a + c.beats; }, 0);
  var mel = (s.melody || []).map(function (n) { return { note: n.note, beats: Math.max(0.25, Math.min(4, +n.beats || 1)) }; });
  if (!mel.length) mel = [{ note: 'rest', beats: loop }];
  var out = [], t = 0, i = 0;
  while (t < loop - 1e-6 && i < 400) {
    var n = mel[i % mel.length], b = Math.min(n.beats, loop - t), at = chordAt(s, t);
    var m = n.note === 'rest' ? null : midiOf(n.note);
    if (m != null) { while (m < 60) m += 12; while (m > 84) m -= 12; m = quantize(m, s.keyPc, MODES[s.mode], chordTones(at.symbol)); }
    out.push({ t: t, beats: b, midi: m });
    t += b; i++;
  }
  s.notes = out;
  s.loop = loop;
  s.drum_style = DRUM_STYLES.indexOf(s.drum_style) >= 0 ? s.drum_style : 'soft';
  return s;
}
function melodyOf(song) { return song.notes.map(function (n) { return { note: n.midi == null ? 'rest' : nameOf(n.midi), beats: n.beats }; }); }

/* ---------- local algorithmic composer ---------- */
function seeded(seed) {
  var a = seed >>> 0;
  return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
var PROG = {
  major: [['I', 'V', 'vi', 'IV'], ['I', 'vi', 'IV', 'V'], ['IV', 'I', 'V', 'vi'], ['I', 'iii', 'IV', 'V']],
  minor: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'VII', 'III'], ['i', 'VI', 'iv', 'v'], ['i', 'iv', 'i', 'V']],
  dorian: [['i', 'IV', 'i', 'IV'], ['i', 'III', 'IV', 'i'], ['i', 'VII', 'IV', 'i']],
  mixolydian: [['I', 'VII', 'IV', 'I'], ['I', 'v', 'IV', 'I']],
  lydian: [['I', 'II', 'I', 'II'], ['I', 'II', 'vii', 'I']],
  'harmonic minor': [['i', 'iv', 'V', 'i'], ['i', 'VI', 'iv', 'V']],
  phrygian: [['i', 'II', 'i', 'VII']],
};
var ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };
function romanToChord(r, keyPc, mode, seventh) {
  var deg = ROMAN[r.toLowerCase()], sc = MODES[mode], root = (keyPc + sc[deg]) % 12;
  var third = mod12(sc[(deg + 2) % 7] - sc[deg]), fifth = mod12(sc[(deg + 4) % 7] - sc[deg]);
  var q = third === 3 ? (fifth === 6 ? 'dim' : 'm') : fifth === 8 ? 'aug' : '';
  if (seventh && q !== 'dim' && q !== 'aug') {
    var sev = mod12(sc[(deg + 6) % 7] - sc[deg]);
    if (sev === 10) q += '7';
    else if (sev === 11 && q === '') q = 'maj7';
  }
  return NAMES[root] + q;
}
function moodTraits(mood) {
  var t = String(mood).toLowerCase();
  return {
    mode: /sad|rain|lonely|night|melanchol|grief|dark|cold|nostalg/.test(t) ? 'minorish' : /epic|battle|villain|tense|storm|danger/.test(t) ? 'harmonic minor' : /dream|space|float|magic|wonder|star/.test(t) ? 'lydian' : /road|summer|groove|funk|beach/.test(t) ? 'mixolydian' : /mystery|desert|ancient/.test(t) ? 'phrygian' : 'major',
    pace: /calm|sleep|slow|rain|lofi|lo-fi|cozy|ambient|sad|dream/.test(t) ? 'slow' : /party|dance|run|chase|energ|happy|hype/.test(t) ? 'fast' : 'mid',
    jazzy: /jazz|lofi|lo-fi|cozy|cafe|smooth|night/.test(t),
    swing: /swing|jazz/.test(t),
  };
}
function localCompose(mood, seedBump) {
  var t = String(mood).toLowerCase(), hash = seedBump || 0;
  for (var c = 0; c < t.length; c++) hash = (hash * 31 + t.charCodeAt(c)) | 0;
  var r = seeded(hash), pick = function (a) { return a[Math.floor(r() * a.length)]; };
  var tr = moodTraits(t);
  var mode = tr.mode === 'minorish' ? pick(['minor', 'dorian']) : tr.mode;
  var tempo = tr.pace === 'slow' ? 68 + Math.floor(r() * 18) : tr.pace === 'fast' ? 118 + Math.floor(r() * 30) : 88 + Math.floor(r() * 20);
  var keyPc = Math.floor(r() * 12);
  var prog = pick(PROG[mode] || PROG.major);
  var chords = prog.concat(prog).map(function (rn, i) { return { symbol: romanToChord(rn, keyPc, mode, tr.jazzy || i % 4 === 3), beats: 4 }; });
  var sc = MODES[mode], scaleNotes = [];
  for (var o = 4; o <= 6; o++) sc.forEach(function (s) { scaleNotes.push(12 * (o + 1) + ((keyPc + s) % 12)); });
  scaleNotes.sort(function (a, b) { return a - b; });
  var idx = Math.floor(scaleNotes.length / 3);
  var rhythms = tempo < 90 ? [[2, 1, 1], [1.5, 0.5, 2], [3, 1], [1, 1, 2], [4]] : [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 2], [1, 1, 1, 1], [0.75, 0.25, 1, 2]];
  var melody = [];
  chords.forEach(function (ch) {
    var ct = chordTones(ch.symbol);
    pick(rhythms).forEach(function (b, k) {
      if (r() < 0.12 && k > 0) { melody.push({ note: 'rest', beats: b }); return; }
      idx = Math.max(0, Math.min(scaleNotes.length - 1, idx + pick([-2, -1, -1, 0, 1, 1, 2])));
      var m = scaleNotes[idx];
      if (k === 0) {
        var tones = scaleNotes.filter(function (n) { return ct.ints.some(function (i) { return (ct.root + i) % 12 === n % 12; }); });
        m = tones.reduce(function (a, n) { return Math.abs(n - m) < Math.abs(a - m) ? n : a; }, tones[0] || m);
        idx = scaleNotes.indexOf(m);
      }
      melody.push({ note: nameOf(m), beats: b });
    });
  });
  var adj = /rain|cozy|lofi|lo-fi/.test(t) ? 'Lo-fi' : mode === 'lydian' ? 'Floating' : mode === 'harmonic minor' ? 'Cinematic' : tempo > 115 ? 'Upbeat' : 'Gentle';
  return {
    title: adj + ' ' + String(mood).split(/[ ,]+/).filter(Boolean).slice(0, 3).map(function (w) { return w[0].toUpperCase() + w.slice(1); }).join(' '),
    description: NAMES[keyPc] + ' ' + mode + ' at ' + tempo + ' BPM, written by the built-in composer.',
    key: NAMES[keyPc], mode: mode, tempo: tempo, chords: chords, melody: melody,
    drum_style: tempo < 80 ? 'halftime' : tr.swing ? 'swing' : tempo > 120 ? 'four' : 'soft',
    lead: tempo > 120 ? 'square' : 'triangle', pad: mode === 'lydian' ? 'triangle' : 'sawtooth',
  };
}

/* ---------- arrangement → timed events (in beats) ---------- */
function buildEvents(song, opts) {
  opts = opts || {};
  var tr = opts.transpose || 0, ev = [], t = 0;
  song.chords.forEach(function (c, ci) {
    var ct = chordTones(c.symbol);
    var pad = ct.ints.slice(0, 4).map(function (i) { var m = 60 + ((ct.root + i) % 12); if (m > 70) m -= 12; return m + tr; }).sort(function (a, b) { return a - b; });
    ev.push({ t: t, kind: 'pad', notes: pad, dur: c.beats, ci: ci });
    for (var b = 0; b < c.beats; b += 2) ev.push({ t: t + b, kind: 'bass', notes: [36 + mod12(ct.bass) + tr], dur: Math.min(2, c.beats - b) * 0.9 });
    t += c.beats;
  });
  song.notes.forEach(function (n) { if (n.midi != null) ev.push({ t: n.t, kind: 'lead', notes: [n.midi + tr], dur: n.beats * 0.92 }); });
  if (opts.drums !== false && song.drum_style !== 'none') {
    var p = song.drum_style === 'custom' && opts.custom ? opts.custom : PATTERNS[song.drum_style] || PATTERNS.soft;
    for (var bar = 0; bar < song.loop / 4; bar++) for (var s = 0; s < 16; s++) ['k', 's', 'h'].forEach(function (d) {
      if (p[d] && p[d][s] === 'x') ev.push({ t: bar * 4 + s / 4 + (s % 2 ? (song.drum_style === 'swing' ? 0.08 : p.swing ? (p.swing / 100) * 0.125 : 0) : 0), kind: d });
    });
  }
  return ev.sort(function (a, b) { return a.t - b.t; });
}

/* ---------- Standard MIDI File (type 1) ---------- */
function vlq(n) { var b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; }
function midiTrack(evs) {
  evs.sort(function (a, b) { return a.tick - b.tick || a.order - b.order; });
  var last = 0, data = [];
  evs.forEach(function (e) { data.push.apply(data, vlq(e.tick - last).concat(e.bytes)); last = e.tick; });
  data.push(0, 0xff, 0x2f, 0);
  return [0x4d, 0x54, 0x72, 0x6b, (data.length >>> 24) & 255, (data.length >>> 16) & 255, (data.length >>> 8) & 255, data.length & 255].concat(data);
}
function encodeMIDI(events, bpm) {
  var TPB = 480, us = Math.round(60e6 / bpm);
  var tempo = midiTrack([{ tick: 0, order: 0, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }, { tick: 0, order: 0, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] }]);
  var notesTrack = function (ch, list, program) {
    var evs = [{ tick: 0, order: 0, bytes: [0xc0 | ch, program] }];
    list.forEach(function (n) { evs.push({ tick: Math.round(n.t * TPB), order: 2, bytes: [0x90 | ch, n.m, n.v] }, { tick: Math.round((n.t + n.dur) * TPB), order: 1, bytes: [0x80 | ch, n.m, 0] }); });
    return midiTrack(evs);
  };
  var DRUM = { k: 36, s: 38, h: 42 };
  var of = function (kind, v) { return events.filter(function (e) { return e.kind === kind; }).reduce(function (a, e) { e.notes.forEach(function (m) { a.push({ t: e.t, dur: e.dur, m: m, v: v }); }); return a; }, []); };
  var drums = events.filter(function (e) { return DRUM[e.kind]; }).map(function (e) { return { t: e.t, dur: 0.1, m: DRUM[e.kind], v: e.kind === 'h' ? 70 : 100 }; });
  var header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 5, (TPB >> 8) & 255, TPB & 255];
  return new Uint8Array(header.concat(tempo, notesTrack(0, of('lead', 96), 0), notesTrack(1, of('pad', 64), 89), notesTrack(2, of('bass', 90), 33), notesTrack(9, drums, 0)));
}

/* ---------- 16-bit PCM WAV ---------- */
function encodeWAV(channels, sampleRate) {
  var n = channels[0].length, nc = channels.length, buf = new ArrayBuffer(44 + n * nc * 2), v = new DataView(buf);
  var str = function (o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * nc * 2, true);
  var o = 44;
  for (var i = 0; i < n; i++) for (var c = 0; c < nc; c++) { var x = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2; }
  return new Uint8Array(buf);
}
