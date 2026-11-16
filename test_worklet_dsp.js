/**
 * Automated Unit Test Suite for FretDSP AudioWorklet Migration
 * File: test_worklet_dsp.js
 * 
 * Verifies:
 * 1. PitchProcessor Worklet Lifecycle, Options & Circular Buffer Sizing (2048 & 4096)
 * 2. Rate Limiting & Message Timing (~60 Hz posting frequency)
 * 3. Message Contracts (payload schema, silence/noise gate, active pitch)
 * 4. Mathematical Frequency Resolution (sub-sample parabolic interpolation across guitar register)
 * 5. Parabolic Waveform Zero-Crossing Pitch Estimation
 * 6. GuitarDSP Main Thread Integration, Callback Piping & Graceful Fallback
 */

const PitchProcessor = require('./js/pitch-processor.worklet.js');
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

/**
 * Helper to synthesize pure sinusoidal audio buffer.
 */
function generateSineWave(freq, sampleRate, length, amplitude = 0.6) {
    const buffer = new Float32Array(length);
    const omega = 2 * Math.PI * freq / sampleRate;
    for (let i = 0; i < length; i++) {
        buffer[i] = amplitude * Math.sin(omega * i);
    }
    return buffer;
}

console.log("================================================================================");
console.log("TEST SUITE: FRET-DSP AUDIOWORKLET PITCH PROCESSOR & DSP INTEGRATION");
console.log("================================================================================\n");

// =============================================================================
// Section 1: Worklet Lifecycle, Options & Circular Buffer Sizing
// =============================================================================
console.log("=== Section 1: Worklet Lifecycle, Options & Buffer Sizing ===");

// 1.1 Default 2048 buffer initialization
const worklet2048 = new PitchProcessor({
    processorOptions: {
        bufferSize: 2048,
        sampleRate: 44100
    }
});

assert(worklet2048.bufferSize === 2048, "Worklet instantiated with 2048 bufferSize");
assert(worklet2048.circularBuffer.length === 2048, "Circular buffer allocated with 2048 samples");
assert(worklet2048.analysisBuffer.length === 2048, "Linear analysis buffer allocated with 2048 samples");
assert(worklet2048.writeIndex === 0, "Initial writeIndex is 0");
assert(worklet2048.totalSamples === 0, "Initial totalSamples is 0");

// 1.2 4096 buffer initialization
const worklet4096 = new PitchProcessor({
    processorOptions: {
        bufferSize: 4096,
        sampleRate: 48000
    }
});

assert(worklet4096.bufferSize === 4096, "Worklet instantiated with 4096 bufferSize");
assert(worklet4096.circularBuffer.length === 4096, "Circular buffer allocated with 4096 samples");
assert(worklet4096.sampleRate === 48000, "Sample rate correctly set to 48000 Hz");

// 1.3 Circular buffer writing and modulo wrap-around
const testChunk = new Float32Array(128);
for (let i = 0; i < 128; i++) testChunk[i] = i + 1;

// Write 1 chunk of 128
worklet2048.process([[testChunk]], [], {});
assert(worklet2048.writeIndex === 128, "writeIndex advanced to 128 after one quantum");
assert(worklet2048.totalSamples === 128, "totalSamples is 128");

// Write 15 more chunks (16 * 128 = 2048 samples total)
for (let c = 0; c < 15; c++) {
    worklet2048.process([[testChunk]], [], {});
}
assert(worklet2048.writeIndex === 0, "writeIndex cleanly wrapped to 0 after exactly 2048 samples");
assert(worklet2048.totalSamples === 2048, "totalSamples is 2048");

// Write 4 more chunks (512 samples past boundary)
for (let c = 0; c < 4; c++) {
    worklet2048.process([[testChunk]], [], {});
}
assert(worklet2048.writeIndex === 512, "writeIndex is 512 after 2560 samples (2560 % 2048 = 512)");
assert(worklet2048.totalSamples === 2560, "totalSamples is 2560");

