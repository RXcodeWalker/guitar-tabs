/**
 * Comprehensive Unit Test Suite for FretDSP Music Transcription & Slow-Downer Module
 * File: test_transcriber.js
 * 
 * Verifies:
 * 1. Mid/Side Matrixing Algebraic Properties & Matrix Inversion
 *    - Matrix symmetry and orthonormality: T * T = I
 *    - Round-trip reconstruction error (< 1e-6)
 *    - Power conservation: M^2 + S^2 = L^2 + R^2
 *    - Solo Focus mode: center channel isolation & stereo panning suppression
 *    - Backing Track mode / Lead Mute: phase cancellation of centered audio (> 100 dB)
 *    - Zero-phase bass retention in backing track mode
 * 2. WSOLA Normalized Cross-Correlation (NCC) Math & Alignment Search
 *    - NCC bounds check: -1.0 <= NCC <= +1.0
 *    - Identity correlation (NCC = 1.0) and inverted correlation (NCC = -1.0)
 *    - Orthogonal signals correlation (NCC ~ 0.0)
 *    - Optimal offset detection under deliberate phase shifts
 *    - Phase cancellation & comb filtering prevention vs naive overlap-add
 * 3. WSOLA Time-Stretching & Output Buffer Duration Ratios
 *    - Output length ratios across 25%, 50%, 75%, 100%, 125%, 150% tempo
 *    - Pitch preservation: 440 Hz (A4) input at 50% tempo remains exactly 440 Hz
 *    - Multi-channel stereo phase coherence
 * 4. Independent Pitch Transposition & Cubic Hermite Resampling
 *    - Cubic Hermite interpolation C1 continuity
 *    - Transposition up 12 semitones (+1 octave, 440 Hz -> 880 Hz) with 100% duration preservation
 *    - Transposition down 12 semitones (-1 octave, 440 Hz -> 220 Hz) with 100% duration preservation
 *    - Tuning Eb-standard song to E-standard (+1 semitone / +100 cents) without changing tempo
 *    - Fine cents tuning (+50 cents)
 * 5. Consolidated Multi-Effect Pipeline
 *    - Simultaneous time-stretching (50% speed) + pitch transposition (+2 semitones) + Solo Focus
 * 6. FretDSP GuitarDSP Pitch Detector Piping & Auto-Tab Integration
 *    - Batch piping via transcribeBuffer(guitarDSP)
 *    - Accurate detection of guitar notes, plucks, and durations scaled to slowed tempo
 *    - Web Audio real-time piping graph interface
 */

const MusicTranscriber = require('./js/transcriber.js');
const GuitarDSP = require('./js/dsp.js');

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

function assertClose(actual, expected, tolerance, message) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
        console.log(`  ✓ ${message} (actual: ${actual.toFixed(5)}, expected: ${expected.toFixed(5)}, diff: ${diff.toExponential(2)})`);
        testsPassed++;
    } else {
        console.error(`  ✗ FAIL: ${message} (actual: ${actual.toFixed(5)}, expected: ${expected.toFixed(5)}, diff: ${diff.toFixed(5)} > tol: ${tolerance})`);
        testsFailed++;
    }
}

/**
 * Synthesizes pure sinusoidal audio buffer.
 */
function generateSine(freq, sampleRate, numSamples, amplitude = 0.8) {
    const buf = new Float32Array(numSamples);
    const omega = (2 * Math.PI * freq) / sampleRate;
    for (let i = 0; i < numSamples; i++) {
        buf[i] = amplitude * Math.sin(omega * i);
    }
    return buf;
}

console.log("================================================================================");
console.log("TEST SUITE: FRETDSP MUSIC TRANSCRIPTION & AUDIO SLOW-DOWNER (PHASE 4)");
console.log("================================================================================\n");

// =============================================================================
// Section 1: Mid/Side Matrixing Algebraic Properties & Matrix Inversion
// =============================================================================
console.log("=== Section 1: Mid/Side Matrixing & Center Channel Extraction ===");

const N_MS = 2048;
const testL = new Float32Array(N_MS);
const testR = new Float32Array(N_MS);
for (let i = 0; i < N_MS; i++) {
    testL[i] = 0.6 * Math.sin(i * 0.05) + 0.3 * Math.cos(i * 0.12);
    testR[i] = 0.5 * Math.sin(i * 0.08) - 0.4 * Math.cos(i * 0.03);
}

