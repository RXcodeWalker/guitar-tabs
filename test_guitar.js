/**
 * Comprehensive Automated Verification Script
 * Tests:
 * 1. Guitar Optimizer & Fingering
 * 2. Guitar DSP Mathematical Models & Note Detection
 * 3. Demo Songs Data Integrity
 * 4. Rhythm Quantization Engine (16th, 8th, Quarter Note Triplet, Eighth Triplet, Raw timestamps)
 * 5. Audio Playback Synthesis Model & Scrubbing Controller
 * 6. Multi-Format Exporter (ASCII 80-column blocks, JSON, MusicXML, and Binary MIDI SMF Type 0)
 */

const GuitarDSP = require('./js/dsp.js');
const GuitarOptimizer = require('./js/optimizer.js');
const GuitarQuantizer = require('./js/quantizer.js');
const { GuitarSynth, TablaturePlaybackController } = require('./js/synth.js');
const GuitarExporter = require('./js/exporter.js');
const TablatureStaff = require('./js/tablature.js');
const DEMO_SONGS = require('./js/demo-songs.js');
const GuitarEffectsRack = require('./js/effects-rack.js');
const { StrobeTuner, TUNING_PRESETS } = require('./js/strobe-tuner.js');

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
const cands = opt.findCandidates(69);
assert(cands.length >= 4, `A4 (440Hz) has ${cands.length} playable positions on 22-fret neck`);
assert(cands.some(c => c.string === 1 && c.fret === 5), "Candidate includes String 1, Fret 5");
assert(cands.some(c => c.string === 2 && c.fret === 10), "Candidate includes String 2, Fret 10");
assert(cands.some(c => c.string === 3 && c.fret === 14), "Candidate includes String 3, Fret 14");
assert(cands.some(c => c.string === 4 && c.fret === 19), "Candidate includes String 4, Fret 19");

opt.setMode('open');
opt.handAnchorFret = 1;
const bestOpen = opt.optimize(69);
assert(bestOpen.string === 1 && bestOpen.fret === 5, `In open mode, A4 picks string ${bestOpen.string} fret ${bestOpen.fret}`);

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

console.log("\n=== 4. Testing Rhythm Quantization Engine ===");
const quantizer = new GuitarQuantizer({ bpm: 120 });

// At 120 BPM:
// 1 beat = 0.5s
// 16th note = 0.125s
// 8th note = 0.25s
// quarter note triplet = (2 * 0.5) / 3 = 1/3s = 0.3333s
// eighth note triplet = 0.5 / 3 = 1/6s = 0.1667s

// Test 16th note quantization
assert(quantizer.getGridSeconds('16th', 120) === 0.125, "16th note grid at 120 BPM is 0.125s");
const q16_1 = quantizer.quantizeTime(0.129, '16th', 120);
assert(q16_1 === 0.125, `Raw time 0.129s quantizes to 16th note 0.125s (got ${q16_1})`);
const q16_2 = quantizer.quantizeTime(0.245, '16th', 120);
assert(q16_2 === 0.25, `Raw time 0.245s quantizes to 16th note 0.25s (got ${q16_2})`);

// Test 8th note quantization
assert(quantizer.getGridSeconds('8th', 120) === 0.25, "8th note grid at 120 BPM is 0.25s");
const q8_1 = quantizer.quantizeTime(0.21, '8th', 120);
assert(q8_1 === 0.25, `Raw time 0.21s quantizes to 8th note 0.25s (got ${q8_1})`);
const q8_2 = quantizer.quantizeTime(0.11, '8th', 120);
assert(q8_2 === 0.0, `Raw time 0.11s quantizes to 8th note 0.0s (got ${q8_2})`);

// Test quarter note triplet quantization
// 3 quarter note triplets take 2 beats (1.0 second at 120 BPM). Triplet step = 0.3333s
const q3_step = quantizer.getGridSeconds('quarterTriplet', 120);
assert(Math.abs(q3_step - 1/3) < 0.001, `Quarter note triplet step is 0.3333s (got ${q3_step.toFixed(4)})`);
const q3_1 = quantizer.quantizeTime(0.35, 'quarterTriplet', 120);
assert(Math.abs(q3_1 - 0.3333) < 0.002, `Raw time 0.35s quantizes to quarter triplet 0.3333s (got ${q3_1})`);
const q3_2 = quantizer.quantizeTime(0.68, 'quarterTriplet', 120);
assert(Math.abs(q3_2 - 0.6667) < 0.002, `Raw time 0.68s quantizes to 2nd quarter triplet 0.6667s (got ${q3_2})`);