// 1.4 Unrolling circular buffer maintains chronological continuity
const rampWorklet = new PitchProcessor({
    processorOptions: { bufferSize: 2048, sampleRate: 44100 }
});
// Fill with sequential ramp 0..2559 across multiple chunks
let seqVal = 1;
for (let chunk = 0; chunk < 20; chunk++) {
    const rampChunk = new Float32Array(128);
    for (let i = 0; i < 128; i++) {
        rampChunk[i] = seqVal++;
    }
    rampWorklet.process([[rampChunk]], [], {});
}
const unrolled = rampWorklet.unrollBuffer();
assert(unrolled.length === 2048, "Unrolled buffer length is 2048");
assert(unrolled[0] === seqVal - 2048, `Unrolled buffer starts with oldest sample (${seqVal - 2048})`);
assert(unrolled[2047] === seqVal - 1, `Unrolled buffer ends with newest sample (${seqVal - 1})`);

let isMonotonic = true;
for (let i = 1; i < 2048; i++) {
    if (unrolled[i] !== unrolled[i - 1] + 1) {
        isMonotonic = false;
        break;
    }
}
assert(isMonotonic, "Unrolled circular buffer preserves perfect chronological continuity without seams");

// 1.5 Reset functionality
rampWorklet.reset();
assert(rampWorklet.writeIndex === 0, "reset() clears writeIndex to 0");
assert(rampWorklet.totalSamples === 0, "reset() clears totalSamples to 0");
assert(rampWorklet.circularBuffer[0] === 0, "reset() zeroes out circular buffer");


// =============================================================================
// Section 2: Rate Limiting & Message Timing (~60 Hz)
// =============================================================================
console.log("\n=== Section 2: Rate Limiting & Message Timing (~60 Hz) ===");

const timingWorklet44k = new PitchProcessor({
    processorOptions: { sampleRate: 44100, bufferSize: 2048 }
});
assert(timingWorklet44k.hopSize === 735, "Hop size for 44100 Hz at 60 Hz target is exactly 735 samples");

const timingWorklet48k = new PitchProcessor({
    processorOptions: { sampleRate: 48000, bufferSize: 2048 }
});
assert(timingWorklet48k.hopSize === 800, "Hop size for 48000 Hz at 60 Hz target is exactly 800 samples");

// Simulate 1 second of audio at 44.1 kHz (44,100 samples)
let postedMessages = [];
timingWorklet44k.port._onmessage = (event) => {
    postedMessages.push(event.data);
};

const sine440 = generateSineWave(440, 44100, 128);
const totalQuanta1s = Math.floor(44100 / 128); // 344 quanta = 44032 samples
for (let q = 0; q < totalQuanta1s; q++) {
    timingWorklet44k.process([[sine440]], [], {});
}
// Finish remaining 68 samples to make exactly 44100 samples
const remainderChunk = new Float32Array(68);
for (let i = 0; i < 68; i++) remainderChunk[i] = sine440[i];
timingWorklet44k.process([[remainderChunk]], [], {});

assert(timingWorklet44k.totalSamples === 44100, "Processed exactly 44100 audio samples (1.00s)");
assert(postedMessages.length === 60, `Exactly 60 messages posted in 1.0 second (got ${postedMessages.length})`);

// Process a second second of audio (total 2.0s = 88200 samples)
for (let q = 0; q < totalQuanta1s; q++) {
    timingWorklet44k.process([[sine440]], [], {});
}
timingWorklet44k.process([[remainderChunk]], [], {});

assert(timingWorklet44k.totalSamples === 88200, "Processed exactly 88200 audio samples (2.00s)");
assert(postedMessages.length === 120, `Exactly 120 messages posted in 2.0 seconds (got ${postedMessages.length}, perfect 60.0 Hz)`);


// =============================================================================
// Section 3: Message Contract Verification
// =============================================================================
console.log("\n=== Section 3: Message Contract Verification ===");

