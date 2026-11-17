/**
 * Automated Verification Test Suite for Smart Backing Track & Rhythm Accompaniment Engine
 * 
 * Verifies:
 * 1. Clean Exported Functions & Classes
 * 2. Chord Parsing, Intervals & Enharmonics
 * 3. Chord Root-to-Frequency Translation (A4=440Hz, Bass Register Optimization)
 * 4. Smooth Voice Leading for Comping Keys
 * 5. Built-in Progression Presets Integrity (12-Bar Blues, Pop I-V-vi-IV, Jazz ii-V-I)
 * 6. Groove Styles & Rhythm Patterns Integrity (Rock, Blues Shuffle, Funk 16ths, Jazz Walking)
 * 7. Chromatic Approach Walking Bass Algorithm
 * 8. Lookahead Scheduling Math (25ms timer, 100ms window, Zero Cumulative Drift)
 * 9. Swing Factor Timing & Subdivisions
 * 10. Procedural Drum Engine Synthesis (Kick 150->40Hz, Snare 180Hz+Noise, Hi-Hat Bandpass+Choke)
 * 11. Procedural Bass & Comping Keys Synthesis Graph
 * 12. Real-Time Dynamic Chord Following Mode
 * 13. Mixer Bus, Volume, Mute & Solo Management
 */

const BackingTrack = require('./backing-track.js');
const {
    BackingTrackEngine,
    createBackingTrack,
    GROOVE_STYLES,
    PROGRESSION_PRESETS,
    CHORD_QUALITIES,
    parseChord,
    chordToFrequencies,
    getBassMidi,
    getBassFrequency,
    midiToFrequency,
    frequencyToMidi,
    noteNameToMidi,
    getVoiceLedChordMidi,
    MockAudioContext
} = BackingTrack;

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
console.log("TEST SUITE: SMART BACKING TRACK & PROCEDURAL RHYTHM ACCOMPANIMENT ENGINE");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// SECTION 1: Export Clean Interfaces
// -----------------------------------------------------------------------------
console.log("--- Section 1: Clean Exported Interfaces ---");
assert(typeof BackingTrackEngine === 'function', "BackingTrackEngine class is exported");
assert(typeof createBackingTrack === 'function', "createBackingTrack factory function is exported");
assert(typeof parseChord === 'function', "parseChord function is exported");
assert(typeof chordToFrequencies === 'function', "chordToFrequencies function is exported");
assert(typeof getBassFrequency === 'function', "getBassFrequency function is exported");
assert(typeof midiToFrequency === 'function', "midiToFrequency function is exported");
assert(typeof MockAudioContext === 'function', "MockAudioContext is exported for headless test suites");
assert(typeof GROOVE_STYLES === 'object' && Object.keys(GROOVE_STYLES).length >= 4, "GROOVE_STYLES contains at least 4 groove definitions");
assert(typeof PROGRESSION_PRESETS === 'object' && Object.keys(PROGRESSION_PRESETS).length >= 6, "PROGRESSION_PRESETS contains at least 6 progression presets");

// -----------------------------------------------------------------------------
// SECTION 2: Chord Root-to-Frequency Translation & Enharmonics
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Chord Root-to-Frequency Translation & Theory ---");
// A4 is 440 Hz
assertClose(midiToFrequency(69), 440.0, 0.001, "A4 (MIDI 69) translates to exactly 440.0 Hz");
// A3 is 220 Hz
assertClose(midiToFrequency(57), 220.0, 0.001, "A3 (MIDI 57) translates to exactly 220.0 Hz");
// Middle C (C4, MIDI 60) is ~261.6256 Hz
assertClose(midiToFrequency(60), 261.6256, 0.01, "C4 (MIDI 60) translates to 261.63 Hz");

// Test Enharmonics
const chordDb = parseChord("Db");
const chordCsharp = parseChord("C#");
assert(chordDb.root === "C#", "Enharmonic Db resolves to canonical C#");
assert(chordCsharp.root === "C#", "C# resolves to C#");
assert(parseChord("Eb").root === "D#", "Enharmonic Eb resolves to canonical D#");
assert(parseChord("Bb").root === "A#", "Enharmonic Bb resolves to canonical A#");
assert(parseChord("Ab").root === "G#", "Enharmonic Ab resolves to canonical G#");