// Test duration quantization
const dur16 = quantizer.quantizeDuration(0.11, '16th', 120);
assert(dur16 === 0.125, `Raw duration 0.11s quantizes to minimum 1 16th note unit 0.125s (got ${dur16})`);
const dur16_long = quantizer.quantizeDuration(0.36, '16th', 120);
assert(dur16_long === 0.375, `Raw duration 0.36s quantizes to 3 16th note units 0.375s (got ${dur16_long})`);

// Test note-on / note-off timestamp capture
const activeMap = new Map();
const noteOn1 = quantizer.captureNoteOn(activeMap, 1, { fret: 5, noteName: 'A4', midi: 69 }, 1.05);
assert(activeMap.has(1), "Active notes map contains ringing string 1");
assert(noteOn1.rawTime === 1.05, `Captured raw note-on timestamp 1.05s (got ${noteOn1.rawTime})`);

// Note-off via second pluck on same string
const noteOn2 = quantizer.captureNoteOn(activeMap, 1, { fret: 7, noteName: 'B4', midi: 71 }, 1.48);
assert(noteOn1.rawEndTime === 1.48, `Prior note finalized with rawEndTime 1.48s (got ${noteOn1.rawEndTime})`);
assert(Math.abs(noteOn1.rawDuration - 0.43) < 0.001, `Prior note rawDuration is 0.43s (got ${noteOn1.rawDuration})`);

// Note-off via explicit release
const finalizedNote = quantizer.captureNoteOff(activeMap, 1, 1.95);
assert(finalizedNote.rawEndTime === 1.95, `Explicit note-off sets rawEndTime 1.95s (got ${finalizedNote.rawEndTime})`);
assert(Math.abs(finalizedNote.rawDuration - 0.47) < 0.001, `Explicit note-off sets rawDuration 0.47s (got ${finalizedNote.rawDuration})`);
assert(!activeMap.has(1), "Active map cleared after note-off");

// Test batch quantizeNotes preserving raw timestamps
const rawTestNotes = [
    { string: 1, fret: 5, time: 0.13, duration: 0.22, noteName: 'A4', midi: 69 },
    { string: 2, fret: 5, time: 0.49, duration: 0.48, noteName: 'E4', midi: 64 }
];
quantizer.quantizeNotes(rawTestNotes, '16th', 120);
assert(rawTestNotes[0].rawTime === 0.13, "Raw start time preserved on note 0");
assert(rawTestNotes[0].time === 0.125, "Quantized start time updated to 0.125s on note 0");
assert(rawTestNotes[1].rawTime === 0.49, "Raw start time preserved on note 1");
assert(rawTestNotes[1].time === 0.5, "Quantized start time updated to 0.5s on note 1");

console.log("\n=== 5. Testing Audio Playback Synthesizer & Controller ===");
const synth = new GuitarSynth();
assert(typeof synth.playKarplusStrongNote === 'function', "Karplus-Strong physical string method exists");
assert(typeof synth.playPolySynthNote === 'function', "Polyphonic Web Audio clean synth method exists");
assert(synth.midiToFrequency(69) === 440, "Synth accurately calculates A4 = 440 Hz");

// Test TablaturePlaybackController calculations
const mockTab = {
    notes: [
        { time: 0.0, duration: 0.5, string: 1, fret: 0, noteName: 'E4', midi: 64 },
        { time: 0.5, duration: 0.5, string: 2, fret: 1, noteName: 'C4', midi: 60 },
        { time: 1.0, duration: 1.0, string: 3, fret: 0, noteName: 'G3', midi: 55 }
    ],
    currentTime: 0,
    bpm: 120,
    pause: () => {}
};
const controller = new TablaturePlaybackController({
    tablature: mockTab,
    synth: synth
});
const songEnd = controller.getSongEndTime();
assert(songEnd === 2.5, `Song end time calculated correctly as 2.5s (1.0s + 1.0s duration + 0.5s margin) (got ${songEnd})`);

console.log("\n=== 6. Testing Multi-Format Exporter ===");
const exporter = new GuitarExporter({
    title: 'Test Guitar Riff',
    bpm: 120,
    tuning: {
        name: 'Standard',
        strings: [64, 59, 55, 50, 45, 40],
        names: ["e", "B", "G", "D", "A", "E"]
    }
});

