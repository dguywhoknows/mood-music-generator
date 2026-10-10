# mood-music-generator

[![tests](https://github.com/dguywhoknows/mood-music-generator/actions/workflows/tests.yml/badge.svg)](https://github.com/dguywhoknows/mood-music-generator/actions/workflows/tests.yml)

Describe a mood and AI composes chords and a melody. A hand-built Web Audio synth plays it, with a live piano roll and MIDI export.

Live: https://dguywhoknows.github.io/mood-music-generator/

## Overview

Type something like "rainy sunday morning, cozy but a little nostalgic". The AI picks a key, mode, tempo, chord progression, melody and groove, returned as structured JSON. A small music-theory engine then parses chord symbols (Cmaj7, Bm7b5, C/E …), snaps any off-key melody notes to the scale or the current chord, and fits everything into a seamless loop. Playback uses a from-scratch Web Audio synth: pads, bass, lead, synthesized drums and a generated convolution reverb, driven by a lookahead scheduler. Without an AI key, a built-in algorithmic composer maps mood words to modes and tempos and writes the music itself.

## Pages

- **Compose**
- **Library**
- **Chord lab**
- **Drum machine**
- **Settings**

## Features

- AI composition as JSON: key, mode, tempo, 8-chord progression, 32-beat melody, drum style, timbres
- Chord-symbol parser (maj7, m7b5, sus, add9, slash chords …) and scale/chord-tone quantizer
- Algorithmic composer fallback: roman-numeral progressions per mode, chord-tone-anchored random-walk melodies
- Web Audio synth: ADSR voices, lowpass filtering, synthesized kick/snare/hats, generated reverb impulse, compressor
- Lookahead scheduler (Chris Wilson pattern) with humanized timing and velocity
- Canvas piano roll with live playhead and chord highlighting
- Tempo, transpose, timbre, drums, reverb controls; AI variations; Standard MIDI File export (4 tracks)
- Library page: save pieces with their mood, rename inline, pin favorites, sort by newest / most played / tempo, mini piano-roll previews, JSON export and import
- Chord lab page: type any progression for Krumhansl–Schmuckler key detection with ranked candidates, roman-numeral analysis with harmonic function, cadence detection and borrowed-chord highlighting
- Reharmonization: tritone substitutions, relative major/minor, secondary dominants and modal borrowing, plus AI reharmonization options; send a progression to the composer
- Drum machine page: 16-step kick/snare/hat sequencer with presets, swing, randomize, and a Custom groove that any piece can use
- Four-track mixer (lead, pad, bass, drums) and WAV export rendered offline with OfflineAudioContext
- MIDI export now includes a General MIDI drum track

## How it works

LLM calls are used for:

- Mood → full structured composition (JSON)
- Variation mode: rewrites the melody as call-and-response while keeping the harmony

Everything else (music theory, quantization, synthesis, scheduling, visualization, MIDI writing) runs locally in the browser.

## Getting started

No build step and no dependencies. Serve the folder with any static server:

```bash
git clone https://github.com/dguywhoknows/mood-music-generator.git
cd mood-music-generator
python -m http.server 8000
```

Then open http://localhost:8000.

`index.html` is the public home page, `login.html` handles accounts and `app.html` is the app.

### Telling the app what to do

Every page has an **Ask AI** box (Ctrl/Cmd+K). Type a request in plain words and the model plans a sequence of
calls to the app's own functions, runs them and reports back. The **Instructions** tab stores standing
preferences that are added to every AI request the app makes.

### Configuration

`src/lib/config.js` is generated from the build settings: the Supabase project (accounts) and the AI proxy URL.
Signed-in users get the built-in AI through the proxy, which keeps the provider key as a server-side secret.
Without those settings the app runs for guests, in demo mode, or with a personal [Groq](https://console.groq.com/keys)
or [OpenRouter](https://openrouter.ai/keys) key entered under **Settings → Model provider** (stored only in this
browser and sent only to that provider).

## Testing

`src/core.js` holds the app's logic as pure functions and is covered by 14 unit tests.

```bash
node tests/run-node.js        # CI runs this on every push
```

Or open `tests/index.html` in a browser ([live](https://dguywhoknows.github.io/mood-music-generator/tests/)).

## Project structure

```
index.html           public home page (generated)
login.html           sign-in and sign-up (generated)
app.html             the app: markup for every page
src/app.js           UI, page wiring and event handlers
src/core.js          pure logic with no DOM access (unit-tested)
src/lib/ai.js        LLM client: Groq / OpenRouter, streaming, JSON mode, retries
src/lib/dom.js       DOM helpers, namespaced storage, markdown renderer
src/lib/router.js    hash router and the Settings page
src/lib/copilot.js   AI command box that drives the app's own functions
src/lib/auth.js      accounts (Supabase Auth) and the sign-in gate
styles/base.css      design tokens and shared components
styles/app.css       app-specific styles
tests/               unit tests (browser runner + Node runner for CI)
```

## Tech

- Web Audio API (oscillators, biquads, convolver, dynamics compressor)
- Binary MIDI file writer with variable-length quantities
- Canvas 2D piano roll
- Pure theory, composer, MIDI and WAV encoders in src/core.js covered by unit tests run in the browser and in CI
- Shared look-ahead transport scheduler for the composer, chord lab and drum machine
- Vanilla JavaScript, no framework or bundler
- Deployed with GitHub Pages

## License

MIT
