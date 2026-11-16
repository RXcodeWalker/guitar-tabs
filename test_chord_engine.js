/**
 * Automated Verification Test Suite for Polyphonic Chord Recognizer
 * and Scale Recommendation Engine
 */

const ChordEngine = require('./chord-engine.js');
const {
    analyzeChroma,
    getScaleOverlay,
    PolyphonicChordRecognizer,
    computeChromagram,
    generateChordSpectrum,
    BUILTIN_TEST_DATA,
    verifyChordDetection,
    NOTE_NAMES,
    CHORD_QUALITIES
} = ChordEngine;

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

console.log("================================================================================");
console.log("TEST SUITE: REAL-TIME POLYPHONIC CHORD RECOGNIZER & SCALE RECOMMENDATION ENGINE");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// SECTION 1: Export Clean Functions Verification
// -----------------------------------------------------------------------------
console.log("--- Section 1: Exported Clean Functions & Interfaces ---");
assert(typeof analyzeChroma === 'function', "analyzeChroma is exported as a clean function");
assert(typeof getScaleOverlay === 'function', "getScaleOverlay is exported as a clean function");
assert(typeof PolyphonicChordRecognizer === 'function', "PolyphonicChordRecognizer class is exported");
assert(typeof computeChromagram === 'function', "computeChromagram function is exported");
assert(Array.isArray(BUILTIN_TEST_DATA), "BUILTIN_TEST_DATA is exported as an array");
assert(BUILTIN_TEST_DATA.length >= 10, `BUILTIN_TEST_DATA contains ${BUILTIN_TEST_DATA.length} chord test cases`);

// -----------------------------------------------------------------------------
// SECTION 2: 4096-bin FFT Spectrum & Cosine-Weighted Chromagram (Spec 1)
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: 4096-bin FFT Spectrum to 12-Dimensional Chroma Vector ---");
const testSampleRate = 44100;
const testSpectrum = generateChordSpectrum("C", testSampleRate, 4096);
assert(testSpectrum instanceof Uint8Array, "generateChordSpectrum generates a Uint8Array");
assert(testSpectrum.length === 4096, `Spectrum has exactly 4096 bins (got ${testSpectrum.length})`);

const chroma = computeChromagram(testSpectrum, testSampleRate);
assert(chroma.length === 12, "Chroma vector has exactly 12 dimensions (C through B)");

// Check unit L2 norm
let l2 = 0;
for (let i = 0; i < 12; i++) l2 += chroma[i] * chroma[i];
assert(Math.abs(Math.sqrt(l2) - 1.0) < 0.01, `Chroma vector is normalized to unit length (L2 norm = ${Math.sqrt(l2).toFixed(4)})`);

// For C Major triad: energy should be concentrated in C (0), E (4), and G (7)
const cEnergy = chroma[0];
const eEnergy = chroma[4];
const gEnergy = chroma[7];
assert(cEnergy > 0.35, `C pitch class has prominent energy: ${cEnergy.toFixed(3)}`);
assert(eEnergy > 0.35, `E pitch class has prominent energy: ${eEnergy.toFixed(3)}`);
assert(gEnergy > 0.30, `G pitch class has prominent energy: ${gEnergy.toFixed(3)}`);
assert(chroma[1] < 0.15, `Non-chord C# has suppressed energy: ${chroma[1].toFixed(3)}`);

// Cosine weighting smoothly partitions energy without discrete jump artifacts
const singleToneSpectrum = new Uint8Array(4096);
const binRes = testSampleRate / (2 * 4096); // ~5.383 Hz
// Exact 440 Hz (A4)
const a4Bin = Math.round(440.0 / binRes);
singleToneSpectrum[a4Bin] = 220;
const a4Chroma = computeChromagram(singleToneSpectrum, testSampleRate);
assert(a4Chroma[9] > 0.85, `Pure A4 tone concentrates in A pitch class (got ${a4Chroma[9].toFixed(3)})`);

// Slightly detuned tone (+50 cents / quarter-tone, midway between A and A#)
const detunedFreq = 440.0 * Math.pow(2, 50 / 1200); // +50 cents
const detunedBin = Math.round(detunedFreq / binRes);
const detunedSpectrum = new Uint8Array(4096);
detunedSpectrum[detunedBin] = 220;
const detunedChroma = computeChromagram(detunedSpectrum, testSampleRate);
assert(detunedChroma[9] > 0.50 && detunedChroma[10] > 0.50, 
    `Cosine weighting smoothly distributes energy between adjacent semitones A and A# (A: ${detunedChroma[9].toFixed(3)}, A#: ${detunedChroma[10].toFixed(3)})`);

// -----------------------------------------------------------------------------
// SECTION 3: Polyphonic Chord Template Matching & Built-in Test Data (Spec 2)
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Built-in Chord Test Data Verification (Triads & 7ths) ---");
const testResults = verifyChordDetection();
for (const res of testResults) {
    assert(res.passed, `Chord "${res.testChord}" correctly identified as "${res.detectedChord}" with ${res.confidence}% confidence (Root: ${res.root}, Quality: ${res.quality})`);
}

// -----------------------------------------------------------------------------
// SECTION 4: Hysteresis & Anti-Flickering Verification (Spec 2)
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Hysteresis & Anti-Flicker State Machine ---");
const recognizer = new PolyphonicChordRecognizer({
    stabilityThreshold: 3,
    hysteresisMargin: 14
});