const sampleNotes = [
    { string: 6, fret: 0, time: 0.0, duration: 0.5, noteName: 'E2', midi: 40 },
    { string: 5, fret: 2, time: 0.25, duration: 0.5, noteName: 'B2', midi: 47 },
    { string: 4, fret: 2, time: 0.5, duration: 0.5, noteName: 'E3', midi: 52 },
    { string: 3, fret: 1, time: 0.75, duration: 0.5, noteName: 'G#3', midi: 56 },
    { string: 2, fret: 0, time: 1.0, duration: 0.5, noteName: 'B3', midi: 59 },
    { string: 1, fret: 0, time: 1.25, duration: 0.75, noteName: 'E4', midi: 64 }
];

// 6.1 Testing ASCII Tab Output Formatting (Strictly 80 columns wide)
console.log("--- 6.1 ASCII Tab Format (80 characters wide per block with bar lines) ---");
const asciiTab = exporter.toASCII(sampleNotes, 120);
assert(asciiTab.length > 0, "ASCII tab generated successfully");
const asciiLines = asciiTab.split('\n');

let allLines80 = true;
let stringLineCount = 0;
for (const line of asciiLines) {
    // Check all non-empty lines that represent staff strings or headers
    if (line.includes('|') && line.length > 10) {
        if (line.length !== 80) {
            console.error(`Line does not have 80 chars (length ${line.length}): "${line}"`);
            allLines80 = false;
        }
        if (/^[eBGDAE]\|/.test(line)) {
            stringLineCount++;
        }
    }
}
assert(allLines80, "Every single staff block line and measure header is strictly 80 characters wide");
assert(stringLineCount >= 6, `Generated at least 6 guitar string lines (found ${stringLineCount})`);

// 6.2 Testing Structured JSON Score Output
console.log("--- 6.2 Structured JSON Score Format ---");
const jsonString = exporter.toJSON(sampleNotes, 120);
assert(typeof jsonString === 'string', "JSON string generated");
const jsonObj = JSON.parse(jsonString);
assert(jsonObj.metadata.title === 'Test Guitar Riff', "JSON metadata contains score title");
assert(jsonObj.metadata.tempo === 120, "JSON metadata contains tempo 120 BPM");
assert(Array.isArray(jsonObj.measures) && jsonObj.measures.length > 0, `JSON contains measures array (length ${jsonObj.measures.length})`);
assert(jsonObj.notes.length === sampleNotes.length, `JSON contains all ${sampleNotes.length} notes`);
assert(jsonObj.notes[0].midi === 40, "JSON note 0 has correct MIDI 40");

// 6.3 Testing MusicXML Score Output
console.log("--- 6.3 MusicXML Score Format (Guitar Pro, MuseScore, TuxGuitar) ---");
const xmlString = exporter.toMusicXML(sampleNotes, 120);
assert(xmlString.includes('<?xml version="1.0" encoding="UTF-8"?>'), "MusicXML has XML declaration header");
assert(xmlString.includes('<score-partwise version="3.1">'), "MusicXML has score-partwise root tag");
assert(xmlString.includes('<clef>'), "MusicXML has clef element");
assert(xmlString.includes('<sign>TAB</sign>'), "MusicXML specifies TAB clef");
assert(xmlString.includes('<staff-lines>6</staff-lines>'), "MusicXML defines 6 guitar staff lines");
assert(xmlString.includes('<notations>'), "MusicXML contains technical notations");
assert(xmlString.includes('<technical>'), "MusicXML contains technical fret/string tags");
assert(xmlString.includes('<fret>'), "MusicXML has fret tags");
assert(xmlString.includes('<string>'), "MusicXML has string tags");

// 6.4 Testing Pure Client-Side Binary MIDI File Encoder (SMF Type 0)
console.log("--- 6.4 Client-Side Binary Standard MIDI File (SMF Type 0) ---");
const midiBytes = exporter.toMIDI(sampleNotes, 120);
assert(midiBytes instanceof Uint8Array, "MIDI encoder returns Uint8Array");
assert(midiBytes.length > 30, `Binary MIDI file size is ${midiBytes.length} bytes`);

// Check 'MThd' header chunk identifier (0x4D, 0x54, 0x68, 0x64)
const isMThd = midiBytes[0] === 0x4D && midiBytes[1] === 0x54 && midiBytes[2] === 0x68 && midiBytes[3] === 0x64;
assert(isMThd, "MIDI header chunk starts with 'MThd'");

