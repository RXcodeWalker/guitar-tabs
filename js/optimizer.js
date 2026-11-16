/**
 * FretDSP Biomechanical Guitar Optimizer (V2)
 *
 * Implements an ergonomic left-hand fingering optimizer for tablature passages
 * using a Viterbi-style dynamic programming lowest-cost trellis solver.
 *
 * Features:
 * - Physical Hand Cost Matrix:
 *     * Quadratic span penalty exceeding 4 frets adjusted for physical fret spacing along the neck.
 *     * Hand position shift penalty proportional to distance shifted along the neck.
 *     * String crossing penalty (adjacent string preference) and inversion penalty (backward finger crossings).
 *     * Open string bonus for rapid acoustic passages.
 * - Scale Box Constraints:
 *     * CAGED box shapes (C, A, G, E, D forms).
 *     * 3-Notes-Per-String (3NPS) modal shapes (Patterns 1-7 / Ionian through Locrian).
 *     * Custom fret span boundaries.
 * - Pure module decoupled from DOM, Web Audio, or canvas logic.
 */

class GuitarOptimizer {
    constructor(options = {}) {
        // Standard guitar tunings (MIDI numbers from string 1 [high e] to string 6 [low E])
        this.tunings = {
            standard: [64, 59, 55, 50, 45, 40], // e4, B3, G3, D3, A2, E2
            dropD:    [64, 59, 55, 50, 45, 38], // e4, B3, G3, D3, A2, D2
            halfStep: [63, 58, 54, 49, 44, 39], // Eb4, Bb3, Gb3, Db3, Ab2, Eb2
            dadgad:   [62, 57, 55, 50, 45, 38], // D4, A3, G3, D3, A2, D2
            openD:    [62, 57, 54, 50, 45, 38], // D4, A3, F#3, D3, A2, D2
            openG:    [62, 59, 55, 50, 43, 38]  // D4, B3, G3, D3, G2, D2
        };

        this.currentTuningName = options.tuning || 'standard';
        this.openMidi = [...(this.tunings[this.currentTuningName] || this.tunings.standard)];
        this.numFrets = options.numFrets || 22;

        // Ergonomic state for single-note incremental calls
        this.handAnchorFret = options.initialPosition || 1; // 1st position (frets 1-4)
        this.prevString = 3;
        this.prevFret = 0;
        this.prevFinger = 1;

        // Optimization mode: 'adaptive', 'open', 'mid', 'high'
        this.mode = options.mode || 'adaptive';

        this.noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

        // Biomechanical cost matrix default weights
        this.weights = {
            span: 18.0,               // Quadratic span penalty factor
            shiftBase: 6.0,           // Base cost for any hand shift
            shiftPerFret: 8.0,        // Linear cost per fret of hand anchor shift
            adjacentString: 1.0,      // Cost for moving to adjacent string
            stringSkip: 7.0,          // Penalty factor for skipping strings (|Δs| > 1)
            inversionBase: 35.0,      // Base penalty for backward finger crossing
            inversionPerDegree: 12.0, // Multiplier for severity of inverted finger/fret reach
            sameFingerHop: 25.0,      // Awkward same-finger jump to a different fret on another string
            barreEase: 1.0,           // Small cost for rolling or barring same fret across strings
            openStringBase: 1.0,      // Comfort cost for open strings
            openStringBonus: 6.0,     // General bonus for open string usage
            acousticOpenBonus: 18.0,  // Enhanced bonus for rapid acoustic passages
            timbreHighWound: 25.0,    // Muddy timbre penalty for frets > 14 on low strings (5 & 6)
            timbreExtremeFret: 15.0,  // Penalty for cramped frets above fret 19
            constraintViolation: 50000.0 // Heavy penalty when outside selected scale box
        };

        // Override weights if provided
        if (options.weights) {
            Object.assign(this.weights, options.weights);
        }
    }

    /**
     * Changes guitar tuning.
     * @param {string|Array<number>} tuningName - Tuning name or 6-element MIDI array
     * @param {Array<number>} [customMidi=null] - Optional 6-element custom MIDI array
     */
    setTuning(tuningName, customMidi = null) {
        if (Array.isArray(tuningName) && tuningName.length === 6) {
            this.openMidi = [...tuningName];
            this.currentTuningName = 'custom';
        } else if (this.tunings[tuningName]) {
            this.currentTuningName = tuningName;
            this.openMidi = customMidi && customMidi.length === 6 ? [...customMidi] : [...this.tunings[tuningName]];
        }
    }

    /**
     * Sets ergonomic bias mode ('adaptive', 'open', 'mid', 'high').
     */
    setMode(mode) {
        this.mode = mode;
    }

    /**
     * Manually overrides hand anchor position.
     */
    setHandPosition(anchorFret) {
        this.handAnchorFret = Math.max(1, Math.min(this.numFrets - 3, anchorFret));
    }

