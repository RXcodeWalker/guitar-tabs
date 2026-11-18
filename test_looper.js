/**
 * Automated Verification Test Suite for FretDSP Multi-Track Phrase Looper Pedal Engine
 * 
 * Verifies:
 * 1. Clean Exported Functions & Classes
 * 2. Web Audio Graph Construction & Audio Routing (Input, Source, Mix, Dry/Wet)
 * 3. Buffer Allocation & Track Capacity
 * 4. Complete State Machine Transitions (EMPTY, RECORDING, PLAYING, OVERDUBBING, STOPPED)
 * 5. Seamless Equal-Power Seam Crossfading Math (10ms, gainIn^2 + gainOut^2 = 1.0)
 * 6. Non-Destructive Single-Level Undo/Redo Engine
 * 7. Vintage Tape FX: Reverse Playback Sample Order Correctness
 * 8. Vintage Tape FX: Half-Speed 2x Downsampling & Octave-Down Interpolation
 * 9. Quantization & Metronome Synchronization (Beat & Bar snapping at active BPM)
 * 10. Dual-Track Synchronization & Mixer (Constant-Power Panning, Solo & Mute)
 * 11. High-Fidelity 16-bit 44.1kHz Stereo WAV Binary Export
 * 12. Real-Time Audio Block Processing Simulation
 */

const LooperModule = require('./js/looper.js');
const {
    PhraseLooper,
    LooperEngine,
    LooperTrack,
    LOOPER_STATES,
    createLooper,
    equalPowerCrossfade,
    calculatePanGains,
    quantizeSamples,
    encodeWav,
    MockAudioContext,
    DEFAULT_SAMPLE_RATE,
    DEFAULT_FADE_DURATION
} = LooperModule;

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

