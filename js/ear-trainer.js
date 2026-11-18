/**
 * FretDSP — Interactive Gamified Ear Training & Call-and-Response Practice Module
 * (js/ear-trainer.js)
 *
 * Real-time guitar ear training engine with audio synthesis prompts and
 * real-time pitch/chord verification via DSP and Polyphonic Chord Recognizer inputs.
 *
 * Core Capabilities:
 * 1. Game Modes & Question Generators:
 *    - INTERVAL: Root + target note quiz; prompt guitarist to identify and play the interval.
 *    - CHORD_QUALITY: Major, Minor, Diminished, Dominant 7th, Sus4; strum or arpeggio recognition.
 *    - CALL_AND_RESPONSE: 3 to 5 note melodic echo motifs within a rhythm/time window.
 * 2. Real-Time Pitch Verification:
 *    - Exact cent verification within a ±35 cent tuning window.
 *    - Configurable response window (default 5.0 seconds).
 *    - Pluck transient debouncing and note sequence tracker.
 * 3. Progressive Difficulty Scaling:
 *    - Tier 1: Diatonic steps and major/minor thirds within a 5-fret span.
 *    - Tier 2: 7ths, octaves, and pentatonic skips across multiple strings.
 *    - Tier 3: Chromaticism, tritones, and fast call-and-response riffs.
 * 4. Gamified Scoring & Analytics:
 *    - Streak counters (current & best), accuracy percentage, reaction time tracking,
 *      speed bonus, in-tune bonus, and dynamic tier auto-advancement.
 * 5. Audio Synthesizer Engine:
 *    - Web Audio synthesis (Karplus-Strong & PolySynth via GuitarSynth or self-contained oscillators)
 *    - Headless / Node.js fallback for 100% deterministic unit testing.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.EarTrainer = exports.EarTrainer;
        root.FretDSPEarTrainer = exports;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    // 1. MUSIC THEORY CONSTANTS & LOOKUP TABLES
    // =========================================================================

    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    const ENHARMONICS = {
        "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B",
        "B#": "C", "E#": "F"
    };

    /**
     * Standard 6-string guitar open string MIDI numbers:
     * String 1: E4 (64)
     * String 2: B3 (59)
     * String 3: G3 (55)
     * String 4: D3 (50)
     * String 5: A2 (45)
     * String 6: E2 (40)
     */
    const STANDARD_TUNING_MIDI = [64, 59, 55, 50, 45, 40];

    /**
     * Standard Musical Intervals from 0 (Unison) to 12 (Octave)
     */
    const INTERVALS = {
        0: {
            semitones: 0,
            shortName: "P1",
            name: "Unison",
            quality: "perfect",
            ratio: 1.0,
            tier: 1
        },
        1: {
            semitones: 1,
            shortName: "m2",
            name: "Minor 2nd",
            quality: "minor",
            ratio: 16 / 15,
            tier: 1
        },
        2: {
            semitones: 2,
            shortName: "M2",
            name: "Major 2nd",
            quality: "major",
            ratio: 9 / 8,
            tier: 1
        },
        3: {
            semitones: 3,
            shortName: "m3",
            name: "Minor 3rd",
            quality: "minor",
            ratio: 6 / 5,
            tier: 1
        },
        4: {
            semitones: 4,
            shortName: "M3",
            name: "Major 3rd",
            quality: "major",
            ratio: 5 / 4,
            tier: 1
        },
        5: {
            semitones: 5,
            shortName: "P4",
            name: "Perfect 4th",
            quality: "perfect",
            ratio: 4 / 3,
            tier: 1
        },
        6: {
            semitones: 6,
            shortName: "TT",
            name: "Tritone",
            quality: "diminished",
            aliases: ["Diminished 5th", "Augmented 4th", "d5", "A4"],
            ratio: 45 / 32,
            tier: 3
        },
        7: {
            semitones: 7,
            shortName: "P5",
            name: "Perfect 5th",
            quality: "perfect",
            ratio: 3 / 2,
            tier: 1
        },
        8: {
            semitones: 8,
            shortName: "m6",
            name: "Minor 6th",
            quality: "minor",
            ratio: 8 / 5,
            tier: 2
        },
        9: {
            semitones: 9,
            shortName: "M6",
            name: "Major 6th",
            quality: "major",
            ratio: 5 / 3,
            tier: 2
        },
        10: {
            semitones: 10,
            shortName: "m7",
            name: "Minor 7th",
            quality: "minor",
            ratio: 9 / 5,
            tier: 2
        },
        11: {
            semitones: 11,
            shortName: "M7",
            name: "Major 7th",
            quality: "major",
            ratio: 15 / 8,
            tier: 2
        },
        12: {
            semitones: 12,
            shortName: "P8",
            name: "Octave",
            quality: "perfect",
            ratio: 2.0,
            tier: 2
        }
    };

    /**
     * Supported Chord Qualities for Ear Training
     * Core 5 qualities: Major, Minor, Diminished, Dominant 7th, Sus4.
     */
    const CHORD_QUALITIES = {
        major: {
            key: "major",
            name: "Major",
            suffix: "",
            intervals: [0, 4, 7],
            aliases: ["maj", "M", "Major Triad"],
            tier: 1
        },
        minor: {
            key: "minor",
            name: "Minor",
            suffix: "m",
            intervals: [0, 3, 7],
            aliases: ["min", "m", "Minor Triad"],
            tier: 1
        },
        dom7: {
            key: "dom7",
            name: "Dominant 7th",
            suffix: "7",
            intervals: [0, 4, 7, 10],
            aliases: ["7", "dom7", "Dominant"],
            tier: 2
        },
        sus4: {
            key: "sus4",
            name: "Suspended 4th",
            suffix: "sus4",
            intervals: [0, 5, 7],
            aliases: ["sus4", "sus"],
            tier: 2
        },
        dim: {
            key: "dim",
            name: "Diminished",
            suffix: "dim",
            intervals: [0, 3, 6],
            aliases: ["diminished", "dim", "°"],
            tier: 3
        },
        // Extended qualities
        maj7: {
            key: "maj7",
            name: "Major 7th",
            suffix: "maj7",
            intervals: [0, 4, 7, 11],
            aliases: ["maj7", "M7", "Δ"],
            tier: 2
        },
        m7: {
            key: "m7",
            name: "Minor 7th",
            suffix: "m7",
            intervals: [0, 3, 7, 10],
            aliases: ["m7", "min7", "-7"],
            tier: 2
        },
        sus2: {
            key: "sus2",
            name: "Suspended 2nd",
            suffix: "sus2",
            intervals: [0, 2, 7],
            aliases: ["sus2"],
            tier: 2
        }
    };

    /**
     * Game Modes
     */
    const GAME_MODES = {
        INTERVAL: "interval",
        CHORD_QUALITY: "chord_quality",
        CALL_AND_RESPONSE: "call_and_response"
    };

    /**
     * Difficulty Tiers
     */
    const DIFFICULTY_TIERS = {
        1: {
            level: 1,
            name: "Novice (Tier 1)",
            description: "Diatonic steps and major/minor thirds within a 5-fret span",
            intervals: [0, 1, 2, 3, 4, 5, 7], // Unison, 2nds, 3rds, P4, P5
            chords: ["major", "minor"],
            callAndResponseNotes: 3,
            timeLimitMs: 6000,
            maxFretSpan: 5,
            promptTempoBpm: 80,
            noteDurationSec: 0.7,
            scoreMultiplier: 1.0
        },
        2: {
            level: 2,
            name: "Intermediate (Tier 2)",
            description: "7ths, octaves, and pentatonic skips across multiple strings",
            intervals: [0, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12],
            chords: ["major", "minor", "dom7", "sus4"],
            callAndResponseNotes: 4,
            timeLimitMs: 5000,
            maxFretSpan: 8,
            promptTempoBpm: 100,
            noteDurationSec: 0.5,
            scoreMultiplier: 1.5
        },
        3: {
            level: 3,
            name: "Advanced (Tier 3)",
            description: "Chromaticism, tritones, and fast call-and-response riffs",
            intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], // All chromatic intervals including TT (6)
            chords: ["major", "minor", "dom7", "sus4", "dim"],
            callAndResponseNotes: 5,
            timeLimitMs: 3800,
            maxFretSpan: 12,
            promptTempoBpm: 125,
            noteDurationSec: 0.35,
            scoreMultiplier: 2.0
        }
    };

    /**
     * State Machine States
     */
    const STATES = {
        IDLE: "IDLE",
        GENERATING: "GENERATING",
        PLAYING_PROMPT: "PLAYING_PROMPT",
        AWAITING_INPUT: "AWAITING_INPUT",
        EVALUATING: "EVALUATING",
        SUCCESS: "SUCCESS",
        FAIL: "FAIL",
        TIMEOUT: "TIMEOUT"
    };

    // =========================================================================
    // 2. HELPER UTILITIES: PITCH, MIDI, FREQUENCY & CENTS
    // =========================================================================

    /**
     * Converts MIDI note number (e.g. 69 = A4) to fundamental frequency in Hz.
     */
    function midiToFrequency(midi, a4 = 440) {
        return a4 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * Converts frequency in Hz to exact fractional MIDI note number.
     */
    function frequencyToMidiExact(freq, a4 = 440) {
        if (!freq || freq <= 0) return 0;
        return 69 + 12 * Math.log2(freq / a4);
    }

    /**
     * Converts MIDI note number to note name string (e.g. 60 -> "C4", 69 -> "A4").
     */
    function midiToNoteName(midi, includeOctave = true) {
        const rounded = Math.round(midi);
        const pitchClass = ((rounded % 12) + 12) % 12;
        const name = NOTE_NAMES[pitchClass];
        if (!includeOctave) return name;
        const octave = Math.floor(rounded / 12) - 1;
        return `${name}${octave}`;
    }

    /**
     * Converts note name (e.g. "C4", "A#2", "Bb3") to MIDI note number.
     */
    function noteNameToMidi(name) {
        if (typeof name !== 'string') return 60;
        const match = name.trim().match(/^([A-Ga-g][#b]?)(-?\d+)?$/);
        if (!match) return 60;

        let letter = match[1].charAt(0).toUpperCase();
        let accidental = match[1].length > 1 ? (match[1].charAt(1) === '#' ? '#' : 'b') : '';
        let note = letter + accidental;
        if (ENHARMONICS[note]) {
            note = ENHARMONICS[note];
        }

        const pitchIndex = NOTE_NAMES.indexOf(note);
        if (pitchIndex === -1) return 60;

        const octave = match[2] !== undefined ? parseInt(match[2], 10) : 4;
        return (octave + 1) * 12 + pitchIndex;
    }

    /**
     * Normalizes chord quality name or key into canonical key.
     */
    function normalizeChordQualityKey(qualityInput) {
        if (!qualityInput) return "major";
        const q = String(qualityInput).trim().toLowerCase();
        for (const [key, def] of Object.entries(CHORD_QUALITIES)) {
            if (key.toLowerCase() === q || def.name.toLowerCase() === q) return key;
            if (def.suffix.toLowerCase() === q && q !== "") return key;
            if (def.aliases && def.aliases.some(a => a.toLowerCase() === q)) return key;
        }
        return "major";
    }

    /**
     * Calculates the signed cent difference between detected pitch and target pitch.
     * Positive = sharp, Negative = flat.
     *
     * @param {number|Object} detected - MIDI number, exact float, or note payload object
     * @param {number} targetMidi - Target MIDI integer
     * @returns {number} Deviation in cents
     */
    function calculateCentsDeviation(detected, targetMidi) {
        if (detected === null || detected === undefined) return 9999;

        // If detected is a note payload object from GuitarDSP
        if (typeof detected === 'object') {
            if (typeof detected.midiExact === 'number') {
                return (detected.midiExact - targetMidi) * 100;
            }
            if (typeof detected.frequency === 'number' && detected.frequency > 0) {
                const targetFreq = midiToFrequency(targetMidi);
                return 1200 * Math.log2(detected.frequency / targetFreq);
            }
            if (typeof detected.midi === 'number') {
                const cents = typeof detected.cents === 'number' ? detected.cents : 0;
                return (detected.midi - targetMidi) * 100 + cents;
            }
        }

        // Numeric direct MIDI value
        if (typeof detected === 'number') {
            return (detected - targetMidi) * 100;
        }

        return 9999;
    }

    /**
     * Evaluates if a detected pitch is within the tolerance window of target MIDI.
     * Default tolerance is ±35 cents.
     */
    function isPitchWithinTolerance(detected, targetMidi, toleranceCents = 35, allowOctave = false) {
        if (detected === null || detected === undefined) return false;

        let detectedMidiExact;
        if (typeof detected === 'object') {
            if (typeof detected.midiExact === 'number') {
                detectedMidiExact = detected.midiExact;
            } else if (typeof detected.frequency === 'number' && detected.frequency > 0) {
                detectedMidiExact = frequencyToMidiExact(detected.frequency);
            } else if (typeof detected.midi === 'number') {
                const cents = typeof detected.cents === 'number' ? detected.cents : 0;
                detectedMidiExact = detected.midi + cents / 100;
            } else {
                return false;
            }
        } else if (typeof detected === 'number') {
            detectedMidiExact = detected;
        } else {
            return false;
        }

        if (allowOctave) {
            // Find closest octave of targetMidi
            const octaveOffset = Math.round((detectedMidiExact - targetMidi) / 12) * 12;
            const nearestOctaveTarget = targetMidi + octaveOffset;
            const diffCents = Math.abs((detectedMidiExact - nearestOctaveTarget) * 100);
            return diffCents <= toleranceCents;
        }

        const diffCents = Math.abs((detectedMidiExact - targetMidi) * 100);
        return diffCents <= toleranceCents;
    }

    /**
     * Resolves guitar positions (string & fret) for a given MIDI note in standard tuning.
     */
    function getGuitarPositions(midi, maxFret = 22) {
        const positions = [];
        for (let s = 0; s < STANDARD_TUNING_MIDI.length; s++) {
            const openMidi = STANDARD_TUNING_MIDI[s];
            const fret = midi - openMidi;
            if (fret >= 0 && fret <= maxFret) {
                positions.push({
                    string: s + 1, // 1 to 6
                    fret: fret,
                    midi: midi
                });
            }
        }
        return positions;
    }

    /**
     * Checks if a set of MIDI notes can be played within a given fret span (e.g. 5 frets).
     */
    function canPlayWithinSpan(midiNotes, maxSpan = 5, maxFret = 22) {
        if (!midiNotes || midiNotes.length === 0) return true;

        // Collect possible frets for each note
        const notePositions = midiNotes.map(m => getGuitarPositions(m, maxFret));
        if (notePositions.some(p => p.length === 0)) return false;

        // Recursive or iterative search for a combination of frets with span <= maxSpan
        function searchCombination(noteIdx, currentMinFret, currentMaxFret) {
            if (noteIdx >= notePositions.length) {
                return (currentMaxFret - currentMinFret) <= maxSpan;
            }

            for (const pos of notePositions[noteIdx]) {
                // Open strings (fret 0) don't widen the fingering fret span box
                const newMin = pos.fret === 0 ? currentMinFret : (currentMinFret === null ? pos.fret : Math.min(currentMinFret, pos.fret));
                const newMax = pos.fret === 0 ? currentMaxFret : (currentMaxFret === null ? pos.fret : Math.max(currentMaxFret, pos.fret));

                if (newMin !== null && newMax !== null && (newMax - newMin) > maxSpan) {
                    continue;
                }

                if (searchCombination(noteIdx + 1, newMin, newMax)) {
                    return true;
                }
            }
            return false;
        }

        return searchCombination(0, null, null);
    }

    // =========================================================================
    // 3. QUESTION GENERATORS (Intervals, Chords, Call-and-Response)
    // =========================================================================

    class QuestionGenerator {
        constructor(options = {}) {
            this.a4 = options.a4 || 440;
            this.randomSeed = options.randomSeed || null;
        }

        _randomChoice(array) {
            if (!array || array.length === 0) return null;
            return array[Math.floor(Math.random() * array.length)];
        }

        _randomInt(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
        }

        /**
         * Generates an Interval Training Question
         *
         * @param {number} tierLevel - 1, 2, or 3
         * @param {Object} options - Custom overrides
         */
        generateIntervalQuestion(tierLevel = 1, options = {}) {
            const tier = DIFFICULTY_TIERS[tierLevel] || DIFFICULTY_TIERS[1];
            const allowedSemitones = options.allowedIntervals || tier.intervals;

            // Pick interval
            const semitones = this._randomChoice(allowedSemitones);
            const intervalDef = INTERVALS[semitones] || INTERVALS[0];

            // Pick root note suitable for guitar (between E2=40 and G4=67)
            // Tier 1 keeps roots in comfortable lower/middle register (E2 to D3 or A2 to E3)
            let minRoot = 45; // A2
            let maxRoot = 57; // A3
            if (tierLevel === 1) {
                minRoot = 45; // A2
                maxRoot = 55; // G3
            } else if (tierLevel === 3) {
                minRoot = 40; // E2
                maxRoot = 64; // E4
            }

            const rootMidi = options.rootMidi !== undefined ? options.rootMidi : this._randomInt(minRoot, maxRoot);
            const targetMidi = rootMidi + semitones;

            // Compute fret span
            const positions = getGuitarPositions(targetMidi);
            const rootPositions = getGuitarPositions(rootMidi);

            return {
                id: `q_int_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                mode: GAME_MODES.INTERVAL,
                tier: tierLevel,
                tierName: tier.name,
                rootMidi: rootMidi,
                rootNoteName: midiToNoteName(rootMidi),
                targetMidi: targetMidi,
                targetNoteName: midiToNoteName(targetMidi),
                intervalSemitones: semitones,
                intervalShortName: intervalDef.shortName,
                intervalName: intervalDef.name,
                intervalQuality: intervalDef.quality,
                direction: "ascending",
                expectedSequence: [targetMidi], // Player must play the target note (or root then target)
                expectedNoteNames: [midiToNoteName(targetMidi)],
                fretSpan: tier.maxFretSpan,
                timeLimitMs: options.timeLimitMs || tier.timeLimitMs,
                scoreMultiplier: tier.scoreMultiplier,
                candidatePositions: positions,
                rootPositions: rootPositions,
                promptPromptText: `Identify and play the ${intervalDef.name} (${intervalDef.shortName}) above ${midiToNoteName(rootMidi)}.`
            };
        }

        /**
         * Generates a Chord Quality Recognition Question
         *
         * @param {number} tierLevel - 1, 2, or 3
         * @param {Object} options - Custom overrides
         */
        generateChordQuestion(tierLevel = 1, options = {}) {
            const tier = DIFFICULTY_TIERS[tierLevel] || DIFFICULTY_TIERS[1];
            const allowedQualities = options.allowedQualities || tier.chords;

            const qualityKey = normalizeChordQualityKey(this._randomChoice(allowedQualities));
            const qualityDef = CHORD_QUALITIES[qualityKey] || CHORD_QUALITIES.major;

            // Pick root note: popular guitar keys (C, A, G, E, D, F, B)
            const commonRoots = [
                { name: "C", midiRoot: 48 }, // C3
                { name: "A", midiRoot: 45 }, // A2
                { name: "G", midiRoot: 43 }, // G2
                { name: "E", midiRoot: 40 }, // E2
                { name: "D", midiRoot: 50 }, // D3
                { name: "F", midiRoot: 41 }, // F2
                { name: "B", midiRoot: 47 }  // B2
            ];

            const rootChoice = this._randomChoice(commonRoots);
            const rootName = rootChoice.name;
            const rootMidi = rootChoice.midiRoot;
            const chordName = `${rootName}${qualityDef.suffix}`;

            // Build chord tone MIDI numbers for arpeggiation checking
            const chordTones = qualityDef.intervals.map(int => rootMidi + int);
            const pitchClasses = qualityDef.intervals.map(int => (NOTE_NAMES.indexOf(rootName) + int) % 12);

            return {
                id: `q_chd_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                mode: GAME_MODES.CHORD_QUALITY,
                tier: tierLevel,
                tierName: tier.name,
                chordName: chordName,
                rootName: rootName,
                rootMidi: rootMidi,
                qualityKey: qualityKey,
                qualityName: qualityDef.name,
                qualitySuffix: qualityDef.suffix,
                intervals: qualityDef.intervals,
                chordTones: chordTones,
                pitchClasses: pitchClasses,
                expectedSequence: chordTones,
                timeLimitMs: options.timeLimitMs || (tier.timeLimitMs + 1000),
                scoreMultiplier: tier.scoreMultiplier * 1.25,
                promptPromptText: `Listen to the chord and strum or arpeggiate ${chordName} (${qualityDef.name}).`
            };
        }

        /**
         * Generates a Call-and-Response (Melodic Echo) Motif
         *
         * @param {number} tierLevel - 1, 2, or 3
         * @param {Object} options - Custom overrides
         */
        generateCallAndResponseQuestion(tierLevel = 1, options = {}) {
            const tier = DIFFICULTY_TIERS[tierLevel] || DIFFICULTY_TIERS[1];
            const numNotes = options.numNotes || tier.callAndResponseNotes;

            let motifMidis = [];
            let isValidMotif = false;
            let attempts = 0;

            // Generate motif conforming to tier criteria
            while (!isValidMotif && attempts < 100) {
                attempts++;
                motifMidis = [];

                if (tierLevel === 1) {
                    // Tier 1: Diatonic steps and major/minor thirds within a 5-fret span
                    // Choose a root in guitar 1st or 2nd position (e.g. C major / A minor pentatonic frets 0-4 or 5-9)
                    const baseMidi = this._randomChoice([45, 48, 50, 52, 55]); // A2, C3, D3, E3, G3
                    const diatonicSteps = [0, 2, 4, 5, 7, 9]; // Major scale tones
                    let currentStepIndex = this._randomInt(0, 2);
                    motifMidis.push(baseMidi + diatonicSteps[currentStepIndex]);

                    for (let i = 1; i < numNotes; i++) {
                        // Steps or thirds: delta -2, -1, +1, +2 scale degrees
                        const delta = this._randomChoice([-2, -1, 1, 2]);
                        currentStepIndex = Math.max(0, Math.min(diatonicSteps.length - 1, currentStepIndex + delta));
                        motifMidis.push(baseMidi + diatonicSteps[currentStepIndex]);
                    }

                    // Verify 5-fret span constraint
                    if (canPlayWithinSpan(motifMidis, tier.maxFretSpan)) {
                        isValidMotif = true;
                    }
                } else if (tierLevel === 2) {
                    // Tier 2: 7ths, octaves, and pentatonic skips across multiple strings
                    const baseMidi = this._randomChoice([40, 45, 50, 55]); // E2, A2, D3, G3
                    const pentatonicIntervals = [0, 3, 5, 7, 10, 12]; // Minor pentatonic + octave
                    motifMidis.push(baseMidi);

                    for (let i = 1; i < numNotes; i++) {
                        const intv = this._randomChoice(pentatonicIntervals);
                        motifMidis.push(baseMidi + intv);
                    }
                    isValidMotif = true;
                } else {
                    // Tier 3: Chromaticism, tritones, and fast call-and-response riffs
                    const baseMidi = this._randomChoice([40, 45, 48, 52]);
                    const chromaticDeltas = [0, 1, 3, 6, 7, 10, 11, 12]; // Includes tritone (6) and semitone (1)
                    motifMidis.push(baseMidi);

                    for (let i = 1; i < numNotes; i++) {
                        const delta = this._randomChoice(chromaticDeltas);
                        motifMidis.push(baseMidi + delta);
                    }
                    isValidMotif = true;
                }
            }

            // Fallback if random generator couldn't find a 5-fret span in 100 tries
            if (!isValidMotif || motifMidis.length === 0) {
                motifMidis = [45, 47, 49]; // A2, B2, C#2
            }

            const expectedNames = motifMidis.map(m => midiToNoteName(m));

            return {
                id: `q_cnr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
                mode: GAME_MODES.CALL_AND_RESPONSE,
                tier: tierLevel,
                tierName: tier.name,
                motifMidis: motifMidis,
                expectedSequence: motifMidis,
                expectedNoteNames: expectedNames,
                numNotes: motifMidis.length,
                tempoBpm: tier.promptTempoBpm,
                noteDurationSec: tier.noteDurationSec,
                timeLimitMs: options.timeLimitMs || tier.timeLimitMs,
                scoreMultiplier: tier.scoreMultiplier * 1.5,
                promptPromptText: `Listen to the ${numNotes}-note motif and immediately echo it back on guitar.`
            };
        }
    }

    // =========================================================================
    // 4. AUDIO PROMPT SYNTHESIS (Web Audio & Node.js Mock Bridge)
    // =========================================================================

    class AudioPromptPlayer {
        constructor(options = {}) {
            this.guitarSynth = options.guitarSynth || null;
            this.audioCtx = options.audioCtx || (this.guitarSynth ? this.guitarSynth.audioCtx : null);
            this.volume = options.volume !== undefined ? options.volume : 0.75;
            this.isNode = typeof window === 'undefined' && typeof process !== 'undefined';
            this.activeTimeouts = [];
        }

        async initAudioContext() {
            if (this.audioCtx) {
                if (this.audioCtx.state === 'suspended') {
                    await this.audioCtx.resume();
                }
                return;
            }

            if (typeof window !== 'undefined') {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                if (AudioContextClass) {
                    this.audioCtx = new AudioContextClass();
                }
            }
        }

        stopAll() {
            for (const t of this.activeTimeouts) {
                clearTimeout(t);
            }
            this.activeTimeouts = [];
        }

        _playTone(midi, duration = 0.8, delayMs = 0) {
            if (this.isNode || !this.audioCtx) return;

            const t = setTimeout(() => {
                if (this.guitarSynth && typeof this.guitarSynth.playNote === 'function') {
                    this.guitarSynth.playNote(midi, duration, this.volume);
                    return;
                }

                // Self-contained oscillator fallback
                try {
                    const now = this.audioCtx.currentTime;
                    const freq = midiToFrequency(midi);
                    const osc = this.audioCtx.createOscillator();
                    const gain = this.audioCtx.createGain();

                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(freq, now);

                    gain.gain.setValueAtTime(0.0001, now);
                    gain.gain.exponentialRampToValueAtTime(this.volume, now + 0.02);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

                    osc.connect(gain);
                    gain.connect(this.audioCtx.destination);

                    osc.start(now);
                    osc.stop(now + duration + 0.05);
                } catch (e) {
                    // AudioContext closed or blocked
                }
            }, delayMs);

            this.activeTimeouts.push(t);
        }

        /**
         * Plays prompt audio for any question object.
         * Returns a Promise that resolves when the audio playback completes.
         */
        async playQuestionPrompt(question, onNotePlayed = null) {
            this.stopAll();
            await this.initAudioContext();

            return new Promise((resolve) => {
                if (!question) {
                    resolve();
                    return;
                }

                if (question.mode === GAME_MODES.INTERVAL) {
                    // Interval prompt: Root note -> 250ms silence -> Target note
                    const noteDur = 0.75;
                    const pauseMs = 300;
                    const rootDurMs = noteDur * 1000;

                    // Play root note
                    this._playTone(question.rootMidi, noteDur, 0);
                    if (onNotePlayed) onNotePlayed(question.rootMidi, 0);

                    // Play target note after root finishes + pause
                    const targetDelayMs = rootDurMs + pauseMs;
                    const t = setTimeout(() => {
                        this._playTone(question.targetMidi, noteDur, 0);
                        if (onNotePlayed) onNotePlayed(question.targetMidi, 1);
                    }, targetDelayMs);
                    this.activeTimeouts.push(t);

                    const totalMs = targetDelayMs + rootDurMs + 200;
                    const endTimeout = setTimeout(() => {
                        resolve();
                    }, totalMs);
                    this.activeTimeouts.push(endTimeout);

                } else if (question.mode === GAME_MODES.CHORD_QUALITY) {
                    // Chord prompt: Natural arpeggiated strum (40ms string delay)
                    const strumDelayMs = 45;
                    const ringDuration = 1.8;
                    const chordTones = question.chordTones || [];

                    chordTones.forEach((midi, idx) => {
                        const delay = idx * strumDelayMs;
                        this._playTone(midi, ringDuration, delay);
                        if (onNotePlayed) {
                            const t = setTimeout(() => onNotePlayed(midi, idx), delay);
                            this.activeTimeouts.push(t);
                        }
                    });

                    const totalMs = (chordTones.length * strumDelayMs) + 1200;
                    const endTimeout = setTimeout(() => {
                        resolve();
                    }, totalMs);
                    this.activeTimeouts.push(endTimeout);

                } else if (question.mode === GAME_MODES.CALL_AND_RESPONSE) {
                    // Call-and-response prompt: Sequential notes with rhythmic pacing
                    const intervalMs = Math.round((60000 / (question.tempoBpm || 90)) * 0.85);
                    const noteDur = (question.noteDurationSec || 0.5);
                    const motif = question.motifMidis || [];

                    motif.forEach((midi, idx) => {
                        const delay = idx * intervalMs;
                        this._playTone(midi, noteDur, delay);
                        if (onNotePlayed) {
                            const t = setTimeout(() => onNotePlayed(midi, idx), delay);
                            this.activeTimeouts.push(t);
                        }
                    });

                    const totalMs = (motif.length * intervalMs) + Math.round(noteDur * 1000) + 150;
                    const endTimeout = setTimeout(() => {
                        resolve();
                    }, totalMs);
                    this.activeTimeouts.push(endTimeout);
                } else {
                    resolve();
                }
            });
        }
    }

    // =========================================================================
    // 5. SCORE TRACKER & GAMIFICATION ENGINE
    // =========================================================================

    class ScoreTracker {
        constructor(options = {}) {
            this.basePointsPerAnswer = options.basePointsPerAnswer || 100;
            this.streakBonusPct = options.streakBonusPct || 0.15; // +15% per streak count
            this.maxStreakBonusPct = options.maxStreakBonusPct || 1.5; // max +150%
            this.autoAdvanceThreshold = options.autoAdvanceThreshold || 5; // advance after 5 consecutive correct answers
            this.autoDemoteThreshold = options.autoDemoteThreshold || 3; // demote after 3 consecutive errors

            this.reset();
        }

        reset() {
            this.totalScore = 0;
            this.totalQuestions = 0;
            this.totalAnswered = 0;
            this.totalCorrect = 0;
            this.totalWrong = 0;
            this.totalTimeout = 0;
            this.currentStreak = 0;
            this.bestStreak = 0;
            this.consecutiveFailures = 0;
            this.reactionTimes = [];
            this.history = [];
        }

        getAccuracy() {
            if (this.totalAnswered === 0) return 0.0;
            return Math.round((this.totalCorrect / this.totalAnswered) * 1000) / 10;
        }

        getAverageReactionTimeMs() {
            if (this.reactionTimes.length === 0) return 0;
            const sum = this.reactionTimes.reduce((acc, val) => acc + val, 0);
            return Math.round(sum / this.reactionTimes.length);
        }

        /**
         * Calculates score delta for a correct answer.
         */
        calculateScore(question, reactionTimeMs, centsDeviation = 0) {
            const multiplier = (question && question.scoreMultiplier) ? question.scoreMultiplier : 1.0;
            const streakBonus = Math.min(this.maxStreakBonusPct, this.currentStreak * this.streakBonusPct);

            // Base score with tier/mode multiplier
            let score = this.basePointsPerAnswer * multiplier;

            // Apply streak bonus
            score *= (1.0 + streakBonus);

            // Speed bonus: answering faster than 2 seconds gives bonus points
            if (reactionTimeMs > 0 && question && question.timeLimitMs) {
                const remainingRatio = Math.max(0, (question.timeLimitMs - reactionTimeMs) / question.timeLimitMs);
                score += Math.round(remainingRatio * 60);
            }

            // In-tune accuracy bonus: if within ±10 cents, reward with bonus
            if (Math.abs(centsDeviation) <= 10) {
                score += 30; // Sweet pitch bonus
            }

            return Math.round(score);
        }

        recordSuccess(question, reactionTimeMs, centsDeviation = 0) {
            this.totalQuestions++;
            this.totalAnswered++;
            this.totalCorrect++;
            this.currentStreak++;
            this.consecutiveFailures = 0;

            if (this.currentStreak > this.bestStreak) {
                this.bestStreak = this.currentStreak;
            }

            if (reactionTimeMs > 0) {
                this.reactionTimes.push(reactionTimeMs);
            }

            const pointsEarned = this.calculateScore(question, reactionTimeMs, centsDeviation);
            this.totalScore += pointsEarned;

            const record = {
                questionId: question ? question.id : null,
                mode: question ? question.mode : null,
                tier: question ? question.tier : 1,
                outcome: "SUCCESS",
                pointsEarned: pointsEarned,
                reactionTimeMs: reactionTimeMs,
                centsDeviation: centsDeviation,
                streak: this.currentStreak,
                timestamp: Date.now()
            };
            this.history.push(record);

            const shouldAdvanceTier = (this.currentStreak > 0) && (this.currentStreak % this.autoAdvanceThreshold === 0);

            return {
                pointsEarned: pointsEarned,
                totalScore: this.totalScore,
                currentStreak: this.currentStreak,
                bestStreak: this.bestStreak,
                accuracy: this.getAccuracy(),
                averageReactionTimeMs: this.getAverageReactionTimeMs(),
                shouldAdvanceTier: shouldAdvanceTier
            };
        }

        recordFailure(question, reactionTimeMs, reason = "WRONG") {
            this.totalQuestions++;
            this.totalAnswered++;
            if (reason === "TIMEOUT") {
                this.totalTimeout++;
            } else {
                this.totalWrong++;
            }

            this.currentStreak = 0;
            this.consecutiveFailures++;

            const record = {
                questionId: question ? question.id : null,
                mode: question ? question.mode : null,
                tier: question ? question.tier : 1,
                outcome: reason,
                pointsEarned: 0,
                reactionTimeMs: reactionTimeMs,
                centsDeviation: null,
                streak: 0,
                timestamp: Date.now()
            };
            this.history.push(record);

            const shouldDemoteTier = (this.consecutiveFailures >= this.autoDemoteThreshold);

            return {
                pointsEarned: 0,
                totalScore: this.totalScore,
                currentStreak: 0,
                bestStreak: this.bestStreak,
                accuracy: this.getAccuracy(),
                averageReactionTimeMs: this.getAverageReactionTimeMs(),
                shouldDemoteTier: shouldDemoteTier
            };
        }

        getStats() {
            return {
                totalScore: this.totalScore,
                totalQuestions: this.totalQuestions,
                totalAnswered: this.totalAnswered,
                totalCorrect: this.totalCorrect,
                totalWrong: this.totalWrong,
                totalTimeout: this.totalTimeout,
                accuracy: this.getAccuracy(),
                currentStreak: this.currentStreak,
                bestStreak: this.bestStreak,
                averageReactionTimeMs: this.getAverageReactionTimeMs(),
                recentHistory: this.history.slice(-10)
            };
        }
    }

    // =========================================================================
    // 6. EAR TRAINER ORCHESTRATOR CLASS
    // =========================================================================

    class EarTrainer {
        constructor(options = {}) {
            // Configuration
            this.toleranceCents = options.toleranceCents !== undefined ? options.toleranceCents : 35; // ±35 cent window
            this.timeLimitMs = options.timeLimitMs || 5000; // 5-second response limit
            this.currentTier = options.tier || 1; // 1, 2, or 3
            this.currentMode = options.mode || GAME_MODES.INTERVAL;
            this.autoAdvanceTier = options.autoAdvanceTier !== undefined ? options.autoAdvanceTier : true;
            this.allowOctaveEquivalent = options.allowOctaveEquivalent || false;
            this.strictSequence = options.strictSequence !== undefined ? options.strictSequence : true;
            this.minNoteIntervalMs = options.minNoteIntervalMs || 120; // Refractory debounce window

            // Core sub-components
            this.questionGenerator = new QuestionGenerator();
            this.promptPlayer = new AudioPromptPlayer({
                guitarSynth: options.guitarSynth || null,
                audioCtx: options.audioCtx || null,
                volume: options.volume || 0.8
            });
            this.scoreTracker = new ScoreTracker(options);

            // State management
            this.state = STATES.IDLE;
            this.currentQuestion = null;
            this.questionStartTime = 0;
            this.inputStartTime = 0;
            this.firstNoteTime = 0;
            this.timeoutId = null;

            // Real-time answer tracking
            this.matchedSequenceIndex = 0;
            this.detectedNotesBuffer = [];
            this.detectedChordPitchClasses = new Set();
            this.lastPluckTimeMs = 0;
            this.lastPluckMidi = -1;

            // DSP & Chord Engine References (Read-only subscriptions)
            this.dsp = null;
            this.chordEngine = null;
            this._boundPitchHandler = null;
            this._boundChordHandler = null;

            // Callback hooks
            this.onQuestionGenerated = options.onQuestionGenerated || null;
            this.onPromptStart = options.onPromptStart || null;
            this.onPromptEnd = options.onPromptEnd || null;
            this.onNoteMatch = options.onNoteMatch || null;
            this.onQuestionSuccess = options.onQuestionSuccess || null;
            this.onQuestionFail = options.onQuestionFail || null;
            this.onTimeout = options.onTimeout || null;
            this.onStateChange = options.onStateChange || null;
            this.onTierChange = options.onTierChange || null;
            this.onScoreUpdate = options.onScoreUpdate || null;
        }

        // ---------------------------------------------------------------------
        // State Machine Management
        // ---------------------------------------------------------------------

        setState(newState, payload = {}) {
            const oldState = this.state;
            this.state = newState;
            if (this.onStateChange) {
                this.onStateChange(newState, oldState, payload);
            }
        }

        getState() {
            return this.state;
        }

        setTier(tierLevel) {
            const level = Math.max(1, Math.min(3, parseInt(tierLevel, 10) || 1));
            const oldTier = this.currentTier;
            this.currentTier = level;
            if (this.onTierChange && oldTier !== level) {
                this.onTierChange(level, oldTier);
            }
            return this.currentTier;
        }

        setMode(mode) {
            if (Object.values(GAME_MODES).includes(mode)) {
                this.currentMode = mode;
            }
            return this.currentMode;
        }

        // ---------------------------------------------------------------------
        // Non-Invasive Subscriptions to DSP & Chord Recognizer
        // ---------------------------------------------------------------------

        /**
         * Safely subscribes to a GuitarDSP instance without modifying its internals.
         */
        attachDSP(dsp) {
            if (!dsp) return;
            this.detachDSP();
            this.dsp = dsp;

            const existingPitchCallback = dsp.onPitchDetected;
            this._boundPitchHandler = (pitchData) => {
                if (existingPitchCallback) {
                    existingPitchCallback(pitchData);
                }
                this.handlePitchInput(pitchData);
            };
            dsp.onPitchDetected = this._boundPitchHandler;
        }

        detachDSP() {
            if (this.dsp && this._boundPitchHandler) {
                // Restore if possible
                this.dsp = null;
                this._boundPitchHandler = null;
            }
        }

        /**
         * Safely subscribes to ChordEngine / ChordRecognizer outputs without modifying internals.
         */
        attachChordEngine(chordRecognizer) {
            if (!chordRecognizer) return;
            this.chordEngine = chordRecognizer;
        }

        detachChordEngine() {
            this.chordEngine = null;
        }

        // ---------------------------------------------------------------------
        // Question Flow & Lifecycle
        // ---------------------------------------------------------------------

        /**
         * Generates and begins the next question for current mode and tier.
         */
        async nextQuestion(customOptions = {}) {
            this._clearCountdown();
            this.promptPlayer.stopAll();

            this.setState(STATES.GENERATING);

            const tier = customOptions.tier || this.currentTier;
            const mode = customOptions.mode || this.currentMode;

            let question;
            if (mode === GAME_MODES.INTERVAL) {
                question = this.questionGenerator.generateIntervalQuestion(tier, customOptions);
            } else if (mode === GAME_MODES.CHORD_QUALITY) {
                question = this.questionGenerator.generateChordQuestion(tier, customOptions);
            } else {
                question = this.questionGenerator.generateCallAndResponseQuestion(tier, customOptions);
            }

            this.currentQuestion = question;
            this.matchedSequenceIndex = 0;
            this.detectedNotesBuffer = [];
            this.detectedChordPitchClasses.clear();
            this.firstNoteTime = 0;

            if (this.onQuestionGenerated) {
                this.onQuestionGenerated(question);
            }

            // Play audio prompt
            this.setState(STATES.PLAYING_PROMPT, { question });
            if (this.onPromptStart) {
                this.onPromptStart(question);
            }

            await this.promptPlayer.playQuestionPrompt(question);

            if (this.state !== STATES.PLAYING_PROMPT) {
                // Was cancelled or reset during playback
                return question;
            }

            // Prompt finished: Start timer and await input
            this.inputStartTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            this.setState(STATES.AWAITING_INPUT, { question });
            if (this.onPromptEnd) {
                this.onPromptEnd(question);
            }

            this._startCountdown(question.timeLimitMs || this.timeLimitMs);
            return question;
        }

        _startCountdown(durationMs) {
            this._clearCountdown();
            this.timeoutId = setTimeout(() => {
                this.handleTimeout();
            }, durationMs);
        }

        _clearCountdown() {
            if (this.timeoutId) {
                clearTimeout(this.timeoutId);
                this.timeoutId = null;
            }
        }

        handleTimeout() {
            if (this.state !== STATES.AWAITING_INPUT && this.state !== STATES.EVALUATING) {
                return;
            }

            this._clearCountdown();
            const question = this.currentQuestion;
            const reactionTime = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.inputStartTime;

            const scoreResult = this.scoreTracker.recordFailure(question, reactionTime, "TIMEOUT");
            this.setState(STATES.TIMEOUT, { question, scoreResult });

            if (this.onTimeout) {
                this.onTimeout({ question, reactionTime });
            }
            if (this.onQuestionFail) {
                this.onQuestionFail({
                    question,
                    reason: "TIMEOUT",
                    reactionTime,
                    scoreResult
                });
            }
            if (this.onScoreUpdate) {
                this.onScoreUpdate(this.scoreTracker.getStats());
            }

            if (scoreResult.shouldDemoteTier && this.autoAdvanceTier && this.currentTier > 1) {
                this.setTier(this.currentTier - 1);
            }
        }

        // ---------------------------------------------------------------------
        // Real-Time Pitch & Chord Input Evaluation
        // ---------------------------------------------------------------------

        /**
         * Main pitch input handler. Call directly or through DSP subscription.
         *
         * @param {Object|number} notePayload - Object with { midi, midiExact, frequency, cents, isPluck, time }
         *                                       or numeric MIDI number.
         */
        handlePitchInput(notePayload) {
            if (this.state !== STATES.AWAITING_INPUT && this.state !== STATES.EVALUATING) {
                return false;
            }

            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

            // Extract MIDI and plucking criteria
            let midi = -1;
            let midiExact = -1;
            let isPluck = false;

            if (typeof notePayload === 'object' && notePayload !== null) {
                midi = notePayload.midi !== undefined ? notePayload.midi : Math.round(notePayload.midiExact || 0);
                midiExact = notePayload.midiExact !== undefined ? notePayload.midiExact : midi;
                isPluck = !!notePayload.isPluck;
            } else if (typeof notePayload === 'number') {
                midi = Math.round(notePayload);
                midiExact = notePayload;
                isPluck = true;
            }

            if (midi < 0) return false;

            // Refractory period / pluck debouncing
            const timeSinceLastPluck = now - this.lastPluckTimeMs;
            const isDifferentNote = (midi !== this.lastPluckMidi);

            // Require either a recognized pluck transient, note pitch change, or elapsed refractory interval
            if (!isPluck && !isDifferentNote && timeSinceLastPluck < this.minNoteIntervalMs) {
                return false;
            }

            this.lastPluckTimeMs = now;
            this.lastPluckMidi = midi;

            if (this.firstNoteTime === 0) {
                this.firstNoteTime = now;
            }

            const question = this.currentQuestion;
            if (!question) return false;

            // Route to appropriate evaluation logic based on game mode
            if (question.mode === GAME_MODES.INTERVAL) {
                return this._evaluateIntervalPitch(notePayload, midi, midiExact, now);
            } else if (question.mode === GAME_MODES.CALL_AND_RESPONSE) {
                return this._evaluateCallAndResponsePitch(notePayload, midi, midiExact, now);
            } else if (question.mode === GAME_MODES.CHORD_QUALITY) {
                return this._evaluateChordArpeggioPitch(notePayload, midi, midiExact, now);
            }

            return false;
        }

        /**
         * Evaluates pitch input against interval question target.
         */
        _evaluateIntervalPitch(notePayload, midi, midiExact, now) {
            const question = this.currentQuestion;
            const targetMidi = question.targetMidi;
            const rootMidi = question.rootMidi;

            // Check if player played the expected interval target note within ±35 cents
            const isMatch = isPitchWithinTolerance(notePayload, targetMidi, this.toleranceCents, this.allowOctaveEquivalent);
            const centsDev = calculateCentsDeviation(notePayload, targetMidi);

            if (isMatch) {
                this._completeSuccess(centsDev);
                return true;
            }

            // Check if player played the root note first before the interval note (allowable preamble)
            const isRootMatch = isPitchWithinTolerance(notePayload, rootMidi, this.toleranceCents, this.allowOctaveEquivalent);
            if (isRootMatch) {
                // Acknowledged root played; wait for interval target
                if (this.onNoteMatch) {
                    this.onNoteMatch({
                        type: "ROOT_PREAMBLE",
                        detectedMidi: midi,
                        expectedMidi: rootMidi,
                        centsDeviation: calculateCentsDeviation(notePayload, rootMidi)
                    });
                }
                return false;
            }

            // Wrong note
            if (this.strictSequence) {
                this._completeFailure(centsDev, "WRONG_NOTE");
            }
            return false;
        }

        /**
         * Evaluates pitch input against call-and-response motif sequence.
         */
        _evaluateCallAndResponsePitch(notePayload, midi, midiExact, now) {
            const question = this.currentQuestion;
            const expectedSeq = question.expectedSequence;
            const targetMidi = expectedSeq[this.matchedSequenceIndex];

            const isMatch = isPitchWithinTolerance(notePayload, targetMidi, this.toleranceCents, this.allowOctaveEquivalent);
            const centsDev = calculateCentsDeviation(notePayload, targetMidi);

            if (isMatch) {
                const noteIndex = this.matchedSequenceIndex;
                this.matchedSequenceIndex++;

                if (this.onNoteMatch) {
                    this.onNoteMatch({
                        index: noteIndex,
                        total: expectedSeq.length,
                        detectedMidi: midi,
                        expectedMidi: targetMidi,
                        centsDeviation: centsDev
                    });
                }

                // Check if all notes in motif have been successfully echoed
                if (this.matchedSequenceIndex >= expectedSeq.length) {
                    this._completeSuccess(centsDev);
                    return true;
                }
                return true;
            }

            // If note didn't match current expected step
            if (this.strictSequence) {
                this._completeFailure(centsDev, "WRONG_NOTE_IN_SEQUENCE");
            }
            return false;
        }

        /**
         * Evaluates note-by-note arpeggiated input for chord quality questions.
         */
        _evaluateChordArpeggioPitch(notePayload, midi, midiExact, now) {
            const question = this.currentQuestion;
            const pitchClass = ((midi % 12) + 12) % 12;

            // Check if pitch class belongs to the chord tones
            if (question.pitchClasses && question.pitchClasses.includes(pitchClass)) {
                this.detectedChordPitchClasses.add(pitchClass);

                if (this.onNoteMatch) {
                    this.onNoteMatch({
                        type: "CHORD_TONE",
                        pitchClass: pitchClass,
                        noteName: NOTE_NAMES[pitchClass],
                        detectedCount: this.detectedChordPitchClasses.size,
                        requiredCount: question.pitchClasses.length
                    });
                }

                // If all distinct chord pitch classes were played, mark chord as completed
                if (this.detectedChordPitchClasses.size >= question.pitchClasses.length) {
                    this._completeSuccess(0);
                    return true;
                }
            }
            return false;
        }

        /**
         * Strummed chord input handler from Polyphonic Chord Recognizer.
         *
         * @param {Object|string} chordData - e.g. { chord: "Am", root: "A", quality: "minor", confidence: 75 } or string "Am"
         */
        handleChordInput(chordData) {
            if (this.state !== STATES.AWAITING_INPUT && this.state !== STATES.EVALUATING) {
                return false;
            }

            const question = this.currentQuestion;
            if (!question || question.mode !== GAME_MODES.CHORD_QUALITY) {
                return false;
            }

            let chordName = "";
            let rootName = "";
            let qualityKey = "";
            let confidence = 100;

            if (typeof chordData === 'object' && chordData !== null) {
                chordName = chordData.chord || "";
                rootName = chordData.root || "";
                qualityKey = normalizeChordQualityKey(chordData.quality || chordData.qualityKey);
                confidence = chordData.confidence !== undefined ? chordData.confidence : 100;
            } else if (typeof chordData === 'string') {
                chordName = chordData.trim();
                const match = chordName.match(/^([A-Ga-g][#b]?)(.*)$/);
                if (match) {
                    rootName = match[1].toUpperCase();
                    qualityKey = normalizeChordQualityKey(match[2]);
                }
            }

            if (!chordName || chordName === "None" || confidence < 35) {
                return false;
            }

            // Verify chord quality match
            const isQualityMatch = (qualityKey === question.qualityKey);
            // Check root match (if rootName is specified)
            const isRootMatch = !rootName || (rootName === question.rootName);

            if (isQualityMatch && isRootMatch) {
                this._completeSuccess(0);
                return true;
            }

            if (this.strictSequence && confidence >= 65) {
                this._completeFailure(0, "WRONG_CHORD");
            }
            return false;
        }

        // ---------------------------------------------------------------------
        // Success & Failure Resolution
        // ---------------------------------------------------------------------

        _completeSuccess(centsDeviation = 0) {
            this._clearCountdown();
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const reactionTime = Math.max(0, now - this.inputStartTime);
            const question = this.currentQuestion;

            const scoreResult = this.scoreTracker.recordSuccess(question, reactionTime, centsDeviation);
            this.setState(STATES.SUCCESS, { question, scoreResult, reactionTime });

            if (this.onQuestionSuccess) {
                this.onQuestionSuccess({
                    question,
                    reactionTime,
                    centsDeviation,
                    scoreResult
                });
            }
            if (this.onScoreUpdate) {
                this.onScoreUpdate(this.scoreTracker.getStats());
            }

            // Auto-advance tier if threshold reached
            if (scoreResult.shouldAdvanceTier && this.autoAdvanceTier && this.currentTier < 3) {
                this.setTier(this.currentTier + 1);
            }
        }

        _completeFailure(centsDeviation = 0, reason = "WRONG_ANSWER") {
            this._clearCountdown();
            const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
            const reactionTime = Math.max(0, now - this.inputStartTime);
            const question = this.currentQuestion;

            const scoreResult = this.scoreTracker.recordFailure(question, reactionTime, reason);
            this.setState(STATES.FAIL, { question, scoreResult, reason });

            if (this.onQuestionFail) {
                this.onQuestionFail({
                    question,
                    reason,
                    reactionTime,
                    centsDeviation,
                    scoreResult
                });
            }
            if (this.onScoreUpdate) {
                this.onScoreUpdate(this.scoreTracker.getStats());
            }

            // Auto-demote tier if consecutive failures exceed threshold
            if (scoreResult.shouldDemoteTier && this.autoAdvanceTier && this.currentTier > 1) {
                this.setTier(this.currentTier - 1);
            }
        }

        /**
         * Resets all game stats and stops active audio or timers.
         */
        reset() {
            this._clearCountdown();
            this.promptPlayer.stopAll();
            this.scoreTracker.reset();
            this.state = STATES.IDLE;
            this.currentQuestion = null;
            this.matchedSequenceIndex = 0;
            this.detectedNotesBuffer = [];
            this.detectedChordPitchClasses.clear();
            if (this.onScoreUpdate) {
                this.onScoreUpdate(this.scoreTracker.getStats());
            }
        }
    }

    // =========================================================================
    // 7. EXPORTS
    // =========================================================================

    return {
        // Main Class
        EarTrainer: EarTrainer,

        // Subcomponents & Helpers
        QuestionGenerator: QuestionGenerator,
        ScoreTracker: ScoreTracker,
        AudioPromptPlayer: AudioPromptPlayer,

        // Music Theory Constants & Lookups
        INTERVALS: INTERVALS,
        CHORD_QUALITIES: CHORD_QUALITIES,
        GAME_MODES: GAME_MODES,
        DIFFICULTY_TIERS: DIFFICULTY_TIERS,
        STATES: STATES,
        NOTE_NAMES: NOTE_NAMES,
        STANDARD_TUNING_MIDI: STANDARD_TUNING_MIDI,

        // Utility Functions
        midiToFrequency: midiToFrequency,
        frequencyToMidiExact: frequencyToMidiExact,
        midiToNoteName: midiToNoteName,
        noteNameToMidi: noteNameToMidi,
        calculateCentsDeviation: calculateCentsDeviation,
        isPitchWithinTolerance: isPitchWithinTolerance,
        getGuitarPositions: getGuitarPositions,
        canPlayWithinSpan: canPlayWithinSpan,
        normalizeChordQualityKey: normalizeChordQualityKey
    };
}));