// Check header length = 6
const headerLen = (midiBytes[4] << 24) | (midiBytes[5] << 16) | (midiBytes[6] << 8) | midiBytes[7];
assert(headerLen === 6, `Header chunk length is 6 (got ${headerLen})`);

// Check format = 0 (Type 0 single track)
const formatType = (midiBytes[8] << 8) | midiBytes[9];
assert(formatType === 0, `SMF Format is Type 0 (got ${formatType})`);

// Check track count = 1
const numTracks = (midiBytes[10] << 8) | midiBytes[11];
assert(numTracks === 1, `Track count is 1 (got ${numTracks})`);

// Check division / PPQ = 480 (0x01E0)
const division = (midiBytes[12] << 8) | midiBytes[13];
assert(division === 480, `PPQ Division is 480 ticks per beat (got ${division})`);

// Check 'MTrk' track chunk identifier (0x4D, 0x54, 0x72, 0x6B)
const isMTrk = midiBytes[14] === 0x4D && midiBytes[15] === 0x54 && midiBytes[16] === 0x72 && midiBytes[17] === 0x6B;
assert(isMTrk, "Track chunk starts with 'MTrk'");

// Check track data length
const trackLen = (midiBytes[18] << 24) | (midiBytes[19] << 16) | (midiBytes[20] << 8) | midiBytes[21];
assert(trackLen > 0, `Track length is valid (${trackLen} bytes)`);

// Check End of Track meta-event at end of file: 0xFF 0x2F 0x00
const last3 = [midiBytes[midiBytes.length - 3], midiBytes[midiBytes.length - 2], midiBytes[midiBytes.length - 1]];
assert(last3[0] === 0xFF && last3[1] === 0x2F && last3[2] === 0x00, "Track concludes with valid End of Track meta-event (FF 2F 00)");

// Check that Note-On (0x90) and Note-Off (0x80) events exist in the track data
let hasNoteOn = false;
let hasNoteOff = false;
for (let i = 22; i < midiBytes.length; i++) {
    if (midiBytes[i] === 0x90) hasNoteOn = true;
    if (midiBytes[i] === 0x80) hasNoteOff = true;
}
assert(hasNoteOn, "MIDI track contains Note-On (0x90) events");
assert(hasNoteOff, "MIDI track contains Note-Off (0x80) events");

// 6.5 Testing Full Multi-Measure Demo Song Export
console.log("--- 6.5 Full Multi-Measure Demo Song Export (Sweet Child O' Mine) ---");
const slashNotes = DEMO_SONGS.sweetChild.notes;
const slashBpm = DEMO_SONGS.sweetChild.bpm;

const slashAscii = exporter.toASCII(slashNotes, slashBpm);
const slashAsciiLines = slashAscii.split('\n');
let slashAll80 = true;
for (const line of slashAsciiLines) {
    if (line.includes('|') && line.length > 10 && line.length !== 80) {
        slashAll80 = false;
    }
}
assert(slashAll80, "All multi-measure staff lines in Sweet Child O' Mine ASCII export are strictly 80 characters wide");

const slashXML = exporter.toMusicXML(slashNotes, slashBpm);
assert(slashXML.includes('<measure number="1">') && slashXML.includes('<measure number="2">'), "Sweet Child O' Mine MusicXML contains multiple measures");

const slashMIDI = exporter.toMIDI(slashNotes, slashBpm);
assert(slashMIDI.length > 200, `Sweet Child O' Mine MIDI encodes into ${slashMIDI.length} bytes`);