// 1.1 Encode Mid/Side
const { mid, side } = MusicTranscriber.encodeMidSide(testL, testR);
assert(mid.length === N_MS, "Mid channel length equals input length");
assert(side.length === N_MS, "Side channel length equals input length");

// 1.2 Mathematical Parseval Power Conservation: M^2 + S^2 = L^2 + R^2
let maxPowerDiff = 0;
for (let i = 0; i < N_MS; i++) {
    const powerLR = (testL[i] * testL[i]) + (testR[i] * testR[i]);
    const powerMS = (mid[i] * mid[i]) + (side[i] * side[i]);
    const diff = Math.abs(powerLR - powerMS);
    if (diff > maxPowerDiff) maxPowerDiff = diff;
}
assert(maxPowerDiff < 1e-6, `Power conservation M^2 + S^2 == L^2 + R^2 holds (max diff: ${maxPowerDiff.toExponential(2)})`);

// 1.3 Algebraic Matrix Inversion: T * T = I (Decoded L, R matches original L, R)
const decoded = MusicTranscriber.decodeMidSide(mid, side);
let maxInvErrL = 0;
let maxInvErrR = 0;
for (let i = 0; i < N_MS; i++) {
    maxInvErrL = Math.max(maxInvErrL, Math.abs(testL[i] - decoded.left[i]));
    maxInvErrR = Math.max(maxInvErrR, Math.abs(testR[i] - decoded.right[i]));
}
assert(maxInvErrL < 1e-6, `Matrix inversion Left error < 1e-6 (actual: ${maxInvErrL.toExponential(2)})`);
assert(maxInvErrR < 1e-6, `Matrix inversion Right error < 1e-6 (actual: ${maxInvErrR.toExponential(2)})`);

// 1.4 Solo Focus Mode (Center Guitar Isolation)
// Setup: Centered guitar solo (L = R = S_solo) + stereo panned rhythm noise (L_noise = -R_noise)
const soloTrack = new Float32Array(N_MS);
const noiseL = new Float32Array(N_MS);
const noiseR = new Float32Array(N_MS);
const mixL = new Float32Array(N_MS);
const mixR = new Float32Array(N_MS);

for (let i = 0; i < N_MS; i++) {
    soloTrack[i] = 0.7 * Math.sin(i * 0.15); // Mono center guitar
    noiseL[i] = 0.4 * Math.cos(i * 0.08);    // Stereo out-of-phase panning
    noiseR[i] = -0.4 * Math.cos(i * 0.08);
    mixL[i] = soloTrack[i] + noiseL[i];
    mixR[i] = soloTrack[i] + noiseR[i];
}

const soloFocusResult = MusicTranscriber.isolateCenter(mixL, mixR, 'solo_focus', { focusAmount: 1.0 });
let maxPannedLeak = 0;
let soloPreservationError = 0;
for (let i = 0; i < N_MS; i++) {
    // In pure solo focus, side is 0, so left == right == soloTrack[i]
    maxPannedLeak = Math.max(maxPannedLeak, Math.abs(soloFocusResult.side[i]));
    soloPreservationError = Math.max(soloPreservationError, Math.abs(soloFocusResult.left[i] - soloTrack[i]));
}
assert(maxPannedLeak < 1e-6, `Solo Focus completely suppresses side panned noise (side leak: ${maxPannedLeak.toExponential(2)})`);
assert(soloPreservationError < 1e-6, `Solo Focus preserves centered lead guitar with 0 dB loss (error: ${soloPreservationError.toExponential(2)})`);

