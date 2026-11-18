/**
 * Automated Verification Test Suite for FretDSP Ear Training & Call-and-Response Practice Module
 * (test_ear_trainer.js)
 * 
 * Verifies:
 * 1. Clean exports, classes, data structures, and theory constants.
 * 2. Interval semitone lookups (0 to 12 semitones, P1, m2, M2, m3, M3, P4, TT, P5, m6, M6, m7, M7, P8).
 * 3. Pitch verification within ±35 cents tolerance window and cent deviation math.
 * 4. Question generators across all 3 game modes and 3 progressive difficulty tiers:
 *    - Tier 1: Diatonic steps and major/minor thirds within 5-fret span.
 *    - Tier 2: 7ths, octaves, and pentatonic skips across multiple strings.
 *    - Tier 3: Chromaticism, tritones, and fast call-and-response riffs.
 * 5. State machine transitions (IDLE -> GENERATING -> PLAYING_PROMPT -> AWAITING_INPUT -> SUCCESS / FAIL / TIMEOUT).
 * 6. Answer verification logic:
 *    - Interval identification
 *    - Chord quality strum recognition & note-by-note arpeggiation
 *    - Melodic echo sequential note matching
 *    - Debouncing of rapid DSP frames
 * 7. Scoring calculations, streak counters, reaction time, and accuracy tracking.
 * 8. Non-invasive DSP & ChordEngine subscription chaining.
 */

