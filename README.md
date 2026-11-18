# FretDSP 🎸

> **Real-Time Acoustic & Polyphonic Tablature Engine, Biomechanical Fretboard Optimizer & Guitar DSP Studio**
> *Zero external dependencies. 100% native Web Audio API, AudioWorklet, Canvas 2D, Web MIDI, and modern JavaScript.*

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Runtime: Vanilla JS](https://img.shields.io/badge/Runtime-Vanilla%20ES6%2B-yellow.svg)
![Web Audio: 64--bit AudioWorklet](https://img.shields.io/badge/Web%20Audio-64--bit%20AudioWorklet-purple.svg)
![Web MIDI: MPE & 14--bit Bend](https://img.shields.io/badge/Web%20MIDI-MPE%20%26%2014--bit%20Pitch%20Bend-green.svg)
![Tests: 1221 Passing](https://img.shields.io/badge/Tests-1221%20Passed%20%7C%200%20Failed-brightgreen.svg)
![Dependencies: Zero](https://img.shields.io/badge/Dependencies-Zero-success.svg)

---

## 📖 Overview

**FretDSP** is an ultra-low-latency, browser-native digital signal processing (DSP) suite and intelligent guitar transcription workstation. It transforms raw audio from any guitar (acoustic via microphone, or electric via audio interface) into real-time interactive tablature, optimal fretboard fingerings, and MIDI output in real time.

Built from the dual perspective of a guitar technician and an audio algorithms researcher, FretDSP combines **64-bit AudioWorklet DSP pitch tracking**, **Viterbi trellis optimization for biomechanically ergonomic fingerings**, **dual-concentric stroboscopic tuning with acoustic inharmonicity dispersion modeling**, a **virtual analog stompbox chain**, a **procedural rhythm accompaniment trio**, and a **multi-track phrase looper** into a sleek, rackmount-inspired web studio.

---

## 📑 Table of Contents

- [Key Architecture & Data Flow](#-key-architecture--data-flow)
- [Core Features & Modules](#-core-features--modules)
  - [1. Real-Time Pitch Tracking & AudioWorklet DSP](#1-real-time-pitch-tracking--audioworklet-dsp)
  - [2. Biomechanical Fretboard Optimizer (Viterbi Trellis)](#2-biomechanical-fretboard-optimizer-viterbi-trellis)
  - [3. Interactive 22-Fret Illuminated Fretboard](#3-interactive-22-fret-illuminated-fretboard)
  - [4. High-Precision Virtual Strobe Tuner & Inharmonicity Analyzer](#4-high-precision-virtual-strobe-tuner--inharmonicity-analyzer)
  - [5. Polyphonic Chord Recognizer & Theory Engine](#5-polyphonic-chord-recognizer--theory-engine)
  - [6. Guitar Effects Rack & Stompbox Chain](#6-guitar-effects-rack--stompbox-chain)
  - [7. Smart Backing Track & Rhythm Accompaniment Engine](#7-smart-backing-track--rhythm-accompaniment-engine)
  - [8. Web MIDI Bridge (MPE & 14-Bit Pitch Bend)](#8-web-midi-bridge-mpe--14-bit-pitch-bend)
  - [9. Sound-on-Sound Multi-Track Phrase Looper](#9-sound-on-sound-multi-track-phrase-looper)
  - [10. WSOLA Music Transcriber & Audio Slow-Downer](#10-wsola-music-transcriber--audio-slow-downer)
  - [11. Interactive Ear Trainer & Call-and-Response Module](#11-interactive-ear-trainer--call-and-response-module)
  - [12. Auto-Scrolling Tablature, Practice Mode & Speed Trainer](#12-auto-scrolling-tablature-practice-mode--speed-trainer)
  - [13. Multi-Format Exporter & IndexedDB Vault](#13-multi-format-exporter--indexeddb-vault)
  - [14. Interactive Guided Tour & Plain-English Tutorial](#14-interactive-guided-tour--plain-english-tutorial)
- [Getting Started](#-getting-started)
- [Automated Verification & Test Suites](#-automated-verification--test-suites)
- [Keyboard Shortcuts Reference](#-keyboard-shortcuts-reference)
- [Project Structure](#-project-structure)
- [Technical Specifications](#-technical-specifications)
- [License](#-license)

---

## ⚡ Key Architecture & Data Flow

FretDSP operates on a split-bus routing topology designed to guarantee zero-jitter pitch detection while allowing full analog-modeled audio processing:

```
[ Microphone / Audio Interface Input ]
               │
      ┌────────┴────────┐
      ▼                 ▼
[ Raw Tap Bus ]   [ Wet DSP Bus ]
      │                 │
      ├─► AudioWorklet  ├─► TS-808 Tube Screamer Overdrive
      │   (Pitch/YIN)   ├─► Impulse Response Cabinet Simulator
      ├─► Strobe Tuner  ├─► MN3005 Analog BBD Delay
      ├─► FFT Analyzer  ├─► Ambient Convolution Reverb
      ├─► Chord Engine  ├─► Multi-Track Phrase Looper
      └─► Web MIDI Out  └─► Master Output Stage ──► [ Speakers / Monitor ]
               │
      [ Biomechanical Optimizer (Viterbi Trellis) ]
               │
      ┌────────┴───────────────────────────┐
      ▼                                    ▼
[ 22-Fret Canvas Fretboard ]     [ Auto-Scrolling Tablature Staff ]
      │                                    │
      └──────── Interactive Practice ──────┘
                (Pitch Accuracy & Speed Trainer)
```

---

## 🛠 Core Features & Modules

### 1. Real-Time Pitch Tracking & AudioWorklet DSP
- **Files:** `js/dsp.js`, `js/pitch-processor.worklet.js`
- **Engine:** Offloads high-density circular buffer processing and mathematical calculations to a background `AudioWorkletProcessor` thread.
- **Algorithms:** Multi-pass autocorrelation, normalized difference function (YIN), and McLeod Pitch Method (MPM) with parabolic peak interpolation for sub-cent fundamental frequency ($f_0$) extraction.
- **Onset Detection:** Spectral flux, RMS energy envelopes, and dynamic noise gate hysteresis to eliminate false triggers, finger squeaks, and fret rattles.
- **Visuals:** Calibrated analog-style RMS dBFS VU meter and digital peak clipping indicator.

### 2. Biomechanical Fretboard Optimizer (Viterbi Trellis)
- **Files:** `js/optimizer.js`, `guitar_fretboard_optimizer.js`
- **Dynamic Programming Formulation:** Solves guitar fingering ambiguity (since identical pitches occur across multiple strings) via the Viterbi algorithm.
- **Physiological Hand Cost Matrix:**
  - **Span Penalty:** Quadratic cost penalty for finger stretches beyond 4 frets, scaled by physical fret spacing tapering.
  - **Hand Shift Penalty:** Proportional cost based on hand displacement distance along the neck, scaled by note speed/tempo.
  - **String Crossing Penalty:** Weighted preference for adjacent string runs over multi-string jumps.
  - **Inversion & Same-Finger Hopping Penalty:** Penalizes awkward anatomical finger crossings and consecutive notes played by the same finger across different strings.
  - **Open-String Preference:** Strategic bonus for natural open-string pivots to facilitate fluid position shifts.
- **Scale Box Constraints:** Seamless integration with standard **CAGED** shapes (C, A, G, E, D forms) and **3-Notes-Per-String (3NPS)** modal frameworks.

### 3. Interactive 22-Fret Illuminated Fretboard
- **File:** `js/fretboard.js`
- **Hardware Rendering:** 60 FPS Canvas 2D engine featuring 6 strings with accurate core/wound gauges and 22 nickel frets.
- **Tunings:** Standard (E A D G B e), Drop D, DADGAD, Open D, Open G, and Half-Step Down (Eb Ab Db Gb Bb eb).
- **Theory Ribbon & Interval Coloring:**
  - **Target Tones (Cyan/Green):** Roots, 3rds, 5ths, and 7ths of the detected chord.
  - **Passing Tones (Amber):** Safe modal diatonic extensions (e.g., Dorian 6th, 9th).
  - **Avoid Tones (Red/Muted):** Clashing minor-second / tritone dissonances.
- **Accessibility & Customization:** Left-handed guitarist flip mode, position lock registers (Open, Mid-Neck, Lead), and string bend physics animations.

### 4. High-Precision Virtual Strobe Tuner & Inharmonicity Analyzer
- **Files:** `js/strobe-tuner.js`, `js/strobe-tuner.esm.js`
- **Virtual Strobe Disc:** Dual concentric stroboscopic wheels running at 60 FPS with true **0.1-cent visual precision** (outer ring tracks fundamental $f_0$, inner ring tracks 2nd harmonic $2f_0$).
- **Acoustic Inharmonicity Dispersion Analyzer:**
  Models real-world physical string stiffness using the dispersive partial equation:
  $$f_n = n \cdot f_0 \sqrt{1 + B \cdot n^2}$$
  - Computes the inharmonicity coefficient ($B$) and statistical fit ($R^2$) across the first 4 spectral partials.
  - **String Wear Gauge:** Diagnoses string fatigue in real time:
    - *Fresh String:* $B < 0.25 \times 10^{-3}$ (Studio Quality)
    - *Good String:* $0.25 \times 10^{-3} \le B \le 0.55 \times 10^{-3}$
    - *Aged String:* $0.55 \times 10^{-3} < B \le 1.10 \times 10^{-3}$
    - *Worn String:* $B > 1.10 \times 10^{-3}$ (Intonation compromised, replacement recommended)
- **Acoustic Physics Simulator:** Built-in synthetic pluck generator to test strobe and inharmonicity responses without requiring an active microphone.

### 5. Polyphonic Chord Recognizer & Theory Engine
- **File:** `js/chord-engine.js`
- **Chroma Profiling:** Maps instantaneous spectral energy to a 12-semitone pitch class profile (PCP).
- **Chord Vocabularies:** Triads (Maj, Min, Dim, Aug), Sevenths (Dom7, Maj7, Min7, m7b5, Dim7), Suspended (Sus2, Sus4), and extended color voicings.
- **Scale Recommendation:** Automatically suggests modal scales matching the harmonic context (e.g., detecting `Am7` immediately activates *A Minor Pentatonic* and *A Dorian*).

### 6. Guitar Effects Rack & Stompbox Chain
- **Files:** `js/effects-rack.js`, `js/cab-sim.js`
- **Split-Signal Topology:** Preserves an uncolored dry signal tap for pitch detection while passing audio through an analog-modeled pedalboard with true-bypass crossfading.
- **Pedals:**
  1. **TS-808 Tube Screamer:** Non-linear asymmetric sigmoid clipping overdrive with 720 Hz pre-emphasis and 800 Hz–6500 Hz active tone tilt filter.
  2. **Cabinet Simulator:** Procedural impulse response generator modeling speaker cone resonance, voice-coil inductance, and cabinet enclosure air reflections. Profiles: *4x12 Closed-Back UK*, *2x12 Open-Back US*, *1x12 Compact Tweed*. Includes mic position (center/edge) and distance (proximity bass boost to ambient room) controls.
  3. **Analog BBD Delay (MN3005):** Bucket-brigade delay emulation with analog low-pass filtering in the feedback loop, repeat times from 20ms to 1000ms, and safety-clamped feedback (0–90%).
  4. **Ambient Reverb:** Algorithmic and convolution spring tank / room plate simulator with variable room decay size (0.5s–4.0s) and high-frequency absorption damping.
  5. **Master Rack Bay:** True-bypass master footswitch, synthesizer-to-effects routing toggle, and speaker monitor toggle (safety-muted by default to prevent feedback).

### 7. Smart Backing Track & Rhythm Accompaniment Engine
- **File:** `js/backing-track.js`
- **Procedural Trio:** Generates dynamic rhythm accompaniment (Kick, Snare, Hi-Hat, Walking Bass, and Comping Keys) using 100% native Web Audio nodes.
- **Zero-Drift Scheduling:** High-precision lookahead scheduler (25ms interval, 100ms lookahead window) preventing timing jitter.
- **Groove Styles:** *Rock Straight 8ths*, *Blues Shuffle* (swung triplets), *Funk 16ths* (syncopated ghost notes), and *Jazz Walking 4/4*.
- **Harmonic Voice Leading & Chromatic Walking Bass:** Automatically computes smooth chord inversions minimizing voice displacement and generates authentic chromatic approach notes on beat 4.
- **Live Guitar Follow Mode:** Dynamically adapts backing chords on the fly to match chords strummed by the guitarist.

### 8. Web MIDI Bridge (MPE & 14-Bit Pitch Bend)
- **File:** `js/midi-output.js`
- **Plug-and-Play Discovery:** Seamless integration with `navigator.requestMIDIAccess()` with automatic port enumeration and hot-plug detection.
- **Audio-to-MIDI Dynamics:** Maps pick transient attack energy to standard MIDI velocity (1–127) using a calibrated musical logarithmic curve.
- **Continuous 14-Bit Pitch Bend:** Tracks real-time microtonal pitch variations, vibrato, and string bends, mapping them to 14-bit high-resolution MIDI pitch wheel events with centering at `0x2000` (8192).
- **MPE Routing:** Supports standard monophonic transmission (Channel 1) as well as full **MIDI Polyphonic Expression (MPE)** with individual string routing across Channels 2–7.

### 9. Sound-on-Sound Multi-Track Phrase Looper
- **File:** `js/looper.js`
- **Circular Buffer Engine:** Full-featured looper supporting standard operating states: `EMPTY`, `RECORDING`, `PLAYING`, `OVERDUBBING`, and `STOPPED`.
- **Seamless 10ms Crossfade:** Equal-power cosine/sine crossfading across the loop seam prevents clicks and pops.
- **Dual-Track Workflow:** Track 1 (rhythm bed) and Track 2 (synchronized lead/overdubs) with single-level non-destructive undo/redo.
- **Vintage Tape FX:** Non-destructive buffer time-reversal and half-speed tape resampling (octave drop).
- **Export:** Mixes down loop tracks into a studio-grade uncompressed 16-bit 44.1kHz stereo WAV file.

### 10. WSOLA Music Transcriber & Audio Slow-Downer
- **File:** `js/transcriber.js`
- **Time-Stretching:** Waveform Similarity Overlap-Add (WSOLA) engine providing tempo scaling from 25% to 150% with **100% pitch preservation**. Uses Normalized Cross-Correlation (NCC) alignment to eliminate comb filtering and transient smearing.
- **Pitch Transposition:** Independent pitch shifting (±12 semitones with fine cent adjustments) via C1-smooth Cubic Hermite Resampling.
- **Mid/Side Center Channel Extractor:**
  - **Solo Focus:** Isolates centered lead guitar while suppressing stereo panned accompaniment.
  - **Backing Track Creation:** Phase-cancels centered vocals/guitar solos while preserving stereo balance and low-end bass frequencies.
- **Auto-Tab Pipe:** Directly feeds processed audio into GuitarDSP for automated score transcription.

### 11. Interactive Ear Trainer & Call-and-Response Module
- **File:** `js/ear-trainer.js`
- **Game Modes:** *Interval Recognition*, *Chord Quality Training*, and *Melodic Call-and-Response Echo Motifs*.
- **Real-Time Pitch Verification:** Real-time feedback verifying notes strummed on the physical guitar within a configurable ±35 cent tolerance.
- **Adaptive Difficulty:** Three tiers scaling from diatonic steps and pentatonic leaps to complex chromaticism and tritones.
- **Scoring:** Tracks streaks, reaction times, accuracy percentages, and pitch accuracy bonuses.

### 12. Auto-Scrolling Tablature, Practice Mode & Speed Trainer
- **Files:** `js/tablature.js`, `js/quantizer.js`, `js/synth.js`
- **Auto-Scrolling Staff:** 60 FPS canvas tablature renderer displaying string numbers, fret numbers, measure lines, and animated playheads.
- **Rhythm Quantization:** Live or post-recording snapping to 1/16, 1/8, quarter note, or triplet subdivisions.
- **Interactive Practice Mode:** Set custom A-B loop measure boundaries, play along with live audio pitch grading (*Perfect*, *Good*, *Miss*), and activate the **Speed Trainer** to automatically accelerate tempo (+3 to +10 BPM) when accuracy goals are achieved.
- **Dual Synthesis Engines:**
  - **Karplus-Strong:** Physical plucked-string modeling using decaying delay lines with low-pass feedback.
  - **PolySynth:** Clean bandlimited multi-voice synthesizer.

### 13. Multi-Format Exporter & IndexedDB Vault
- **Files:** `js/exporter.js`, `js/storage.js`
- **Multi-Format Export Suite:**
  - **ASCII Tab:** Clean 80-column monospace tablature blocks ready for sharing or text editing.
  - **MusicXML 3.1 & 4.0:** Full partwise scores with 6-string TAB clef and string/fret technical notations for Guitar Pro, MuseScore, and Sibelius.
  - **Structured JSON:** Machine-readable interchange schema including measures, notes, velocities, and timestamps.
  - **Standard MIDI File (SMF Type 0):** Pure client-side binary `.mid` generator with 480 PPQ resolution, guitar program patches, and tempo meta tracks.
- **IndexedDB Take Vault:** Client-side local database to save, tag, search, and recall recorded riffs, practice sessions, and pedal presets offline.

### 14. Interactive Guided Tour & Plain-English Tutorial
- **File:** `js/tutorial.js`
- **12-Step Guided Onboarding:** A user-friendly, jargon-free interactive walkthrough introducing each studio panel with glowing target spotlights.
- **Interactive "Try It" Demos:** Lets users test real-time features during the tour, including synthetic fresh vs. worn string comparison, live A-minor pentatonic phrase generation, backing track engagement, and demo riff playback.
- **Topics Quick-Jump:** Collapsible jump menu allowing instant navigation to any specific topic, with keyboard navigation (<kbd>←</kbd> <kbd>→</kbd> <kbd>Esc</kbd>) and responsive auto-anchoring.

---

## 🚀 Getting Started

### Prerequisites
- Modern desktop or mobile web browser with Web Audio API support (Google Chrome, Microsoft Edge, Mozilla Firefox, or Apple Safari).
- An audio input source: built-in laptop microphone, USB microphone, or USB guitar audio interface.
- *Optional for testing:* [Node.js](https://nodejs.org/) (v16 or newer) to run the automated headless test suites.

### Running the Application Locally
Because FretDSP uses standard Web Audio and AudioWorklet modules, simply serve the repository directory with any HTTP server:

```bash
# Option 1: Python 3
python -m http.server 8000

# Option 2: Node npx serve
npx serve .

# Option 3: VS Code Live Server extension
# Right-click index.html -> "Open with Live Server"
```

Navigate to `http://localhost:8000` in your browser. Grant microphone permissions when prompted, click **Start Listening**, and pluck a string on your guitar!

---

## 🧪 Automated Verification & Test Suites

FretDSP comes with **15 comprehensive, zero-dependency test suites** totaling **1,221 automated tests** covering every mathematical formula, DSP filter, Viterbi optimization cost, and audio graph routing.

### Running All Tests
To execute all test suites sequentially using Node.js:

```bash
# Run all tests and display the summary pass/fail report
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
const testFiles = fs.readdirSync('.').filter(f => f.startsWith('test_') && f.endsWith('.js'));
let totalPassed = 0;
testFiles.forEach(file => {
  console.log('Running ' + file + '...');
  try {
    const output = execSync('node ' + file, { encoding: 'utf-8' });
    const match = output.match(/(\d+)\s+passed/i) || output.match(/PASSED:\s*(\d+)/i);
    if (match) totalPassed += parseInt(match[1]);
    console.log('  -> ' + (match ? match[0] : 'Completed successfully'));
  } catch (err) {
    console.error('  -> FAILED: ' + file, err.message);
  }
});
console.log('\n========================================');
console.log('TOTAL VERIFIED TESTS PASSED: ' + totalPassed);
console.log('========================================');
"
```

### Individual Test Suites

| Test Suite | Module Under Test | Key Assertions Verified |
| :--- | :--- | :--- |
| `test_guitar.js` | Full System Master | End-to-end integration, demo riffs, quantizer, playback scrubbing |
| `test_optimizer_v2.js` | Biomechanical Optimizer | Hand span penalties, neck tapering, CAGED boxes, 3NPS forms, Viterbi trellis |
| `test_worklet_dsp.js` | AudioWorklet DSP | Circular buffers, sample-rate invariance, zero-crossing, RMS energy |
| `test_strobe_tuner.js` | Strobe Tuner & Inharmonicity | 0.1¢ stroboscopic drift, $B$-factor curve fitting, string wear classification |
| `test_effects.js` | Guitar Effects Rack | TS-808 overdrive curves, tone tilt filter, BBD delay feedback, true-bypass |
| `test_cab_sim.js` | Cabinet & Mic Simulator | Impulse response synthesis, cone frequency response, mic proximity boost |
| `test_backing_track.js` | Procedural Accompaniment | Zero-drift lookahead scheduler, drum synthesis, walking bass, voice leading |
| `test_midi_output.js` | Web MIDI Bridge | Transient velocity mapping, 14-bit pitch bend calculations, MPE channels |
| `test_looper.js` | Multi-Track Looper | Circular buffers, 10ms equal-power crossfade, tape reversal, WAV encoding |
| `test_transcriber.js` | WSOLA Audio Transcriber | Normalized cross-correlation time stretching, Mid/Side matrixing |
| `test_ear_trainer.js` | Gamified Ear Trainer | Real-time pitch verification, cent tolerances, difficulty tier progressions |
| `test_fretboard.js` | Fretboard Visualizer | Coordinate transforms, alternate tunings, interval mapping, CAGED overlays |
| `test_chord_engine.js` | Polyphonic Chord Engine | Pitch class profiling, chord dictionary matching, scale recommendations |
| `test_exporter_xml.js` | Exporters | Well-formed XML tags, MusicXML 3.1 & 4.0 specifications, SMF Type 0 MIDI |
| `test_spectral_visualizer.js`| Spectral Waterfall Visualizer | FFT bins, overtone harmonic tagging ($f_0$, $2f_0$, $3f_0$, $4f_0$) |

---

## ⌨️ Keyboard Shortcuts Reference

FretDSP supports full keyboard control for hands-on-guitar interaction without needing to reach for a mouse:

| Key | Action |
| :---: | :--- |
| <kbd>1</kbd> – <kbd>6</kbd> | Virtual Pluck open strings 1 through 6 (e to E) |
| <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> <kbd>F</kbd> <kbd>G</kbd> <kbd>H</kbd> <kbd>J</kbd> <kbd>K</kbd> | Play notes along the A Minor Pentatonic scale box |
| <kbd>Space</kbd> | Pause / Resume auto-scrolling tablature staff |
| <kbd>P</kbd> | Toggle Synthesizer playback of recorded score |
| <kbd>L</kbd> | Toggle Continuous Score Looping |
| <kbd>Q</kbd> | Quantize recorded tablature to active grid subdivision |
| <kbd>R</kbd> | Rewind playhead to measure 1 |
| <kbd>B</kbd> | Engage / Stop Smart Backing Track Accompaniment |

---

## 📂 Project Structure

```
Guitar/
├── css/
│   └── styles.css                  # Hardware-inspired chassis styling, animations & responsive layout
├── js/
│   ├── app.js                      # Application orchestrator, event hub & UI binding
│   ├── backing-track.js            # Procedural rhythm trio accompaniment engine & zero-drift scheduler
│   ├── cab-sim.js                  # Impulse response guitar cabinet & microphone simulator
│   ├── chord-engine.js             # Polyphonic chord recognition & modal scale engine
│   ├── demo-songs.js               # Iconic guitar riffs & educational exercise scores
│   ├── dsp.js                      # Multi-pass pitch detection, YIN/MPM, onset detection & VU metering
│   ├── ear-trainer.js              # Gamified ear trainer, call-and-response & interval quiz engine
│   ├── effects-rack.js             # Stompbox DSP chain (Overdrive, BBD Delay, Reverb, Master Bay)
│   ├── exporter.js                 # Multi-format export engine (ASCII, MusicXML, JSON, SMF Type 0 MIDI)
│   ├── fretboard.js                # 22-fret interactive illuminated Canvas fretboard visualizer
│   ├── looper.js                   # Sound-on-sound multi-track phrase looper with tape FX & WAV export
│   ├── midi-output.js              # Low-latency Web MIDI bridge with MPE & 14-bit continuous pitch bend
│   ├── optimizer.js                # Biomechanical Viterbi optimizer & CAGED/3NPS shape mapper
│   ├── pitch-processor.worklet.js  # Dedicated 64-bit AudioWorkletProcessor thread
│   ├── quantizer.js                # Multi-subdivision rhythm quantization engine
│   ├── spectral-visualizer.js      # 60 FPS rolling FFT waterfall spectrogram & overtone tracker
│   ├── storage.js                  # IndexedDB persistent Preset & Take Vault
│   ├── strobe-tuner.js             # High-precision virtual strobe disc & acoustic inharmonicity analyzer
│   ├── strobe-tuner.esm.js         # ES Module variant of the strobe tuner engine
│   ├── synth.js                    # Karplus-Strong physical modeling string synth & PolySynth
│   ├── tablature.js                # Auto-scrolling 6-string canvas tablature staff & practice mode
│   ├── transcriber.js              # WSOLA time-stretch, pitch-shift & Mid/Side solo isolator
│   └── tutorial.js                 # Interactive 12-step guided tour with live spotlight highlighting
├── test_*.js                       # 15 headless verification test suites (1,221 automated tests)
├── index.html                      # Single-page studio interface & modular hardware rackmount chassis
├── README.md                       # Comprehensive technical documentation & user guide
└── LICENSE                         # MIT License
```

---

## 🔬 Technical Specifications

- **Audio Sample Rates:** 44.1 kHz, 48 kHz, 96 kHz (automatic sample-rate invariant tuning).
- **Pitch Detection Range:** E2 (~82.4 Hz) to D6 (~1174.7 Hz) with sub-cent parabolic interpolation.
- **Pitch Tracking Precision:** $\pm 0.1$ cents (virtual strobe disc) / $\pm 1.0$ cent (AudioWorklet engine).
- **Strobe Inharmonicity Range:** $B \in [0.00005, 0.00500]$ with least-squares polynomial regression.
- **MIDI Output Specs:** Standard MIDI File (SMF Type 0), 480 PPQ, 14-bit pitch bend ($\pm 2$ semitones default, configurable up to $\pm 24$).
- **MusicXML Specification:** MusicXML 3.1 & 4.0 Partwise with `<technical>` fret and string elements.
- **Dependencies:** **Zero runtime dependencies, zero build steps.** Written in standard ES6+ JavaScript.

---

## 📄 License

This project is licensed under the **MIT License**. Feel free to use, modify, and distribute it for personal, educational, or commercial applications.
