test('pcOf and midiOf read note names with accidentals', () => {
  assert.eq(pcOf('Bb'), 10); assert.eq(pcOf('C#'), 1); assert.eq(pcOf('Cb'), 11);
  assert.eq(midiOf('C4'), 60); assert.eq(midiOf('A4'), 69); assert.eq(midiOf('rest'), null);
  assert.eq(nameOf(61), 'C#4'); assert.eq(nameOf(70), 'Bb4');
});

test('chordTones parses qualities and slash bass', () => {
  const c = chordTones('Am7/G');
  assert.eq(c.root, 9); assert.deepEq(c.ints, [0, 3, 7, 10]); assert.eq(c.bass, 7); assert.eq(c.quality, 'm7');
  assert.eq(chordTones('F#m7b5').quality, 'm7b5');
  assert.deepEq(chordTones('Cmaj7').ints, [0, 4, 7, 11]);
  assert.deepEq(chordTones('Dsus4').ints, [0, 5, 7]);
});

test('transposeChord moves root and bass; parseProgression splits on separators', () => {
  assert.eq(transposeChord('Am7/G', 3), 'Cm7/Bb');
  assert.eq(transposeChord('F#m7b5', -1), 'Fm7b5');
  assert.deepEq(parseProgression('Am F | C - G7, x'), ['Am', 'F', 'C', 'G7']);
});

test('spellChord uses flats in flat keys and addSeventh follows the key', () => {
  assert.eq(spellChord('A#m F# C# G#', 1, 'major'), 'Bbm Gb Db Ab');
  assert.eq(spellChord('F#m D A E', 9, 'major'), 'F#m D A E');
  assert.eq(spellChord('C#m', 10, 'minor'), 'Dbm', 'Bb minor is a flat key');
  assert.eq(addSeventh('G', 0, 'major'), 'G7');
  assert.eq(addSeventh('F', 0, 'major'), 'Fmaj7');
  assert.eq(addSeventh('Am', 0, 'major'), 'Am7');
  assert.eq(addSeventh('Bb', 0, 'major'), 'Bb7');
  assert.eq(addSeventh('Dm7', 0, 'major'), 'Dm7');
});

test('quantize snaps out-of-key notes to the nearest scale or chord tone', () => {
  assert.eq(quantize(61, 0, MODES.major, chordTones('C')), 62);
  assert.eq(quantize(64, 0, MODES.major, chordTones('C')), 64);
  assert.eq(quantize(68, 0, MODES.major, chordTones('E7')), 68, 'G# is a chord tone of E7');
});

test('detectKey finds the tonic of plain progressions', () => {
  const c = detectKey(chordHistogram(['C', 'F', 'G', 'C']))[0];
  assert.eq(c.keyPc, 0); assert.eq(c.mode, 'major');
  const a = detectKey(chordHistogram(['Am', 'Dm', 'E7', 'Am']))[0];
  assert.eq(a.keyPc, 9); assert.eq(a.mode, 'minor');
});

test('romanOf labels diatonic, borrowed and diminished chords', () => {
  assert.eq(romanOf('G7', 0, 'major').roman, 'V7');
  assert.eq(romanOf('Am', 0, 'major').roman, 'vi');
  assert.eq(romanOf('Bdim', 0, 'major').roman, 'vii°');
  assert.eq(romanOf('Bm7b5', 0, 'major').roman, 'viiø7');
  const b = romanOf('Bb', 0, 'major');
  assert.eq(b.roman, 'bVII'); assert.ok(!b.diatonic);
});

test('analyzeProgression gives functions and the cadence', () => {
  const a = analyzeProgression(['C', 'F', 'G7', 'C'], { keyPc: 0, mode: 'major' });
  assert.deepEq(a.chords.map((c) => c.roman), ['I', 'IV', 'V7', 'I']);
  assert.deepEq(a.chords.map((c) => c.fn), ['tonic', 'predominant', 'dominant', 'tonic']);
  assert.eq(a.cadence, 'Authentic (V–I)');
  assert.eq(analyzeProgression(['C', 'Am', 'F', 'G'], { keyPc: 0, mode: 'major' }).cadence, 'Half (ends on V)');
});

