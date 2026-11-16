/**
 * Automated Verification Script for Guitar DSP, Optimizer, and Tablature
 */

const GuitarDSP = require('./js/dsp.js');
const GuitarOptimizer = require('./js/optimizer.js');
const TablatureStaff = require('./js/tablature.js');
const DEMO_SONGS = require('./js/demo-songs.js');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        testsFailed++;
    }
}

console.log("=== 1. Testing Guitar Optimizer (Phase 2) ===");
const opt = new GuitarOptimizer();

// Test standard open strings
assert(opt.openMidi[0] === 64, "High E open string is MIDI 64 (E4)");
assert(opt.openMidi[1] === 59, "B open string is MIDI 59 (B3)");
assert(opt.openMidi[2] === 55, "G open string is MIDI 55 (G3)");
assert(opt.openMidi[3] === 50, "D open string is MIDI 50 (D3)");
assert(opt.openMidi[4] === 45, "A open string is MIDI 45 (A2)");
assert(opt.openMidi[5] === 40, "Low E open string is MIDI 40 (E2)");

// Disambiguation test for A4 (MIDI 69, 440 Hz)
// Playable on string 1 fret 5, string 2 fret 10, string 3 fret 14, string 4 fret 19
const cands = opt.findCandidates(69);
assert(cands.length >= 4, `A4 (440Hz) has ${cands.length} playable positions on 22-fret neck`);
assert(cands.some(c => c.string === 1 && c.fret === 5), "Candidate includes String 1, Fret 5");
assert(cands.some(c => c.string === 2 && c.fret === 10), "Candidate includes String 2, Fret 10");
assert(cands.some(c => c.string === 3 && c.fret === 14), "Candidate includes String 3, Fret 14");
assert(cands.some(c => c.string === 4 && c.fret === 19), "Candidate includes String 4, Fret 19");

// Test optimization under open position
opt.setMode('open');
opt.handAnchorFret = 1;
const bestOpen = opt.optimize(69);
assert(bestOpen.string === 1 && bestOpen.fret === 5, `In open mode, A4 picks string ${bestOpen.string} fret ${bestOpen.fret}`);

// Test optimization under mid mode
opt.setMode('mid');
opt.handAnchorFret = 7;
const bestMid = opt.optimize(69);
assert(bestMid.string === 2 && bestMid.fret === 10, `In mid mode (frets 5-9 anchor), A4 picks string ${bestMid.string} fret ${bestMid.fret}`);

// Test finger assignment
const finger1 = opt.assignFinger(5, 5); // Index
const finger2 = opt.assignFinger(6, 5); // Middle
const finger3 = opt.assignFinger(7, 5); // Ring
const finger4 = opt.assignFinger(8, 5); // Pinky
const finger0 = opt.assignFinger(0, 5); // Open string
assert(finger1 === 1, "Fret matching anchor gets Finger 1 (Index)");
assert(finger2 === 2, "Anchor + 1 gets Finger 2 (Middle)");
assert(finger3 === 3, "Anchor + 2 gets Finger 3 (Ring)");
assert(finger4 === 4, "Anchor + 3 gets Finger 4 (Pinky)");
assert(finger0 === 0, "Fret 0 gets Finger 0 (Open)");

console.log("\n=== 2. Testing Guitar DSP Mathematical Models (Phase 1) ===");
const dsp = new GuitarDSP();

// MIDI to Frequency test
const freqA4 = dsp.midiToFrequency(69);
assert(Math.abs(freqA4 - 440) < 0.01, `MIDI 69 converts to 440 Hz (got ${freqA4})`);

const freqE2 = dsp.midiToFrequency(40);
assert(Math.abs(freqE2 - 82.406) < 0.05, `MIDI 40 (Low E) converts to ~82.41 Hz (got ${freqE2})`);

const freqE4 = dsp.midiToFrequency(64);
assert(Math.abs(freqE4 - 329.627) < 0.05, `MIDI 64 (High E) converts to ~329.63 Hz (got ${freqE4})`);

// Median filter test
const med = dsp.getMedian([60, 61, 60, 60, 72]);
assert(med === 60, `Median filter removes outlier jump (got ${med})`);

// Synthetic sine wave YIN pitch detection test
const sampleRate = 44100;
const testFreq = 440.0;
const synthBuffer = new Float32Array(2048);
for (let i = 0; i < synthBuffer.length; i++) {
    synthBuffer[i] = Math.sin(2 * Math.PI * testFreq * i / sampleRate);
}
const detected = dsp.detectPitchYIN(synthBuffer, sampleRate);
assert(detected !== null, "YIN successfully detected pitch on pure tone");
assert(Math.abs(detected.frequency - 440) < 1.0, `Detected frequency ${detected.frequency.toFixed(2)} Hz is within 1 Hz of 440 Hz`);
assert(detected.confidence > 0.95, `Confidence score is high: ${detected.confidence.toFixed(3)}`);

console.log("\n=== 3. Testing Demo Songs Integrity ===");
for (const [key, song] of Object.entries(DEMO_SONGS)) {
    assert(song.notes.length > 0, `Demo song "${song.title}" contains ${song.notes.length} notes`);
    let allValid = true;
    for (const n of song.notes) {
        if (n.string < 1 || n.string > 6 || n.fret < 0 || n.fret > 22) {
            allValid = false;
        }
    }
    assert(allValid, `All notes in "${song.title}" have valid strings (1-6) and frets (0-22)`);
}

console.log(`\n========================================`);
console.log(`Verification Complete: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) process.exit(1);