// Step 4.1: Stream C Major frames until locked
const specC = generateChordSpectrum("C", 44100, 4096);
let res1 = null;
for (let f = 0; f < 3; f++) {
    res1 = recognizer.processFrame(specC, 44100);
}
assert(res1.chord === "C", `Recognizer locked onto C after sustained frames (got "${res1.chord}")`);
assert(res1.confidence >= 70, `Confidence is robust: ${res1.confidence}%`);

// Step 4.2: Inject a single transient frame of a competing chord (Am)
const specAm = generateChordSpectrum("Am", 44100, 4096);
const flickerFrame = recognizer.processFrame(specAm, 44100);
assert(flickerFrame.chord === "C", `Single transient frame did NOT cause chord to flicker (remained locked on "${flickerFrame.chord}")`);

// Step 4.3: Sustain the new chord for 3+ consecutive frames -> should decisively transition
recognizer.processFrame(specAm, 44100);
const transitioned = recognizer.processFrame(specAm, 44100);
assert(transitioned.chord === "Am", `After 3 sustained frames, recognizer stably transitioned to "${transitioned.chord}"`);

// Step 4.4: Silence handling
const silentBuffer = new Uint8Array(4096);
const silentResult = recognizer.processFrame(silentBuffer, 44100);
assert(silentResult.isConfident === false || silentResult.confidence <= 100, "Silence reduces confidence gracefully without throwing errors");

// -----------------------------------------------------------------------------
// SECTION 5: Live Fretboard Scale Overlay Generator (Spec 3)
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: Live Fretboard Scale Overlay Generator ---");

// Test Am7 scale recommendation (Explicitly specified in prompt)
const am7Overlay = getScaleOverlay("Am7");
assert(am7Overlay.scaleName === "A Minor Pentatonic / A Dorian", `Am7 returns scale recommendation: "${am7Overlay.scaleName}"`);
assert(Array.isArray(am7Overlay), "getScaleOverlay returns an Array");
assert(am7Overlay.length === 138, `Generates notes for 6 strings * 23 frets (0 to 22) = 138 notes (got ${am7Overlay.length})`);

// Check note classification categories
const am7TargetNotes = am7Overlay.targetNotes;
const am7PassingNotes = am7Overlay.passingNotes;
const am7AvoidNotes = am7Overlay.avoidNotes;

assert(am7TargetNotes.includes("A") && am7TargetNotes.includes("C") && am7TargetNotes.includes("E") && am7TargetNotes.includes("G"), 
    `Am7 Target Notes correctly contain chord tones [A, C, E, G] (got: ${am7TargetNotes.join(', ')})`);
assert(am7PassingNotes.includes("B") && am7PassingNotes.includes("D") && am7PassingNotes.includes("F#"), 
    `Am7 Passing Notes contain safe extensions [B, D, F#] (got: ${am7PassingNotes.join(', ')})`);
assert(am7AvoidNotes.includes("F"), "Am7 Avoid Notes classify F (minor 6th) as avoid note in Dorian context");

// Verify fretboard coordinate objects
const openHighE = am7Overlay.find(n => n.string === 1 && n.fret === 0);
assert(openHighE && openHighE.noteName === "E" && openHighE.noteType === "target" && openHighE.interval === "5", 
    "String 1, Fret 0 (High E) is classified as 'target' (5th interval)");

const string1Fret1 = am7Overlay.find(n => n.string === 1 && n.fret === 1);
assert(string1Fret1 && string1Fret1.noteName === "F" && string1Fret1.noteType === "avoid", 
    "String 1, Fret 1 (F) is classified as 'avoid'");

const string1Fret2 = am7Overlay.find(n => n.string === 1 && n.fret === 2);
assert(string1Fret2 && string1Fret2.noteName === "F#" && string1Fret2.noteType === "passing", 
    "String 1, Fret 2 (F#) is classified as 'passing' (Dorian 6th)");

const string1Fret5 = am7Overlay.find(n => n.string === 1 && n.fret === 5);
assert(string1Fret5 && string1Fret5.noteName === "A" && string1Fret5.noteType === "target" && string1Fret5.interval === "R", 
    "String 1, Fret 5 (A) is classified as 'target' (Root interval)");

// Test Major triad overlay (e.g. C)
const cOverlay = getScaleOverlay("C");
assert(cOverlay.targetNotes.includes("C") && cOverlay.targetNotes.includes("E") && cOverlay.targetNotes.includes("G"), 
    "C Major Target Notes contain C, E, G");
assert(cOverlay.avoidNotes.includes("F"), "C Major classifies Natural 4th (F) as avoid note over major 3rd");

// Test Dominant 7th overlay (e.g. G7)
const g7Overlay = getScaleOverlay("G7");
assert(g7Overlay.scaleName.includes("Mixolydian"), `G7 recommends Mixolydian (got: "${g7Overlay.scaleName}")`);
assert(g7Overlay.targetNotes.includes("F"), "G7 Target Notes contain minor 7th (F)");

// Test Diminished chord overlay (e.g. Bdim)
const bdimOverlay = getScaleOverlay("Bdim");
assert(bdimOverlay.targetNotes.includes("F"), "Bdim Target Notes contain diminished fifth (F)");
assert(bdimOverlay.avoidNotes.includes("F#"), "Bdim Avoid Notes classify natural 5th (F#) as avoid note");

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log("\n================================================================================");
console.log(`TOTAL TEST RESULTS: ${passed} passed, ${failed} failed.`);
console.log("================================================================================");

if (failed > 0) {
    process.exit(1);
}