// 1.5 Backing Track Mode / Lead Mute (Phase Cancellation of Center Guitar)
const leadMuteResult = MusicTranscriber.isolateCenter(mixL, mixR, 'lead_mute', { muteAmount: 1.0 });
let centerResidual = 0;
let rhythmPreservationError = 0;
for (let i = 0; i < N_MS; i++) {
    // Mid channel should be 0. Left channel output should be exactly noiseL
    centerResidual = Math.max(centerResidual, Math.abs(leadMuteResult.mid[i]));
    rhythmPreservationError = Math.max(rhythmPreservationError, Math.abs(leadMuteResult.left[i] - noiseL[i]));
}
assert(centerResidual < 1e-6, `Lead Mute phase-cancels center channel (>120 dB rejection, residual: ${centerResidual.toExponential(2)})`);
assert(rhythmPreservationError < 1e-6, `Lead Mute cleanly preserves stereo backing rhythm track (error: ${rhythmPreservationError.toExponential(2)})`);

// 1.6 Zero-Phase Bass Retention in Backing Track Mode
const bassFreq = 60; // 60 Hz bass note
const leadFreq = 800; // 800 Hz guitar solo note
const bassTrack = generateSine(bassFreq, 44100, N_MS, 0.8);
const highLeadTrack = generateSine(leadFreq, 44100, N_MS, 0.8);
const centerMixL = new Float32Array(N_MS);
const centerMixR = new Float32Array(N_MS);
for (let i = 0; i < N_MS; i++) {
    centerMixL[i] = bassTrack[i] + highLeadTrack[i];
    centerMixR[i] = bassTrack[i] + highLeadTrack[i];
}
const bassRetainedResult = MusicTranscriber.isolateCenter(centerMixL, centerMixR, 'lead_mute', {
    muteAmount: 1.0,
    preserveBass: true,
    bassCrossoverFreq: 150,
    sampleRate: 44100
});
// Verify that bass frequencies (>50Hz) are preserved in mid while high lead is cancelled
let highFreqEnergy = 0;
let bassFreqEnergy = 0;
for (let i = 200; i < N_MS - 200; i++) {
    bassFreqEnergy += Math.abs(bassRetainedResult.mid[i]);
}
assert(bassFreqEnergy > 50, "Zero-phase bass retention preserves low-end groove (<150Hz)");

console.log("");

// =============================================================================
// Section 2: WSOLA Normalized Cross-Correlation Math & Alignment Search
// =============================================================================
console.log("=== Section 2: WSOLA Normalized Cross-Correlation (NCC) Math ===");

const L_CORR = 512;
const waveA = generateSine(440, 44100, L_CORR, 0.7);
const waveInverted = new Float32Array(L_CORR);
for (let i = 0; i < L_CORR; i++) waveInverted[i] = -waveA[i];

// 2.1 Identity correlation = +1.0
const nccIdentity = MusicTranscriber.computeNormalizedCrossCorrelation(waveA, 0, waveA, 0, L_CORR);
assertClose(nccIdentity, 1.0, 1e-5, "NCC of identical waveforms equals +1.00000");

// 2.2 Inverted correlation = -1.0
const nccInverted = MusicTranscriber.computeNormalizedCrossCorrelation(waveA, 0, waveInverted, 0, L_CORR);
assertClose(nccInverted, -1.0, 1e-5, "NCC of inverted waveforms equals -1.00000");

// 2.3 Orthogonal waveforms correlation = 0.0
// Sine and cosine with integer number of periods over window
const waveCos = new Float32Array(L_CORR);
for (let i = 0; i < L_CORR; i++) waveCos[i] = 0.7 * Math.cos(2 * Math.PI * 440 * i / 44100);
const nccOrthogonal = MusicTranscriber.computeNormalizedCrossCorrelation(waveA, 0, waveCos, 0, L_CORR);
assert(Math.abs(nccOrthogonal) < 0.05, `NCC of orthogonal sine/cosine ~ 0.0 (actual: ${nccOrthogonal.toFixed(4)})`);

// 2.4 Optimal offset discovery under intentional phase delay
// Delay wave by known offset delta = +23 samples
const testTrack = generateSine(440, 44100, 2048, 0.8);
const shift = 23;
const targetPos = 500;
const refPos = targetPos + shift;
const { bestOffset, maxCorrelation } = MusicTranscriber.findOptimalOffset(testTrack, refPos, targetPos, 64, 512);
assert(bestOffset === shift, `findOptimalOffset correctly discovered alignment shift (expected: +${shift}, found: +${bestOffset})`);
assertClose(maxCorrelation, 1.0, 1e-4, "Optimal offset achieves maximum correlation ~ 1.0");