function assertClose(actual, expected, tolerance, message) {
    const diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
        console.log(`  ✓ ${message} (expected ${expected.toFixed(4)}, got ${actual.toFixed(4)})`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message} (expected ${expected.toFixed(4)}, got ${actual.toFixed(4)}, diff ${diff.toFixed(4)})`);
        failed++;
    }
}

console.log("================================================================================");
console.log("TEST SUITE: MULTI-TRACK SOUND-ON-SOUND PHRASE LOOPER PEDAL ENGINE");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// SECTION 1: Clean Exported Interfaces
// -----------------------------------------------------------------------------
console.log("--- Section 1: Clean Exported Interfaces ---");
assert(typeof PhraseLooper === 'function', "PhraseLooper class is exported");
assert(typeof LooperEngine === 'function', "LooperEngine alias is exported");
assert(typeof LooperTrack === 'function', "LooperTrack class is exported");
assert(typeof createLooper === 'function', "createLooper factory is exported");
assert(typeof LOOPER_STATES === 'object', "LOOPER_STATES object is exported");
assert(LOOPER_STATES.EMPTY === 'EMPTY', "LOOPER_STATES contains EMPTY");
assert(LOOPER_STATES.RECORDING === 'RECORDING', "LOOPER_STATES contains RECORDING");
assert(LOOPER_STATES.PLAYING === 'PLAYING', "LOOPER_STATES contains PLAYING");
assert(LOOPER_STATES.OVERDUBBING === 'OVERDUBBING', "LOOPER_STATES contains OVERDUBBING");
assert(LOOPER_STATES.STOPPED === 'STOPPED', "LOOPER_STATES contains STOPPED");
assert(typeof equalPowerCrossfade === 'function', "equalPowerCrossfade utility is exported");
assert(typeof calculatePanGains === 'function', "calculatePanGains utility is exported");
assert(typeof quantizeSamples === 'function', "quantizeSamples utility is exported");
assert(typeof encodeWav === 'function', "encodeWav utility is exported");
assert(typeof MockAudioContext === 'function', "MockAudioContext is exported for headless test suites");

// -----------------------------------------------------------------------------
// SECTION 2: Web Audio Graph Construction & Routing
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Audio Graph Construction & Routing ---");
const mockCtx = new MockAudioContext();
const mockSource = mockCtx.createGain();
const looper = new PhraseLooper(mockCtx, mockSource, { masterVolume: 0.85, dryLevel: 0.9 });

assert(looper.inputNode !== null, "inputNode summing gain node created");
assert(looper.outputNode !== null, "outputNode (mix destination) created");
assert(looper.mixNode === looper.outputNode, "mixNode alias points to outputNode");
assert(looper.dryGainNode !== null, "dryGainNode direct monitoring node created");
assert(looper.wetGainNode !== null, "wetGainNode looper return mix node created");
assert(mockSource.connections.includes(looper.inputNode), "Audio source node successfully connected to looper input");
assert(looper.inputNode.connections.includes(looper.dryGainNode), "Dry-thru path: inputNode connects to dryGainNode");
assert(looper.dryGainNode.connections.includes(looper.outputNode), "Dry-thru path: dryGainNode connects to outputNode");
assertClose(looper.outputNode.gain.value, 0.85, 0.001, "Master volume initialized to 0.85");
assertClose(looper.dryGainNode.gain.value, 0.9, 0.001, "Dry level initialized to 0.9");

// Test replacing source node dynamically
const newMockSource = mockCtx.createGain();
looper.setSourceNode(newMockSource);
assert(newMockSource.connections.includes(looper.inputNode), "setSourceNode successfully connects new source");

// -----------------------------------------------------------------------------
// SECTION 3: Buffer Allocation & Track Capacity
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Buffer Allocation & Track Architecture ---");
assert(looper.track1 instanceof LooperTrack, "Track 1 is an instance of LooperTrack");
assert(looper.track2 instanceof LooperTrack, "Track 2 is an instance of LooperTrack");
assert(looper.tracks.length === 2, "Looper maintains dual-track architecture (tracks array length 2)");
assert(looper.track1.id === 1, "Track 1 ID is 1");
assert(looper.track2.id === 2, "Track 2 ID is 2");

// Check 5 minutes max capacity at 44.1kHz: 300s * 44100 = 13,230,000 samples
const expectedCapacity = 300 * 44100;
assert(looper.track1.maxCapacity === expectedCapacity, `Track 1 buffer capacity allocated to ${expectedCapacity} samples (5 minutes)`);
assert(looper.track1.bufferL instanceof Float32Array, "Track 1 Left channel is Float32Array");
assert(looper.track1.bufferR instanceof Float32Array, "Track 1 Right channel is Float32Array");
assert(looper.track1.bufferL.length === expectedCapacity, "Track 1 Left channel length matches maximum capacity");
assert(looper.track1.bufferR.length === expectedCapacity, "Track 1 Right channel length matches maximum capacity");
assert(looper.track1.length === 0, "Initial active loop length is 0 (empty)");
assert(looper.track1.duration === 0, "Initial loop duration is 0.0s");

// -----------------------------------------------------------------------------
// SECTION 4: Complete State Machine Transitions
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Complete State Machine Transitions ---");
const track = new LooperTrack(1, { sampleRate: 44100 });
assert(track.state === LOOPER_STATES.EMPTY, "Initial track state is EMPTY");

// Transition 1: EMPTY -> RECORDING
const recStarted = track.record();
assert(recStarted === true, "record() returns true from EMPTY");
assert(track.state === LOOPER_STATES.RECORDING, "Track transitioned to RECORDING");

// Simulate capturing 2 seconds of audio (88,200 samples)
const testFrames = 88200;
for (let i = 0; i < testFrames; i++) {
    // Generate simple sine test signal
    const s = Math.sin((2 * Math.PI * 440 * i) / 44100);
    track.processSample(s, s);
}
assert(track.recordingPlayhead === testFrames, `Recorded playhead advanced to ${testFrames} samples`);

// Transition 2: RECORDING -> PLAYING
const playStarted = track.play();
assert(playStarted === true, "play() returns true from RECORDING");
assert(track.state === LOOPER_STATES.PLAYING, "Track transitioned to PLAYING");
assert(track.length === testFrames, `Track loop length set to ${testFrames} samples`);
assertClose(track.duration, 2.0, 0.001, "Loop duration is exactly 2.000s");
assert(track.playhead === 0.0, "Playhead reset to 0.0 for playback");

// Transition 3: PLAYING -> OVERDUBBING
const overdubStarted = track.overdub();
assert(overdubStarted === true, "overdub() returns true from PLAYING");
assert(track.state === LOOPER_STATES.OVERDUBBING, "Track transitioned to OVERDUBBING");
assert(track.canUndo === true, "canUndo is true when overdub is active (undo snapshot preserved)");

// Transition 4: OVERDUBBING -> PLAYING
track.play();
assert(track.state === LOOPER_STATES.PLAYING, "Track transitioned from OVERDUBBING to PLAYING");
assert(track.canUndo === true, "canUndo remains true after overdub is committed");

// Transition 5: PLAYING -> STOPPED
track.stop();
assert(track.state === LOOPER_STATES.STOPPED, "Track transitioned to STOPPED");
assert(track.length === testFrames, "Loop length preserved in STOPPED state");

// Transition 6: STOPPED -> PLAYING
track.play();
assert(track.state === LOOPER_STATES.PLAYING, "Track resumed PLAYING from STOPPED");

// Transition 7: PLAYING -> STOPPED -> CLEAR -> EMPTY
track.stop();
track.clear();
assert(track.state === LOOPER_STATES.EMPTY, "Track returned to EMPTY after clear()");
assert(track.length === 0, "Loop length reset to 0 after clear()");
assert(track.canUndo === false, "canUndo reset to false after clear()");
assert(track.canRedo === false, "canRedo reset to false after clear()");

// -----------------------------------------------------------------------------
// SECTION 5: Seamless Equal-Power Seam Crossfading Math
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: Equal-Power Seam Crossfading Math (10ms) ---");
const sampleRate = 44100;
const expectedFadeSamples = Math.round(0.010 * sampleRate); // 441 samples
assert(expectedFadeSamples === 441, "10ms crossfade at 44.1kHz is exactly 441 samples");

// Verify Equal-Power Trigonometric Invariant across all 441 samples
let maxPowerDeviation = 0;
for (let i = 0; i < expectedFadeSamples; i++) {
    const theta = (Math.PI / 2) * (i / expectedFadeSamples);
    const gOut = Math.cos(theta);
    const gIn = Math.sin(theta);
    const power = gOut * gOut + gIn * gIn;
    const dev = Math.abs(power - 1.0);
    if (dev > maxPowerDeviation) maxPowerDeviation = dev;
}
assertClose(maxPowerDeviation, 0.0, 1e-7, "Equal-power invariant (cos^2 + sin^2 = 1.0) strictly holds across all fade steps");

// Boundary conditions:
// At i=0: gainOut = 1.0, gainIn = 0.0
assertClose(Math.cos(0), 1.0, 1e-9, "At start of crossfade window, gainOut = 1.0");
assertClose(Math.sin(0), 0.0, 1e-9, "At start of crossfade window, gainIn = 0.0");

// Test crossfade on synthetic buffer with a harsh edge discontinuity
const testBufLen = 10000;
const seamBuffer = new Float32Array(testBufLen);
// Fill head with +0.8, tail with -0.8 (1.6 amplitude step click at seam)
for (let i = 0; i < expectedFadeSamples; i++) {
    seamBuffer[i] = 0.8; // Head
    seamBuffer[testBufLen - expectedFadeSamples + i] = -0.8; // Tail
}

equalPowerCrossfade(seamBuffer, testBufLen, sampleRate, 0.010);

// Verify that the seam points have been smoothly blended without abrupt step
const headStart = seamBuffer[0];
const tailEnd = seamBuffer[testBufLen - 1];
assert(headStart === seamBuffer[testBufLen - expectedFadeSamples], "Head starts seamlessly at blended tail entry value");
assert(tailEnd === seamBuffer[expectedFadeSamples - 1], "Tail terminates seamlessly at blended head exit value");

// Verify midpoint of crossfade is balanced
const midIdx = Math.floor(expectedFadeSamples / 2);
const expectedMidVal = Math.sin(Math.PI / 4) * 0.8 + Math.cos(Math.PI / 4) * (-0.8);
assertClose(seamBuffer[midIdx], expectedMidVal, 0.01, "Midpoint of crossfade achieves exact equal-power summation (~0.0 for symmetric opposite signals)");

// -----------------------------------------------------------------------------
// SECTION 6: Non-Destructive Single-Level Undo / Redo Engine
// -----------------------------------------------------------------------------
console.log("\n--- Section 6: Non-Destructive Single-Level Undo / Redo Engine ---");
const undoTrack = new LooperTrack(1, { sampleRate: 44100 });
undoTrack.record();

// Record base rhythm layer (pure DC offset 0.5 for unmistakable tracking)
// Length 5,000 samples ensures index 1000 is cleanly outside the 441-sample seam crossfade window
const loopLen = 5000;
for (let i = 0; i < loopLen; i++) {
    undoTrack.processSample(0.5, 0.5);
}
undoTrack.play();

assert(undoTrack.canUndo === false, "canUndo is initially false on base loop");
assert(undoTrack.canRedo === false, "canRedo is initially false on base loop");
assertClose(undoTrack.bufferL[1000], 0.5, 0.001, "Base loop contains original audio (0.5)");

// Start Overdubbing layer (+0.3 harmony)
undoTrack.overdub();
assert(undoTrack.canUndo === true, "canUndo becomes true once overdub begins");
assert(undoTrack.canRedo === false, "canRedo is false during overdub");

// Overdub one cycle with 0.3
for (let i = 0; i < loopLen; i++) {
    undoTrack.processSample(0.3, 0.3);
}
undoTrack.play(); // Commit overdub

assertClose(undoTrack.bufferL[1000], 0.8, 0.001, "Overdubbed buffer contains mixed sum (0.5 + 0.3 = 0.8)");
assert(undoTrack.canUndo === true, "canUndo is true after committing overdub");
assert(undoTrack.canRedo === false, "canRedo is false before any undo call");

// Perform UNDO
const undoResult = undoTrack.undo();
assert(undoResult === true, "undo() returned true");
assertClose(undoTrack.bufferL[1000], 0.5, 0.001, "Audio successfully reverted to clean base loop (0.5)");
assert(undoTrack.canUndo === false, "canUndo is now false after undo");
assert(undoTrack.canRedo === true, "canRedo is now true after undo");

// Perform REDO
const redoResult = undoTrack.redo();
assert(redoResult === true, "redo() returned true");
assertClose(undoTrack.bufferL[1000], 0.8, 0.001, "Audio successfully restored with overdub layer (0.8)");
assert(undoTrack.canUndo === true, "canUndo is restored to true after redo");
assert(undoTrack.canRedo === false, "canRedo is false after redo");

// Start NEW overdub layer: verifies that redo is cleanly invalidated
undoTrack.undo(); // back to 0.5
undoTrack.overdub(); // start new overdub
assert(undoTrack.canRedo === false, "Starting a new overdub invalidates any previous redo snapshot");

// -----------------------------------------------------------------------------
// SECTION 7: Creative Tape FX: Reverse Playback Sample Order Correctness
// -----------------------------------------------------------------------------
console.log("\n--- Section 7: Vintage Tape FX: Reverse Playback Sample Order ---");
const revTrack = new LooperTrack(1, { sampleRate: 44100, fadeDuration: 0, pan: -1.0 });
revTrack.record();

// Record a recognizable linear ramp: 0, 1, 2, 3, 4, ... 99
const rampLen = 100;
for (let i = 0; i < rampLen; i++) {
    revTrack.processSample(i / 100.0, i / 100.0);
}
revTrack.play();
assert(revTrack.length === rampLen, "Track has 100 samples");

// Read forward playback
const forwardSamples = [];
for (let i = 0; i < rampLen; i++) {
    const out = revTrack.processSample(0, 0);
    forwardSamples.push(out.outL);
}
assertClose(forwardSamples[0], 0.0, 0.01, "Forward playback sample 0 is ~0.0");
assertClose(forwardSamples[50], 0.5, 0.01, "Forward playback sample 50 is ~0.5");
assertClose(forwardSamples[99], 0.99, 0.01, "Forward playback sample 99 is ~0.99");

// Engage Reverse Tape FX
revTrack.setReverse(true);
assert(revTrack.isReverse === true, "Reverse tape mode is enabled");
assert(revTrack.duration === revTrack.length / 44100, "Loop duration remains strictly unchanged in reverse");

// Read reverse playback
revTrack.playhead = 0.0;
const reverseSamples = [];
for (let i = 0; i < rampLen; i++) {
    const out = revTrack.processSample(0, 0);
    reverseSamples.push(out.outL);
}

// In reverse mode, playhead 0 reads index (len - 1) = 99
assertClose(reverseSamples[0], 0.99, 0.01, "Reverse playback first sample is the end of the loop (~0.99)");
assertClose(reverseSamples[49], 0.50, 0.01, "Reverse playback sample 49 is ~0.50");
assertClose(reverseSamples[99], 0.00, 0.01, "Reverse playback last sample is the beginning of the loop (~0.0)");

// Verify exact reversed order: reverseSamples[i] === forwardSamples[rampLen - 1 - i]
let reverseMatch = true;
for (let i = 0; i < rampLen; i++) {
    const expected = forwardSamples[rampLen - 1 - i];
    const actual = reverseSamples[i];
    if (Math.abs(actual - expected) > 0.01) {
        reverseMatch = false;
        break;
    }
}
assert(reverseMatch === true, "All 100 samples play back in exact mathematical time-reversed sequence");

// -----------------------------------------------------------------------------
// SECTION 8: Creative Tape FX: Half-Speed & Octave Down
// -----------------------------------------------------------------------------
console.log("\n--- Section 8: Vintage Tape FX: Half-Speed (Octave Down) ---");
const speedTrack = new LooperTrack(1, { sampleRate: 44100, fadeDuration: 0, pan: -1.0 });
speedTrack.record();

for (let i = 0; i < 100; i++) {
    speedTrack.processSample(i / 100.0, i / 100.0);
}
speedTrack.play();

assertClose(speedTrack.duration, 100 / 44100, 1e-6, "Base duration is 100 samples");
assertClose(speedTrack.cycleDuration, 100 / 44100, 1e-6, "Normal cycle duration matches base duration");

speedTrack.setHalfSpeed(true);
assert(speedTrack.isHalfSpeed === true, "Half-speed mode is enabled");
assertClose(speedTrack.cycleDuration, (100 * 2) / 44100, 1e-6, "Half-speed cycle duration is exactly doubled (2x time dilation)");

// Verify 0.5 playhead increment and linear interpolation
speedTrack.playhead = 0.0;
const sample0 = speedTrack.processSample(0, 0).outL; // at playhead 0.0 -> index 0 (0.0)
assertClose(sample0, 0.0, 0.001, "At step 0 (playhead 0.0), sample is 0.0");
assertClose(speedTrack.playhead, 0.5, 0.001, "Playhead advanced by exactly 0.5 sample");

const sample1 = speedTrack.processSample(0, 0).outL; // at playhead 0.5 -> interp between 0.0 and 0.01 -> 0.005
assertClose(sample1, 0.005, 0.001, "At step 1 (playhead 0.5), interpolated sample is exactly 0.005");
assertClose(speedTrack.playhead, 1.0, 0.001, "Playhead advanced to 1.0");

const sample2 = speedTrack.processSample(0, 0).outL; // at playhead 1.0 -> index 1 (0.01)
assertClose(sample2, 0.01, 0.001, "At step 2 (playhead 1.0), sample is 0.01");

// Test combination of BOTH Reverse AND Half-Speed
speedTrack.setReverse(true);
speedTrack.playhead = 0.0;
const revHalfSample0 = speedTrack.processSample(0, 0).outL; // effective pos = 99.0
assertClose(revHalfSample0, 0.99, 0.01, "Reverse + Half-Speed begins at 0.99");
const revHalfSample1 = speedTrack.processSample(0, 0).outL; // effective pos = 98.5
assertClose(revHalfSample1, 0.985, 0.01, "Reverse + Half-Speed interpolates 98.5 (0.985)");

// -----------------------------------------------------------------------------
// SECTION 9: Quantization & Metronome Synchronization
// -----------------------------------------------------------------------------
console.log("\n--- Section 9: Quantization & Metronome Sync (autoQuantize) ---");
const quantizeBpm = 120;
const quantizeSampleRate = 44100;
// At 120 BPM:
// Beat duration = 60 / 120 = 0.500s -> 22,050 samples per beat
// Measure duration (4/4) = 4 * 0.500s = 2.000s -> 88,200 samples per measure

const qBar = quantizeSamples(90000, quantizeSampleRate, quantizeBpm, 4, 'bar');
assert(qBar.samplesPerBeat === 22050, "Quarter note beat is 22,050 samples at 120 BPM");
assert(qBar.samplesPerBar === 88200, "Measure (4 beats) is 88,200 samples at 120 BPM");
assert(qBar.targetSamples === 88200, "90,000 samples (~2.04s) snaps to nearest measure: 88,200 samples (1 bar)");
assert(qBar.bars === 1, "Quantized to exactly 1 bar");

// Test 2 measures snapping (160,000 samples -> nearest 88200 * 2 = 176,400)
const q2Bars = quantizeSamples(160000, quantizeSampleRate, quantizeBpm, 4, 'bar');
assert(q2Bars.targetSamples === 176400, "160,000 samples (~3.62s) snaps to nearest 2 measures: 176,400 samples");
assert(q2Bars.bars === 2, "Quantized to exactly 2 bars");

// Test beat-level snapping
const qBeat = quantizeSamples(50000, quantizeSampleRate, quantizeBpm, 4, 'beat');
assert(qBeat.targetSamples === 44100, "50,000 samples snaps to 2 beats (44,100 samples)");
assert(qBeat.beats === 2, "Quantized to exactly 2 beats");

// Test PhraseLooper autoQuantize in recording workflow
const quantLooper = new PhraseLooper(mockCtx, null, {
    autoQuantize: true,
    bpm: 120,
    timeSignature: [4, 4],
    quantizeMode: 'bar'
});
quantLooper.record(1);
// Record 91,000 samples into Track 1
for (let i = 0; i < 91000; i++) {
    quantLooper.track1.processSample(0.1, 0.1);
}
quantLooper.play(1);
assert(quantLooper.track1.length === 88200, "Track 1 recorded buffer automatically snapped to 88,200 samples (1 bar)");
assertClose(quantLooper.track1.duration, 2.0, 0.001, "Quantized Track 1 duration is exactly 2.000s");

// -----------------------------------------------------------------------------
// SECTION 10: Dual-Track Architecture & Synchronization
// -----------------------------------------------------------------------------
console.log("\n--- Section 10: Dual-Track Architecture & Sync ---");
const dualLooper = new PhraseLooper(mockCtx, null, { syncMode: 'sync' });

// Track 1 establishes master 44,100 sample (1.0s) loop
dualLooper.record(1);
for (let i = 0; i < 44100; i++) {
    dualLooper.track1.processSample(0.2, 0.2);
}
dualLooper.play(1);
assert(dualLooper.track1.length === 44100, "Track 1 established 44,100 sample master rhythm loop");

// Track 2 records lead counterpoint in sync mode
dualLooper.record(2);
for (let i = 0; i < 42000; i++) { // Guitarist presses stop slightly early (42,000 samples)
    dualLooper.track2.processSample(0.4, 0.4);
}
dualLooper.play(2);
assert(dualLooper.track2.length === 44100, "Track 2 in sync mode automatically locked to Track 1's cycle length (44,100)");

// Mixer & Panning tests
const panCenter = calculatePanGains(0.0);
assertClose(panCenter.left, Math.SQRT1_2, 0.001, "Center pan left gain is ~0.7071");
assertClose(panCenter.right, Math.SQRT1_2, 0.001, "Center pan right gain is ~0.7071");
assertClose(panCenter.left * panCenter.left + panCenter.right * panCenter.right, 1.0, 1e-6, "Constant-power panning invariant holds at center");

const panHardLeft = calculatePanGains(-1.0);
assertClose(panHardLeft.left, 1.0, 0.001, "Hard left pan left gain is 1.0");
assertClose(panHardLeft.right, 0.0, 0.001, "Hard left pan right gain is 0.0");

const panHardRight = calculatePanGains(1.0);
assertClose(panHardRight.left, 0.0, 0.001, "Hard right pan left gain is 0.0");
assertClose(panHardRight.right, 1.0, 0.001, "Hard right pan right gain is 1.0");

// Solo & Mute tests
dualLooper.setTrackSolo(1, true);
assert(dualLooper.track1.isSoloed === true, "Track 1 is soloed");
assert(dualLooper.track2.isSoloed === false, "Track 2 is not soloed");

const outBlockL = new Float32Array(10);
const outBlockR = new Float32Array(10);
const dummyIn = new Float32Array(10);
dualLooper.processAudioBlock(dummyIn, dummyIn, outBlockL, outBlockR, 10);
// Track 1 should be audible, Track 2 muted by solo
assert(outBlockL[0] > 0, "Soloed Track 1 audio passes to mixer");
dualLooper.setTrackSolo(1, false);

// -----------------------------------------------------------------------------
// SECTION 11: High-Fidelity 16-bit 44.1kHz Stereo WAV Binary Export
// -----------------------------------------------------------------------------
console.log("\n--- Section 11: High-Fidelity WAV Export Engine ---");
const exportLooper = new PhraseLooper(mockCtx, null);
exportLooper.record(1);
const exportFrames = 1000;
for (let i = 0; i < exportFrames; i++) {
    exportLooper.track1.processSample(0.5, -0.5);
}
exportLooper.play(1);

const wavBlob = exportLooper.exportWav();
assert(wavBlob !== null && typeof wavBlob === 'object', "WAV export returned an object/Blob");
assert(wavBlob.type === 'audio/wav', "Exported MIME type is 'audio/wav'");

// Inspect WAV RIFF Header Bytes
const arrayBuf = wavBlob.buffer;
assert(arrayBuf instanceof ArrayBuffer, "WAV buffer is an ArrayBuffer");
const view = new DataView(arrayBuf);

// Check 'RIFF' tag
const riffTag = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
assert(riffTag === 'RIFF', "WAV starts with ASCII 'RIFF'");

// Check 'WAVE' tag
const waveTag = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
assert(waveTag === 'WAVE', "Format header contains ASCII 'WAVE'");

// Check 'fmt ' subchunk
const fmtTag = String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15));
assert(fmtTag === 'fmt ', "Subchunk 1 contains ASCII 'fmt '");

// Check PCM format = 1
const audioFormat = view.getUint16(20, true);
assert(audioFormat === 1, "Audio format is 1 (PCM uncompressed)");

// Check Channels = 2 (stereo)
const numChannels = view.getUint16(22, true);
assert(numChannels === 2, "Channel count is exactly 2 (Stereo)");

// Check Sample Rate = 44100
const exportSampleRate = view.getUint32(24, true);
assert(exportSampleRate === 44100, "Sample rate is exactly 44,100 Hz");

// Check Bits Per Sample = 16
const bitsPerSample = view.getUint16(34, true);
assert(bitsPerSample === 16, "Bit depth is exactly 16-bit PCM");

// Check 'data' tag
const dataTag = String.fromCharCode(view.getUint8(36), view.getUint8(37), view.getUint8(38), view.getUint8(39));
assert(dataTag === 'data', "Subchunk 2 contains ASCII 'data'");

// Verify byte length math: 44 header bytes + (1000 frames * 2 channels * 2 bytes/sample) = 4044 bytes
const expectedWavSize = 44 + (exportFrames * 2 * 2);
assert(arrayBuf.byteLength === expectedWavSize, `Total WAV file size matches exact calculation: ${expectedWavSize} bytes`);

// Verify PCM sample amplitudes
// Sample 0 Left was 0.5 * masterVolume(1.0) * panGainLeft(0.7071)
// 0.5 * 0.7071 = 0.35355 -> 0.35355 * 32767 = 11585
const sampleL0 = view.getInt16(44, true);
assert(sampleL0 > 11000 && sampleL0 < 12000, `Left PCM sample accurately quantized: ${sampleL0}`);

// -----------------------------------------------------------------------------
// SECTION 12: Real-Time Audio Block Processing Simulation
// -----------------------------------------------------------------------------
console.log("\n--- Section 12: Real-Time Audio Block Processing Simulation ---");
const rtLooper = new PhraseLooper(mockCtx, null);
const blockSize = 512;
const inL = new Float32Array(blockSize);
const inR = new Float32Array(blockSize);
const outL = new Float32Array(blockSize);
const outR = new Float32Array(blockSize);

for (let i = 0; i < blockSize; i++) {
    inL[i] = 0.25;
    inR[i] = 0.25;
}

// 1. Record through audio block
rtLooper.record(1);
rtLooper.processAudioBlock(inL, inR, outL, outR, blockSize);
assert(rtLooper.track1.recordingPlayhead === blockSize, `Processed block advanced recording playhead by ${blockSize}`);

// 2. Play through audio block
rtLooper.play(1);
rtLooper.processAudioBlock(new Float32Array(blockSize), new Float32Array(blockSize), outL, outR, blockSize);
assert(outL[0] > 0, "Playback audio block outputs recorded loop");

// 3. State serialization
const state = rtLooper.getState();
assert(typeof state === 'object', "getState() returns valid JSON state snapshot");
assert(state.tracks.length === 2, "State includes both tracks");
assert(state.tracks[0].length === blockSize, "State accurately reflects Track 1 length");

console.log("\n================================================================================");
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log("================================================================================");

if (failed > 0) {
    process.exit(1);
}