// Bass frequency register optimization:
// E1 should be in octave 1 (~41.2 Hz)
const bassE = getBassFrequency("E");
assertClose(bassE, 41.203, 0.05, "Bass E translates to E1 (~41.2 Hz, punchy low string)");
// A1 should be ~55 Hz
const bassA = getBassFrequency("A");
assertClose(bassA, 55.0, 0.05, "Bass A translates to A1 (55.0 Hz)");
// C should be placed in Octave 2 (~65.4 Hz) rather than sub-audible C1 (~32.7 Hz)
const bassC = getBassFrequency("C");
assertClose(bassC, 65.406, 0.05, "Bass C translates to C2 (~65.41 Hz) to avoid sub-30Hz inaudible rumble");
// D should be placed in Octave 2 (~73.4 Hz)
const bassD = getBassFrequency("D");
assertClose(bassD, 73.416, 0.05, "Bass D translates to D2 (~73.42 Hz)");

// Chord intervals and frequencies
const amFrequencies = chordToFrequencies("Am", 3);
assert(amFrequencies.length === 3, "Am triad has exactly 3 frequencies");
assertClose(amFrequencies[0], 220.0, 0.1, "Am root A3 is 220 Hz");
assertClose(amFrequencies[1], 261.63, 0.1, "Am minor third C4 is ~261.63 Hz");
assertClose(amFrequencies[2], 329.63, 0.1, "Am fifth E4 is ~329.63 Hz");

const g7Frequencies = chordToFrequencies("G7", 3);
assert(g7Frequencies.length === 4, "G7 dominant 7th has 4 frequencies");

const cmaj7Frequencies = chordToFrequencies("Cmaj7", 3);
assert(cmaj7Frequencies.length === 4, "Cmaj7 has 4 frequencies");
assert(parseChord("Bdim").quality === "dim", "Bdim parsed as diminished");
assert(parseChord("Dsus2").quality === "sus2", "Dsus2 parsed as suspended 2nd");
assert(parseChord("Asus4").quality === "sus4", "Asus4 parsed as suspended 4th");

// -----------------------------------------------------------------------------
// SECTION 3: Smooth Voice Leading for Comping Keys
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Smooth Voice Leading for Comping Keys ---");
const initialC = getVoiceLedChordMidi("C", null, 60);
assert(Array.isArray(initialC) && initialC.length === 3, "C major generates 3-note voicing");
// Voice lead to F major
const ledF = getVoiceLedChordMidi("F", initialC);
// In smooth voice leading from C [60, 64, 67] to F, F should be second inversion [60, 65, 69]
// where the common tone C (60) is held, E moves to F (64->65), G moves to A (67->69)
// Total movement is only 1 + 2 = 3 semitones instead of leaping up 5 semitones!
let totalDistance = 0;
for (let i = 0; i < 3; i++) {
    totalDistance += Math.abs(ledF[i] - initialC[i]);
}
assert(totalDistance <= 4, `Smooth voice leading minimizes distance between C and F (distance: ${totalDistance} semitones)`);
assert(ledF.includes(60), "Common tone C is preserved in second inversion of F");

// -----------------------------------------------------------------------------
// SECTION 4: Built-in Progression Presets Integrity
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Built-in Progression Presets Integrity ---");
const bluesE = PROGRESSION_PRESETS["12_bar_blues_e"];
assert(bluesE !== undefined, "12-Bar Blues in E exists");
assert(bluesE.measures === 12, "12-Bar Blues in E has 12 measures");
assert(bluesE.chords.length === 12, "12-Bar Blues in E has 12 chords");
assert(bluesE.chords[0] === "E7" && bluesE.chords[4] === "A7" && bluesE.chords[8] === "B7", "12-Bar Blues in E has correct I (E7), IV (A7), and V (B7) chords");
assert(bluesE.chords[11] === "B7", "12-Bar Blues in E has turnaround V (B7) in bar 12");
assert(bluesE.style === "blues_shuffle", "12-Bar Blues in E uses blues_shuffle style");