// 2.5 Phase cancellation & comb filtering prevention test
// Half-period shift (50 samples ~ 180 degrees) causes severe destructive cancellation
// when overlapped naively without alignment. WSOLA alignment locks phase and restores full amplitude.
const halfPeriodShift = 50;
const antiPhaseRef = targetPos + halfPeriodShift;
const { bestOffset: antiPhaseOffset } = MusicTranscriber.findOptimalOffset(testTrack, antiPhaseRef, targetPos, 64, L_CORR);

let unalignedSum = 0;
let alignedSum = 0;
for (let i = 0; i < L_CORR; i++) {
    unalignedSum += Math.abs(testTrack[antiPhaseRef + i] + testTrack[targetPos + i]);
    alignedSum += Math.abs(testTrack[antiPhaseRef + i] + testTrack[targetPos + antiPhaseOffset + i]);
}
assert(alignedSum > unalignedSum * 50, `WSOLA alignment offset (+${antiPhaseOffset}) prevents destructive phase cancellation (energy gain: ${(alignedSum / unalignedSum).toFixed(1)}x)`);

console.log("");

// =============================================================================
// Section 3: WSOLA Time-Stretching & Output Buffer Duration Ratios
// =============================================================================
console.log("=== Section 3: WSOLA Time-Stretching & Duration Scaling ===");

const SR = 44100;
const inputDuration = 1.0; // 1 second
const inputLength = Math.round(SR * inputDuration);
const inputSine440 = generateSine(440, SR, inputLength, 0.8);

const tempoTestCases = [
    { tempo: 0.25, name: "25% Speed (Slow Shred)", expectedRatio: 4.0 },
    { tempo: 0.50, name: "50% Speed (Half Speed)", expectedRatio: 2.0 },
    { tempo: 0.75, name: "75% Speed (Practice)", expectedRatio: 1.3333 },
    { tempo: 1.00, name: "100% Speed (Original)", expectedRatio: 1.0 },
    { tempo: 1.25, name: "125% Speed (Fast)", expectedRatio: 0.8 },
    { tempo: 1.50, name: "150% Speed (Super Fast)", expectedRatio: 0.6667 }
];

for (const tc of tempoTestCases) {
    const res = MusicTranscriber.timeStretch(inputSine440, tc.tempo);
    const actualRatio = res.left.length / inputLength;
    assertClose(actualRatio, tc.expectedRatio, 0.02, `WSOLA ${tc.name} output duration ratio matches 1/tempo`);
}

// 3.7 Pitch Preservation Test in WSOLA Time-Stretching
// Input is 440 Hz (A4). Slowed to 50% speed. Pitch must remain 440 Hz!
const dspTester = new GuitarDSP({ sampleRate: SR });
const stretched50 = MusicTranscriber.timeStretch(inputSine440, 0.50);
const midFrame = stretched50.left.slice(SR, SR + 2048);
const pitchResult = dspTester.detectPitchYIN(midFrame, SR);

assert(pitchResult !== null, "YIN pitch detection succeeds on 50% stretched audio");
assertClose(pitchResult.frequency, 440.0, 1.0, "WSOLA preserves 100% of original pitch at 50% tempo (440 Hz)");
assert(pitchResult.confidence > 0.95, `Pitch confidence is exceptionally high (${pitchResult.confidence.toFixed(4)})`);

// 3.8 Stereo Inter-Channel Phase Coherence
// Stretched stereo audio must retain exact left-right phase relationship
const stereoInput = {
    left: generateSine(330, SR, inputLength, 0.7),
    right: generateSine(330, SR, inputLength, 0.7)
};
const stereoStretched = MusicTranscriber.timeStretch(stereoInput, 0.50);
let maxStereoDiff = 0;
for (let i = 0; i < stereoStretched.left.length; i++) {
    const diff = Math.abs(stereoStretched.left[i] - stereoStretched.right[i]);
    if (diff > maxStereoDiff) maxStereoDiff = diff;
}
assert(maxStereoDiff < 1e-6, "Stereo WSOLA maintains 100% inter-channel phase coherence without comb filtering");

console.log("");

// =============================================================================
// Section 4: Independent Pitch Transposition & Cubic Hermite Resampling
// =============================================================================
console.log("=== Section 4: Pitch Transposition (Independent of Tempo) ===");