const EarTrainerModule = require('./js/ear-trainer.js');
const {
    EarTrainer,
    QuestionGenerator,
    ScoreTracker,
    AudioPromptPlayer,
    INTERVALS,
    CHORD_QUALITIES,
    GAME_MODES,
    DIFFICULTY_TIERS,
    STATES,
    NOTE_NAMES,
    STANDARD_TUNING_MIDI,
    midiToFrequency,
    frequencyToMidiExact,
    midiToNoteName,
    noteNameToMidi,
    calculateCentsDeviation,
    isPitchWithinTolerance,
    getGuitarPositions,
    canPlayWithinSpan,
    normalizeChordQualityKey
} = EarTrainerModule;

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
        console.log(`  ✓ ${message} (expected ${expected.toFixed(2)}, got ${actual.toFixed(2)})`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message} (expected ${expected.toFixed(2)}, got ${actual.toFixed(2)}, diff ${diff.toFixed(2)})`);
        failed++;
    }
}

console.log("================================================================================");
console.log("TEST SUITE: FRET-DSP INTERACTIVE EAR TRAINING & CALL-AND-RESPONSE MODULE");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// SECTION 1: Clean Exports & Core Classes
// -----------------------------------------------------------------------------
console.log("--- Section 1: Clean Exports & Class Interfaces ---");
assert(typeof EarTrainer === 'function', "EarTrainer class is exported");
assert(typeof QuestionGenerator === 'function', "QuestionGenerator class is exported");
assert(typeof ScoreTracker === 'function', "ScoreTracker class is exported");
assert(typeof AudioPromptPlayer === 'function', "AudioPromptPlayer class is exported");
assert(typeof INTERVALS === 'object' && INTERVALS !== null, "INTERVALS lookup table is exported");
assert(typeof CHORD_QUALITIES === 'object' && CHORD_QUALITIES !== null, "CHORD_QUALITIES lookup table is exported");
assert(typeof GAME_MODES === 'object' && GAME_MODES !== null, "GAME_MODES enum is exported");
assert(typeof DIFFICULTY_TIERS === 'object' && DIFFICULTY_TIERS !== null, "DIFFICULTY_TIERS is exported");
assert(Array.isArray(STANDARD_TUNING_MIDI) && STANDARD_TUNING_MIDI.length === 6, "Standard guitar tuning MIDI numbers array is 6 strings");

// -----------------------------------------------------------------------------
// SECTION 2: Interval Semitone Lookups & Music Theory
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Interval Semitone Lookups & Theory Constants ---");
assert(INTERVALS[0].name === "Unison" && INTERVALS[0].shortName === "P1", "0 semitones = Unison (P1)");
assert(INTERVALS[1].name === "Minor 2nd" && INTERVALS[1].shortName === "m2", "1 semitone = Minor 2nd (m2)");
assert(INTERVALS[2].name === "Major 2nd" && INTERVALS[2].shortName === "M2", "2 semitones = Major 2nd (M2)");
assert(INTERVALS[3].name === "Minor 3rd" && INTERVALS[3].shortName === "m3", "3 semitones = Minor 3rd (m3)");
assert(INTERVALS[4].name === "Major 3rd" && INTERVALS[4].shortName === "M3", "4 semitones = Major 3rd (M3)");
assert(INTERVALS[5].name === "Perfect 4th" && INTERVALS[5].shortName === "P4", "5 semitones = Perfect 4th (P4)");
assert(INTERVALS[6].name === "Tritone" && INTERVALS[6].shortName === "TT", "6 semitones = Tritone (TT)");
assert(INTERVALS[7].name === "Perfect 5th" && INTERVALS[7].shortName === "P5", "7 semitones = Perfect 5th (P5)");
assert(INTERVALS[8].name === "Minor 6th" && INTERVALS[8].shortName === "m6", "8 semitones = Minor 6th (m6)");
assert(INTERVALS[9].name === "Major 6th" && INTERVALS[9].shortName === "M6", "9 semitones = Major 6th (M6)");
assert(INTERVALS[10].name === "Minor 7th" && INTERVALS[10].shortName === "m7", "10 semitones = Minor 7th (m7)");
assert(INTERVALS[11].name === "Major 7th" && INTERVALS[11].shortName === "M7", "11 semitones = Major 7th (M7)");
assert(INTERVALS[12].name === "Octave" && INTERVALS[12].shortName === "P8", "12 semitones = Octave (P8)");

// Chord Qualities
assert(CHORD_QUALITIES.major && CHORD_QUALITIES.major.intervals.join(',') === "0,4,7", "Major triad has intervals [0, 4, 7]");
assert(CHORD_QUALITIES.minor && CHORD_QUALITIES.minor.intervals.join(',') === "0,3,7", "Minor triad has intervals [0, 3, 7]");
assert(CHORD_QUALITIES.dim && CHORD_QUALITIES.dim.intervals.join(',') === "0,3,6", "Diminished triad has intervals [0, 3, 6]");
assert(CHORD_QUALITIES.dom7 && CHORD_QUALITIES.dom7.intervals.join(',') === "0,4,7,10", "Dominant 7th has intervals [0, 4, 7, 10]");
assert(CHORD_QUALITIES.sus4 && CHORD_QUALITIES.sus4.intervals.join(',') === "0,5,7", "Sus4 has intervals [0, 5, 7]");

// Note conversions
assert(midiToNoteName(69) === "A4", "MIDI 69 converts to note name A4");
assert(midiToNoteName(40) === "E2", "MIDI 40 converts to note name E2 (open 6th string)");
assert(noteNameToMidi("A4") === 69, "Note name A4 converts to MIDI 69");
assert(noteNameToMidi("C#3") === 49, "Note name C#3 converts to MIDI 49");
assert(noteNameToMidi("Db3") === 49, "Enharmonic Db3 converts to MIDI 49");
assertClose(midiToFrequency(69), 440.0, 0.001, "MIDI 69 = 440.0 Hz");
assertClose(midiToFrequency(40), 82.407, 0.01, "MIDI 40 (Low E) = 82.41 Hz");

// -----------------------------------------------------------------------------
// SECTION 3: Pitch Verification & ±35 Cents Tuning Window
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: Pitch Verification & ±35 Cent Tolerance Window ---");
const targetMidiA4 = 69; // 440 Hz

// In-tune exact
assert(isPitchWithinTolerance(69, targetMidiA4, 35), "Exact MIDI 69 is within ±35 cent window");
assert(Math.abs(calculateCentsDeviation(69, targetMidiA4)) < 0.01, "Exact MIDI deviation is 0 cents");

// Slightly sharp (+20 cents) -> within tolerance
const sharpMidi = 69 + 0.20;
assert(isPitchWithinTolerance(sharpMidi, targetMidiA4, 35), "+20 cents sharp pitch is accepted within ±35 cent window");
assertClose(calculateCentsDeviation(sharpMidi, targetMidiA4), 20.0, 0.1, "+20 cents deviation calculated correctly");

// Slightly flat (-32 cents) -> within tolerance
const flatMidi = 69 - 0.32;
assert(isPitchWithinTolerance(flatMidi, targetMidiA4, 35), "-32 cents flat pitch is accepted within ±35 cent window");
assertClose(calculateCentsDeviation(flatMidi, targetMidiA4), -32.0, 0.1, "-32 cents deviation calculated correctly");

// Out of tolerance (+42 cents sharp)
const outOfToleranceSharp = 69 + 0.42;
assert(!isPitchWithinTolerance(outOfToleranceSharp, targetMidiA4, 35), "+42 cents sharp pitch is rejected (> 35 cents)");

// Out of tolerance (-38 cents flat)
const outOfToleranceFlat = 69 - 0.38;
assert(!isPitchWithinTolerance(outOfToleranceFlat, targetMidiA4, 35), "-38 cents flat pitch is rejected (> 35 cents)");

// Wrong note entirely (MIDI 70 = A#4)
assert(!isPitchWithinTolerance(70, targetMidiA4, 35), "Wrong semitone (MIDI 70 vs 69) is rejected");

// Real-world DSP payload object verification
const dspPayloadInTune = {
    frequency: 442.54, // ~+10 cents sharp
    midi: 69,
    midiExact: 69.10,
    cents: 10,
    confidence: 0.95,
    isPluck: true
};
assert(isPitchWithinTolerance(dspPayloadInTune, targetMidiA4, 35), "DSP payload object within tolerance passes verification");
assertClose(calculateCentsDeviation(dspPayloadInTune, targetMidiA4), 10.0, 0.1, "DSP payload cents deviation extracted accurately");

const dspPayloadWrong = {
    frequency: 466.16, // A#4
    midi: 70,
    midiExact: 70.0,
    cents: 0,
    confidence: 0.92,
    isPluck: true
};
assert(!isPitchWithinTolerance(dspPayloadWrong, targetMidiA4, 35), "DSP payload for wrong note correctly fails tolerance check");

// -----------------------------------------------------------------------------
// SECTION 4: Guitar Fretboard Spans & Question Generators
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Guitar Fretboard Spans & Question Generators ---");

// Fretboard span validation
const positionsA2 = getGuitarPositions(45); // A2: string 5 fret 0, string 6 fret 5
assert(positionsA2.length >= 2, "A2 has multiple guitar string/fret positions");

// 3 notes within 5 frets: A2 (45), B2 (47), C#3 (49) on 5th string (frets 0, 2, 4)
assert(canPlayWithinSpan([45, 47, 49], 5), "A2, B2, C#3 are playable within a 5-fret span on guitar");

const qGen = new QuestionGenerator();

// 1. Interval Training Generator
const intQuestionT1 = qGen.generateIntervalQuestion(1);
assert(intQuestionT1.mode === GAME_MODES.INTERVAL, "Interval question has mode 'interval'");
assert(intQuestionT1.tier === 1, "Interval question configured for Tier 1");
assert(DIFFICULTY_TIERS[1].intervals.includes(intQuestionT1.intervalSemitones), "Tier 1 interval is within diatonic/3rds/4ths/5ths set");
assert(intQuestionT1.targetMidi === intQuestionT1.rootMidi + intQuestionT1.intervalSemitones, "Target MIDI correctly equals Root MIDI + Semitones");
assert(intQuestionT1.expectedSequence.length === 1 && intQuestionT1.expectedSequence[0] === intQuestionT1.targetMidi, "Expected sequence matches target note");

// 2. Chord Quality Generator
const chordQuestion = qGen.generateChordQuestion(1);
assert(chordQuestion.mode === GAME_MODES.CHORD_QUALITY, "Chord question has mode 'chord_quality'");
assert(["major", "minor"].includes(chordQuestion.qualityKey), "Tier 1 chord quality is Major or Minor");
assert(chordQuestion.chordTones.length >= 3, "Chord has at least 3 chord tones");
assert(chordQuestion.pitchClasses.length >= 3, "Chord has pitch classes array for arpeggiation");

// Tier 3 Chord can produce Diminished
let dimFound = false;
for (let i = 0; i < 50; i++) {
    const q = qGen.generateChordQuestion(3);
    if (q.qualityKey === "dim") {
        dimFound = true;
        assert(q.qualityName === "Diminished", "Diminished chord quality generated in Tier 3");
        break;
    }
}
assert(dimFound, "Tier 3 question generator incorporates Diminished chord quality");

// 3. Call-and-Response Generator
const cnrQuestionT1 = qGen.generateCallAndResponseQuestion(1);
assert(cnrQuestionT1.mode === GAME_MODES.CALL_AND_RESPONSE, "Call-and-response mode is 'call_and_response'");
assert(cnrQuestionT1.motifMidis.length === 3, "Tier 1 Call-and-Response generates exactly 3 notes");
assert(canPlayWithinSpan(cnrQuestionT1.motifMidis, 5), "Tier 1 motif is guaranteed playable within a 5-fret span");

const cnrQuestionT2 = qGen.generateCallAndResponseQuestion(2);
assert(cnrQuestionT2.motifMidis.length === 4, "Tier 2 Call-and-Response generates 4 notes");

const cnrQuestionT3 = qGen.generateCallAndResponseQuestion(3);
assert(cnrQuestionT3.motifMidis.length === 5, "Tier 3 Call-and-Response generates 5 notes");

// -----------------------------------------------------------------------------
// SECTION 5: Score Tracker & Gamification Mechanics
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: Score Tracker & Gamification Mechanics ---");
const tracker = new ScoreTracker({ basePointsPerAnswer: 100, autoAdvanceThreshold: 3 });

assert(tracker.totalScore === 0, "Initial score is 0");
assert(tracker.currentStreak === 0, "Initial streak is 0");
assert(tracker.getAccuracy() === 0, "Initial accuracy is 0%");

// Record 1st correct answer (Tier 1, in-tune, fast reaction 1200ms)
const mockQ1 = { id: "q1", tier: 1, scoreMultiplier: 1.0, timeLimitMs: 5000 };
const res1 = tracker.recordSuccess(mockQ1, 1200, 4); // 4 cents deviation (< 10 gives in-tune bonus)
assert(res1.currentStreak === 1, "Streak increments to 1 after first correct answer");
assert(res1.bestStreak === 1, "Best streak is 1");
assert(res1.pointsEarned > 100, `Points earned (${res1.pointsEarned}) includes base + speed + in-tune bonus`);
assert(tracker.getAccuracy() === 100, "Accuracy is 100% after 1/1 correct");

// Record 2nd correct answer
const res2 = tracker.recordSuccess(mockQ1, 1500, 15);
assert(res2.currentStreak === 2, "Streak increments to 2");
assert(!res2.shouldAdvanceTier, "Should not advance tier before reaching threshold (3)");

// Record 3rd correct answer -> triggers shouldAdvanceTier
const res3 = tracker.recordSuccess(mockQ1, 1100, 2);
assert(res3.currentStreak === 3, "Streak increments to 3");
assert(res3.shouldAdvanceTier === true, "Auto-advance tier flagged after 3 consecutive correct answers");

// Record failure (wrong answer)
const resFail = tracker.recordFailure(mockQ1, 2000, "WRONG");
assert(resFail.currentStreak === 0, "Streak resets to 0 upon wrong answer");
assert(tracker.bestStreak === 3, "Best streak preserves maximum historical streak (3)");
assert(tracker.getAccuracy() === 75.0, `Accuracy adjusts to 75% (3/4 correct, got ${tracker.getAccuracy()}%)`);
assert(tracker.getAverageReactionTimeMs() > 0, `Average reaction time computed: ${tracker.getAverageReactionTimeMs()}ms`);

// -----------------------------------------------------------------------------
// SECTION 6: EarTrainer Orchestrator & Answer Verification
// -----------------------------------------------------------------------------
console.log("\n--- Section 6: EarTrainer Engine & Answer Verification Logic ---");

(async () => {
    const trainer = new EarTrainer({
        tier: 1,
        mode: GAME_MODES.INTERVAL,
        toleranceCents: 35,
        timeLimitMs: 4000,
        autoAdvanceTier: false
    });

    assert(trainer.getState() === STATES.IDLE, "EarTrainer initializes in IDLE state");

    // 1. Interval Verification Test
    let questionSuccessFired = false;
    trainer.onQuestionSuccess = (data) => {
        questionSuccessFired = true;
    };

    // Preset fixed interval question for deterministic test
    const qInterval = {
        id: "test_int_1",
        mode: GAME_MODES.INTERVAL,
        tier: 1,
        rootMidi: 45, // A2
        targetMidi: 52, // E3 (Perfect 5th, +7 semitones)
        intervalSemitones: 7,
        intervalName: "Perfect 5th",
        expectedSequence: [52],
        timeLimitMs: 5000,
        scoreMultiplier: 1.0
    };

    trainer.currentQuestion = qInterval;
    trainer.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    trainer.setState(STATES.AWAITING_INPUT, { question: qInterval });

    // Player plays wrong note (MIDI 50 = D3)
    const matchedWrong = trainer.handlePitchInput({ midi: 50, midiExact: 50.0, isPluck: true });
    assert(!matchedWrong, "Playing wrong interval note does not match");
    assert(trainer.getState() === STATES.FAIL, "State transitions to FAIL on wrong note");

    // Reset and test correct note within ±35 cents
    trainer.setState(STATES.AWAITING_INPUT, { question: qInterval });
    trainer.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    questionSuccessFired = false;

    // Player plays target note E3 with +18 cents sharp
    const matchedCorrect = trainer.handlePitchInput({
        midi: 52,
        midiExact: 52.18,
        cents: 18,
        isPluck: true
    });
    assert(matchedCorrect, "Pitch within +18 cents matches target interval note");
    assert(trainer.getState() === STATES.SUCCESS, "State transitions to SUCCESS upon correct pitch");
    assert(questionSuccessFired, "onQuestionSuccess callback fired");

    // 2. Chord Quality Recognition (Strummed via Chord Recognizer)
    trainer.setMode(GAME_MODES.CHORD_QUALITY);
    const qChord = {
        id: "test_chord_1",
        mode: GAME_MODES.CHORD_QUALITY,
        tier: 1,
        chordName: "Am",
        rootName: "A",
        qualityKey: "minor",
        pitchClasses: [9, 0, 4], // A, C, E
        timeLimitMs: 5000
    };

    trainer.currentQuestion = qChord;
    trainer.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    trainer.setState(STATES.AWAITING_INPUT, { question: qChord });

    // Strum wrong chord: C Major
    const strumWrong = trainer.handleChordInput({ chord: "C", root: "C", quality: "major", confidence: 80 });
    assert(!strumWrong, "Strumming wrong chord quality fails verification");

    // Strum correct chord: A Minor
    trainer.setState(STATES.AWAITING_INPUT, { question: qChord });
    trainer.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const strumCorrect = trainer.handleChordInput({ chord: "Am", root: "A", quality: "minor", confidence: 78 });
    assert(strumCorrect, "Strumming Am with high confidence successfully passes chord question");
    assert(trainer.getState() === STATES.SUCCESS, "State is SUCCESS after correct chord strum");

    // 3. Chord Quality Recognition (Arpeggiated Note-by-Note)
    trainer.setState(STATES.AWAITING_INPUT, { question: qChord });
    trainer.detectedChordPitchClasses.clear();
    trainer.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Player arpeggiates A2 (MIDI 45, pitchClass 9)
    trainer.handlePitchInput({ midi: 45, isPluck: true });
    assert(trainer.detectedChordPitchClasses.has(9), "Root note A detected in arpeggiator buffer");
    assert(trainer.getState() === STATES.AWAITING_INPUT, "Still awaiting input while arpeggio in progress");

    // Player plucks C3 (MIDI 48, pitchClass 0)
    trainer.handlePitchInput({ midi: 48, isPluck: true });
    assert(trainer.detectedChordPitchClasses.has(0), "Minor 3rd note C detected in arpeggiator buffer");

    // Player plucks E3 (MIDI 52, pitchClass 4) -> completes chord!
    trainer.handlePitchInput({ midi: 52, isPluck: true });
    assert(trainer.detectedChordPitchClasses.has(4), "5th note E detected in arpeggiator buffer");
    assert(trainer.getState() === STATES.SUCCESS, "Arpeggiating all chord tones successfully completes chord recognition");

    // 4. Call-and-Response (Melodic Echo) Sequential Matching
    trainer.setMode(GAME_MODES.CALL_AND_RESPONSE);
    const qCallResponse = {
        id: "test_cnr_1",
        mode: GAME_MODES.CALL_AND_RESPONSE,
        tier: 1,
        motifMidis: [45, 47, 50], // A2, B2, D3
        expectedSequence: [45, 47, 50],
        timeLimitMs: 5000
    };

    trainer.currentQuestion = qCallResponse;
    trainer.matchedSequenceIndex = 0;
    trainer.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    trainer.setState(STATES.AWAITING_INPUT, { question: qCallResponse });

    let noteMatchedIndices = [];
    trainer.onNoteMatch = (match) => {
        noteMatchedIndices.push(match.index);
    };

    // Play note 1: A2 (45)
    const n1 = trainer.handlePitchInput({ midi: 45, midiExact: 45.05, isPluck: true });
    assert(n1 && trainer.matchedSequenceIndex === 1, "First note in motif echoed correctly (index 0 -> 1)");

    // Rapid duplicate frame without pluck: should be debounced and ignored
    const duplicateIgnored = trainer.handlePitchInput({ midi: 45, isPluck: false });
    assert(!duplicateIgnored, "Unplucked vibrating frame of same note is successfully debounced");

    // Play note 2: B2 (47)
    // Small artificial delay for debounce window
    trainer.lastPluckTimeMs = 0;
    const n2 = trainer.handlePitchInput({ midi: 47, midiExact: 46.95, isPluck: true });
    assert(n2 && trainer.matchedSequenceIndex === 2, "Second note in motif echoed correctly (index 1 -> 2)");

    // Play note 3: D3 (50)
    trainer.lastPluckTimeMs = 0;
    const n3 = trainer.handlePitchInput({ midi: 50, midiExact: 50.12, isPluck: true });
    assert(n3 && trainer.matchedSequenceIndex === 3, "Third note in motif echoed correctly");
    assert(trainer.getState() === STATES.SUCCESS, "Melodic motif echo completed -> SUCCESS");
    assert(noteMatchedIndices.length === 3, "All 3 notes triggered onNoteMatch notifications");

    // 5. Timeout Handling
    trainer.setState(STATES.AWAITING_INPUT, { question: qCallResponse });
    let timeoutFired = false;
    trainer.onTimeout = () => { timeoutFired = true; };
    trainer.handleTimeout();
    assert(trainer.getState() === STATES.TIMEOUT, "handleTimeout transitions state to TIMEOUT");
    assert(timeoutFired, "onTimeout callback invoked when timer expires");

    // -----------------------------------------------------------------------------
    // SECTION 7: Non-Invasive DSP Subscription Chaining
    // -----------------------------------------------------------------------------
    console.log("\n--- Section 7: Non-Invasive DSP & Chord Recognizer Chaining ---");

    let originalDspCalled = false;
    const mockDSP = {
        onPitchDetected: (data) => {
            originalDspCalled = true;
        }
    };

    trainer.attachDSP(mockDSP);
    assert(typeof mockDSP.onPitchDetected === 'function', "DSP subscription attached");

    // Simulate DSP firing
    mockDSP.onPitchDetected({ midi: 60, midiExact: 60.0, isPluck: true });
    assert(originalDspCalled, "Original DSP callback is preserved and invoked");

    trainer.detachDSP();
    assert(trainer.dsp === null, "DSP successfully detached");

    // -----------------------------------------------------------------------------
    // FINAL SUMMARY
    // -----------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log(`TOTAL TEST RESULTS: ${passed} passed, ${failed} failed.`);
    console.log("================================================================================");

    if (failed > 0) {
        process.exit(1);
    }
})();
