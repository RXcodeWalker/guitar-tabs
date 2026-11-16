/**
 * Fretboard & Ergonomic Optimization Engine (Phase 2)
 * Disambiguates pitch-to-(string, fret) mappings on a 22-fret guitar,
 * tracks left-hand position anchors, and calculates optimal biomechanical finger assignments.
 */

class GuitarOptimizer {
    constructor(options = {}) {
        // Standard guitar tuning (MIDI note numbers for open strings)
        // String 1 is high e (thin), String 6 is low E (thick)
        this.tunings = {
            standard: [64, 59, 55, 50, 45, 40], // e4, B3, G3, D3, A2, E2
            dropD:    [64, 59, 55, 50, 45, 38], // e4, B3, G3, D3, A2, D2
            halfStep: [63, 58, 54, 49, 44, 39], // Eb4, Bb3, Gb3, Db3, Ab2, Eb2
            dadgad:   [62, 57, 55, 50, 45, 38], // D4, A3, G3, D3, A2, D2
            openD:    [62, 57, 54, 50, 45, 38], // D4, A3, F#3, D3, A2, D2
            openG:    [62, 59, 55, 50, 43, 38]  // D4, B3, G3, D3, G2, D2
        };

        this.currentTuningName = options.tuning || 'standard';
        this.openMidi = [...this.tunings[this.currentTuningName]];
        this.numFrets = options.numFrets || 22;

        // Ergonomic state
        this.handAnchorFret = options.initialPosition || 1; // 1st position (frets 1-4)
        this.prevString = 3;
        this.prevFret = 0;
        this.prevFinger = 1;

        // Optimization modes: 'adaptive', 'open', 'mid', 'high'
        this.mode = options.mode || 'adaptive';

        this.noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    }

    /**
     * Changes the guitar tuning.
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
     * Returns all physically playable (string, fret) candidates for a given MIDI note.
     * @param {number} midi - Target MIDI note number (e.g. 64 for E4).
     * @returns {Array<Object>} candidates
     */
    findCandidates(midi) {
        const candidates = [];

        // Check strings 1 to 6
        for (let strIdx = 0; strIdx < 6; strIdx++) {
            const stringNum = strIdx + 1; // 1 (high e) to 6 (low E)
            const openNote = this.openMidi[strIdx];
            const fret = midi - openNote;

            if (fret >= 0 && fret <= this.numFrets) {
                candidates.push({
                    string: stringNum,
                    fret: fret,
                    midi: midi,
                    noteName: this.noteNames[midi % 12],
                    octave: Math.floor(midi / 12) - 1,
                    isOpen: (fret === 0)
                });
            }
        }

        return candidates;
    }

    /**
     * Solves for the optimal (string, fret) and finger assignment given the current playing context.
     * Minimizes biomechanical strain, unnecessary hand shifts, and awkward string jumps.
     * @param {number} midi - Detected note MIDI number
     * @returns {Object} Best placement and finger
     */
    optimize(midi) {
        const candidates = this.findCandidates(midi);

        if (candidates.length === 0) {
            return null; // Note out of playable guitar range
        }

        // Score each candidate according to cost function
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

        // Determine optimal finger based on chosen fret and hand position
        const finger = this.assignFinger(bestCandidate.fret, this.handAnchorFret);
        bestCandidate.finger = finger;

        // Update state
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

    /**
     * Biomechanical Cost Function:
     * C = w_pos * d_pos + w_span * d_span + w_str * d_str + w_mode * d_mode
     */
    calculateBiomechanicalCost(candidate) {
        const { fret, string, isOpen } = candidate;

        // Open string bonus: very natural and effortless to play
        if (isOpen) {
            if (this.mode === 'high') {
                return 40; // Discourage open strings in high lead solo mode
            }
            return 2.0; // Cheap and comfortable
        }

        let cost = 0;

        // 1. Hand Position Shift Penalty:
        // A hand covers a 4-fret span: [anchor, anchor + 3]
        const currentAnchor = this.handAnchorFret;
        const handSpanMin = currentAnchor;
        const handSpanMax = currentAnchor + 3;

        if (fret >= handSpanMin && fret <= handSpanMax) {
            // Right in the pocket of current hand position!
            cost += 0;
        } else if (fret === handSpanMin - 1 || fret === handSpanMax + 1) {
            // Small comfortable 1-fret stretch
            cost += 8;
        } else {
            // Requires shifting hand anchor along the neck
            const shiftDistance = Math.min(Math.abs(fret - handSpanMin), Math.abs(fret - handSpanMax));
            cost += 20 + shiftDistance * 6;
        }

        // 2. String Traversal Penalty (skipping multiple strings is harder)
        const stringJump = Math.abs(string - this.prevString);
        cost += stringJump * 4;

        // 3. Fretboard Ergonomics Bias Modes
        if (this.mode === 'open') {
            // Strongly favor frets 0-4
            if (fret > 5) cost += (fret - 5) * 12;
        } else if (this.mode === 'mid') {
            // Favor frets 5-9 (A-minor/pentatonic box standard)
            const distFromMid = Math.abs(fret - 7);
            cost += distFromMid * 5;
        } else if (this.mode === 'high') {
            // Favor frets 10-22
            if (fret < 9) cost += (9 - fret) * 10;
        } else {
            // 'adaptive' mode: slight sweet-spot preference for frets 2-12
            if (fret > 15) cost += (fret - 15) * 3;
        }

        // 4. Tone/Timbre Preference:
        // Frets above 17 on low wound strings (6 & 5) sound muddy, prefer higher strings if equal
        if ((string === 6 || string === 5) && fret > 14) {
            cost += 25;
        }

        return cost;
    }

    /**
     * Assigns optimal left hand finger (0 = open, 1 = index, 2 = middle, 3 = ring, 4 = pinky)
     */
    assignFinger(fret, anchor) {
        if (fret === 0) return 0; // Open string, no finger

        const offset = fret - anchor;

        if (offset <= 0) return 1;      // Index (or extended index)
        if (offset === 1) return 2;     // Middle
        if (offset === 2) return 3;     // Ring
        return 4;                       // Pinky (or extended pinky)
    }

    /**
     * Dynamically shifts hand anchor if the player moves outside the comfortable 4-fret span.
     */
    updateHandPosition(fret) {
        if (fret === 0) return; // Open string doesn't shift anchor

        if (fret < this.handAnchorFret) {
            // Shift down
            this.handAnchorFret = Math.max(1, fret);
        } else if (fret > this.handAnchorFret + 3) {
            // Shift up: place new anchor so note is played with middle or ring finger
            this.handAnchorFret = Math.max(1, fret - 2);
        }
    }

    /**
     * Manually overrides hand anchor position.
     */
    setHandPosition(anchorFret) {
        this.handAnchorFret = Math.max(1, Math.min(this.numFrets - 3, anchorFret));
    }
}

if (typeof module !== 'undefined') {
    module.exports = GuitarOptimizer;
}