const testMsg = postedMessages[postedMessages.length - 1];
assert(testMsg.type === 'pitch', "Message contains type: 'pitch'");
assert(typeof testMsg.f0 === 'number', `Message contains numeric f0: ${testMsg.f0.toFixed(2)} Hz`);
assert(typeof testMsg.frequency === 'number', `Message contains numeric frequency matching f0`);
assert(Math.abs(testMsg.f0 - testMsg.frequency) < 1e-9, "f0 and frequency fields are identical");
assert(typeof testMsg.rms === 'number' && testMsg.rms > 0, `Message contains positive RMS: ${testMsg.rms.toFixed(4)}`);
assert(typeof testMsg.peakSample === 'number' && testMsg.peakSample > 0, `Message contains peakSample: ${testMsg.peakSample.toFixed(4)}`);
assert(typeof testMsg.confidence === 'number' && testMsg.confidence >= 0 && testMsg.confidence <= 1, `Message contains confidence in [0, 1]: ${testMsg.confidence.toFixed(3)}`);
assert(typeof testMsg.isSilence === 'boolean' && testMsg.isSilence === false, "Active signal marked isSilence === false");
assert(typeof testMsg.time === 'number' && testMsg.time >= 0, `Message contains timestamp: ${testMsg.time.toFixed(3)}s`);

// Silence / Noise Gate message contract
const silenceWorklet = new PitchProcessor({
    processorOptions: { sampleRate: 44100, bufferSize: 2048, noiseGate: 0.008 }
});
let silenceMessages = [];
silenceWorklet.port._onmessage = (event) => {
    silenceMessages.push(event.data);
};
const quietChunk = new Float32Array(128); // all zeroes
for (let q = 0; q < 10; q++) {
    silenceWorklet.process([[quietChunk]], [], {});
}
assert(silenceMessages.length >= 1, "Silence worklet triggered message post");
const lastSilenceMsg = silenceMessages[silenceMessages.length - 1];
assert(lastSilenceMsg.isSilence === true, "Silent audio correctly flagged with isSilence: true");
assert(lastSilenceMsg.f0 === 0, "Silent audio reports f0: 0");
assert(lastSilenceMsg.frequency === 0, "Silent audio reports frequency: 0");
assert(lastSilenceMsg.confidence === 0, "Silent audio reports confidence: 0");
assert(lastSilenceMsg.rms < 0.008, "Silent audio reports rms < noiseGate");


// =============================================================================
// Section 4: Mathematical Frequency Resolution Across Guitar Register
// =============================================================================
console.log("\n=== Section 4: Mathematical Frequency Resolution (Autocorrelation & Parabolic Refinement) ===");

const sampleRate = 44100;
const guitarTuningNotes = [
    { name: "Low E (E2)",  nominal: 82.4069, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "A2 (Open 5)", nominal: 110.0000, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "D3 (Open 4)", nominal: 146.8324, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "G3 (Open 3)", nominal: 195.9977, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "B3 (Open 2)", nominal: 246.9417, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "High E (E4)", nominal: 329.6276, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "A4 Concert",  nominal: 440.0000, maxErrorHz: 0.05, maxCents: 0.10 },
    { name: "High E (E6)", nominal: 1318.510, maxErrorHz: 0.05, maxCents: 0.10 }
];

const dspWorklet = new PitchProcessor({
    processorOptions: { sampleRate: sampleRate, bufferSize: 2048 }
});