console.log("\n=== 7. Testing Guitar Effects Rack (Stompbox Chain) DSP Engine ===");
// Mock Web Audio Context for Node.js
class TestMockAudioParam {
    constructor(v = 0) { this.value = v; this.targetValue = v; }
    setValueAtTime(v) { this.value = v; this.targetValue = v; }
    setTargetAtTime(v) { this.targetValue = v; this.value = v; }
}
class TestMockNode {
    constructor(ctx, type) { this.context = ctx; this.nodeType = type; this.connections = []; }
    connect(d) { this.connections.push(d); return d; }
    disconnect(d) { if (!d) this.connections = []; else this.connections = this.connections.filter(c => c !== d); }
}
class TestMockGain extends TestMockNode { constructor(ctx) { super(ctx, 'Gain'); this.gain = new TestMockAudioParam(1); } }
class TestMockFilter extends TestMockNode { constructor(ctx) { super(ctx, 'Filter'); this.type = 'lowpass'; this.frequency = new TestMockAudioParam(350); this.Q = new TestMockAudioParam(1); } }
class TestMockShaper extends TestMockNode { constructor(ctx) { super(ctx, 'Shaper'); this.curve = null; this.oversample = 'none'; } }
class TestMockDelay extends TestMockNode { constructor(ctx) { super(ctx, 'Delay'); this.delayTime = new TestMockAudioParam(0); } }
class TestMockConvolver extends TestMockNode { constructor(ctx) { super(ctx, 'Convolver'); this.buffer = null; this.normalize = true; } }
class TestMockAnalyser extends TestMockNode { constructor(ctx) { super(ctx, 'Analyser'); this.fftSize = 2048; this.smoothingTimeConstant = 0; } }
class TestMockBuffer {
    constructor(ch, len, sr) {
        this.numberOfChannels = ch; this.length = len; this.sampleRate = sr;
        this.channels = [new Float32Array(len), new Float32Array(len)];
    }
    getChannelData(c) { return this.channels[c]; }
}
class TestMockAudioCtx {
    constructor() { this.sampleRate = 44100; this.currentTime = 0; this.destination = new TestMockNode(this, 'Destination'); }
    createGain() { return new TestMockGain(this); }
    createBiquadFilter() { return new TestMockFilter(this); }
    createWaveShaper() { return new TestMockShaper(this); }
    createDelay() { return new TestMockDelay(this); }
    createConvolver() { return new TestMockConvolver(this); }
    createAnalyser() { return new TestMockAnalyser(this); }
    createBuffer(ch, len, sr) { return new TestMockBuffer(ch, len, sr); }
}

const fxCtx = new TestMockAudioCtx();
const fxSource = fxCtx.createGain();
const fxRack = new GuitarEffectsRack(fxCtx, fxSource);

// 7.1 Routing & Performance
assert(fxRack !== null, "GuitarEffectsRack instantiated cleanly with zero external dependencies");
assert(fxRack.pitchAnalyser !== null, "Pitch AnalyserNode dedicated raw tap exists");
assert(fxRack.inputNode.connections.includes(fxRack.pitchAnalyser), "Split routing: Raw audio connects to pitchAnalyser for pristine tracking");
assert(fxSource.connections.includes(fxRack.inputNode), "Audio input connects to effects rack input node");

// 7.2 Tube Screamer / Overdrive
assert(fxRack.od.waveShaper.oversample === '4x', "Tube Screamer WaveShaper uses 4x oversampling");
const odCurve = fxRack._generateOverdriveCurve(4096, 0.35, 2.2);
assert(odCurve.length === 4096, "Overdrive non-linear transfer curve generated with 4096 points");
assert(Math.abs(odCurve[2048]) < 0.001, "Overdrive transfer curve at x=0 has zero DC offset");
assert(odCurve[3072] > 0 && odCurve[1024] < 0, "Overdrive curve is bipolar");
assert(Math.abs(Math.abs(odCurve[3072]) - Math.abs(odCurve[1024])) > 0.04, "Overdrive curve exhibits asymmetric saturation (even harmonics)");

fxRack.setParam('overdrive', 'drive', 65);
assert(fxRack.getParam('overdrive', 'drive') === 65, "Overdrive drive set to 65");
fxRack.setParam('overdrive', 'tone', 80);
assert(fxRack.getParam('overdrive', 'tone') === 80, "Overdrive tone set to 80");
assert(fxRack.od.toneFilter.frequency.targetValue > 2500, "Tone 80 shifts low-pass tilt cutoff to bright treble");
fxRack.setParam('overdrive', 'level', 85);
assert(fxRack.getParam('overdrive', 'level') === 85, "Overdrive level set to 85");
fxRack.setBypass('overdrive', true);
assert(fxRack.isBypassed('overdrive') === true, "Overdrive true-bypass engages clean dry path");

