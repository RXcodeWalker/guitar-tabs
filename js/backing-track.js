/**
 * FretDSP — Smart Backing Track & Rhythm Accompaniment Engine
 * 
 * Standalone procedural Web Audio accompaniment system that synthesizes dynamic
 * drums, basslines, and rhythm keys to accompany the guitarist without external audio samples.
 * 
 * Core Architectural Modules:
 * 1. Procedural Drum Engine:
 *    - Kick: Pure sine oscillator with rapid exponential pitch sweep (150 Hz -> 40 Hz) and body decay.
 *    - Snare: High-pass filtered white noise burst mixed with 180 Hz body tone.
 *    - Hi-Hat: Band-pass filtered metallic noise with adjustable closed (50ms) and open (400ms) decay + choking.
 *    - Ride Cymbal: High-resonance bandpass metallic wash with bell harmonics for jazz spang-a-lang.
 * 2. Bass & Harmonic Comping Engine:
 *    - Sub-bass oscillator (dual Triangle + filtered Sawtooth) following chord root, 5th, and chromatic walking notes.
 *    - Comping Keys: Warm triangle/saw polyphonic voice with lowpass envelope playing chord triads/7ths on syncopated down/up-beats.
 *    - Dynamic voice leading to ensure smooth harmonic transitions across chord changes.
 * 3. Rhythm & Progression Manager:
 *    - Groove Styles: Rock Straight 8ths, Blues Shuffle (swing factor), Funk 16ths, and Jazz Walking 4/4.
 *    - Built-in Presets: 12-Bar Blues in E & A, Pop I-V-vi-IV in C & G, Jazz ii-V-I in C & G.
 *    - Real-Time Follow Mode: Integrates dynamically with chord-engine.js to accompany live guitar chords.
 *    - Lookahead Scheduling: 25ms timer interval scheduling 100ms ahead for zero timing jitter.
 * 4. Node.js & Headless Support:
 *    - Built-in MockAudioContext for headless environments, automated verification, and testing.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.BackingTrack = exports;
        root.BackingTrackEngine = exports.BackingTrackEngine;
        root.createBackingTrack = exports.createBackingTrack;
        root.GROOVE_STYLES = exports.GROOVE_STYLES;
        root.PROGRESSION_PRESETS = exports.PROGRESSION_PRESETS;
        root.CHORD_QUALITIES = exports.CHORD_QUALITIES;
        root.parseChord = exports.parseChord;
        root.chordToFrequencies = exports.chordToFrequencies;
        root.getBassFrequency = exports.getBassFrequency;
        root.midiToFrequency = exports.midiToFrequency;
        root.MockAudioContext = exports.MockAudioContext;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    // 1. MUSIC THEORY & CHORD PARSING ENGINE
    // =========================================================================

    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    const ENHARMONIC_MAP = {
        "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B",
        "B#": "C", "E#": "F"
    };

    /**
     * Standard chord quality interval mappings (semitones relative to root)
     */
    const CHORD_QUALITIES = {
        major: {
            suffix: "",
            displayName: "Major",
            intervals: [0, 4, 7]
        },
        minor: {
            suffix: "m",
            displayName: "Minor",
            intervals: [0, 3, 7]
        },
        dom7: {
            suffix: "7",
            displayName: "Dominant 7th",
            intervals: [0, 4, 7, 10]
        },
        maj7: {
            suffix: "maj7",
            displayName: "Major 7th",
            intervals: [0, 4, 7, 11]
        },
        m7: {
            suffix: "m7",
            displayName: "Minor 7th",
            intervals: [0, 3, 7, 10]
        },
        sus2: {
            suffix: "sus2",
            displayName: "Suspended 2nd",
            intervals: [0, 2, 7]
        },
        sus4: {
            suffix: "sus4",
            displayName: "Suspended 4th",
            intervals: [0, 5, 7]
        },
        dim: {
            suffix: "dim",
            displayName: "Diminished",
            intervals: [0, 3, 6]
        },
        dim7: {
            suffix: "dim7",
            displayName: "Diminished 7th",
            intervals: [0, 3, 6, 9]
        },
        m7b5: {
            suffix: "m7b5",
            displayName: "Half-Diminished",
            intervals: [0, 3, 6, 10]
        },
        aug: {
            suffix: "aug",
            displayName: "Augmented",
            intervals: [0, 4, 8]
        },
        "6": {
            suffix: "6",
            displayName: "Major 6th",
            intervals: [0, 4, 7, 9]
        },
        m6: {
            suffix: "m6",
            displayName: "Minor 6th",
            intervals: [0, 3, 7, 9]
        },
        "9": {
            suffix: "9",
            displayName: "Dominant 9th",
            intervals: [0, 4, 7, 10, 14]
        },
        add9: {
            suffix: "add9",
            displayName: "Add 9",
            intervals: [0, 4, 7, 14]
        }
    };

    /**
     * Converts MIDI note number (0-127) to frequency in Hz.
     */
    function midiToFrequency(midi, a4 = 440) {
        return a4 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * Converts frequency in Hz to MIDI note number.
     */
    function frequencyToMidi(freq, a4 = 440) {
        if (!freq || freq <= 0) return 0;
        return 69 + 12 * Math.log2(freq / a4);
    }

    /**
     * Converts a note name (e.g. "C", "F#", "Bb") and octave (e.g. 1, 3, 4) to MIDI note number.
     */
    function noteNameToMidi(noteName, octave = 4) {
        if (!noteName) return 60;
        const normalized = ENHARMONIC_MAP[noteName] || noteName;
        const semitone = NOTE_NAMES.indexOf(normalized);
        if (semitone === -1) return 60;
        return (octave + 1) * 12 + semitone;
    }

    /**
     * Parses a chord string (e.g. "Am7", "C#dim", "G7", "Eb", "Fmaj7") into structured root, quality, and intervals.
     */
    function parseChord(chordStr) {
        if (!chordStr || typeof chordStr !== 'string') {
            return { root: "C", quality: "major", intervals: [0, 4, 7], raw: "C" };
        }
        const trimmed = chordStr.trim();
        const match = trimmed.match(/^([A-G][#b]?)(.*)$/i);
        if (!match) {
            return { root: "C", quality: "major", intervals: [0, 4, 7], raw: trimmed };
        }

        let rawRoot = match[1].charAt(0).toUpperCase() + (match[1].length > 1 ? match[1].charAt(1) : "");
        let root = ENHARMONIC_MAP[rawRoot] || rawRoot;
        let suffix = match[2].trim();

        let qualityKey = "major";

        // Map suffixes to chord qualities
        const s = suffix.toLowerCase();
        if (s === "m" || s === "min" || s === "-") {
            qualityKey = "minor";
        } else if (s === "7") {
            qualityKey = "dom7";
        } else if (s === "maj7" || s === "m7+" || s === "δ" || s === "δ7" || s === "major7") {
            qualityKey = "maj7";
        } else if (s === "m7" || s === "min7" || s === "-7") {
            qualityKey = "m7";
        } else if (s === "sus2") {
            qualityKey = "sus2";
        } else if (s === "sus4" || s === "sus") {
            qualityKey = "sus4";
        } else if (s === "dim" || s === "o") {
            qualityKey = "dim";
        } else if (s === "dim7" || s === "o7") {
            qualityKey = "dim7";
        } else if (s === "m7b5" || s === "ø" || s === "half-dim") {
            qualityKey = "m7b5";
        } else if (s === "aug" || s === "+") {
            qualityKey = "aug";
        } else if (s === "6") {
            qualityKey = "6";
        } else if (s === "m6") {
            qualityKey = "m6";
        } else if (s === "9") {
            qualityKey = "9";
        } else if (s === "add9") {
            qualityKey = "add9";
        } else if (s === "" || s === "maj" || s === "major") {
            qualityKey = "major";
        }

        const qual = CHORD_QUALITIES[qualityKey] || CHORD_QUALITIES.major;
        return {
            root: root,
            quality: qualityKey,
            displayName: `${root}${qual.suffix}`,
            intervals: qual.intervals.slice(),
            raw: trimmed
        };
    }

    /**
     * Translates a chord name into an array of frequencies (in Hz) in a given octave.
     */
    function chordToFrequencies(chordStr, octave = 3, a4 = 440) {
        const parsed = parseChord(chordStr);
        const rootMidi = noteNameToMidi(parsed.root, octave);
        return parsed.intervals.map(int => midiToFrequency(rootMidi + int, a4));
    }

    /**
     * Returns the optimal bass note MIDI number for a given root note name.
     * Places E, F, F#, G, G#, A, A#, B into Octave 1 (MIDI 28-35: 41.2 Hz - 61.7 Hz)
     * and C, C#, D, D# into Octave 2 (MIDI 36-39: 65.4 Hz - 77.8 Hz)
     * to ensure optimal sub-bass punch and prevent muddy inaudible sub-rumble (<35 Hz).
     */
    function getBassMidi(rootName, preferredOctave = null) {
        const normalized = ENHARMONIC_MAP[rootName] || rootName;
        const semitone = NOTE_NAMES.indexOf(normalized);
        if (semitone === -1) return 36; // C2 fallback

        if (preferredOctave !== null) {
            return (preferredOctave + 1) * 12 + semitone;
        }

        // Semitones: C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11
        // E1 (40) is lowest standard guitar note; for bass guitar E1 is 28 (41.2Hz)
        if (semitone >= 4) {
            // E1 (28) through B1 (35)
            return 24 + semitone;
        } else {
            // C2 (36) through D#2 (39)
            return 36 + semitone;
        }
    }

    /**
     * Returns optimal bass frequency (Hz) for a root note.
     */
    function getBassFrequency(rootName, preferredOctave = null, a4 = 440) {
        const midi = getBassMidi(rootName, preferredOctave);
        return midiToFrequency(midi, a4);
    }

    /**
     * Smooth Voice Leading Engine for Comping Keys.
     * Given a target chord and optional previous chord voicing MIDI notes,
     * chooses the octave inversion in the range MIDI 53-76 (F3-E5)
     * that minimizes cumulative semitone pitch distance.
     */
    function getVoiceLedChordMidi(chordStr, prevMidiNotes = null, targetCenter = 60) {
        const parsed = parseChord(chordStr);
        const intervals = parsed.intervals.slice(); // e.g. [0, 4, 7] or [0, 4, 7, 10]
        const semitone = NOTE_NAMES.indexOf(parsed.root);
        if (semitone === -1) return [60, 64, 67];

        // Base notes at octave 3 (MIDI 48 + semitone)
        const baseRoot = 48 + semitone;
        const candidateNotes = intervals.map(int => baseRoot + int);

        // Generate candidate inversions across octaves 3 and 4
        // A voicing is a set of notes mapped into [52, 74]
        const voicings = [];
        const numNotes = candidateNotes.length;

        // Try octave offsets -1, 0, 1 for individual notes or blocks
        for (let inv = 0; inv < numNotes; inv++) {
            // Inversion: rotate notes and add 12 to shifted notes
            for (let octShift = -1; octShift <= 1; octShift++) {
                const v = [];
                for (let i = 0; i < numNotes; i++) {
                    let note = candidateNotes[(i + inv) % numNotes];
                    if (i + inv >= numNotes) note += 12;
                    note += octShift * 12;
                    v.push(note);
                }
                // Check if voicing sits comfortably in keyboard comping sweet spot (MIDI 50 to 76)
                const minN = Math.min(...v);
                const maxN = Math.max(...v);
                if (minN >= 50 && maxN <= 78) {
                    voicings.push(v);
                }
            }
        }

        if (voicings.length === 0) {
            // Fallback: simple center clamp
            return candidateNotes.map(n => {
                while (n < 55) n += 12;
                while (n > 74) n -= 12;
                return n;
            }).sort((a, b) => a - b);
        }

        // If no previous notes, choose voicing closest to targetCenter
        if (!prevMidiNotes || prevMidiNotes.length === 0) {
            voicings.sort((a, b) => {
                const avgA = a.reduce((s, x) => s + x, 0) / a.length;
                const avgB = b.reduce((s, x) => s + x, 0) / b.length;
                return Math.abs(avgA - targetCenter) - Math.abs(avgB - targetCenter);
            });
            return voicings[0];
        }

        // If previous notes exist, calculate minimum distance voice-leading cost
        let bestVoicing = voicings[0];
        let minCost = Infinity;

        for (const v of voicings) {
            let cost = 0;
            const len = Math.min(v.length, prevMidiNotes.length);
            for (let i = 0; i < len; i++) {
                cost += Math.abs(v[i] - prevMidiNotes[i]);
            }
            if (v.length !== prevMidiNotes.length) {
                cost += Math.abs(v.length - prevMidiNotes.length) * 4;
            }
            if (cost < minCost) {
                minCost = cost;
                bestVoicing = v;
            }
        }

        return bestVoicing;
    }


    // =========================================================================
    // 2. GROOVE STYLES & PATTERNS
    // =========================================================================

    /**
     * Standard groove styles definitions.
     * Each style defines:
     * - id, name, defaultBpm, subdivision (steps per bar), swing (0.0 - 0.75)
     * - drum pattern generator
     * - bass pattern generator (root, 5th, walking, chromatic approaches)
     * - comping keys pattern generator (rhythm, voicings, envelopes)
     */
    const GROOVE_STYLES = {
        rock_straight_8ths: {
            id: 'rock_straight_8ths',
            name: 'Rock Straight 8ths',
            defaultBpm: 120,
            subdivision: 8, // 8 steps per 4/4 measure (straight 8ths)
            swing: 0.0,
            description: 'Driving straight 8th rock beat with solid backbeat, punchy root-5th bass, and sustained chord comping.',
            getDrums: function (step) {
                // step 0-7: 0=Beat 1, 1=& of 1, 2=Beat 2, 3=& of 2, 4=Beat 3, 5=& of 3, 6=Beat 4, 7=& of 4
                const isKick = (step === 0 || step === 4 || step === 5);
                const isSnare = (step === 2 || step === 6);
                const isHat = true; // Every 8th
                const isHatOpen = (step === 7);
                const kickVel = (step === 0) ? 1.0 : (step === 4 ? 0.9 : 0.75);
                const snareVel = 1.0;
                const hatVel = (step % 2 === 0) ? 0.85 : 0.60;
                return {
                    kick: isKick ? kickVel : 0,
                    snare: isSnare ? snareVel : 0,
                    hihat: isHat ? hatVel : 0,
                    hihatOpen: isHatOpen,
                    ride: 0
                };
            },
            getBass: function (step, chordInfo, nextChordInfo) {
                // Driving straight 8ths: Root, Root, 5th, Root, Root, 5th, Octave, Passing
                const rootMidi = getBassMidi(chordInfo.root);
                const fifthMidi = rootMidi + 7;
                const octaveMidi = rootMidi + 12;
                
                let midi = rootMidi;
                let vel = 0.9;
                let durBeats = 0.45; // slightly detached 8th note punch

                switch (step) {
                    case 0: midi = rootMidi; vel = 1.0; break;
                    case 1: midi = rootMidi; vel = 0.75; break;
                    case 2: midi = fifthMidi; vel = 0.85; break;
                    case 3: midi = rootMidi; vel = 0.75; break;
                    case 4: midi = rootMidi; vel = 0.95; break;
                    case 5: midi = fifthMidi; vel = 0.85; break;
                    case 6: midi = octaveMidi; vel = 0.90; break;
                    case 7:
                        // Chromatic approach to next chord root
                        if (nextChordInfo) {
                            const nextRootMidi = getBassMidi(nextChordInfo.root);
                            midi = (nextRootMidi > rootMidi) ? nextRootMidi - 1 : nextRootMidi + 1;
                        } else {
                            midi = fifthMidi;
                        }
                        vel = 0.80;
                        break;
                }
                return { active: true, midi: midi, velocity: vel, durationBeats: durBeats };
            },
            getKeys: function (step, chordInfo) {
                // Comping rhythm: Downbeat on beat 1 (step 0), syncopated push on step 3, backbeat on 4, 6
                let active = false;
                let durBeats = 0.8;
                let vel = 0.75;

                if (step === 0) {
                    active = true;
                    durBeats = 1.6;
                    vel = 0.85;
                } else if (step === 3) {
                    active = true;
                    durBeats = 0.8;
                    vel = 0.70;
                } else if (step === 4) {
                    active = true;
                    durBeats = 1.2;
                    vel = 0.75;
                } else if (step === 6) {
                    active = true;
                    durBeats = 0.8;
                    vel = 0.70;
                }

                return { active: active, durationBeats: durBeats, velocity: vel, style: 'pad' };
            }
        },

        blues_shuffle: {
            id: 'blues_shuffle',
            name: 'Blues Shuffle (swing factor)',
            defaultBpm: 108,
            subdivision: 8,
            swing: 0.67, // Classic triplet shuffle swing factor (2/3 + 1/3)
            description: 'Authentic 12-bar blues shuffle with boogie-woogie walking bass, backbeat snare, and offbeat swung comping chanks.',
            getDrums: function (step) {
                // 8th shuffle grid with swingFactor = 0.67:
                // Downbeats are 0, 2, 4, 6. Swung upbeats are 1, 3, 5, 7.
                const isKick = (step === 0 || step === 4);
                const isGhostKick = (step === 2 || step === 6);
                const isSnare = (step === 2 || step === 6);
                const isGhostSnare = (step === 7);
                const isHat = true; // Swung shuffle pattern
                const kickVel = isKick ? 1.0 : (isGhostKick ? 0.35 : 0);
                const snareVel = isSnare ? 1.0 : (isGhostSnare ? 0.30 : 0);
                const hatVel = (step % 2 === 0) ? 0.85 : 0.65;
                return {
                    kick: kickVel,
                    snare: snareVel,
                    hihat: hatVel,
                    hihatOpen: (step === 3 || step === 7),
                    ride: 0
                };
            },
            getBass: function (step, chordInfo, nextChordInfo) {
                // Classic boogie-woogie walking bass: Root, 3rd, 5th, 6th, b7, 6th, 5th, 3rd
                const rootMidi = getBassMidi(chordInfo.root);
                const isMinor = chordInfo.quality.includes('minor') || chordInfo.quality === 'm7';
                const thirdInterval = isMinor ? 3 : 4;
                const fifthInterval = 7;
                const sixthInterval = 9;
                const b7Interval = 10;

                let midi = rootMidi;
                let vel = (step % 2 === 0) ? 0.95 : 0.75;
                let durBeats = 0.40;

                switch (step) {
                    case 0: midi = rootMidi; break;
                    case 1: midi = rootMidi + thirdInterval; break;
                    case 2: midi = rootMidi + fifthInterval; break;
                    case 3: midi = rootMidi + sixthInterval; break;
                    case 4: midi = rootMidi + b7Interval; break;
                    case 5: midi = rootMidi + sixthInterval; break;
                    case 6: midi = rootMidi + fifthInterval; break;
                    case 7:
                        // Approaching next bar: chromatic approach or 3rd
                        if (nextChordInfo) {
                            const nextRoot = getBassMidi(nextChordInfo.root);
                            midi = (nextRoot > rootMidi) ? nextRoot - 1 : nextRoot + 1;
                        } else {
                            midi = rootMidi + thirdInterval;
                        }
                        break;
                }
                return { active: true, midi: midi, velocity: vel, durationBeats: durBeats };
            },
            getKeys: function (step, chordInfo) {
                // Classic blues rhythm guitar/keys: "chank" on the swung upbeats (steps 1, 3, 5, 7)!
                const isSwungUpbeat = (step === 1 || step === 3 || step === 5 || step === 7);
                const isAccent = (step === 3 || step === 7);
                return {
                    active: isSwungUpbeat,
                    durationBeats: 0.25, // crisp staccato chank
                    velocity: isAccent ? 0.85 : 0.65,
                    style: 'stab'
                };
            }
        },

        funk_16ths: {
            id: 'funk_16ths',
            name: 'Funk 16ths',
            defaultBpm: 104,
            subdivision: 16, // 16 steps per bar
            swing: 0.54, // Tight funk pocket swing
            description: 'Syncopated 16th funk groove with tight ghost snares, staccato slap bassline, and rhythmic clav/keys stabs.',
            getDrums: function (step) {
                // Steps 0-15:
                // Beat 1: 0, 1, 2, 3
                // Beat 2: 4, 5, 6, 7
                // Beat 3: 8, 9, 10, 11
                // Beat 4: 12, 13, 14, 15
                let kickVel = 0;
                let snareVel = 0;
                let hatVel = 0.6;
                let hatOpen = false;

                // Syncopated kick: Beat 1 (0), & of 2 (6), & of 3 (10), ah of 4 (15)
                if (step === 0) kickVel = 1.0;
                else if (step === 6) kickVel = 0.85;
                else if (step === 10) kickVel = 0.90;
                else if (step === 15) kickVel = 0.70;

                // Snare backbeat on 4, 12 + ghost notes on 7, 9, 14
                if (step === 4 || step === 12) snareVel = 1.0;
                else if (step === 7 || step === 9 || step === 14) snareVel = 0.35;

                // Hi-Hat 16ths with open hat sizzle on 6 and 14
                if (step === 6 || step === 14) {
                    hatOpen = true;
                    hatVel = 0.85;
                } else if (step % 4 === 0) {
                    hatVel = 0.80; // on the beat
                } else if (step % 2 === 0) {
                    hatVel = 0.65; // on the 8th
                } else {
                    hatVel = 0.45; // 16th skip
                }

                return {
                    kick: kickVel,
                    snare: snareVel,
                    hihat: hatVel,
                    hihatOpen: hatOpen,
                    ride: 0
                };
            },
            getBass: function (step, chordInfo, nextChordInfo) {
                // Funky syncopated bass with staccato pops, octave leaps, and chromatic steps
                const rootMidi = getBassMidi(chordInfo.root);
                const octaveMidi = rootMidi + 12;
                const fifthMidi = rootMidi + 7;
                const b7Midi = rootMidi + 10;

                let active = false;
                let midi = rootMidi;
                let vel = 0.8;
                let durBeats = 0.20;

                switch (step) {
                    case 0:
                        active = true; midi = rootMidi; vel = 1.0; durBeats = 0.4; break;
                    case 3:
                        active = true; midi = fifthMidi; vel = 0.7; durBeats = 0.18; break;
                    case 6:
                        active = true; midi = b7Midi; vel = 0.85; durBeats = 0.25; break;
                    case 8:
                        active = true; midi = octaveMidi; vel = 0.95; durBeats = 0.25; break;
                    case 10:
                        active = true; midi = rootMidi; vel = 0.85; durBeats = 0.35; break;
                    case 14:
                        active = true;
                        if (nextChordInfo) {
                            const nextRoot = getBassMidi(nextChordInfo.root);
                            midi = (nextRoot > rootMidi) ? nextRoot - 1 : nextRoot + 1;
                        } else {
                            midi = rootMidi + 1;
                        }
                        vel = 0.8; durBeats = 0.20;
                        break;
                }

                return { active: active, midi: midi, velocity: vel, durationBeats: durBeats };
            },
            getKeys: function (step, chordInfo) {
                // Syncopated 16th clavinet/Rhodes stabs on steps 2, 6, 8, 11, 14
                const stabSteps = [2, 6, 8, 11, 14];
                const active = stabSteps.includes(step);
                return {
                    active: active,
                    durationBeats: 0.18, // short crisp funk stab
                    velocity: (step === 2 || step === 8) ? 0.85 : 0.65,
                    style: 'stab'
                };
            }
        },

        jazz_walking: {
            id: 'jazz_walking',
            name: 'Jazz Walking 4/4',
            defaultBpm: 135,
            subdivision: 8, // 4 beats, 2 subdivisions per beat
            swing: 0.62, // Medium jazz swing
            description: 'Sophisticated 4/4 jazz swing with 4-to-the-bar walking bassline, ride cymbal spang-a-lang, feathered kick, and Charleston comping.',
            getDrums: function (step) {
                // Feathered kick on all 4 beats (steps 0, 2, 4, 6) - very subtle
                const isKick = (step === 0 || step === 2 || step === 4 || step === 6);
                const kickVel = isKick ? 0.22 : 0; // acoustic feathered pulse

                // Hi-Hat foot "chick" sharp on beats 2 and 4 (steps 2, 6)
                const isHatPedal = (step === 2 || step === 6);
                const hatVel = isHatPedal ? 0.80 : 0;

                // Ride cymbal jazz pattern: "ding... ding-a, ding... ding-a"
                // Beats 1 (0), 2 (2), swung upbeat of 2 (3), 3 (4), 4 (6), swung upbeat of 4 (7)
                let rideVel = 0;
                if (step === 0 || step === 4) rideVel = 0.80;
                else if (step === 2 || step === 6) rideVel = 0.90;
                else if (step === 3 || step === 7) rideVel = 0.70;

                // Snare: subtle brushes/cross-stick accents on beats 2 and 4
                const snareVel = (step === 2 || step === 6) ? 0.55 : (step === 5 ? 0.25 : 0);

                return {
                    kick: kickVel,
                    snare: snareVel,
                    hihat: hatVel,
                    hihatOpen: false,
                    ride: rideVel
                };
            },
            getBass: function (step, chordInfo, nextChordInfo) {
                // Continuous 4-beat walking bass! (Only on steps 0, 2, 4, 6 = Beats 1, 2, 3, 4)
                if (step % 2 !== 0) {
                    return { active: false, midi: 0, velocity: 0, durationBeats: 0 };
                }

                const beat = step / 2; // 0, 1, 2, 3
                const rootMidi = getBassMidi(chordInfo.root);
                const isMinor = chordInfo.quality.includes('minor') || chordInfo.quality === 'm7';
                const thirdMidi = rootMidi + (isMinor ? 3 : 4);
                const fifthMidi = rootMidi + 7;
                const seventhMidi = rootMidi + (chordInfo.quality === 'maj7' ? 11 : 10);

                let midi = rootMidi;
                let vel = (beat === 0) ? 0.95 : (beat === 2 ? 0.85 : 0.80);
                let durBeats = 0.90; // smooth legato walking feel

                switch (beat) {
                    case 0:
                        // Beat 1: Root
                        midi = rootMidi;
                        break;
                    case 1:
                        // Beat 2: Chord tone (3rd or 5th)
                        midi = thirdMidi;
                        break;
                    case 2:
                        // Beat 3: 5th or 7th
                        midi = fifthMidi;
                        break;
                    case 3:
                        // Beat 4: Chromatic approach note to next chord root!
                        if (nextChordInfo) {
                            const nextRoot = getBassMidi(nextChordInfo.root);
                            // Approach from half step below or half step above
                            if (nextRoot > fifthMidi) {
                                midi = nextRoot - 1; // chromatic approach from below
                            } else {
                                midi = nextRoot + 1; // chromatic approach from above
                            }
                        } else {
                            midi = seventhMidi;
                        }
                        vel = 0.85;
                        break;
                }

                return { active: true, midi: midi, velocity: vel, durationBeats: durBeats };
            },
            getKeys: function (step, chordInfo) {
                // Charleston comping rhythm: Dotted quarter on Beat 1 (step 0), 8th on upbeat of 2 (step 3)
                let active = false;
                let durBeats = 1.0;
                let vel = 0.75;

                if (step === 0) {
                    active = true;
                    durBeats = 1.4; // dotted quarter feel
                    vel = 0.80;
                } else if (step === 3) {
                    active = true;
                    durBeats = 0.5; // upbeat punch
                    vel = 0.75;
                }

                return { active: active, durationBeats: durBeats, velocity: vel, style: 'pad' };
            }
        }
    };


    // =========================================================================
    // 3. PROGRESSION PRESETS
    // =========================================================================

    const PROGRESSION_PRESETS = {
        "12_bar_blues_e": {
            id: "12_bar_blues_e",
            name: "12-Bar Blues in E",
            style: "blues_shuffle",
            defaultBpm: 108,
            key: "E",
            measures: 12,
            chords: [
                "E7", "E7", "E7", "E7",
                "A7", "A7", "E7", "E7",
                "B7", "A7", "E7", "B7"
            ]
        },
        "12_bar_blues_a": {
            id: "12_bar_blues_a",
            name: "12-Bar Blues in A",
            style: "blues_shuffle",
            defaultBpm: 112,
            key: "A",
            measures: 12,
            chords: [
                "A7", "D7", "A7", "A7",
                "D7", "D7", "A7", "A7",
                "E7", "D7", "A7", "E7"
            ]
        },
        "pop_i_v_vi_iv_c": {
            id: "pop_i_v_vi_iv_c",
            name: "Pop I-V-vi-IV in C",
            style: "rock_straight_8ths",
            defaultBpm: 120,
            key: "C",
            measures: 4,
            chords: ["C", "G", "Am", "F"]
        },
        "pop_i_v_vi_iv_g": {
            id: "pop_i_v_vi_iv_g",
            name: "Pop I-V-vi-IV in G",
            style: "rock_straight_8ths",
            defaultBpm: 120,
            key: "G",
            measures: 4,
            chords: ["G", "D", "Em", "C"]
        },
        "jazz_ii_v_i_c": {
            id: "jazz_ii_v_i_c",
            name: "Jazz ii-V-I in C",
            style: "jazz_walking",
            defaultBpm: 135,
            key: "C",
            measures: 4,
            chords: ["Dm7", "G7", "Cmaj7", "A7"]
        },
        "jazz_ii_v_i_g": {
            id: "jazz_ii_v_i_g",
            name: "Jazz ii-V-I in G",
            style: "jazz_walking",
            defaultBpm: 135,
            key: "G",
            measures: 4,
            chords: ["Am7", "D7", "Gmaj7", "E7"]
        },
        "realtime": {
            id: "realtime",
            name: "Real-Time Follow (Live Guitar Chord)",
            style: "rock_straight_8ths",
            defaultBpm: 120,
            key: "Dynamic",
            measures: 1,
            chords: []
        }
    };


    // =========================================================================
    // 4. PURE JAVASCRIPT WEB AUDIO MOCK FOR NODE.JS / HEADLESS TESTING
    // =========================================================================

    class MockAudioParam {
        constructor(defaultValue = 0) {
            this.value = defaultValue;
            this.targetValue = defaultValue;
            this.events = [];
        }
        setValueAtTime(val, time) {
            this.value = val;
            this.events.push({ type: 'setValueAtTime', value: val, time: time });
        }
        linearRampToValueAtTime(val, time) {
            this.targetValue = val;
            this.events.push({ type: 'linearRampToValueAtTime', value: val, time: time });
        }
        exponentialRampToValueAtTime(val, time) {
            this.targetValue = val;
            this.events.push({ type: 'exponentialRampToValueAtTime', value: val, time: time });
        }
        setTargetAtTime(val, time, timeConstant) {
            this.targetValue = val;
            this.events.push({ type: 'setTargetAtTime', value: val, time: time, timeConstant: timeConstant });
        }
    }

    class MockAudioNode {
        constructor(context, type) {
            this.context = context;
            this.nodeType = type;
            this.connections = [];
        }
        connect(destination) {
            this.connections.push(destination);
            return destination;
        }
        disconnect(destination) {
            if (!destination) {
                this.connections = [];
            } else {
                this.connections = this.connections.filter(c => c !== destination);
            }
        }
    }

    class MockGainNode extends MockAudioNode {
        constructor(context, initialGain = 1.0) {
            super(context, 'GainNode');
            this.gain = new MockAudioParam(initialGain);
        }
    }

    class MockOscillatorNode extends MockAudioNode {
        constructor(context) {
            super(context, 'OscillatorNode');
            this.type = 'sine';
            this.frequency = new MockAudioParam(440);
            this.detune = new MockAudioParam(0);
            this.started = false;
            this.stopped = false;
            this.startTime = null;
            this.stopTime = null;
        }
        start(time = 0) {
            this.started = true;
            this.startTime = time;
            this.context._activeNodes.push(this);
        }
        stop(time = 0) {
            this.stopped = true;
            this.stopTime = time;
        }
    }

    class MockBiquadFilterNode extends MockAudioNode {
        constructor(context) {
            super(context, 'BiquadFilterNode');
            this.type = 'lowpass';
            this.frequency = new MockAudioParam(350);
            this.Q = new MockAudioParam(1);
            this.gain = new MockAudioParam(0);
        }
    }

    class MockAudioBufferSourceNode extends MockAudioNode {
        constructor(context) {
            super(context, 'AudioBufferSourceNode');
            this.buffer = null;
            this.playbackRate = new MockAudioParam(1.0);
            this.loop = false;
            this.started = false;
            this.stopped = false;
        }
        start(time = 0) {
            this.started = true;
            this.context._activeNodes.push(this);
        }
        stop(time = 0) {
            this.stopped = true;
        }
    }

    class MockAudioBuffer {
        constructor(channels, length, sampleRate) {
            this.numberOfChannels = channels;
            this.length = length;
            this.sampleRate = sampleRate;
            this.duration = length / sampleRate;
            this._data = new Float32Array(length);
        }
        getChannelData(c) {
            return this._data;
        }
    }

    class MockAudioContext {
        constructor(options = {}) {
            this.state = 'running';
            this.sampleRate = options.sampleRate || 44100;
            this.currentTime = 0.0;
            this.destination = new MockAudioNode(this, 'AudioDestinationNode');
            this._activeNodes = [];
            this._createdNodes = [];
        }
        async resume() {
            this.state = 'running';
        }
        async suspend() {
            this.state = 'suspended';
        }
        async close() {
            this.state = 'closed';
        }
        createGain() {
            const node = new MockGainNode(this);
            this._createdNodes.push(node);
            return node;
        }
        createOscillator() {
            const node = new MockOscillatorNode(this);
            this._createdNodes.push(node);
            return node;
        }
        createBiquadFilter() {
            const node = new MockBiquadFilterNode(this);
            this._createdNodes.push(node);
            return node;
        }
        createBufferSource() {
            const node = new MockAudioBufferSourceNode(this);
            this._createdNodes.push(node);
            return node;
        }
        createBuffer(channels, length, sampleRate) {
            return new MockAudioBuffer(channels, length, sampleRate);
        }
        advanceTime(seconds) {
            this.currentTime += seconds;
        }
    }


    // =========================================================================
    // 5. PROCEDURAL SOUND SYNTHESIS ENGINE
    // =========================================================================

    /**
     * White noise buffer generator and cache.
     * Generates a 2-second white noise buffer with zero DC offset.
     */
    function getOrCreateNoiseBuffer(audioCtx) {
        if (audioCtx._fretDspNoiseBuffer) {
            return audioCtx._fretDspNoiseBuffer;
        }
        const sampleRate = audioCtx.sampleRate || 44100;
        const length = sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        audioCtx._fretDspNoiseBuffer = buffer;
        return buffer;
    }


    // =========================================================================
    // 6. MAIN BACKING TRACK ENGINE CLASS
    // =========================================================================

    class BackingTrackEngine {
        constructor(options = {}) {
            // Audio context configuration
            this.audioCtx = options.audioCtx || null;
            this.sampleRate = options.sampleRate || 44100;
            this.outputNode = options.outputNode || null;

            // Lookahead Timing configuration
            // Gold standard: 25ms timer interval, 100ms schedule-ahead window
            this.timerInterval = options.timerInterval || 25; // ms
            this.scheduleAheadTime = options.scheduleAheadTime || 0.100; // seconds
            this._timerId = null;

            // Musical playback state
            this.bpm = options.bpm || 120;
            this.isPlaying = false;
            this.currentBar = 0;
            this.currentStep = 0; // step within current bar
            this.nextNoteTime = 0.0;
            this.activeChordName = "C";
            this.activeChord = parseChord("C");
            this.nextChord = null;
            this.liveChord = null; // Used in follow mode
            this.previousKeysMidi = null; // For voice leading

            // Active preset & style
            const initPresetKey = options.preset || "pop_i_v_vi_iv_c";
            this.preset = PROGRESSION_PRESETS[initPresetKey] || PROGRESSION_PRESETS.pop_i_v_vi_iv_c;
            const initStyleKey = options.style || this.preset.style || "rock_straight_8ths";
            this.grooveStyle = GROOVE_STYLES[initStyleKey] || GROOVE_STYLES.rock_straight_8ths;
            this.bpm = options.bpm || this.preset.defaultBpm || this.grooveStyle.defaultBpm;
            this.swing = (options.swing !== undefined) ? options.swing : this.grooveStyle.swing;

            // Custom progression array if provided
            this.customChords = options.chords || null;

            // Mixer levels & mutes
            this.volumes = {
                master: options.masterVolume !== undefined ? options.masterVolume : 0.85,
                drums: options.drumsVolume !== undefined ? options.drumsVolume : 0.85,
                kick: 1.0,
                snare: 0.9,
                hihat: 0.75,
                ride: 0.70,
                bass: options.bassVolume !== undefined ? options.bassVolume : 0.80,
                keys: options.keysVolume !== undefined ? options.keysVolume : 0.75
            };

            this.mutes = {
                drums: false,
                bass: false,
                keys: false
            };

            this.solos = {
                drums: false,
                bass: false,
                keys: false
            };

            // Sound parameters
            this.hiHatClosedDecay = 0.055;
            this.hiHatOpenDecay = 0.38;
            this._activeOpenHatGain = null; // For hi-hat choking

            // Event callbacks
            this._listeners = {
                step: [],
                beat: [],
                bar: [],
                chord: [],
                play: [],
                stop: [],
                tempo: []
            };

            // Web Audio Nodes (initialized lazily or immediately)
            this.masterGain = null;
            this.drumBusGain = null;
            this.kickGain = null;
            this.snareGain = null;
            this.hiHatGain = null;
            this.rideGain = null;
            this.bassBusGain = null;
            this.keysBusGain = null;

            if (this.audioCtx) {
                this._initAudioNodes();
            }
        }

        // ---------------------------------------------------------------------
        // Audio Graph Initialization
        // ---------------------------------------------------------------------

        async initAudio() {
            if (!this.audioCtx) {
                if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
                    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                    this.audioCtx = new AudioContextClass({
                        latencyHint: 'interactive',
                        sampleRate: this.sampleRate
                    });
                } else {
                    // Headless / Node.js fallback
                    this.audioCtx = new MockAudioContext({ sampleRate: this.sampleRate });
                }
            }

            if (this.audioCtx.state === 'suspended') {
                await this.audioCtx.resume();
            }

            this.sampleRate = this.audioCtx.sampleRate;
            this._initAudioNodes();
            return this.audioCtx;
        }

        _initAudioNodes() {
            if (this.masterGain) return; // already initialized

            const ctx = this.audioCtx;
            const dest = this.outputNode || ctx.destination;

            // Master Bus
            this.masterGain = ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.volumes.master, ctx.currentTime);
            this.masterGain.connect(dest);

            // Drum Bus
            this.drumBusGain = ctx.createGain();
            this.drumBusGain.gain.setValueAtTime(this.volumes.drums, ctx.currentTime);
            this.drumBusGain.connect(this.masterGain);

            this.kickGain = ctx.createGain();
            this.kickGain.gain.setValueAtTime(this.volumes.kick, ctx.currentTime);
            this.kickGain.connect(this.drumBusGain);

            this.snareGain = ctx.createGain();
            this.snareGain.gain.setValueAtTime(this.volumes.snare, ctx.currentTime);
            this.snareGain.connect(this.drumBusGain);

            this.hiHatGain = ctx.createGain();
            this.hiHatGain.gain.setValueAtTime(this.volumes.hihat, ctx.currentTime);
            this.hiHatGain.connect(this.drumBusGain);

            this.rideGain = ctx.createGain();
            this.rideGain.gain.setValueAtTime(this.volumes.ride, ctx.currentTime);
            this.rideGain.connect(this.drumBusGain);

            // Bass Bus
            this.bassBusGain = ctx.createGain();
            this.bassBusGain.gain.setValueAtTime(this.volumes.bass, ctx.currentTime);
            this.bassBusGain.connect(this.masterGain);

            // Keys Bus
            this.keysBusGain = ctx.createGain();
            this.keysBusGain.gain.setValueAtTime(this.volumes.keys, ctx.currentTime);
            this.keysBusGain.connect(this.masterGain);
        }

        // ---------------------------------------------------------------------
        // Procedural Drum Voices (Pure Web Audio Nodes)
        // ---------------------------------------------------------------------

        /**
         * Procedural Kick Drum:
         * Pure sine wave oscillator with fast exponential pitch drop (150 Hz -> 40 Hz)
         * and exponential gain decay.
         */
        triggerKick(time, velocity = 1.0) {
            if (!this.audioCtx || this._isMuted('drums')) return;
            const ctx = this.audioCtx;
            const t = Math.max(time, ctx.currentTime);

            // Sine wave body oscillator
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';

            // Fast exponential pitch drop from 150 Hz down to 40 Hz, then 30 Hz
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(40, t + 0.055);
            osc.frequency.exponentialRampToValueAtTime(30, t + 0.25);

            // Gain envelope with rapid attack and punchy decay
            const peakGain = Math.max(0.001, velocity * 1.1);
            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(peakGain, t + 0.003);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);

            osc.connect(gain);
            gain.connect(this.kickGain || this.masterGain);

            osc.start(t);
            osc.stop(t + 0.32);

            // Subtle sub-bass ducking on kick hit (simulates analog console compression)
            if (this.bassBusGain && this.bassBusGain.gain) {
                const curBassGain = this.volumes.bass * (this._isMuted('bass') ? 0 : 1);
                this.bassBusGain.gain.setValueAtTime(curBassGain * 0.75, t);
                this.bassBusGain.gain.setTargetAtTime(curBassGain, t + 0.05, 0.04);
            }
        }

        /**
         * Procedural Snare Drum:
         * High-pass filtered white noise burst mixed with a short 180 Hz body tone.
         */
        triggerSnare(time, velocity = 1.0) {
            if (!this.audioCtx || this._isMuted('drums')) return;
            const ctx = this.audioCtx;
            const t = Math.max(time, ctx.currentTime);

            // 1. Snare Body tone (180 Hz tone decaying downward)
            const bodyOsc = ctx.createOscillator();
            const bodyGain = ctx.createGain();
            bodyOsc.type = 'triangle';
            bodyOsc.frequency.setValueAtTime(180, t);
            bodyOsc.frequency.exponentialRampToValueAtTime(120, t + 0.06);

            const bodyPeak = Math.max(0.001, velocity * 0.65);
            bodyGain.gain.setValueAtTime(bodyPeak, t);
            bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

            bodyOsc.connect(bodyGain);
            bodyGain.connect(this.snareGain || this.masterGain);
            bodyOsc.start(t);
            bodyOsc.stop(t + 0.14);

            // 2. Snare Wires Noise Burst (High-pass filtered white noise)
            const noise = ctx.createBufferSource();
            noise.buffer = getOrCreateNoiseBuffer(ctx);

            const hpFilter = ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.setValueAtTime(800, t);
            hpFilter.Q.setValueAtTime(1.0, t);

            const noiseGain = ctx.createGain();
            const noisePeak = Math.max(0.001, velocity * 0.90);
            noiseGain.gain.setValueAtTime(0.001, t);
            noiseGain.gain.linearRampToValueAtTime(noisePeak, t + 0.002);
            noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);

            noise.connect(hpFilter);
            hpFilter.connect(noiseGain);
            noiseGain.connect(this.snareGain || this.masterGain);

            noise.start(t);
            noise.stop(t + 0.20);
        }

        /**
         * Procedural Hi-Hat:
         * Band-pass filtered metallic noise with adjustable closed/open decay and choking.
         */
        triggerHiHat(time, isOpen = false, velocity = 1.0) {
            if (!this.audioCtx || this._isMuted('drums')) return;
            const ctx = this.audioCtx;
            const t = Math.max(time, ctx.currentTime);

            // Choke previous open hat if this is a closed hat
            if (!isOpen && this._activeOpenHatGain) {
                try {
                    this._activeOpenHatGain.gain.cancelScheduledValues(t);
                    this._activeOpenHatGain.gain.setValueAtTime(this._activeOpenHatGain.gain.value, t);
                    this._activeOpenHatGain.gain.linearRampToValueAtTime(0.0001, t + 0.015);
                } catch (e) {}
                this._activeOpenHatGain = null;
            }

            const noise = ctx.createBufferSource();
            noise.buffer = getOrCreateNoiseBuffer(ctx);

            // Band-pass filter around 8500 Hz for crisp metallic sizzle
            const bpFilter = ctx.createBiquadFilter();
            bpFilter.type = 'bandpass';
            bpFilter.frequency.setValueAtTime(8500, t);
            bpFilter.Q.setValueAtTime(3.0, t);

            // High-pass filter above 7000 Hz to remove low-mid rumble
            const hpFilter = ctx.createBiquadFilter();
            hpFilter.type = 'highpass';
            hpFilter.frequency.setValueAtTime(7000, t);

            const hatGain = ctx.createGain();
            const decay = isOpen ? this.hiHatOpenDecay : this.hiHatClosedDecay;
            const peak = Math.max(0.001, velocity * 0.85);

            hatGain.gain.setValueAtTime(peak, t);
            hatGain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

            if (isOpen) {
                this._activeOpenHatGain = hatGain;
            }

            noise.connect(bpFilter);
            bpFilter.connect(hpFilter);
            hpFilter.connect(hatGain);
            hatGain.connect(this.hiHatGain || this.masterGain);

            noise.start(t);
            noise.stop(t + decay + 0.02);
        }

        /**
         * Procedural Ride Cymbal (for Jazz / Swing):
         * Metallic wash with resonant high bandpass and subtle bell undertone.
         */
        triggerRide(time, velocity = 1.0) {
            if (!this.audioCtx || this._isMuted('drums')) return;
            const ctx = this.audioCtx;
            const t = Math.max(time, ctx.currentTime);

            const noise = ctx.createBufferSource();
            noise.buffer = getOrCreateNoiseBuffer(ctx);

            const filter = ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(6500, t);
            filter.Q.setValueAtTime(4.0, t);

            const gain = ctx.createGain();
            const decay = 0.45;
            const peak = Math.max(0.001, velocity * 0.70);

            gain.gain.setValueAtTime(peak, t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);

            noise.connect(filter);
            filter.connect(gain);
            gain.connect(this.rideGain || this.masterGain);

            noise.start(t);
            noise.stop(t + decay + 0.02);
        }

        // ---------------------------------------------------------------------
        // Procedural Bass & Comping Keys Voices
        // ---------------------------------------------------------------------

        /**
         * Procedural Bass Note Generator:
         * Dual oscillator (Triangle warm fundamental + Sawtooth harmonics)
         * with punchy low-pass filter decay envelope.
         */
        triggerBassNote(time, midiNote, durationSeconds, velocity = 1.0) {
            if (!this.audioCtx || this._isMuted('bass') || !midiNote) return;
            const ctx = this.audioCtx;
            const t = Math.max(time, ctx.currentTime);
            const freq = midiToFrequency(midiNote);

            // Sub fundamental (Triangle)
            const osc1 = ctx.createOscillator();
            osc1.type = 'triangle';
            osc1.frequency.setValueAtTime(freq, t);

            // Harmonic warmth (Sawtooth)
            const osc2 = ctx.createOscillator();
            osc2.type = 'sawtooth';
            osc2.frequency.setValueAtTime(freq, t);
            osc2.detune.setValueAtTime(3, t); // +3 cents for analog chorus thickness

            // Lowpass Filter with punchy envelope
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(650, t);
            filter.frequency.exponentialRampToValueAtTime(200, t + Math.min(durationSeconds, 0.22));
            filter.Q.setValueAtTime(2.0, t);

            const gain = ctx.createGain();
            const peak = Math.max(0.001, velocity * 0.90);
            const dur = Math.max(0.08, durationSeconds);

            // Attack & release envelope
            gain.gain.setValueAtTime(0.001, t);
            gain.gain.linearRampToValueAtTime(peak, t + 0.006);
            gain.gain.setValueAtTime(peak * 0.85, t + Math.max(0.015, dur - 0.04));
            gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

            osc1.connect(filter);
            osc2.connect(filter);
            filter.connect(gain);
            gain.connect(this.bassBusGain || this.masterGain);

            osc1.start(t);
            osc2.start(t);
            osc1.stop(t + dur + 0.02);
            osc2.stop(t + dur + 0.02);
        }

        /**
         * Procedural Comping Keys (Warm Rhodes / Pad / Organ):
         * Warm triangle/saw pad with lowpass envelope playing chord triads on syncopated beats.
         */
        triggerCompingChord(time, midiNotes, durationSeconds, velocity = 1.0, style = 'pad') {
            if (!this.audioCtx || this._isMuted('keys') || !midiNotes || midiNotes.length === 0) return;
            const ctx = this.audioCtx;
            const t = Math.max(time, ctx.currentTime);
            const dur = Math.max(0.06, durationSeconds);
            const numNotes = midiNotes.length;
            const noteVel = (velocity * 0.75) / Math.sqrt(numNotes);

            for (let i = 0; i < numNotes; i++) {
                const midi = midiNotes[i];
                const freq = midiToFrequency(midi);

                const osc1 = ctx.createOscillator();
                osc1.type = 'triangle';
                osc1.frequency.setValueAtTime(freq, t);

                const osc2 = ctx.createOscillator();
                osc2.type = 'sawtooth';
                osc2.frequency.setValueAtTime(freq, t);
                osc2.detune.setValueAtTime(4, t); // +4 cents detune for electric piano shimmer

                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                const cutoff = (style === 'stab') ? 1400 : 1000;
                filter.frequency.setValueAtTime(cutoff, t);
                if (style === 'stab') {
                    filter.frequency.exponentialRampToValueAtTime(400, t + dur);
                }
                filter.Q.setValueAtTime(1.2, t);

                const gain = ctx.createGain();
                const peak = Math.max(0.001, noteVel);

                // Shaped envelope
                gain.gain.setValueAtTime(0.001, t);
                gain.gain.linearRampToValueAtTime(peak, t + 0.012);
                gain.gain.setValueAtTime(peak * 0.70, t + Math.max(0.02, dur - 0.03));
                gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

                osc1.connect(filter);
                osc2.connect(filter);
                filter.connect(gain);
                gain.connect(this.keysBusGain || this.masterGain);

                osc1.start(t);
                osc2.start(t);
                osc1.stop(t + dur + 0.03);
                osc2.stop(t + dur + 0.03);
            }
        }

        // ---------------------------------------------------------------------
        // Lookahead Scheduler (25ms timer interval, 100ms schedule ahead)
        // ---------------------------------------------------------------------

        start() {
            if (this.isPlaying) return;
            this.isPlaying = true;

            if (!this.audioCtx) {
                this.initAudio();
            }

            if (this.audioCtx && this.audioCtx.state === 'suspended') {
                this.audioCtx.resume();
            }

            // Start slightly ahead (50ms pre-roll) to guarantee first events never glitch
            this.currentBar = 0;
            this.currentStep = 0;
            this.previousKeysMidi = null;
            this.nextNoteTime = (this.audioCtx ? this.audioCtx.currentTime : 0) + 0.05;

            this._updateActiveChords();
            this._emit('play', { bpm: this.bpm, groove: this.grooveStyle.name, preset: this.preset.name });

            this._timerId = setInterval(() => {
                this._schedulerTick();
            }, this.timerInterval);

            // Run first tick immediately
            this._schedulerTick();
        }

        play() {
            this.start();
        }

        pause() {
            this.stop();
        }

        stop() {
            if (!this.isPlaying) return;
            this.isPlaying = false;
            if (this._timerId) {
                clearInterval(this._timerId);
                this._timerId = null;
            }
            this.currentBar = 0;
            this.currentStep = 0;
            this.previousKeysMidi = null;
            this._emit('stop', {});
        }

        /**
         * Core lookahead timer loop.
         * Runs every 25ms and schedules all musical events within currentTime + scheduleAheadTime (100ms).
         */
        _schedulerTick() {
            if (!this.isPlaying || !this.audioCtx) return;

            const lookaheadEnd = this.audioCtx.currentTime + this.scheduleAheadTime;

            while (this.nextNoteTime < lookaheadEnd) {
                this._scheduleStep(this.currentStep, this.nextNoteTime, this.currentBar);
                this._advanceStep();
            }
        }

        /**
         * Schedules drum, bass, and keys events for a specific step.
         */
        _scheduleStep(stepIndex, time, barIndex) {
            const style = this.grooveStyle;
            const quarterDuration = 60.0 / this.bpm;
            const nominalStepDuration = quarterDuration * (4.0 / style.subdivision);

            // 1. Drums
            const drumEvents = style.getDrums(stepIndex);
            if (drumEvents.kick > 0) {
                this.triggerKick(time, drumEvents.kick);
            }
            if (drumEvents.snare > 0) {
                this.triggerSnare(time, drumEvents.snare);
            }
            if (drumEvents.hihat > 0) {
                this.triggerHiHat(time, drumEvents.hihatOpen, drumEvents.hihat);
            }
            if (drumEvents.ride > 0) {
                this.triggerRide(time, drumEvents.ride);
            }

            // 2. Bass
            const bassEvent = style.getBass(stepIndex, this.activeChord, this.nextChord);
            if (bassEvent && bassEvent.active) {
                const durSeconds = bassEvent.durationBeats * quarterDuration;
                this.triggerBassNote(time, bassEvent.midi, durSeconds, bassEvent.velocity);
            }

            // 3. Keys
            const keysEvent = style.getKeys(stepIndex, this.activeChord);
            if (keysEvent && keysEvent.active) {
                const durSeconds = keysEvent.durationBeats * quarterDuration;
                const voicings = getVoiceLedChordMidi(this.activeChord.displayName, this.previousKeysMidi);
                this.previousKeysMidi = voicings;
                this.triggerCompingChord(time, voicings, durSeconds, keysEvent.velocity, keysEvent.style);
            }

            // 4. Emit callback events
            const isBeatStart = (stepIndex % (style.subdivision / 4) === 0);
            const beatNumber = Math.floor(stepIndex / (style.subdivision / 4)) + 1;

            this._emit('step', {
                step: stepIndex,
                bar: barIndex,
                time: time,
                chord: this.activeChord.displayName,
                isBeat: isBeatStart,
                beatNumber: beatNumber
            });

            if (isBeatStart) {
                this._emit('beat', {
                    beat: beatNumber,
                    bar: barIndex,
                    time: time,
                    chord: this.activeChord.displayName
                });
            }
        }

        /**
         * Advances the step pointer and calculates exact hardware timestamp of next step,
         * taking tempo and swing factor into account with zero cumulative drift.
         */
        _advanceStep() {
            const style = this.grooveStyle;
            const quarterDuration = 60.0 / this.bpm;
            const stepsPerQuarter = style.subdivision / 4;
            const nominalStepDuration = quarterDuration / stepsPerQuarter;

            // Swing calculation:
            // For 8th-note or 16th-note pairs:
            // even steps are on the beat; odd steps are swung.
            let stepDuration = nominalStepDuration;
            const swingFactor = (this.swing !== undefined) ? this.swing : style.swing;

            if (swingFactor > 0.0 && stepsPerQuarter === 2) {
                // 8th-note swing
                const pairDuration = 2.0 * nominalStepDuration;
                if (this.currentStep % 2 === 0) {
                    stepDuration = pairDuration * swingFactor;
                } else {
                    stepDuration = pairDuration * (1.0 - swingFactor);
                }
            } else if (swingFactor > 0.5 && stepsPerQuarter === 4) {
                // 16th-note swing
                const pairDuration = 2.0 * nominalStepDuration;
                if (this.currentStep % 2 === 0) {
                    stepDuration = pairDuration * swingFactor;
                } else {
                    stepDuration = pairDuration * (1.0 - swingFactor);
                }
            }

            this.nextNoteTime += stepDuration;
            this.currentStep++;

            if (this.currentStep >= style.subdivision) {
                this.currentStep = 0;
                this.currentBar++;
                this._updateActiveChords();
                this._emit('bar', {
                    bar: this.currentBar,
                    time: this.nextNoteTime,
                    chord: this.activeChord.displayName
                });
            }
        }

        /**
         * Updates the active chord and upcoming next chord based on progression or follow mode.
         */
        _updateActiveChords() {
            let chordList = null;

            if (this.customChords && this.customChords.length > 0) {
                chordList = this.customChords;
            } else if (this.preset && this.preset.chords && this.preset.chords.length > 0) {
                chordList = this.preset.chords;
            }

            // Real-time follow mode: adapts to live chord detected from guitar input
            if (this.preset && this.preset.id === "realtime" && this.liveChord) {
                this.activeChordName = this.liveChord;
                this.activeChord = parseChord(this.liveChord);
                this.nextChord = this.activeChord;
                this._emit('chord', { chord: this.activeChordName, bar: this.currentBar });
                return;
            }

            if (!chordList || chordList.length === 0) {
                this.activeChordName = "C";
                this.activeChord = parseChord("C");
                this.nextChord = this.activeChord;
                return;
            }

            const chordIdx = this.currentBar % chordList.length;
            const nextIdx = (this.currentBar + 1) % chordList.length;

            this.activeChordName = chordList[chordIdx];
            this.activeChord = parseChord(this.activeChordName);
            this.nextChord = parseChord(chordList[nextIdx]);

            this._emit('chord', {
                chord: this.activeChordName,
                bar: this.currentBar,
                nextChord: chordList[nextIdx]
            });
        }

        // ---------------------------------------------------------------------
        // Live Chord & Chord-Engine Integration
        // ---------------------------------------------------------------------

        /**
         * Sets the real-time chord immediately (e.g. from chord-engine.js or UI selection).
         */
        setLiveChord(chordStr) {
            if (!chordStr) return;
            this.liveChord = chordStr;
            if (this.preset && this.preset.id === "realtime") {
                this.activeChordName = chordStr;
                this.activeChord = parseChord(chordStr);
                this.nextChord = this.activeChord;
                this._emit('chord', { chord: this.activeChordName, bar: this.currentBar, live: true });
            }
        }

        /**
         * Binds directly to a ChordEngine PolyphonicChordRecognizer instance.
         */
        bindChordEngine(chordRecognizer) {
            if (!chordRecognizer) return;
            // Listen for recognized chord changes
            if (typeof chordRecognizer.onChord === 'function') {
                chordRecognizer.onChord((res) => {
                    if (res && res.chord && res.chord !== 'None') {
                        this.setLiveChord(res.chord);
                    }
                });
            }
        }

        // ---------------------------------------------------------------------
        // Controls, Presets & Grooves Configuration
        // ---------------------------------------------------------------------

        setBpm(bpm) {
            const clamped = Math.max(40, Math.min(260, Math.round(bpm)));
            this.bpm = clamped;
            this._emit('tempo', { bpm: this.bpm });
        }

        setGroove(grooveIdOrObj) {
            let style = null;
            if (typeof grooveIdOrObj === 'string') {
                style = GROOVE_STYLES[grooveIdOrObj];
            } else if (grooveIdOrObj && grooveIdOrObj.id) {
                style = grooveIdOrObj;
            }
            if (style) {
                this.grooveStyle = style;
                this.swing = style.swing;
                if (!this.isPlaying) {
                    this.bpm = style.defaultBpm;
                }
            }
        }

        setProgression(presetIdOrObj) {
            let p = null;
            if (typeof presetIdOrObj === 'string') {
                p = PROGRESSION_PRESETS[presetIdOrObj];
            } else if (presetIdOrObj && presetIdOrObj.id) {
                p = presetIdOrObj;
            }
            if (p) {
                this.preset = p;
                this.customChords = null;
                if (p.style && GROOVE_STYLES[p.style]) {
                    this.grooveStyle = GROOVE_STYLES[p.style];
                    this.swing = this.grooveStyle.swing;
                }
                if (p.defaultBpm && !this.isPlaying) {
                    this.bpm = p.defaultBpm;
                }
                this._updateActiveChords();
            }
        }

        setCustomProgression(chordsArray) {
            if (Array.isArray(chordsArray) && chordsArray.length > 0) {
                this.customChords = chordsArray.slice();
                this._updateActiveChords();
            }
        }

        setSwing(swingFactor) {
            this.swing = Math.max(0.0, Math.min(0.85, swingFactor));
        }

        setVolume(track, val) {
            const v = Math.max(0.0, Math.min(1.0, val));
            this.volumes[track] = v;

            const t = this.audioCtx ? this.audioCtx.currentTime : 0;
            if (track === 'master' && this.masterGain) {
                this.masterGain.gain.setValueAtTime(v, t);
            } else if (track === 'drums' && this.drumBusGain) {
                this.drumBusGain.gain.setValueAtTime(this._isMuted('drums') ? 0 : v, t);
            } else if (track === 'bass' && this.bassBusGain) {
                this.bassBusGain.gain.setValueAtTime(this._isMuted('bass') ? 0 : v, t);
            } else if (track === 'keys' && this.keysBusGain) {
                this.keysBusGain.gain.setValueAtTime(this._isMuted('keys') ? 0 : v, t);
            }
        }

        setMute(track, isMuted) {
            if (this.mutes[track] !== undefined) {
                this.mutes[track] = !!isMuted;
                this._syncMixerGains();
            }
        }

        setSolo(track, isSoloed) {
            if (this.solos[track] !== undefined) {
                this.solos[track] = !!isSoloed;
                this._syncMixerGains();
            }
        }

        _isMuted(track) {
            // Check if any solo is active
            const anySolo = Object.values(this.solos).some(s => s === true);
            if (anySolo) {
                return !this.solos[track];
            }
            return !!this.mutes[track];
        }

        _syncMixerGains() {
            const t = this.audioCtx ? this.audioCtx.currentTime : 0;
            if (this.drumBusGain) {
                const vol = this._isMuted('drums') ? 0 : this.volumes.drums;
                this.drumBusGain.gain.setValueAtTime(vol, t);
            }
            if (this.bassBusGain) {
                const vol = this._isMuted('bass') ? 0 : this.volumes.bass;
                this.bassBusGain.gain.setValueAtTime(vol, t);
            }
            if (this.keysBusGain) {
                const vol = this._isMuted('keys') ? 0 : this.volumes.keys;
                this.keysBusGain.gain.setValueAtTime(vol, t);
            }
        }

        getState() {
            return {
                isPlaying: this.isPlaying,
                bpm: this.bpm,
                swing: this.swing,
                groove: this.grooveStyle.id,
                grooveName: this.grooveStyle.name,
                preset: this.preset.id,
                presetName: this.preset.name,
                currentBar: this.currentBar,
                currentStep: this.currentStep,
                activeChord: this.activeChordName,
                volumes: Object.assign({}, this.volumes),
                mutes: Object.assign({}, this.mutes),
                solos: Object.assign({}, this.solos)
            };
        }

        // ---------------------------------------------------------------------
        // Event Emitter Support
        // ---------------------------------------------------------------------

        on(event, callback) {
            if (this._listeners[event]) {
                this._listeners[event].push(callback);
            }
        }

        off(event, callback) {
            if (this._listeners[event]) {
                this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
            }
        }

        _emit(event, data) {
            if (this._listeners[event]) {
                for (let i = 0; i < this._listeners[event].length; i++) {
                    try {
                        this._listeners[event][i](data);
                    } catch (e) {
                        console.error(`BackingTrack listener error for event ${event}:`, e);
                    }
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Factory Convenience Function
    // -------------------------------------------------------------------------

    function createBackingTrack(options = {}) {
        return new BackingTrackEngine(options);
    }

    // =========================================================================
    // 7. EXPORTS
    // =========================================================================

    return {
        BackingTrackEngine: BackingTrackEngine,
        createBackingTrack: createBackingTrack,
        GROOVE_STYLES: GROOVE_STYLES,
        PROGRESSION_PRESETS: PROGRESSION_PRESETS,
        CHORD_QUALITIES: CHORD_QUALITIES,
        NOTE_NAMES: NOTE_NAMES,
        ENHARMONIC_MAP: ENHARMONIC_MAP,
        parseChord: parseChord,
        chordToFrequencies: chordToFrequencies,
        getBassMidi: getBassMidi,
        getBassFrequency: getBassFrequency,
        midiToFrequency: midiToFrequency,
        frequencyToMidi: frequencyToMidi,
        noteNameToMidi: noteNameToMidi,
        getVoiceLedChordMidi: getVoiceLedChordMidi,
        MockAudioContext: MockAudioContext,
        MockGainNode: MockGainNode,
        MockOscillatorNode: MockOscillatorNode,
        MockBiquadFilterNode: MockBiquadFilterNode,
        MockAudioBufferSourceNode: MockAudioBufferSourceNode,
        MockAudioBuffer: MockAudioBuffer
    };
}));