for (const note of guitarTuningNotes) {
    const testAudio = generateSineWave(note.nominal, sampleRate, 2048, 0.75);
    const result = dspWorklet.detectPitchAutocorrelation(testAudio, sampleRate);

    assert(result !== null, `Autocorrelation detected pitch for ${note.name}`);
    const errorHz = Math.abs(result.frequency - note.nominal);
    const centsDev = Math.abs(1200 * Math.log2(result.frequency / note.nominal));

    assert(errorHz < note.maxErrorHz, 
        `${note.name} (${note.nominal.toFixed(2)} Hz): Detected ${result.frequency.toFixed(4)} Hz | Error: ${errorHz.toFixed(5)} Hz (< ${note.maxErrorHz} Hz)`);
    assert(centsDev < note.maxCents, 
        `  -> Cents deviation: ${centsDev.toFixed(4)}¢ (< ${note.maxCents}¢)`);
    assert(result.confidence > 0.95, 
        `  -> High confidence score: ${result.confidence.toFixed(4)} (> 0.95)`);
}

// Sub-sample lag resolution test
// For 440 Hz at 44100 Hz, exact fractional lag = 44100 / 440 = 100.22727 samples.
// Nearest integer lag is 100, which corresponds to 441.00 Hz (1 Hz / 3.9 cents error).
// Parabolic peak refinement should recover 100.2273.
const sine440Buffer = generateSineWave(440.0, 44100, 2048);
const res440 = dspWorklet.detectPitchAutocorrelation(sine440Buffer, 44100);
const lagDiffFromInteger = Math.abs(res440.period - 100);
assert(lagDiffFromInteger > 0.15 && lagDiffFromInteger < 0.30, 
    `Parabolic interpolation resolved fractional sub-sample lag: ${res440.period.toFixed(4)} (diff from 100 = ${lagDiffFromInteger.toFixed(4)})`);
assert(Math.abs(res440.frequency - 440.0) < 0.005, 
    `Sub-sample accuracy reduces 440 Hz error to ${Math.abs(res440.frequency - 440.0).toFixed(5)} Hz`);


// =============================================================================
// Section 5: Parabolic Waveform Zero-Crossing Pitch Estimation
// =============================================================================
console.log("\n=== Section 5: Parabolic Waveform Zero-Crossing Pitch Estimation ===");

const zcWorklet = new PitchProcessor({
    processorOptions: { sampleRate: 44100, bufferSize: 2048, algorithm: 'zero-crossing' }
});

const zc440 = zcWorklet.detectPitchZeroCrossing(sine440Buffer, 44100);
assert(zc440 !== null, "Zero-crossing successfully detected 440 Hz tone");
assert(Math.abs(zc440.frequency - 440.0) < 0.05, 
    `Zero-crossing detected ${zc440.frequency.toFixed(4)} Hz (Error: ${Math.abs(zc440.frequency - 440.0).toFixed(5)} Hz)`);

const zc110Buffer = generateSineWave(110.0, 44100, 2048);
const zc110 = zcWorklet.detectPitchZeroCrossing(zc110Buffer, 44100);
assert(zc110 !== null, "Zero-crossing successfully detected 110 Hz tone");
assert(Math.abs(zc110.frequency - 110.0) < 0.05, 
    `Zero-crossing detected ${zc110.frequency.toFixed(4)} Hz (Error: ${Math.abs(zc110.frequency - 110.0).toFixed(5)} Hz)`);


// =============================================================================
// Section 6: GuitarDSP Main Thread Integration, Callback Piping & Graceful Fallback
// =============================================================================
console.log("\n=== Section 6: GuitarDSP Main Thread Integration & Callback Piping ===");

let pitchCallbackData = null;
let pluckCallbackData = null;
let noteOffCallbackData = null;
let silenceCallbackFired = false;
let audioMetricsData = null;

const dsp = new GuitarDSP({
    sampleRate: 44100,
    bufferSize: 2048,
    onPitchDetected: (data) => { pitchCallbackData = data; },
    onPluck: (data) => { pluckCallbackData = data; },
    onNoteOff: (data) => { noteOffCallbackData = data; },
    onSilence: () => { silenceCallbackFired = true; },
    onAudioMetrics: (metrics) => { audioMetricsData = metrics; }
});
dsp.isRunning = true;