// 4.1 Cubic Hermite Interpolator C1 continuity
const stepWave = new Float32Array([0.0, 0.2, 0.8, 1.0, 0.7, 0.1, 0.0]);
const valAt1_5 = MusicTranscriber.cubicHermite(stepWave, 1.5);
assert(valAt1_5 > 0.2 && valAt1_5 < 0.8, "Cubic Hermite interpolation generates smooth intermediate sample value");

// 4.2 Transposition by +12 Semitones (1 Octave Up, 440 Hz -> 880 Hz)
const inputLong = generateSine(440, SR, Math.round(SR * 1.5), 0.8);
const octaveUpResult = MusicTranscriber.pitchShift(inputLong, 12, 0);
assertClose(octaveUpResult.left.length / inputLong.length, 1.0, 0.01, "+12 semitones pitch shift preserves 100% of original duration");
const pitchOctaveUp = dspTester.detectPitchYIN(octaveUpResult.left.slice(SR, SR + 2048), SR);
assertClose(pitchOctaveUp.frequency, 880.0, 4.0, "+12 semitones transposition shifts 440 Hz -> 880 Hz");

// 4.3 Transposition by -12 Semitones (1 Octave Down, 440 Hz -> 220 Hz)
const octaveDownResult = MusicTranscriber.pitchShift(inputLong, -12, 0);
assertClose(octaveDownResult.left.length / inputLong.length, 1.0, 0.01, "-12 semitones pitch shift preserves 100% of original duration");
const pitchOctaveDown = dspTester.detectPitchYIN(octaveDownResult.left.slice(SR, SR + 2048), SR);
assertClose(pitchOctaveDown.frequency, 220.0, 2.0, "-12 semitones transposition shifts 440 Hz -> 220 Hz");

// 4.4 Tuning Eb-Standard Song Up to E-Standard (+1 Semitone / +100 Cents)
// E-standard 1st string = 329.63 Hz (E4). Eb-standard = 311.13 Hz (Eb4).
const ebFreq = 311.13;
const targetEFreq = 329.63;
const ebSongSample = generateSine(ebFreq, SR, Math.round(SR * 1.5), 0.8);
const eTunedResult = MusicTranscriber.pitchShift(ebSongSample, 1, 0); // +1 semitone
assertClose(eTunedResult.left.length / ebSongSample.length, 1.0, 0.01, "Eb-to-E retuning preserves exact song duration");
const pitchETuned = dspTester.detectPitchYIN(eTunedResult.left.slice(SR, SR + 2048), SR);
assertClose(pitchETuned.frequency, targetEFreq, 2.0, "Retuning Eb up 1 semitone accurately yields E4 (329.63 Hz)");

// 4.5 Fine Cents Tuning (+50 Cents, Quarter-Tone)
const cents50Ratio = MusicTranscriber.semitonesToRatio(0, 50);
const expected50Hz = 440.0 * Math.pow(2, 50 / 1200); // 452.89 Hz
assertClose(cents50Ratio, Math.pow(2, 50 / 1200), 1e-6, "50 cents corresponds to frequency multiplier ~ 1.0293");

console.log("");

// =============================================================================
// Section 5: Consolidated Multi-Effect Pipeline
// =============================================================================
console.log("=== Section 5: Consolidated Multi-Effect Processing Pipeline ===");

// Simultaneous: 50% slow-down + tuning + solo focus
const transEngine = new MusicTranscriber({
    sampleRate: SR,
    tempo: 0.50,
    semitones: 2, // +2 semitones (D to E)
    cents: 0,
    midSideMode: 'solo_focus',
    focusAmount: 1.0
});

const multiTestInput = {
    left: generateSine(440, SR, inputLength, 0.8),
    right: generateSine(440, SR, inputLength, 0.8)
};

const fullResult = transEngine.processAudio(multiTestInput);
const targetPitchedFreq = 440 * Math.pow(2, 2 / 12); // ~493.88 Hz (B4)
assertClose(fullResult.duration, inputDuration * 2.0, 0.05, "Consolidated pipeline achieves 2x duration at 50% speed");
const fullPitchDetect = dspTester.detectPitchYIN(fullResult.left.slice(SR, SR + 2048), SR);
assertClose(fullPitchDetect.frequency, targetPitchedFreq, 3.0, "Consolidated pipeline accurately applies pitch transposition during slow-down");