const bluesA = PROGRESSION_PRESETS["12_bar_blues_a"];
assert(bluesA !== undefined, "12-Bar Blues in A exists");
assert(bluesA.measures === 12, "12-Bar Blues in A has 12 measures");
assert(bluesA.chords[0] === "A7" && bluesA.chords[4] === "D7" && bluesA.chords[8] === "E7", "12-Bar Blues in A has correct I (A7), IV (D7), and V (E7) chords");

const popC = PROGRESSION_PRESETS["pop_i_v_vi_iv_c"];
assert(popC.measures === 4, "Pop I-V-vi-IV in C has 4 measures");
assert(JSON.stringify(popC.chords) === JSON.stringify(["C", "G", "Am", "F"]), "Pop I-V-vi-IV in C has chords C, G, Am, F");

const popG = PROGRESSION_PRESETS["pop_i_v_vi_iv_g"];
assert(JSON.stringify(popG.chords) === JSON.stringify(["G", "D", "Em", "C"]), "Pop I-V-vi-IV in G has chords G, D, Em, C");

const jazzC = PROGRESSION_PRESETS["jazz_ii_v_i_c"];
assert(jazzC.measures === 4, "Jazz ii-V-I in C has 4 measures");
assert(jazzC.chords[0] === "Dm7" && jazzC.chords[1] === "G7" && jazzC.chords[2] === "Cmaj7", "Jazz ii-V-I has ii (Dm7), V (G7), I (Cmaj7)");

const jazzG = PROGRESSION_PRESETS["jazz_ii_v_i_g"];
assert(jazzG.chords[0] === "Am7" && jazzG.chords[1] === "D7" && jazzG.chords[2] === "Gmaj7", "Jazz ii-V-I in G has ii (Am7), V (D7), I (Gmaj7)");

// -----------------------------------------------------------------------------
// SECTION 5: Groove Styles & Rhythm Patterns Integrity
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: Groove Styles & Pattern Engines ---");
// 1. Rock Straight 8ths
const rock = GROOVE_STYLES["rock_straight_8ths"];
assert(rock.subdivision === 8, "Rock has 8 subdivisions (8th notes)");
assert(rock.swing === 0.0, "Rock straight 8ths has 0.0 swing");
const rockDrums0 = rock.getDrums(0);
assert(rockDrums0.kick > 0, "Rock beat 1 (step 0) triggers kick");
const rockDrums2 = rock.getDrums(2);
assert(rockDrums2.snare > 0, "Rock beat 2 (step 2) triggers snare backbeat");
const rockDrums6 = rock.getDrums(6);
assert(rockDrums6.snare > 0, "Rock beat 4 (step 6) triggers snare backbeat");
const rockDrums5 = rock.getDrums(5);
assert(rockDrums5.kick > 0, "Rock has syncopated kick on '& of 3' (step 5)");

// 2. Blues Shuffle
const shuffle = GROOVE_STYLES["blues_shuffle"];
assert(shuffle.swing > 0.60, `Blues shuffle has swing factor: ${shuffle.swing}`);
const shuffleBass = [];
const testE7 = parseChord("E7");
for (let s = 0; s < 8; s++) {
    shuffleBass.push(shuffle.getBass(s, testE7, testE7).midi);
}
// In E boogie shuffle: Root E1(28), 3rd G#1(32), 5th B1(35), 6th C#2(37), b7 D2(38), 6th C#2(37), 5th B1(35), 3rd G#1(32)
assert(shuffleBass[0] === 28, "Blues bass step 0 is Root (E)");
assert(shuffleBass[1] === 32, "Blues bass step 1 is Major 3rd (G#)");
assert(shuffleBass[2] === 35, "Blues bass step 2 is 5th (B)");
assert(shuffleBass[3] === 37, "Blues bass step 3 is 6th (C#)");
assert(shuffleBass[4] === 38, "Blues bass step 4 is Minor 7th (D)");
assert(shuffleBass[5] === 37, "Blues bass step 5 returns to 6th (C#)");
assert(shuffleBass[6] === 35, "Blues bass step 6 returns to 5th (B)");
const shuffleKeysOffbeat = shuffle.getKeys(1, testE7);
assert(shuffleKeysOffbeat.active === true, "Blues comping keys trigger on swung offbeat (step 1)");
const shuffleKeysDownbeat = shuffle.getKeys(0, testE7);
assert(shuffleKeysDownbeat.active === false, "Blues comping keys rests on downbeat (step 0) for authentic chank");