// 6.1 Audio Metrics dispatch
dsp.handleWorkletMessage({
    type: 'pitch',
    f0: 440.0,
    rms: 0.15,
    peakSample: 0.22,
    confidence: 0.98,
    isSilence: false,
    time: 1.25
});

assert(audioMetricsData !== null, "onAudioMetrics callback received payload");
assert(audioMetricsData.rms === 0.15, "onAudioMetrics received accurate RMS (0.15)");
assert(audioMetricsData.peakSample === 0.22, "onAudioMetrics received accurate peakSample (0.22)");
assert(audioMetricsData.isClipping === false, "Normal amplitude is not clipping");

// 6.2 Pitch Detection & Note Payload contract
assert(pitchCallbackData !== null, "onPitchDetected callback fired");
assert(pitchCallbackData.frequency === 440.0, "Piped frequency is 440.0 Hz");
assert(pitchCallbackData.midi === 69, "Piped MIDI is 69");
assert(pitchCallbackData.noteName === 'A', "Piped noteName is 'A'");
assert(pitchCallbackData.octave === 4, "Piped octave is 4");
assert(pitchCallbackData.cents === 0, "Piped cents is 0");
assert(pitchCallbackData.confidence === 0.98, "Piped confidence is 0.98");
assert(pitchCallbackData.rms === 0.15, "Piped RMS is 0.15");
assert(pitchCallbackData.time === 1.25, "Piped timestamp is 1.25s");

// 6.3 Pluck detection on transient energy surge
dsp.pitchHistory = [];
dsp.prevRMS = 0.01;
pluckCallbackData = null;
dsp.handleWorkletMessage({
    type: 'pitch',
    f0: 329.63,
    rms: 0.25, // delta = 0.24 > onsetThreshold (0.015)
    peakSample: 0.35,
    confidence: 0.99,
    isSilence: false,
    time: 2.50
});

assert(pluckCallbackData !== null, "onPluck callback fired on transient pluck onset");
assert(pluckCallbackData.isPluck === true, "Pluck payload marked isPluck: true");
assert(pluckCallbackData.noteName === 'E', "Pluck detected noteName 'E' (MIDI 64)");
assert(pluckCallbackData.midi === 64, "Pluck detected MIDI 64");

// 6.4 Silence and Note-Off handling
silenceCallbackFired = false;
noteOffCallbackData = null;
dsp.handleWorkletMessage({
    type: 'pitch',
    f0: 0,
    rms: 0.001, // Below noiseGateRMS (0.008)
    peakSample: 0.002,
    confidence: 0,
    isSilence: true,
    time: 3.10
});

assert(silenceCallbackFired === true, "onSilence callback fired when signal drops below noise gate");
assert(noteOffCallbackData !== null, "onNoteOff callback fired to release playing note");
assert(noteOffCallbackData.midi === 64, "onNoteOff released active MIDI 64 note");
assert(noteOffCallbackData.time === 3.10, "onNoteOff provided timestamp 3.10s");

// 6.5 Graceful fallback verification when AudioWorklet is unavailable
const fallbackDsp = new GuitarDSP();
assert(fallbackDsp.useWorklet === false, "By default in headless Node.js, useWorklet is false");
fallbackDsp.initFallbackNode();
assert(fallbackDsp.useWorklet === false, "Graceful fallback cleanly completes without errors");

// Verify fallback analyzeFrame still functions seamlessly
let fallbackPitch = null;
fallbackDsp.onPitchDetected = (data) => { fallbackPitch = data; };
fallbackDsp.analyzeFrame(sine440Buffer, 0.5);
assert(fallbackPitch !== null, "Fallback analyzeFrame successfully detects pitch on main thread");
assert(fallbackPitch.midi === 69, "Fallback detected A4 (MIDI 69)");

console.log("\n================================================================================");
console.log(`TOTAL AUDIOWORKLET VERIFICATION: ${testsPassed} passed, ${testsFailed} failed.`);
console.log("================================================================================");

if (testsFailed > 0) {
    process.exit(1);
}