test('substitutions suggest a tritone sub for dominants and relatives for triads', () => {
  const s = substitutions('G7', 0, 'major').map((x) => x.symbol);
  assert.ok(s.includes('C#7')); assert.ok(s.includes('Em'));
  assert.ok(substitutions('Am', 0, 'major').some((x) => x.symbol === 'C' && /Relative major/.test(x.why)));
  assert.ok(substitutions('F', 0, 'major').some((x) => x.symbol === 'Fm'), 'borrowed iv');
});

test('localCompose is deterministic and fills 8 bars', () => {
  const a = localCompose('rainy sunday morning'), b = localCompose('rainy sunday morning');
  assert.eq(JSON.stringify(a), JSON.stringify(b));
  assert.eq(a.chords.length, 8);
  assert.eq(a.chords.reduce((s, c) => s + c.beats, 0), 32);
  assert.near(a.melody.reduce((s, n) => s + n.beats, 0), 32, 1e-9);
  assert.ok(['minor', 'dorian'].includes(a.mode)); assert.ok(a.tempo < 90);
  assert.ok(JSON.stringify(localCompose('rainy sunday morning', 7)) !== JSON.stringify(a), 'seed bump changes the piece');
});

test('normalizeSong clamps values and loops the melody across the progression', () => {
  const s = normalizeSong({ key: 'C', mode: 'weird', tempo: 300, chords: [{ symbol: 'C', beats: 4 }], melody: [{ note: 'C#4', beats: 1 }] });
  assert.eq(s.mode, 'major'); assert.eq(s.tempo, 180); assert.eq(s.loop, 4);
  assert.eq(s.notes.length, 4);
  assert.ok(s.notes.every((n) => n.midi === 62), 'C# snapped to D');
});

test('buildEvents lays out pad, bass, lead and drum hits', () => {
  const s = normalizeSong({ key: 'C', tempo: 100, chords: [{ symbol: 'C', beats: 4 }], melody: [{ note: 'E4', beats: 1 }], drum_style: 'four' });
  const ev = buildEvents(s, { transpose: 2 });
  const count = (k) => ev.filter((e) => e.kind === k).length;
  assert.eq(count('pad'), 1); assert.eq(count('bass'), 2); assert.eq(count('lead'), 4);
  assert.eq(count('k'), 4); assert.eq(count('s'), 2); assert.eq(count('h'), 8);
  assert.eq(ev.find((e) => e.kind === 'lead').notes[0], 66);
  assert.eq(buildEvents(s, { drums: false }).filter((e) => e.kind === 'k').length, 0);
  const custom = Object.assign({}, s, { drum_style: 'custom' });
  assert.eq(buildEvents(custom, { custom: { k: 'x...............', s: '', h: '' } }).filter((e) => /^[ksh]$/.test(e.kind)).length, 1);
});

test('encodeMIDI writes a type-1 file with tempo, three instruments and drums', () => {
  assert.deepEq(vlq(0), [0]); assert.deepEq(vlq(200), [0x81, 0x48]);
  const s = normalizeSong({ key: 'C', tempo: 120, chords: [{ symbol: 'C', beats: 4 }], melody: [{ note: 'C5', beats: 4 }] });
  const b = encodeMIDI(buildEvents(s), 120);
  assert.eq(String.fromCharCode(b[0], b[1], b[2], b[3]), 'MThd');
  assert.eq(b[11], 5, 'track count');
  assert.deepEq(Array.from(b.slice(-4)), [0, 0xff, 0x2f, 0], 'ends with end-of-track');
});

test('encodeWAV writes a 16-bit PCM header and clamps samples', () => {
  const w = encodeWAV([new Float32Array([1, -1, 2]), new Float32Array([0, 0, 0])], 44100);
  assert.eq(w.length, 44 + 3 * 2 * 2);
  assert.eq(String.fromCharCode(w[0], w[1], w[2], w[3]), 'RIFF');
  const v = new DataView(w.buffer);
  assert.eq(v.getUint16(22, true), 2); assert.eq(v.getUint32(24, true), 44100);
  assert.eq(v.getInt16(44, true), 32767); assert.eq(v.getInt16(48, true), -32768); assert.eq(v.getInt16(52, true), 32767);
});