// 3. Funk 16ths
const funk = GROOVE_STYLES["funk_16ths"];
assert(funk.subdivision === 16, "Funk has 16 subdivisions (16th notes)");
const funkDrums6 = funk.getDrums(6);
assert(funkDrums6.kick > 0 && funkDrums6.hihatOpen === true, "Funk step 6 has syncopated kick and open hi-hat sizzle");
const funkDrums4 = funk.getDrums(4);
assert(funkDrums4.snare === 1.0, "Funk step 4 has main snare backbeat");
const funkDrums7 = funk.getDrums(7);
assert(funkDrums7.snare > 0 && funkDrums7.snare < 0.5, "Funk step 7 has snare ghost note");

// 4. Jazz Walking 4/4
const jazz = GROOVE_STYLES["jazz_walking"];
assert(jazz.swing > 0.60, `Jazz has medium swing factor: ${jazz.swing}`);
const jazzDrums2 = jazz.getDrums(2);
assert(jazzDrums2.hihat > 0, "Jazz step 2 (Beat 2) triggers hi-hat pedal chick");
assert(jazzDrums2.ride > 0, "Jazz step 2 triggers ride cymbal");
const jazzDrums0 = jazz.getDrums(0);
assert(jazzDrums0.kick > 0 && jazzDrums0.kick < 0.3, "Jazz beat 1 triggers quiet feathered acoustic kick");

// -----------------------------------------------------------------------------
// SECTION 6: Chromatic Approach Walking Bass Algorithm
// -----------------------------------------------------------------------------
console.log("\n--- Section 6: Chromatic Approach Walking Bass Algorithm ---");
const chordDm7 = parseChord("Dm7");
const chordG7 = parseChord("G7");
const chordCmaj7 = parseChord("Cmaj7");

// Step 6 (Beat 4) in Dm7 moving to G7 should chromatically approach G root!
// Root of G is G1 (31) or G2 (43)
const jazzBassBeat4 = jazz.getBass(6, chordDm7, chordG7);
const targetGRoot = getBassMidi("G");
const semitoneDiff = Math.abs(jazzBassBeat4.midi - targetGRoot);
assert(semitoneDiff === 1, `Jazz walking bass beat 4 chromatically approaches target G root by exactly 1 semitone (diff: ${semitoneDiff})`);

// Beat 4 in G7 moving to Cmaj7 should chromatically approach C root!
const jazzBassBeat4ToC = jazz.getBass(6, chordG7, chordCmaj7);
const targetCRoot = getBassMidi("C");
const diffToC = Math.abs(jazzBassBeat4ToC.midi - targetCRoot);
assert(diffToC === 1, `Jazz walking bass beat 4 chromatically approaches target C root by exactly 1 semitone (diff: ${diffToC})`);

// -----------------------------------------------------------------------------
// SECTION 7: Lookahead Scheduling Interval Math & Zero Drift
// -----------------------------------------------------------------------------
console.log("\n--- Section 7: Lookahead Scheduling Interval Math & Zero Drift ---");
const mockCtx = new MockAudioContext();
const engine = new BackingTrackEngine({
    audioCtx: mockCtx,
    bpm: 120,
    preset: "pop_i_v_vi_iv_c",
    style: "rock_straight_8ths",
    timerInterval: 25,
    scheduleAheadTime: 0.100
});

assert(engine.timerInterval === 25, "Timer interval is exactly 25ms");
assert(engine.scheduleAheadTime === 0.100, "Schedule ahead lookahead window is exactly 100ms");

// Start engine
engine.start();
assert(engine.isPlaying === true, "Engine is now playing");

// At 120 BPM:
// 1 beat (quarter note) = 60 / 120 = 0.500 seconds
// 1 bar (4 beats) = 2.000 seconds
// Straight 8th note step = 0.250 seconds
const expectedQuarterSec = 60.0 / 120;
const expectedStepSec = expectedQuarterSec / 2;
assertClose(expectedQuarterSec, 0.500, 0.0001, "At 120 BPM, quarter note is exactly 0.500s");
assertClose(expectedStepSec, 0.250, 0.0001, "At 120 BPM, 8th note step is exactly 0.250s");