// 7.3 Analog BBD Delay
assert(fxRack.delay.bbdFilter.type === 'lowpass', "BBD delay has analog lowpass filter in feedback path");
assert(fxRack.delay.bbdFilter.frequency.value === 2200, "BBD analog filter cutoff set to 2200 Hz");
fxRack.setParam('delay', 'time', 400);
assert(fxRack.getParam('delay', 'time') === 400, "Delay time set to 400ms");
assert(Math.abs(fxRack.delay.delayNode.delayTime.targetValue - 0.4) < 0.001, "DelayNode delayTime converted to 0.4s");
fxRack.setParam('delay', 'feedback', 110);
assert(fxRack.getParam('delay', 'feedback') === 90, "Delay feedback safely clamped to 90% max");
fxRack.setParam('delay', 'mix', 45);
assert(fxRack.getParam('delay', 'mix') === 45, "Delay mix set to 45%");

// 7.4 Studio Ambient Reverb
assert(fxRack.reverb.convolver.buffer !== null, "Convolver initialized with synthetic IR buffer");
assert(fxRack.reverb.convolver.buffer.numberOfChannels === 2, "Synthetic IR buffer is stereo");
fxRack.setParam('reverb', 'size', 2.8);
assert(fxRack.getParam('reverb', 'size') === 2.8, "Reverb size set to 2.8s");
fxRack.setParam('reverb', 'damping', 60);
assert(fxRack.getParam('reverb', 'damping') === 60, "Reverb damping set to 60%");
fxRack.setParam('reverb', 'mix', 35);
assert(fxRack.getParam('reverb', 'mix') === 35, "Reverb mix set to 35%");

// 7.5 Master True-Bypass & State
fxRack.setBypass('master', true);
assert(fxRack.isBypassed('master') === true, "Master rack true-bypass engaged");
assert(fxRack.master.masterBypassDry.gain.targetValue === 1.0, "Master bypass routes raw audio directly to output");
fxRack.setBypass('master', false);
assert(fxRack.isBypassed('master') === false, "Master rack re-engaged");

const fxState = fxRack.getState();
assert(fxState.overdrive.drive === 65, "State snapshot contains accurate overdrive drive");
assert(fxState.delay.time === 400, "State snapshot contains accurate delay time");
assert(fxState.reverb.damping === 60, "State snapshot contains accurate reverb damping");

console.log("\n=== 8. Testing Virtual Strobe Tuner & Acoustic Inharmonicity Analyzer ===");
const strobe = new StrobeTuner(null, null, null, { a4: 440, preset: 'standard' });

// 8.1 API & Preset Verification
assert(typeof strobe.start === 'function', "StrobeTuner exposes .start() method");
assert(typeof strobe.stop === 'function', "StrobeTuner exposes .stop() method");
assert(typeof strobe.setTuning === 'function', "StrobeTuner exposes .setTuning() method");
assert(typeof strobe.getFrequencies === 'function', "StrobeTuner exposes .getFrequencies() method");

// Verify all 6 alternate tuning presets
const presets = ['standard', 'dropD', 'dadgad', 'openD', 'openG', 'halfStep'];
presets.forEach(p => {
    const t = strobe.setTuning(p);
    assert(t.preset === p, `setTuning successfully switches to '${p}'`);
    assert(t.frequencies.length === 6, `'${p}' returns 6 open-string frequencies`);
    assert(t.frequencies.every(f => f > 50 && f < 500), `'${p}' frequencies are within valid guitar range`);
});

// Dynamic fretboard remapping via open-string frequencies
const openGTuning = strobe.setTuning('openG');
opt.setTuning('openG');
assert(opt.openMidi[5] === 38, "In Open G tuning, String 6 is tuned down to D2 (MIDI 38)");
assert(opt.openMidi[4] === 43, "In Open G tuning, String 5 is tuned down to G2 (MIDI 43)");

// 8.2 Strobe Dynamics (Clockwise sharp, Counter-clockwise flat, Stationary zero)
strobe.cents = 0.0;
strobe.hasSignal = true;
strobe.outerAngle = 0.5;
strobe.lastFrameTime = 1000;
strobe.update(1020);
assert(Math.abs(strobe.outerAngle - 0.5) < 1e-5, "Strobe wheel is stationary (0 drift) at 0.0 cents");

strobe.cents = 12.0; // Sharp
strobe.outerAngle = 0.0;
strobe.lastFrameTime = 1000;
strobe.update(1050);
assert(strobe.outerAngle > 0, "Strobe wheel rotates clockwise for sharp note (+12¢)");