    /**
     * Converts a note pitch representation (number or string e.g. "C4", "F#3", "Bb2") to MIDI number.
     * @param {number|string} pitch - MIDI note or pitch string
     * @returns {number} MIDI note number
     */
    parsePitch(pitch) {
        if (typeof pitch === 'number') {
            return Math.round(pitch);
        }
        if (typeof pitch === 'string') {
            const trimmed = pitch.trim();
            const match = trimmed.match(/^([A-Ga-g])([#b]?)(-?\d+)$/);
            if (match) {
                const name = match[1].toUpperCase();
                const acc = match[2];
                const octave = parseInt(match[3], 10);
                const baseMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                let semi = baseMap[name];
                if (acc === '#') semi += 1;
                else if (acc === 'b') semi -= 1;
                return (octave + 1) * 12 + semi;
            }
            // Check if string is a numeric string
            const num = parseInt(trimmed, 10);
            if (!isNaN(num)) return num;
        }
        throw new Error(`Invalid pitch representation: ${pitch}`);
    }

    /**
     * Returns all physically playable (string, fret) candidates for a given MIDI note.
     * @param {number} midi - Target MIDI note number (e.g. 64 for E4).
     * @returns {Array<Object>} candidates
     */
    findCandidates(midi) {
        const parsedMidi = typeof midi === 'number' ? midi : this.parsePitch(midi);
        const candidates = [];

        for (let strIdx = 0; strIdx < 6; strIdx++) {
            const stringNum = strIdx + 1; // 1 (high e) to 6 (low E)
            const openNote = this.openMidi[strIdx];
            const fret = parsedMidi - openNote;

            if (fret >= 0 && fret <= this.numFrets) {
                candidates.push({
                    string: stringNum,
                    fret: fret,
                    midi: parsedMidi,
                    noteName: this.noteNames[parsedMidi % 12],
                    octave: Math.floor(parsedMidi / 12) - 1,
                    isOpen: (fret === 0)
                });
            }
        }

        return candidates;
    }

    /**
     * Assigns optimal left hand finger (0 = open, 1 = index, 2 = middle, 3 = ring, 4 = pinky).
     * Maintains backwards compatibility for single-note assignments.
     */
    assignFinger(fret, anchor) {
        if (fret === 0) return 0; // Open string
        const offset = fret - anchor;
        if (offset <= 0) return 1;  // Index (or extended index)
        if (offset === 1) return 2; // Middle
        if (offset === 2) return 3; // Ring
        return 4;                   // Pinky (or extended pinky)
    }

    /**
     * Dynamically shifts hand anchor if the player moves outside the comfortable 4-fret span.
     */
    updateHandPosition(fret) {
        if (fret === 0) return; // Open string doesn't shift anchor
        if (fret < this.handAnchorFret) {
            this.handAnchorFret = Math.max(1, fret);
        } else if (fret > this.handAnchorFret + 3) {
            this.handAnchorFret = Math.max(1, fret - 2);
        }
    }

    /**
     * Biomechanical Cost Function for single-note evaluation (maintains 100% backward compatibility).
     */
    calculateBiomechanicalCost(candidate) {
        const { fret, string, isOpen } = candidate;

        if (isOpen) {
            if (this.mode === 'high') return 40;
            return 2.0;
        }

        let cost = 0;
        const currentAnchor = this.handAnchorFret;
        const handSpanMin = currentAnchor;
        const handSpanMax = currentAnchor + 3;

        if (fret >= handSpanMin && fret <= handSpanMax) {
            cost += 0;
        } else if (fret === handSpanMin - 1 || fret === handSpanMax + 1) {
            cost += 8;
        } else {
            const shiftDistance = Math.min(Math.abs(fret - handSpanMin), Math.abs(fret - handSpanMax));
            cost += 20 + shiftDistance * 6;
        }

        const stringJump = Math.abs(string - this.prevString);
        cost += stringJump * 4;

        if (this.mode === 'open') {
            if (fret > 5) cost += (fret - 5) * 12;
        } else if (this.mode === 'mid') {
            const distFromMid = Math.abs(fret - 7);
            cost += distFromMid * 5;
        } else if (this.mode === 'high') {
            if (fret < 9) cost += (9 - fret) * 10;
        } else {
            if (fret > 15) cost += (fret - 15) * 3;
        }

        if ((string === 6 || string === 5) && fret > 14) {
            cost += 25;
        }

        return cost;
    }

    /**
     * Unified optimize method.
     * If an array of notes is provided, executes the Viterbi passage optimizer.
     * If a single note or MIDI number is provided, maintains single-note optimization.
     * @param {Array<Object>|number|Object} input - Array of notes or single note / MIDI
     * @param {Object} [options={}] - Optimization and constraint options
     * @returns {Array<Object>|Object|null}
     */
    optimize(input, options = {}) {
        if (Array.isArray(input)) {
            return this.optimizePassage(input, options);
        }

        // Single note / MIDI number fallback
        let targetMidi = null;
        if (typeof input === 'number') {
            targetMidi = input;
        } else if (input && typeof input === 'object') {
            targetMidi = input.midi !== undefined ? input.midi : input.pitch;
            if (typeof targetMidi === 'string') {
                targetMidi = this.parsePitch(targetMidi);
            }
        }

        if (targetMidi === null || isNaN(targetMidi)) {
            return null;
        }

        const candidates = this.findCandidates(targetMidi);
        if (candidates.length === 0) return null;

        let bestCandidate = null;
        let lowestCost = Infinity;

        for (const cand of candidates) {
            const cost = this.calculateBiomechanicalCost(cand);
            cand.cost = cost;
            if (cost < lowestCost) {
                lowestCost = cost;
                bestCandidate = cand;
            }
        }

        const finger = this.assignFinger(bestCandidate.fret, this.handAnchorFret);
        bestCandidate.finger = finger;

        this.updateHandPosition(bestCandidate.fret);
        this.prevString = bestCandidate.string;
        this.prevFret = bestCandidate.fret;
        this.prevFinger = finger;

        return {
            string: bestCandidate.string,
            fret: bestCandidate.fret,
            finger: finger,
            handPosition: this.handAnchorFret,
            midi: bestCandidate.midi,
            noteName: bestCandidate.noteName,
            octave: bestCandidate.octave,
            isOpen: bestCandidate.isOpen,
            cost: lowestCost,
            allCandidates: candidates
        };
    }

    // =========================================================================
    // TASK 1: PHYSICAL HAND COST MATRIX
    // =========================================================================

    /**
     * Span Penalty:
     * Quadratic cost if fret reach exceeds 4 frets, adjusted for physical fret spacing along the neck.
     * Spacing factor models physical distance: L * 2^(-anchor/12), shrinking as frets get higher.
     * @param {number} fret - Target fret
     * @param {number} anchor - Current hand anchor fret
     * @returns {number} Span penalty cost
     */
    calculateSpanPenalty(fret, anchor) {
        if (fret === 0 || anchor == null) return 0;

        const minFret = anchor;
        const maxFret = anchor + 3; // Standard 4-fret reach span [anchor, anchor+3]
        let excess = 0;

        if (fret > maxFret) {
            excess = fret - maxFret;
        } else if (fret < minFret) {
            excess = minFret - fret;
        }

        if (excess <= 0) return 0;

        // Physical fret spacing adjustment: frets are ~half the width at fret 12 vs nut
        const spacingFactor = Math.pow(2, -Math.max(0, anchor - 1) / 12);
        return this.weights.span * (excess * excess) * spacingFactor;
    }

    /**
     * Hand Position Shift Penalty:
     * Cost proportional to the distance shifted by the hand anchor point along the neck.
     * Scales with speed/rest interval if deltaT is provided.
     * @param {number|null} prevAnchor - Previous hand anchor fret
     * @param {number|null} currAnchor - New hand anchor fret
     * @param {number} [deltaT=0.25] - Elapsed time in seconds
     * @returns {number} Shift penalty cost
     */
    calculateShiftPenalty(prevAnchor, currAnchor, deltaT = 0.25) {
        if (prevAnchor == null || currAnchor == null) return 0;

        const deltaA = Math.abs(currAnchor - prevAnchor);
        if (deltaA === 0) return 0;

        let cost = this.weights.shiftBase + this.weights.shiftPerFret * deltaA;

        // Rapid passages require faster shift velocities, increasing mechanical strain
        if (typeof deltaT === 'number' && deltaT > 0 && deltaT < 0.25) {
            const speedFactor = Math.min(2.5, 0.25 / Math.max(0.04, deltaT));
            cost *= speedFactor;
        }

        return cost;
    }

    /**
     * String Crossing Penalty:
     * Prefers adjacent strings and penalizes multi-string skips.
     * @param {number} prevString - Previous string (1-6)
     * @param {number} currString - Current string (1-6)
     * @returns {number} String crossing penalty cost
     */
    calculateStringCrossingPenalty(prevString, currString) {
        const deltaS = Math.abs(currString - prevString);
        if (deltaS === 0) return 0;
        if (deltaS === 1) return this.weights.adjacentString;
        return this.weights.adjacentString + this.weights.stringSkip * Math.pow(deltaS - 1, 1.6);
    }

    /**
     * Inversion & Finger Crossing Penalty:
     * Penalizes backward finger crossings (e.g. higher finger on lower fret or lower finger on higher fret)
     * within the same or overlapping hand position. Also penalizes awkward same-finger hops.
     * @param {Object} prevState - Previous note state { fret, finger, anchor, string }
     * @param {Object} currState - Current note state { fret, finger, anchor, string }
     * @returns {number} Inversion penalty cost
     */
    calculateInversionPenalty(prevState, currState) {
        if (prevState.fret === 0 || currState.fret === 0) return 0;

        const prevFret = prevState.fret;
        const currFret = currState.fret;
        const prevFinger = typeof prevState.finger === 'number' ? prevState.finger : 1;
        const currFinger = typeof currState.finger === 'number' ? currState.finger : 1;

        // If either finger is thumb 'T', handle separately
        if (prevState.finger === 'T' || currState.finger === 'T') {
            return 0;
        }

        let cost = 0;
        const anchorDiff = Math.abs((currState.anchor || 1) - (prevState.anchor || 1));

        // When in the same or closely adjacent hand position, fingers must strictly preserve anatomical ordering
        if (anchorDiff <= 2) {
            // Ascending fret leap played by a lower finger (e.g., finger 3 on fret 5, then finger 1 on fret 7)
            if (currFret > prevFret && currFinger < prevFinger) {
                const degree = (prevFinger - currFinger) * (currFret - prevFret);
                cost += this.weights.inversionBase + this.weights.inversionPerDegree * degree;
            }
            // Descending fret leap played by a higher finger (e.g., finger 1 on fret 7, then finger 4 on fret 5)
            else if (currFret < prevFret && currFinger > prevFinger) {
                const degree = (currFinger - prevFinger) * (prevFret - currFret);
                cost += this.weights.inversionBase + this.weights.inversionPerDegree * degree;
            }
        }

        // Same finger hopping across different strings to different frets breaks legato
        if (prevState.string !== currState.string && prevFret !== currFret && prevFinger === currFinger && currFinger > 0) {
            cost += this.weights.sameFingerHop;
        }

        // Same finger barring across strings at the exact same fret is natural and comfortable
        if (prevState.string !== currState.string && prevFret === currFret && prevFinger === currFinger && currFinger > 0) {
            cost += this.weights.barreEase;
        }

        return cost;
    }

    /**
     * Open String Bonus:
     * Evaluates open string advantages (zero hand stretch, pivot opportunities, acoustic timbre).
     * @param {boolean} isOpen - Whether candidate note is played on an open string
     * @param {Object} options - Optimizer options
     * @returns {number} Bonus value (negative cost)
     */
    calculateOpenStringBonus(isOpen, options = {}) {
        if (!isOpen) return 0;

        let bonus = this.weights.openStringBonus;
        if (options.preferOpenStrings || options.mode === 'open' || options.openStringBonus) {
            bonus += options.openStringBonusAmount || this.weights.acousticOpenBonus;
        }

        return -bonus; // Subtracted from total cost
    }

    // =========================================================================
    // TASK 2: SCALE BOX CONSTRAINTS (CAGED & 3NPS)
    // =========================================================================

    /**
     * Resolves root pitch class (0-11) from name or number.
     * @param {string|number} root - Root note (e.g. 'C', 'G', 'F#', or 0-11)
     * @returns {number} Pitch class 0 to 11
     */
    static resolvePitchClass(root) {
        if (typeof root === 'number') {
            return ((Math.round(root) % 12) + 12) % 12;
        }
        if (typeof root === 'string') {
            const cleaned = root.trim().toUpperCase();
            const noteMap = {
                'C': 0, 'C#': 1, 'DB': 1, 'D': 2, 'D#': 3, 'EB': 3,
                'E': 4, 'F': 5, 'F#': 6, 'GB': 6, 'G': 7, 'G#': 8,
                'AB': 8, 'A': 9, 'A#': 10, 'BB': 10, 'B': 11
            };
            if (noteMap[cleaned] !== undefined) {
                return noteMap[cleaned];
            }
            // Strip octave if provided (e.g. "G3" -> "G")
            const baseMatch = cleaned.match(/^([A-G][#B]?)/);
            if (baseMatch && noteMap[baseMatch[1]] !== undefined) {
                return noteMap[baseMatch[1]];
            }
        }
        return 0; // Default to C
    }

    /**
     * Calculates the fret window for a CAGED form (C, A, G, E, D) given a root key.
     * @param {string} form - 'C', 'A', 'G', 'E', or 'D'
     * @param {string|number} root - Root note
     * @param {Array<number>} [tuning] - Open strings MIDI
     * @returns {Object} { form, root, rootPitchClass, minFret, maxFret, anchorFret }
     */
    static getCAGEDBox(form, root = 'C', tuning = [64, 59, 55, 50, 45, 40]) {
        const rootPc = GuitarOptimizer.resolvePitchClass(root);
        const formUpper = String(form).trim().toUpperCase();

        const openString6Pc = tuning[5] % 12; // E = 4
        const openString5Pc = tuning[4] % 12; // A = 9
        const openString4Pc = tuning[3] % 12; // D = 2

        let minFret = 0;
        let maxFret = 4;
        let anchorFret = 1;

        switch (formUpper) {
            case 'E': {
                // Root on string 6
                const rootFret = ((rootPc - openString6Pc + 12) % 12);
                minFret = Math.max(0, rootFret - 1);
                maxFret = rootFret + 3;
                anchorFret = Math.max(1, rootFret);
                break;
            }
            case 'G': {
                // Root on string 6, box extends backwards
                const rootFret = ((rootPc - openString6Pc + 12) % 12);
                minFret = Math.max(0, rootFret - 3);
                maxFret = rootFret + 1;
                anchorFret = Math.max(1, rootFret - 3);
                break;
            }
            case 'A': {
                // Root on string 5
                const rootFret = ((rootPc - openString5Pc + 12) % 12);
                minFret = Math.max(0, rootFret - 1);
                maxFret = rootFret + 3;
                anchorFret = Math.max(1, rootFret);
                break;
            }
            case 'C': {
                // Root on string 5, box extends backwards
                const rootFret = ((rootPc - openString5Pc + 12) % 12);
                minFret = Math.max(0, rootFret - 3);
                maxFret = rootFret + 1;
                anchorFret = Math.max(1, rootFret - 2);
                break;
            }
            case 'D': {
                // Root on string 4
                const rootFret = ((rootPc - openString4Pc + 12) % 12);
                minFret = Math.max(0, rootFret - 1);
                maxFret = rootFret + 3;
                anchorFret = Math.max(1, rootFret);
                break;
            }
            default:
                throw new Error(`Invalid CAGED form: ${form}. Expected C, A, G, E, or D.`);
        }

        return {
            system: 'CAGED',
            form: formUpper,
            root: root,
            rootPitchClass: rootPc,
            minFret: minFret,
            maxFret: maxFret,
            anchorFret: anchorFret
        };
    }

    /**
     * Calculates the string-by-string fret layout for a 3-Notes-Per-String (3NPS) modal shape.
     * @param {number|string} patternOrMode - Pattern index (1-7) or mode name (e.g. 'Ionian', 'Dorian')
     * @param {string|number} root - Scale root note
     * @param {Array<number>} [tuning] - Open strings MIDI
     * @returns {Object} 3NPS pattern definition with per-string fret arrays
     */
    static get3NPSPattern(patternOrMode, root = 'C', tuning = [64, 59, 55, 50, 45, 40]) {
        const rootPc = GuitarOptimizer.resolvePitchClass(root);
        const modeMap = {
            'IONIAN': 1, 'MAJOR': 1,
            'DORIAN': 2,
            'PHRYGIAN': 3,
            'LYDIAN': 4,
            'MIXOLYDIAN': 5,
            'AEOLIAN': 6, 'MINOR': 6,
            'LOCRIAN': 7
        };

        let patternNum = 1;
        if (typeof patternOrMode === 'number') {
            patternNum = Math.max(1, Math.min(7, Math.round(patternOrMode)));
        } else if (typeof patternOrMode === 'string') {
            const key = patternOrMode.trim().toUpperCase();
            patternNum = modeMap[key] || parseInt(key, 10) || 1;
        }

        // Major scale diatonic intervals from root
        const diatonicSteps = [0, 2, 4, 5, 7, 9, 11];
        const modeDegree = patternNum - 1;

        // String 6 (low E) starts on the specified mode degree
        const stringNotes = {};
        let currentDegreeIdx = modeDegree;
        let globalMin = Infinity;
        let globalMax = -Infinity;

        // Populate strings 6 to 1 (indices 5 down to 0 in tuning)
        // Note: String 1 is high e (idx 0), String 6 is low E (idx 5)
        for (let strIdx = 5; strIdx >= 0; strIdx--) {
            const stringNum = strIdx + 1;
            const openNote = tuning[strIdx];
            const frets = [];

            // 3 notes per string
            for (let n = 0; n < 3; n++) {
                const deg = currentDegreeIdx % 7;
                const scalePc = (rootPc + diatonicSteps[deg]) % 12;

                // Find lowest playable fret for this pitch class on this string
                let fret = ((scalePc - (openNote % 12) + 12) % 12);
                if (frets.length > 0 && fret <= frets[frets.length - 1]) {
                    fret += 12;
                }
                frets.push(fret);
                globalMin = Math.min(globalMin, fret);
                globalMax = Math.max(globalMax, fret);
                currentDegreeIdx++;
            }

            stringNotes[stringNum] = frets;
        }

        return {
            system: '3NPS',
            pattern: patternNum,
            root: root,
            rootPitchClass: rootPc,
            minFret: globalMin,
            maxFret: globalMax,
            anchorFret: globalMin,
            strings: stringNotes
        };
    }

    /**
     * Checks if a candidate note placement satisfies active scale box constraints.
     * @param {Object} cand - Candidate note { string, fret, isOpen }
     * @param {Object} constraint - Constraint configuration
     * @returns {Object} { allowed: boolean, penalty: number }
     */
    evaluateConstraint(cand, constraint) {
        if (!constraint) return { allowed: true, penalty: 0 };

        const { fret, string, isOpen } = cand;

        // If open string, check if constraint allows open strings
        if (isOpen) {
            if (constraint.allowOpenStrings === false) {
                return { allowed: false, penalty: this.weights.constraintViolation };
            }
            return { allowed: true, penalty: 0 };
        }

        // 1. Min/Max fret box range check
        if (typeof constraint.minFret === 'number' && typeof constraint.maxFret === 'number') {
            // Also check octave-transposed range (+12 frets) if high on neck
            const inBaseRange = fret >= constraint.minFret && fret <= constraint.maxFret;
            const inOctaveRange = fret >= constraint.minFret + 12 && fret <= constraint.maxFret + 12;

            if (!inBaseRange && !inOctaveRange) {
                return { allowed: false, penalty: this.weights.constraintViolation };
            }
        }

        // 2. 3NPS specific string fret check
        if (constraint.system === '3NPS' && constraint.strings && constraint.strings[string]) {
            const allowedFrets = constraint.strings[string];
            const matchesExact = allowedFrets.includes(fret) || allowedFrets.some(f => f + 12 === fret);
            if (!matchesExact) {
                return { allowed: false, penalty: this.weights.constraintViolation };
            }
        }

        return { allowed: true, penalty: 0 };
    }

    // =========================================================================
    // TASK 3: OPTIMIZATION SOLVER (VITERBI TRELLIS PATH SEARCH)
    // =========================================================================

    /**
     * Generates all discrete trellis states (string, fret, finger, anchor) for a given note.
     * @param {Object} note - Note object { pitch/midi, time, duration }
     * @param {Object} [options={}] - Constraint and fingering options
     * @returns {Array<Object>} List of candidate states
     */
    generateTrellisStatesForNote(note, options = {}) {
        const midi = note.midi !== undefined ? note.midi : (note.pitch !== undefined ? note.pitch : null);
        if (midi === null) return [];

        const parsedMidi = typeof midi === 'number' ? midi : this.parsePitch(midi);
        const physicalCandidates = this.findCandidates(parsedMidi);
        const states = [];

        for (const cand of physicalCandidates) {
            // Check scale box constraint early
            const constraintEval = this.evaluateConstraint(cand, options.activeConstraint);
            const constraintPenalty = constraintEval.penalty;

            if (cand.isOpen) {
                // Open string: finger 0, anchor is null (inherits or pivots freely)
                states.push({
                    string: cand.string,
                    fret: 0,
                    finger: 0,
                    anchor: null,
                    isOpen: true,
                    midi: parsedMidi,
                    noteName: cand.noteName,
                    octave: cand.octave,
                    constraintPenalty: constraintPenalty
                });
            } else {
                // Fretted note: evaluate fingers 1, 2, 3, 4
                const fingers = [1, 2, 3, 4];
                for (const fng of fingers) {
                    const nominalAnchor = Math.max(1, cand.fret - (fng - 1));

                    // Standard 1-finger-per-fret state
                    states.push({
                        string: cand.string,
                        fret: cand.fret,
                        finger: fng,
                        anchor: nominalAnchor,
                        isOpen: false,
                        midi: parsedMidi,
                        noteName: cand.noteName,
                        octave: cand.octave,
                        constraintPenalty: constraintPenalty
                    });

                    // Optional extended reaches:
                    // Finger 1 reaching back 1 fret below anchor
                    if (fng === 1 && cand.fret + 1 <= this.numFrets) {
                        states.push({
                            string: cand.string,
                            fret: cand.fret,
                            finger: 1,
                            anchor: cand.fret + 1,
                            isOpen: false,
                            midi: parsedMidi,
                            noteName: cand.noteName,
                            octave: cand.octave,
                            constraintPenalty: constraintPenalty
                        });
                    }

                    // Finger 4 stretching 1 fret above 4-fret box (5-fret span reach)
                    if (fng === 4 && cand.fret - 4 >= 1) {
                        states.push({
                            string: cand.string,
                            fret: cand.fret,
                            finger: 4,
                            anchor: cand.fret - 4,
                            isOpen: false,
                            midi: parsedMidi,
                            noteName: cand.noteName,
                            octave: cand.octave,
                            constraintPenalty: constraintPenalty
                        });
                    }
                }

                // Optional thumb 'T' fretting on thick bass strings (string 6, sometimes 5)
                if (options.enableThumb && (cand.string === 6 || cand.string === 5) && cand.fret <= 5) {
                    states.push({
                        string: cand.string,
                        fret: cand.fret,
                        finger: 'T',
                        anchor: Math.max(1, cand.fret),
                        isOpen: false,
                        midi: parsedMidi,
                        noteName: cand.noteName,
                        octave: cand.octave,
                        constraintPenalty: constraintPenalty
                    });
                }
            }
        }

        return states;
    }

    /**
     * Calculates the local emission cost of a state independent of transitions.
     * @param {Object} state - Trellis state
     * @param {Object} options - Optimizer options
     * @param {number|null} [initialAnchor=null] - Optional initial anchor position
     * @returns {number} State emission cost
     */
    calculateEmissionCost(state, options = {}, initialAnchor = null) {
        let cost = 0;

        // Scale box constraint violation
        if (state.constraintPenalty) {
            cost += state.constraintPenalty;
        }

        if (state.isOpen) {
            cost += this.weights.openStringBase;
            cost += this.calculateOpenStringBonus(true, options);
            return cost;
        }

        // Span stretch penalty
        cost += this.calculateSpanPenalty(state.fret, state.anchor);

        // Timbre and ergonomics
        if ((state.string === 6 || state.string === 5) && state.fret > 14) {
            cost += this.weights.timbreHighWound;
        }
        if (state.fret > 19) {
            cost += this.weights.timbreExtremeFret;
        }

        // Initial hand position bias if specified
        if (initialAnchor != null && state.anchor != null) {
            const anchorDiff = Math.abs(state.anchor - initialAnchor);
            cost += anchorDiff * 2.0;
        }

        return cost;
    }

    /**
     * Calculates the transition cost between two successive note states.
     * @param {Object} fromState - State at t-1
     * @param {Object} toState - State at t
     * @param {number} deltaT - Elapsed time between notes
     * @param {Object} options - Optimizer options
     * @returns {number} Transition cost
     */
    calculateTransitionCost(fromState, toState, deltaT = 0.25, options = {}) {
        let cost = 0;

        // 1. String crossing penalty
        cost += this.calculateStringCrossingPenalty(fromState.string, toState.string);

        // 2. Hand position shift penalty
        // Open strings allow the fretting hand to pivot/shift freely without penalty
        if (!fromState.isOpen && !toState.isOpen) {
            cost += this.calculateShiftPenalty(fromState.anchor, toState.anchor, deltaT);
        } else if (fromState.isOpen && !toState.isOpen && fromState.anchor != null) {
            // Hand shift arriving from an open string has discounted transition cost
            cost += this.calculateShiftPenalty(fromState.anchor, toState.anchor, deltaT) * 0.4;
        }

        // 3. Inversion & backward finger crossing penalty
        cost += this.calculateInversionPenalty(fromState, toState);

        return cost;
    }

    /**
     * Resolves scale box constraint options into a normalized constraint object.
     * @param {Object} options - User options
     * @returns {Object|null} Normalized constraint object or null
     */
    resolveBoxConstraint(options) {
        if (!options) return null;

        let result = null;
        if (options.boxConstraint) {
            const bc = options.boxConstraint;
            if (bc.system === 'CAGED' || bc.form) {
                result = GuitarOptimizer.getCAGEDBox(bc.form, bc.root || options.root || options.key || 'C', this.openMidi);
            } else if (bc.system === '3NPS' || bc.pattern) {
                result = GuitarOptimizer.get3NPSPattern(bc.pattern, bc.root || options.root || options.key || 'C', this.openMidi);
            } else {
                result = Object.assign({}, bc);
            }
            if (bc.allowOpenStrings !== undefined) {
                result.allowOpenStrings = bc.allowOpenStrings;
            }
        } else if (options.caged || options.cagedForm || options.cagedBox) {
            const form = options.caged || options.cagedForm || options.cagedBox;
            const root = options.root || options.key || 'C';
            result = GuitarOptimizer.getCAGEDBox(form, root, this.openMidi);
        } else if (options.threeNps || options.threeNpsPattern || options.modalShape) {
            const pattern = options.threeNps || options.threeNpsPattern || options.modalShape;
            const root = options.root || options.key || 'C';
            result = GuitarOptimizer.get3NPSPattern(pattern, root, this.openMidi);
        } else if (Array.isArray(options.boxRange) && options.boxRange.length === 2) {
            result = {
                minFret: options.boxRange[0],
                maxFret: options.boxRange[1],
                anchorFret: options.boxRange[0]
            };
        } else if (typeof options.minFret === 'number' && typeof options.maxFret === 'number') {
            result = {
                minFret: options.minFret,
                maxFret: options.maxFret,
                anchorFret: options.minFret
            };
        }

        if (result) {
            if (options.allowOpenStrings !== undefined) {
                result.allowOpenStrings = options.allowOpenStrings;
            } else if (result.allowOpenStrings === undefined) {
                // By default 3NPS strictly locks to fretted modal shapes (no open strings)
                result.allowOpenStrings = result.system === '3NPS' ? false : true;
            }
        }

        return result;
    }

    /**
     * Viterbi / Lowest-Cost Trellis Path Search for a passage of notes.
     * Finds the globally optimal sequence of (string, fret, finger, handAnchor) assignments.
     *
     * @param {Array<Object>} notes - Input array of notes [{ pitch|midi, time, duration }, ...]
     * @param {Object} [options={}] - Optimization constraints & preferences
     * @returns {Array<Object>} Array of assigned notes [{ string, fret, finger, cost, ... }]
     */
    optimizePassage(notes, options = {}) {
        if (!Array.isArray(notes) || notes.length === 0) {
            return [];
        }

        // Normalize constraint
        const activeConstraint = this.resolveBoxConstraint(options);
        const solverOptions = Object.assign({}, options, { activeConstraint });

        // Trellis time slices
        const T = notes.length;
        const trellis = []; // trellis[t] = array of { state, cost, prevIdx, localCost }

        // Step 1: Initialize t = 0
        const firstNote = notes[0];
        const states0 = this.generateTrellisStatesForNote(firstNote, solverOptions);

        if (states0.length === 0) {
            return [];
        }

        const initialAnchor = options.initialPosition || (activeConstraint ? activeConstraint.anchorFret : null);
        trellis[0] = states0.map(s => {
            const emitCost = this.calculateEmissionCost(s, solverOptions, initialAnchor);
            return {
                state: s,
                cost: emitCost,
                localCost: emitCost,
                prevIdx: -1
            };
        });

        // Step 2: Forward Trellis Pass (t = 1 to T-1)
        for (let t = 1; t < T; t++) {
            const currNote = notes[t];
            const prevNote = notes[t - 1];

            const deltaT = (currNote.time !== undefined && prevNote.time !== undefined)
                ? Math.max(0.01, currNote.time - ((prevNote.time || 0) + (prevNote.duration || 0.25)))
                : 0.25;

            const currStates = this.generateTrellisStatesForNote(currNote, solverOptions);

            if (currStates.length === 0) {
                // If a note is outside playable range, keep previous step
                trellis[t] = trellis[t - 1];
                continue;
            }

            trellis[t] = currStates.map(currState => {
                const emissionCost = this.calculateEmissionCost(currState, solverOptions);
                let minCumulativeCost = Infinity;
                let bestPrevIdx = 0;
                let bestTransCost = 0;

                // Evaluate transitions from all states in previous time slice
                for (let prevIdx = 0; prevIdx < trellis[t - 1].length; prevIdx++) {
                    const prevState = trellis[t - 1][prevIdx].state;
                    const prevCumulativeCost = trellis[t - 1][prevIdx].cost;

                    // Carry over anchor if transition note was open string
                    if (prevState.isOpen && currState.anchor == null && prevState.anchor != null) {
                        currState.anchor = prevState.anchor;
                    }

                    const transCost = this.calculateTransitionCost(prevState, currState, deltaT, solverOptions);
                    const totalCost = prevCumulativeCost + transCost + emissionCost;

                    if (totalCost < minCumulativeCost) {
                        minCumulativeCost = totalCost;
                        bestPrevIdx = prevIdx;
                        bestTransCost = transCost;
                    }
                }

                return {
                    state: currState,
                    cost: minCumulativeCost,
                    localCost: emissionCost + bestTransCost,
                    prevIdx: bestPrevIdx
                };
            });
        }

        // Step 3: Backtracking from t = T-1
        let minFinalCost = Infinity;
        let bestFinalIdx = 0;

        for (let i = 0; i < trellis[T - 1].length; i++) {
            if (trellis[T - 1][i].cost < minFinalCost) {
                minFinalCost = trellis[T - 1][i].cost;
                bestFinalIdx = i;
            }
        }

        const optimalPath = new Array(T);
        let currTraceIdx = bestFinalIdx;

        for (let t = T - 1; t >= 0; t--) {
            const entry = trellis[t][currTraceIdx];
            optimalPath[t] = {
                entry: entry,
                note: notes[t]
            };
            currTraceIdx = entry.prevIdx >= 0 ? entry.prevIdx : 0;
        }

        // Step 4: Reconstruct assigned notes output
        const results = [];
        let runningAnchor = initialAnchor || 1;

        for (let t = 0; t < T; t++) {
            const { entry, note } = optimalPath[t];
            const state = entry.state;

            if (state.anchor != null) {
                runningAnchor = state.anchor;
            }

            const assignedNote = {
                string: state.string,
                fret: state.fret,
                finger: state.finger,
                cost: Math.round(entry.localCost * 100) / 100,
                cumulativeCost: Math.round(entry.cost * 100) / 100,
                handPosition: state.isOpen ? runningAnchor : (state.anchor || runningAnchor),
                pitch: note.pitch !== undefined ? note.pitch : state.midi,
                midi: state.midi,
                noteName: state.noteName,
                octave: state.octave,
                time: note.time !== undefined ? note.time : t * 0.25,
                duration: note.duration !== undefined ? note.duration : 0.25,
                isOpen: state.isOpen
            };

            results.push(assignedNote);
        }

        // Update single-note internal tracking to the end of the passage
        if (results.length > 0) {
            const lastNote = results[results.length - 1];
            this.handAnchorFret = lastNote.handPosition;
            this.prevString = lastNote.string;
            this.prevFret = lastNote.fret;
            this.prevFinger = lastNote.finger;
        }

        return results;
    }
}

// Module export for Node.js environments
if (typeof module !== 'undefined') {
    module.exports = GuitarOptimizer;
}