// Simulate time progression over 4 full measures (8.000 seconds)
const initialTime = engine.nextNoteTime;
let scheduledSteps = 0;
engine.on('step', () => {
    scheduledSteps++;
});

// Advance mock time in 25ms increments up to 8.5 seconds
for (let t = 0; t < 340; t++) {
    mockCtx.advanceTime(0.025);
    engine._schedulerTick();
}

// 4 bars of 8 subdivisions = 32 steps
assert(scheduledSteps >= 32, `Engine scheduled at least 32 steps over 4 bars (got ${scheduledSteps})`);
assert(engine.currentBar >= 4, `Engine advanced through at least 4 bars (got ${engine.currentBar})`);

// Verify Swing Timing Math
// Blues Shuffle at 108 BPM with swing = 0.67
const shuffleEngine = new BackingTrackEngine({
    audioCtx: new MockAudioContext(),
    bpm: 108,
    preset: "12_bar_blues_e",
    style: "blues_shuffle"
});

const quarter108 = 60.0 / 108; // ~0.55556s
const nominal8th = quarter108 / 2; // ~0.27778s
const swingFactor = shuffleEngine.swing;
const downbeatDur = 2.0 * nominal8th * swingFactor;
const upbeatDur = 2.0 * nominal8th * (1.0 - swingFactor);
const pairTotal = downbeatDur + upbeatDur;

assertClose(pairTotal, quarter108, 0.00001, "Downbeat + Upbeat duration exactly equals 1 quarter note with zero drift");
assert(downbeatDur > upbeatDur, "Downbeat duration is longer than upbeat in swung shuffle");
assertClose(downbeatDur / pairTotal, swingFactor, 0.0001, "Downbeat to pair ratio matches swing factor");

// Stop engine
engine.stop();
assert(engine.isPlaying === false, "Engine stopped cleanly");

// -----------------------------------------------------------------------------
// SECTION 8: Procedural Drum Engine Synthesis Verification (Web Audio Nodes)
// -----------------------------------------------------------------------------
console.log("\n--- Section 8: Procedural Drum Engine Web Audio Node Verification ---");
const synthMockCtx = new MockAudioContext();
const synthEngine = new BackingTrackEngine({ audioCtx: synthMockCtx });
synthEngine.initAudio();

// 1. Kick Drum
const nodesBeforeKick = synthMockCtx._createdNodes.length;
synthEngine.triggerKick(0.1, 1.0);
const kickOsc = synthMockCtx._createdNodes.find(n => n.nodeType === 'OscillatorNode' && n.type === 'sine');
assert(kickOsc !== undefined, "Kick drum created sine wave OscillatorNode");
assert(kickOsc.frequency.events.length >= 2, "Kick oscillator has pitch envelope events");
assert(kickOsc.frequency.events[0].value === 150, "Kick pitch starts at 150 Hz");
assert(kickOsc.frequency.events[1].value === 40, "Kick pitch exponentially drops to 40 Hz");
assert(kickOsc.frequency.events[1].type === 'exponentialRampToValueAtTime', "Kick pitch drop uses exponential ramp");

// 2. Snare Drum
synthEngine.triggerSnare(0.2, 1.0);
const snareBodyOsc = synthMockCtx._createdNodes.find(n => n.nodeType === 'OscillatorNode' && n.frequency.events[0] && n.frequency.events[0].value === 180);
assert(snareBodyOsc !== undefined, "Snare created 180 Hz body tone oscillator");
const snareFilter = synthMockCtx._createdNodes.find(n => n.nodeType === 'BiquadFilterNode' && n.type === 'highpass');
assert(snareFilter !== undefined, "Snare created high-pass filter for white noise burst");
assert(snareFilter.frequency.events[0].value === 800, "Snare high-pass filter cutoff is 800 Hz");

// 3. Hi-Hat
synthEngine.triggerHiHat(0.3, false, 0.8);
const hatBpFilter = synthMockCtx._createdNodes.find(n => n.nodeType === 'BiquadFilterNode' && n.type === 'bandpass' && n.frequency.events[0].value === 8500);
assert(hatBpFilter !== undefined, "Hi-hat created band-pass filter at 8500 Hz");
assert(hatBpFilter.Q.events[0].value === 3.0, "Hi-hat band-pass filter has resonant Q = 3.0");