strobe.cents = -12.0; // Flat
strobe.outerAngle = 1.0;
strobe.lastFrameTime = 1000;
strobe.update(1050);
assert(strobe.outerAngle < 1.0, "Strobe wheel rotates counter-clockwise for flat note (-12¢)");

// 8.3 Acoustic Inharmonicity (String Stiffness Model: fn = n * f0 * sqrt(1 + B * n^2))
const testB = 0.00042;
const nominalF0 = 110.0; // A2 string
const syntheticPartials = [1, 2, 3, 4].map(n => ({
    n: n,
    freq: n * nominalF0 * Math.sqrt(1 + testB * n * n)
}));

const inharmResult = strobe.calculateInharmonicity(syntheticPartials);
assert(Math.abs(inharmResult.B - testB) < 1e-6, `Inharmonicity B calculated as ${inharmResult.B.toFixed(6)} (matches target ${testB})`);
assert(Math.abs(inharmResult.f0 - nominalF0) < 0.05, `Fundamental f0 recovered as ${inharmResult.f0.toFixed(2)} Hz`);
assert(inharmResult.rSquared > 0.9999, `Regression R^2 is ${inharmResult.rSquared.toFixed(5)}`);
assert(inharmResult.stringWear === 'Good', `String with B = 0.00042 classified as 'Good'`);

// Test worn string wear assessment
const wornPartials = [1, 2, 3, 4].map(n => ({
    n: n,
    freq: n * nominalF0 * Math.sqrt(1 + 0.00125 * n * n)
}));
const wornResult = strobe.calculateInharmonicity(wornPartials);
assert(wornResult.stringWear === 'Worn', `High-stiffness string (B = 0.00125) classified as 'Worn'`);

console.log("\n=== 9. Testing Polyphonic Chord Recognizer & Scale Recommendation Engine ===");
const ChordEngine = require('./chord-engine.js');

// 9.1 Clean Exports Verification
assert(typeof ChordEngine.analyzeChroma === 'function', "analyzeChroma is exported as a clean function");
assert(typeof ChordEngine.getScaleOverlay === 'function', "getScaleOverlay is exported as a clean function");
assert(Array.isArray(ChordEngine.BUILTIN_TEST_DATA), "BUILTIN_TEST_DATA is exported");

// 9.2 Built-in Chord Detection Verification
const chordResults = ChordEngine.verifyChordDetection();
assert(chordResults.length >= 10, "Built-in test suite covers at least 10 chords");
for (const cr of chordResults) {
    assert(cr.passed, `Built-in detection: ${cr.testChord} -> ${cr.detectedChord} (${cr.confidence}%, Root: ${cr.root})`);
}

// 9.3 Scale Overlay Recommendation (Am7 -> A Minor Pentatonic / A Dorian)
const am7Scale = ChordEngine.getScaleOverlay("Am7");
assert(am7Scale.scaleName === "A Minor Pentatonic / A Dorian", `Am7 scale recommendation is '${am7Scale.scaleName}'`);
assert(am7Scale.length === 138, `Scale overlay provides 138 guitar neck positions (got ${am7Scale.length})`);
assert(am7Scale.targetNotes.includes("A") && am7Scale.targetNotes.includes("C") && am7Scale.targetNotes.includes("E") && am7Scale.targetNotes.includes("G"), "Am7 target notes are chord tones [A, C, E, G]");
assert(am7Scale.passingNotes.includes("B") && am7Scale.passingNotes.includes("D") && am7Scale.passingNotes.includes("F#"), "Am7 passing notes are [B, D, F#]");
assert(am7Scale.avoidNotes.includes("F"), "Am7 avoid notes include F");

// 9.4 Fast Hysteresis Anti-Flicker Check
const recHyst = new ChordEngine.PolyphonicChordRecognizer({ stabilityThreshold: 3 });
const specC = ChordEngine.generateChordSpectrum("C", 44100, 4096);
const specAm = ChordEngine.generateChordSpectrum("Am", 44100, 4096);
recHyst.processFrame(specC, 44100);
recHyst.processFrame(specC, 44100);
const lockedC = recHyst.processFrame(specC, 44100);
assert(lockedC.chord === "C", "Locked onto chord C");
const flicker = recHyst.processFrame(specAm, 44100);
assert(flicker.chord === "C", "Single transient frame does not flicker locked chord");

console.log(`\n========================================`);
console.log(`Verification Complete: ${testsPassed} passed, ${testsFailed} failed.`);
if (testsFailed > 0) process.exit(1);