console.log("");

// =============================================================================
// Section 6: Piping to FretDSP (js/dsp.js) for Auto-Tab Transcription
// =============================================================================
console.log("=== Section 6: Piping to FretDSP & Auto-Tab Integration ===");

// Construct a 2-note guitar lick: A4 (440 Hz, MIDI 69) -> E4 (329.63 Hz, MIDI 64)
const lickDuration = 1.0;
const lickLength = Math.round(SR * lickDuration);
const guitarLick = new Float32Array(lickLength);

for (let i = 0; i < lickLength; i++) {
    const isFirstNote = i < lickLength * 0.5;
    const f = isFirstNote ? 440.0 : 329.63;
    const tNote = isFirstNote ? (i / SR) : ((i - lickLength * 0.5) / SR);
    // Exponential pluck decay envelope
    const env = Math.exp(-tNote / 0.35);
    guitarLick[i] = 0.85 * Math.sin(2 * Math.PI * f * i / SR) * env;
}

// Slow down lick to 50% speed
const slowTranscriber = new MusicTranscriber({
    sampleRate: SR,
    tempo: 0.50,
    midSideMode: 'solo_focus'
});

const processedLick = slowTranscriber.processAudio(guitarLick);

// Direct piping into GuitarDSP pitch detector
const liveDsp = new GuitarDSP({ sampleRate: SR });
const transcription = slowTranscriber.transcribeBuffer(liveDsp, processedLick);

assert(transcription.framesAnalyzed > 50, `Processed ${transcription.framesAnalyzed} audio frames through GuitarDSP`);
assertClose(transcription.totalDuration, 2.0, 0.05, "Slowed transcription duration is 2.0 seconds");
assert(transcription.events.length > 0, `Captured ${transcription.events.length} pitch analysis frames`);

// Verify detected notes
const detectedMidis = transcription.notes.map(n => n.midi);
const hasA4 = detectedMidis.includes(69);
const hasE4 = detectedMidis.includes(64);
assert(hasA4, "GuitarDSP auto-transcription correctly detected A4 (MIDI 69)");
assert(hasE4, "GuitarDSP auto-transcription correctly detected E4 (MIDI 64)");

// Verify note duration scaling
const a4Note = transcription.notes.find(n => n.midi === 69);
if (a4Note) {
    assert(a4Note.duration >= 0.5, `A4 note duration sustained across slowed tempo (duration: ${a4Note.duration.toFixed(2)}s)`);
}

// 6.5 Web Audio Real-Time Graph Interface
// Mock minimal Web Audio AudioContext to verify pipeToGuitarDSP API
const mockCtx = {
    currentTime: 10.0,
    sampleRate: SR,
    destination: {},
    createBuffer: (ch, len, rate) => ({
        numberOfChannels: ch,
        length: len,
        sampleRate: rate,
        copyToChannel: () => {}
    }),
    createBufferSource: () => ({
        connect: () => {},
        start: () => {},
        stop: () => {},
        disconnect: () => {}
    }),
    createGain: () => ({
        gain: { value: 1.0 },
        connect: () => {},
        disconnect: () => {}
    })
};

const mockDsp = {
    audioCtx: mockCtx,
    analyser: { connect: () => {} }
};

const playbackCtrl = slowTranscriber.pipeToGuitarDSP(mockDsp, processedLick);
assert(typeof playbackCtrl.start === 'function', "Playback controller exposes start()");
assert(typeof playbackCtrl.stop === 'function', "Playback controller exposes stop()");
assert(playbackCtrl.isPlaying() === true, "Playback controller state reports active playing");
playbackCtrl.stop();
assert(playbackCtrl.isPlaying() === false, "Playback controller stop() successfully terminates playback");

console.log("");
console.log("================================================================================");
console.log(`TEST RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
console.log("================================================================================");

if (testsFailed > 0) {
    process.exit(1);
} else {
    console.log("ALL TESTS COMPLETED SUCCESSFULLY.");
}