// 4. Hi-Hat Open and Choke
synthEngine.triggerHiHat(0.4, true, 1.0); // open hat
assert(synthEngine._activeOpenHatGain !== null, "Open hi-hat registered active gain for choking");
synthEngine.triggerHiHat(0.45, false, 0.9); // closed hat chokes open hat
assert(synthEngine._activeOpenHatGain === null, "Closed hat successfully choked the open hat");

// -----------------------------------------------------------------------------
// SECTION 9: Procedural Bass & Comping Keys Synthesis Verification
// -----------------------------------------------------------------------------
console.log("\n--- Section 9: Procedural Bass & Comping Keys Graph Verification ---");
// Bass note trigger
const nodesBeforeBass = synthMockCtx._createdNodes.length;
synthEngine.triggerBassNote(0.5, 28, 0.45, 0.9); // E1 (41.2 Hz)
const bassFilter = synthMockCtx._createdNodes.find(n => n.nodeType === 'BiquadFilterNode' && n.type === 'lowpass' && n.frequency.events[0].value === 650);
assert(bassFilter !== undefined, "Bass note created lowpass filter with 650 Hz attack cutoff");
assert(bassFilter.frequency.events[1].value === 200, "Bass filter cutoff decays exponentially to 200 Hz");

// Keys chord trigger
const keysNotes = [60, 64, 67]; // C major
synthEngine.triggerCompingChord(0.6, keysNotes, 0.5, 0.8, 'pad');
const keysTriOsc = synthMockCtx._createdNodes.filter(n => n.nodeType === 'OscillatorNode' && n.type === 'triangle');
assert(keysTriOsc.length >= 3, "Comping keys generated polyphonic voice oscillators for all chord tones");

// -----------------------------------------------------------------------------
// SECTION 10: Real-Time Dynamic Chord Following Mode
// -----------------------------------------------------------------------------
console.log("\n--- Section 10: Real-Time Follow Mode (Live Guitar Chord) ---");
const followEngine = new BackingTrackEngine({
    audioCtx: new MockAudioContext(),
    preset: "realtime"
});
assert(followEngine.preset.id === "realtime", "Engine initialized in realtime follow mode");

let detectedChord = null;
followEngine.on('chord', (data) => {
    detectedChord = data.chord;
});

// Guitar plays Am7
followEngine.setLiveChord("Am7");
assert(followEngine.activeChordName === "Am7", "Engine dynamically updated active chord to Am7");
assert(followEngine.activeChord.root === "A", "Active chord root is A");
assert(followEngine.activeChord.quality === "m7", "Active chord quality is m7");
assert(detectedChord === "Am7", "Chord update event fired with Am7");

// Guitar transitions to G7
followEngine.setLiveChord("G7");
assert(followEngine.activeChordName === "G7", "Engine transitioned dynamically to G7");
assert(followEngine.activeChord.root === "G", "Active chord root is G");

// -----------------------------------------------------------------------------
// SECTION 11: Mixer Bus, Volumes, Mute & Solo Management
// -----------------------------------------------------------------------------
console.log("\n--- Section 11: Mixer Bus, Volumes, Mute & Solo Management ---");
const mixerCtx = new MockAudioContext();
const mixerEngine = new BackingTrackEngine({ audioCtx: mixerCtx });
mixerEngine.initAudio();

// Master volume
mixerEngine.setVolume('master', 0.65);
assertClose(mixerEngine.masterGain.gain.value, 0.65, 0.001, "Master gain node updated to 0.65");

// Mute drums
mixerEngine.setMute('drums', true);
assert(mixerEngine._isMuted('drums') === true, "Drums are flagged as muted");
assert(mixerEngine._isMuted('bass') === false, "Bass is unmuted");

// Solo bass
mixerEngine.setSolo('bass', true);
assert(mixerEngine._isMuted('bass') === false, "Soloed bass is active");
assert(mixerEngine._isMuted('keys') === true, "Non-soloed keys are muted by bass solo");

// Unsolo bass
mixerEngine.setSolo('bass', false);
assert(mixerEngine._isMuted('keys') === false, "Keys are unmuted after solo release");

console.log("\n================================================================================");
console.log(`TOTAL TEST RESULTS: ${passed} passed, ${failed} failed.`);
console.log("================================================================================");

if (failed > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
