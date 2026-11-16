/**
 * Polyphonic Chord Recognizer and Scale Recommendation Engine
 * Real-time Chromagram / Pitch Class Profile (PCP) DSP and Harmonic Analysis.
 * 
 * Core Specifications:
 * 1. Chromagram / Pitch Class Profile (PCP):
 *    - Maps 4096-bin FFT spectrum into a 12-dimensional chroma vector (C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
 *      by summing harmonic energies across all octaves with cosine weighting.
 * 2. Polyphonic Chord Template Matching:
 *    - Matches live chroma vector against pre-defined binary/weighted chord masks for:
 *      Major, Minor, Dominant 7th, Major 7th, Minor 7th, Sus2, Sus4, and Diminished chords across all 12 roots.
 *    - Outputs detected chord name, confidence score (0 to 100%), and active root note with hysteresis to prevent flickering.
 * 3. Live Fretboard Scale Overlay Generator:
 *    - Based on detected chord/tonality, generates corresponding scale notes (e.g., Am7 -> A Minor Pentatonic / A Dorian).
 *    - Classifies notes into:
 *      * "target" (Chord Tones / Target Notes: Root, 3rd, 5th, 7th)
 *      * "passing" (Passing / Safe Notes: Extensions and pentatonic steps)
 *      * "avoid" (Avoid Notes: Clashing half-step intervals)
 *    - Returns an array of {string, fret, noteType} objects ready for the visual fretboard to render.
 * 4. Clean Exports:
 *    - analyzeChroma(freqByteData, sampleRate)
 *    - getScaleOverlay(chordName)
 *    - Built-in test data verifying detection for standard chord triads and 7ths.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.ChordEngine = exports;
        root.analyzeChroma = exports.analyzeChroma;
        root.getScaleOverlay = exports.getScaleOverlay;
    }
}(typeof self !== 'undefined' ? self : this, function () {

    // =========================================================================
    // 1. MUSIC THEORY CONSTANTS & CHORD QUALITIES
    // =========================================================================

    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    
    const ENHARMONICS = {
        "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B",
        "B#": "C", "E#": "F"
    };

    const INTERVAL_NAMES = {
        0: "R",
        1: "b9",
        2: "9",
        3: "b3",
        4: "3",
        5: "11",
        6: "b5",
        7: "5",
        8: "b13",
        9: "6",
        10: "b7",
        11: "7"
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
     * 8 Core Chord Qualities with defining semitone intervals relative to root (0-11)
     * and scale recommendations / classifications.
     */
    const CHORD_QUALITIES = {
        major: {
            suffix: "",
            displayName: "Major",
            intervals: [0, 4, 7],
            weights: { 0: 1.0, 4: 0.95, 7: 0.85 },
            scaleRecommendation: (root) => `${root} Major Pentatonic / ${root} Major (Ionian)`,
            targetIntervals: [0, 4, 7],
            passingIntervals: [2, 9, 11],
            avoidIntervals: [5, 1, 3, 6, 8, 10] // Natural 4th clashes with major 3rd
        },
        minor: {
            suffix: "m",
            displayName: "Minor",
            intervals: [0, 3, 7],
            weights: { 0: 1.0, 3: 0.95, 7: 0.85 },
            scaleRecommendation: (root) => `${root} Minor Pentatonic / ${root} Aeolian (Natural Minor)`,
            targetIntervals: [0, 3, 7],
            passingIntervals: [2, 5, 10, 8],
            avoidIntervals: [1, 4, 6, 11]
        },
        dom7: {
            suffix: "7",
            displayName: "Dominant 7th",
            intervals: [0, 4, 7, 10],
            weights: { 0: 1.0, 4: 0.95, 7: 0.85, 10: 0.95 },
            scaleRecommendation: (root) => `${root} Mixolydian / ${root} Major Pentatonic`,
            targetIntervals: [0, 4, 7, 10],
            passingIntervals: [2, 9],
            avoidIntervals: [5, 1, 11, 8]
        },
        maj7: {
            suffix: "maj7",
            displayName: "Major 7th",
            intervals: [0, 4, 7, 11],
            weights: { 0: 1.0, 4: 0.95, 7: 0.85, 11: 0.95 },
            scaleRecommendation: (root) => `${root} Major / ${root} Lydian`,
            targetIntervals: [0, 4, 7, 11],
            passingIntervals: [2, 9, 6],
            avoidIntervals: [5, 10, 1, 3, 8]
        },
        m7: {
            suffix: "m7",
            displayName: "Minor 7th",
            intervals: [0, 3, 7, 10],
            weights: { 0: 1.0, 3: 0.95, 7: 0.85, 10: 0.95 },
            scaleRecommendation: (root) => `${root} Minor Pentatonic / ${root} Dorian`,
            targetIntervals: [0, 3, 7, 10],
            passingIntervals: [2, 5, 9], // Dorian natural 6th
            avoidIntervals: [1, 4, 8, 11]
        },
        sus2: {
            suffix: "sus2",
            displayName: "Sus2",
            intervals: [0, 2, 7],
            weights: { 0: 1.0, 2: 1.0, 7: 0.85 },
            scaleRecommendation: (root) => `${root} Major Pentatonic / ${root} Mixolydian`,
            targetIntervals: [0, 2, 7],
            passingIntervals: [4, 5, 9, 10],
            avoidIntervals: [1, 3, 6, 8, 11]
        },
        sus4: {
            suffix: "sus4",
            displayName: "Sus4",
            intervals: [0, 5, 7],
            weights: { 0: 1.0, 5: 1.0, 7: 0.85 },
            scaleRecommendation: (root) => `${root} Mixolydian / ${root} Minor Pentatonic`,
            targetIntervals: [0, 5, 7],
            passingIntervals: [2, 9, 10],
            avoidIntervals: [4, 1, 6, 8, 11] // Major 3rd clashes until suspended 4th resolves
        },
        dim: {
            suffix: "dim",
            displayName: "Diminished",
            intervals: [0, 3, 6],
            weights: { 0: 1.0, 3: 1.0, 6: 1.0 },
            scaleRecommendation: (root) => `${root} Locrian / ${root} Whole-Half Diminished`,
            targetIntervals: [0, 3, 6],
            passingIntervals: [1, 5, 8, 10, 9],
            avoidIntervals: [7, 4, 11] // Natural 5th clashes with b5
        }
    };

    // =========================================================================
    // 2. TEMPLATE GENERATOR: 96 CHORD MASKS
    // =========================================================================

    /**
     * Builds the 96 chord templates (12 roots * 8 chord qualities).
     * Zero-mean centered and L2 normalized for Pearson cross-correlation matching.
     */
    function buildChordTemplates() {
        const templates = [];

        for (let r = 0; r < 12; r++) {
            const rootName = NOTE_NAMES[r];

            for (const [qualityKey, quality] of Object.entries(CHORD_QUALITIES)) {
                const chordName = `${rootName}${quality.suffix}`;
                const rawVector = new Float32Array(12);

                for (const interval of quality.intervals) {
                    const pitchClass = (r + interval) % 12;
                    const weight = quality.weights[interval] || 1.0;
                    rawVector[pitchClass] = weight;
                }

                // Penalize non-chord tones to ensure selective matching
                const numChordTones = quality.intervals.length;
                const penalty = -(0.55 / (12 - numChordTones));
                for (let i = 0; i < 12; i++) {
                    if (rawVector[i] === 0) {
                        rawVector[i] = penalty;
                    }
                }

                // Zero-mean centering
                let sum = 0.0;
                for (let i = 0; i < 12; i++) sum += rawVector[i];
                const mean = sum / 12.0;

                const zeroMean = new Float32Array(12);
                let sumSq = 0.0;
                for (let i = 0; i < 12; i++) {
                    zeroMean[i] = rawVector[i] - mean;
                    sumSq += zeroMean[i] * zeroMean[i];
                }

                const norm = Math.sqrt(sumSq) || 1.0;
                const normalized = new Float32Array(12);
                for (let i = 0; i < 12; i++) {
                    normalized[i] = zeroMean[i] / norm;
                }

                templates.push({
                    name: chordName,
                    root: rootName,
                    rootIndex: r,
                    qualityKey: qualityKey,
                    quality: quality,
                    vector: normalized,
                    intervals: quality.intervals.map(int => (r + int) % 12)
                });
            }
        }

        return templates;
    }

    const ALL_TEMPLATES = buildChordTemplates();

    // =========================================================================
    // 3. CHROMAGRAM / PITCH CLASS PROFILE (PCP) DSP
    // =========================================================================

    /**
     * Maps an FFT frequency spectrum into a normalized 12-dimensional chroma vector
     * using harmonic energy summation across all octaves with cosine weighting.
     * 
     * @param {Uint8Array|Float32Array|Array<number>} freqData - FFT bins from AnalyserNode
     * @param {number} sampleRate - AudioContext sample rate (e.g. 44100, 48000)
     * @param {object} options - Optional DSP parameters
     * @returns {Float32Array} 12-dimensional normalized chroma vector [C, C#, D, ..., B]
     */
    function computeChromagram(freqData, sampleRate = 44100, options = {}) {
        const numBins = freqData.length;
        const chroma = new Float32Array(12);
        if (!numBins || numBins === 0) return chroma;

        const binResolution = sampleRate / (2.0 * numBins);
        const minFreq = options.minFreq || 65.0;
        const maxFreq = options.maxFreq || 3500.0;

        const minBin = Math.max(1, Math.floor(minFreq / binResolution));
        const maxBin = Math.min(numBins - 1, Math.ceil(maxFreq / binResolution));

        let totalEnergy = 0.0;
        const isByteData = (freqData instanceof Uint8Array) || (freqData[0] !== undefined && Number.isInteger(freqData[0]));

        for (let k = minBin; k <= maxBin; k++) {
            const rawVal = freqData[k];
            if (isByteData && rawVal < 8) continue; // Noise floor suppression
            
            let magnitude = 0.0;
            if (isByteData) {
                magnitude = rawVal / 255.0;
            } else {
                if (rawVal < -90) continue;
                magnitude = (rawVal <= 0) ? Math.pow(10, rawVal / 20.0) : rawVal;
            }

            const power = magnitude * magnitude;
            const freq = k * binResolution;
            if (freq <= 0) continue;

            // Broadband harmonic weighting: Flat passband through core guitar register (75Hz - 1200Hz)
            // with smooth cosine taper below 75Hz and above 1200Hz.
            let octWeight = 1.0;
            if (freq < 75.0) {
                octWeight = 0.5 * (1.0 - Math.cos(Math.PI * (freq - 60.0) / 15.0));
            } else if (freq > 1200.0) {
                octWeight = 0.5 * (1.0 + Math.cos(Math.PI * (freq - 1200.0) / 2300.0));
            }

            const weightedPower = power * octWeight;

            // Continuous MIDI pitch and pitch class relative to C (0..12)
            const midiPitch = 69.0 + 12.0 * Math.log2(freq / 440.0);
            const pitchClass = ((midiPitch % 12.0) + 12.0) % 12.0;

            // Cosine Weighting across 12 semitone chroma bins:
            // Spreads harmonic energies smoothly across neighboring bins within +/- 1 semitone
            for (let b = 0; b < 12; b++) {
                let dist = Math.abs(pitchClass - b);
                if (dist > 6.0) dist = 12.0 - dist;

                if (dist < 1.0) {
                    const cosWeight = 0.5 * (1.0 + Math.cos(Math.PI * dist));
                    chroma[b] += weightedPower * cosWeight;
                    totalEnergy += weightedPower * cosWeight;
                }
            }
        }

        // Return zeros if total audio energy is negligible
        if (totalEnergy < 1e-6) {
            return chroma;
        }

        // L2 Unit Normalization
        let sumSq = 0.0;
        for (let b = 0; b < 12; b++) {
            sumSq += chroma[b] * chroma[b];
        }
        const norm = Math.sqrt(sumSq) || 1.0;
        for (let b = 0; b < 12; b++) {
            chroma[b] /= norm;
        }

        return chroma;
    }

    /**
     * Extracts the lowest fundamental peak between 70 Hz and 280 Hz.
     * In guitar acoustics, this identifies the active bass note string (E2, A2, D3, etc.),
     * which provides the foundational acoustic cue for root and chord inversion disambiguation.
     */
    function detectLowestBassPitchClass(freqData, sampleRate = 44100) {
        const numBins = freqData.length;
        const binRes = sampleRate / (2.0 * numBins);
        const minK = Math.floor(70.0 / binRes);
        const maxK = Math.ceil(280.0 / binRes);

        for (let k = minK; k <= maxK; k++) {
            const val = freqData[k];
            if (val > 35 && val > freqData[k - 1] && val >= freqData[k + 1]) {
                const freq = k * binRes;
                const midi = 69.0 + 12.0 * Math.log2(freq / 440.0);
                return ((Math.round(midi) % 12) + 12) % 12;
            }
        }

        return -1;
    }

    // =========================================================================
    // 4. POLYPHONIC CHORD TEMPLATE MATCHING & HYSTERESIS
    // =========================================================================

    /**
     * Polyphonic Chord Recognizer state machine.
     * Implements temporal exponential moving average (EMA) smoothing and
     * candidate hysteresis to prevent flickering during live audio capture.
     */
    class PolyphonicChordRecognizer {
        constructor(options = {}) {
            this.sampleRate = options.sampleRate || 44100;
            this.historyAlpha = options.alpha !== undefined ? options.alpha : 0.40;
            this.stabilityThreshold = options.stabilityThreshold || 3;
            this.hysteresisMargin = options.hysteresisMargin || 14;
            this.minConfidence = options.minConfidence || 35;
            this.noiseFloor = options.noiseFloor || 0.005;

            // State
            this.smoothedChroma = new Float32Array(12);
            this.hasHistory = false;
            this.currentChord = "None";
            this.currentRoot = null;
            this.currentQuality = null;
            this.currentConfidence = 0;
            this.candidateChord = null;
            this.candidateCount = 0;
            this.templates = ALL_TEMPLATES;
        }

        reset() {
            this.smoothedChroma.fill(0);
            this.hasHistory = false;
            this.currentChord = "None";
            this.currentRoot = null;
            this.currentQuality = null;
            this.currentConfidence = 0;
            this.candidateChord = null;
            this.candidateCount = 0;
        }

        /**
         * Matches normalized chroma vector against all 96 chord templates.
         */
        matchTemplates(chromaVector, bassPitchClass = -1) {
            let sum = 0.0;
            for (let b = 0; b < 12; b++) sum += chromaVector[b];
            const mean = sum / 12.0;

            let sumSqZM = 0.0;
            const zeroMean = new Float32Array(12);
            for (let b = 0; b < 12; b++) {
                zeroMean[b] = chromaVector[b] - mean;
                sumSqZM += zeroMean[b] * zeroMean[b];
            }
            const normZM = Math.sqrt(sumSqZM) || 1.0;

            const results = [];

            for (let t = 0; t < this.templates.length; t++) {
                const tmpl = this.templates[t];

                // 1. Pearson cross-correlation
                let dot = 0.0;
                for (let b = 0; b < 12; b++) {
                    dot += (zeroMean[b] / normZM) * tmpl.vector[b];
                }

                // 2. Completeness penalty: All required chord tones must have non-trivial energy
                let missingPenalty = 0.0;
                for (let i = 0; i < tmpl.intervals.length; i++) {
                    const pc = tmpl.intervals[i];
                    if (chromaVector[pc] < 0.12) {
                        missingPenalty += (0.12 - chromaVector[pc]) * 2.5;
                    }
                }

                // 3. Bass root affinity bonus
                let bassBonus = 0.0;
                if (bassPitchClass !== -1 && tmpl.rootIndex === bassPitchClass) {
                    bassBonus = 0.25;
                }

                // 4. Non-chord tone penalty
                let extraPenalty = 0.0;
                for (let b = 0; b < 12; b++) {
                    if (!tmpl.intervals.includes(b)) {
                        if (chromaVector[b] > 0.20) {
                            extraPenalty += (chromaVector[b] - 0.20) * 0.8;
                        }
                    }
                }

                const rawScore = dot * 0.60 + bassBonus - missingPenalty - extraPenalty;
                const confidence = Math.max(0, Math.min(100, Math.round(rawScore * 100)));

                results.push({
                    name: tmpl.name,
                    root: tmpl.root,
                    quality: tmpl.qualityKey,
                    confidence: confidence,
                    pearson: dot,
                    rawScore: rawScore
                });
            }

            results.sort((a, b) => b.confidence - a.confidence);
            return results;
        }

        /**
         * Processes live frequency data from Web Audio AnalyserNode with hysteresis.
         */
        processFrame(freqData, sampleRate) {
            const sr = sampleRate || this.sampleRate;
            const instantaneousChroma = computeChromagram(freqData, sr);
            const bassRoot = detectLowestBassPitchClass(freqData, sr);

            let totalEnergy = 0.0;
            for (let b = 0; b < 12; b++) totalEnergy += instantaneousChroma[b];

            if (totalEnergy < this.noiseFloor) {
                // Signal decayed below noise gate
                this.hasHistory = false;
                this.currentConfidence = Math.max(0, Math.round(this.currentConfidence * 0.85));
                if (this.currentConfidence < 15) {
                    this.currentChord = "None";
                    this.currentRoot = null;
                    this.currentQuality = null;
                }
                return {
                    chord: this.currentChord,
                    confidence: this.currentConfidence,
                    root: this.currentRoot,
                    quality: this.currentQuality,
                    chroma: Array.from(this.smoothedChroma),
                    rawChord: "None",
                    isConfident: false
                };
            }

            // Temporal EMA smoothing of chroma vector with L2 normalization
            if (!this.hasHistory) {
                this.smoothedChroma.set(instantaneousChroma);
                this.hasHistory = true;
            } else {
                for (let b = 0; b < 12; b++) {
                    this.smoothedChroma[b] = this.historyAlpha * instantaneousChroma[b] + 
                                            (1.0 - this.historyAlpha) * this.smoothedChroma[b];
                }
                let sumSq = 0.0;
                for (let b = 0; b < 12; b++) sumSq += this.smoothedChroma[b] * this.smoothedChroma[b];
                const norm = Math.sqrt(sumSq) || 1.0;
                for (let b = 0; b < 12; b++) this.smoothedChroma[b] /= norm;
            }

            const matches = this.matchTemplates(this.smoothedChroma, bassRoot);
            const topMatch = matches[0];

            // Hysteresis Anti-Flicker State Machine
            if (this.currentChord === "None" || this.currentChord === null) {
                if (topMatch.confidence >= this.minConfidence) {
                    this.currentChord = topMatch.name;
                    this.currentRoot = topMatch.root;
                    this.currentQuality = topMatch.quality;
                    this.currentConfidence = topMatch.confidence;
                    this.candidateChord = topMatch.name;
                    this.candidateCount = 1;
                }
            } else if (topMatch.name === this.currentChord) {
                this.currentConfidence = Math.round(0.6 * this.currentConfidence + 0.4 * topMatch.confidence);
                this.candidateChord = topMatch.name;
                this.candidateCount = 0;
            } else {
                // Different chord is contending
                if (topMatch.confidence > this.currentConfidence + this.hysteresisMargin) {
                    // Decisive takeover
                    this.currentChord = topMatch.name;
                    this.currentRoot = topMatch.root;
                    this.currentQuality = topMatch.quality;
                    this.currentConfidence = topMatch.confidence;
                    this.candidateChord = topMatch.name;
                    this.candidateCount = 1;
                } else {
                    // Accumulate candidate stability frames
                    if (this.candidateChord === topMatch.name) {
                        this.candidateCount++;
                        if (this.candidateCount >= this.stabilityThreshold && topMatch.confidence >= this.minConfidence) {
                            this.currentChord = topMatch.name;
                            this.currentRoot = topMatch.root;
                            this.currentQuality = topMatch.quality;
                            this.currentConfidence = topMatch.confidence;
                        }
                    } else {
                        this.candidateChord = topMatch.name;
                        this.candidateCount = 1;
                    }
                }
            }

            return {
                chord: this.currentChord,
                confidence: this.currentConfidence,
                root: this.currentRoot,
                quality: this.currentQuality,
                chroma: Array.from(this.smoothedChroma),
                rawChord: topMatch.name,
                rawConfidence: topMatch.confidence,
                isConfident: this.currentConfidence >= this.minConfidence
            };
        }
    }

    // Default shared instance for static export
    const defaultRecognizer = new PolyphonicChordRecognizer();

    /**
     * Clean Function 1:
     * Analyzes raw FFT frequency bins and outputs detected chord, confidence, and root note with hysteresis.
     * 
     * @param {Uint8Array|Float32Array|Array<number>} freqByteData - 4096-bin FFT spectrum from Web Audio
     * @param {number} sampleRate - AudioContext sample rate
     * @returns {object} { chord, confidence, root, quality, chroma, isConfident }
     */
    function analyzeChroma(freqByteData, sampleRate = 44100) {
        return defaultRecognizer.processFrame(freqByteData, sampleRate);
    }

    // =========================================================================
    // 5. LIVE FRETBOARD SCALE OVERLAY GENERATOR
    // =========================================================================

    /**
     * Parses chord name into root and quality key.
     */
    function parseChordName(chordStr) {
        if (!chordStr || chordStr === "None") return null;

        const trimmed = chordStr.trim();
        const match = trimmed.match(/^([A-Ga-g][#b]?)(.*)$/);
        if (!match) return null;

        let root = match[1].toUpperCase();
        if (root.length === 2 && root[1] === 'B') {
            root = root[0] + 'b';
        }
        if (ENHARMONICS[root]) {
            root = ENHARMONICS[root];
        }

        const rawSuffix = match[2].trim().toLowerCase();
        let qualityKey = 'major';

        if (rawSuffix === 'm7' || rawSuffix === 'min7' || rawSuffix === '-7') {
            qualityKey = 'm7';
        } else if (rawSuffix === 'maj7' || (rawSuffix === 'm7' && match[2].includes('M')) || rawSuffix === 'Δ') {
            qualityKey = 'maj7';
        } else if (rawSuffix === '7' || rawSuffix === 'dom7') {
            qualityKey = 'dom7';
        } else if (rawSuffix === 'm' || rawSuffix === 'min' || rawSuffix === '-') {
            qualityKey = 'minor';
        } else if (rawSuffix === 'sus2') {
            qualityKey = 'sus2';
        } else if (rawSuffix === 'sus4' || rawSuffix === 'sus') {
            qualityKey = 'sus4';
        } else if (rawSuffix === 'dim' || rawSuffix === '°' || rawSuffix === 'dim7') {
            qualityKey = 'dim';
        } else if (rawSuffix === '' || rawSuffix === 'maj') {
            qualityKey = 'major';
        }

        return {
            root: root,
            qualityKey: qualityKey,
            rootIndex: NOTE_NAMES.indexOf(root)
        };
    }

    /**
     * Clean Function 2:
     * Generates compatible scale overlay and classifies notes across the entire guitar neck into:
     * - "target": Chord Tones / Target Notes (Root, 3rd, 5th, 7th)
     * - "passing": Passing / Safe Notes (Extensions and pentatonic steps)
     * - "avoid": Avoid Notes (Clashing half-step intervals)
     * 
     * Returns an Array of `{string, fret, noteType}` objects ready for the visual fretboard to render,
     * with attached scale recommendation metadata.
     * 
     * @param {string} chordName - e.g. "Am7", "C", "G7", "Fmaj7"
     * @param {object} options - Optional tuning and fret count overrides
     * @returns {Array<object>} Array of { string, fret, noteType, noteName, interval, midi }
     */
    function getScaleOverlay(chordName, options = {}) {
        const parsed = parseChordName((typeof chordName === 'string') ? chordName : "Am7");
        const numFrets = options.numFrets || 22;
        const tuning = options.tuning || STANDARD_TUNING_MIDI;

        if (!parsed) {
            const emptyArray = [];
            emptyArray.chordName = chordName || "None";
            emptyArray.scaleName = "No active chord";
            emptyArray.targetNotes = [];
            emptyArray.passingNotes = [];
            emptyArray.avoidNotes = [];
            return emptyArray;
        }

        const quality = CHORD_QUALITIES[parsed.qualityKey];
        const rootIdx = parsed.rootIndex;
        const scaleName = quality.scaleRecommendation(parsed.root);

        const targetNotes = quality.targetIntervals.map(i => NOTE_NAMES[(rootIdx + i) % 12]);
        const passingNotes = quality.passingIntervals.map(i => NOTE_NAMES[(rootIdx + i) % 12]);
        const avoidNotes = quality.avoidIntervals.map(i => NOTE_NAMES[(rootIdx + i) % 12]);

        const targetSet = new Set(quality.targetIntervals);
        const passingSet = new Set(quality.passingIntervals);
        const avoidSet = new Set(quality.avoidIntervals);

        const fretboardNotes = [];

        // Scan 6 strings across all frets
        for (let s = 1; s <= 6; s++) {
            const openMidi = tuning[s - 1];

            for (let f = 0; f <= numFrets; f++) {
                const midi = openMidi + f;
                const pitchClass = midi % 12;
                const interval = (pitchClass - rootIdx + 12) % 12;

                let noteType = 'avoid';
                if (targetSet.has(interval)) {
                    noteType = 'target';
                } else if (passingSet.has(interval)) {
                    noteType = 'passing';
                } else if (avoidSet.has(interval)) {
                    noteType = 'avoid';
                }

                fretboardNotes.push({
                    string: s,
                    fret: f,
                    noteType: noteType,
                    noteName: NOTE_NAMES[pitchClass],
                    interval: INTERVAL_NAMES[interval],
                    midi: midi
                });
            }
        }

        fretboardNotes.chordName = chordName;
        fretboardNotes.root = parsed.root;
        fretboardNotes.quality = parsed.qualityKey;
        fretboardNotes.scaleName = scaleName;
        fretboardNotes.targetNotes = targetNotes;
        fretboardNotes.passingNotes = passingNotes;
        fretboardNotes.avoidNotes = avoidNotes;

        return fretboardNotes;
    }

    // =========================================================================
    // 6. SYNTHETIC FFT SPECTRUM GENERATOR & BUILT-IN TEST DATA
    // =========================================================================

    /**
     * Synthesizes a realistic 4096-bin FFT spectrum for a guitar chord voicing,
     * modeling physical string fundamentals, overtone harmonic decay (1 / h^1.4),
     * and spectral window leakage.
     */
    function generateChordSpectrum(chordName, sampleRate = 44100, numBins = 4096) {
        const spectrum = new Uint8Array(numBins);
        const floatPower = new Float32Array(numBins);
        const binRes = sampleRate / (2.0 * numBins);

        const VOICINGS = {
            "C": [48, 52, 55, 60, 64],          // C3, E3, G3, C4, E4 (Open C)
            "Am": [45, 52, 57, 60, 64],         // A2, E3, A3, C4, E4 (Open Am)
            "G7": [43, 47, 50, 55, 59, 65],     // G2, B2, D3, G3, B3, F4 (Open G7)
            "Cmaj7": [48, 52, 55, 59, 64],      // C3, E3, G3, B3, E4 (Cmaj7)
            "Fmaj7": [41, 48, 53, 57, 60, 64],  // F2, C3, F3, A3, C4, E4 (Fmaj7)
            "Am7": [45, 52, 55, 60, 64],        // A2, E3, G3, C4, E4 (Open Am7)
            "Em7": [40, 47, 50, 55, 59, 64],    // E2, B2, D3, G3, B3, E4 (Open Em7)
            "Dsus2": [50, 57, 62, 64],          // D3, A3, D4, E4 (Dsus2)
            "Asus4": [45, 52, 57, 62, 64],      // A2, E3, A3, D4, E4 (Asus4)
            "Bdim": [47, 53, 59, 62],           // B2, F3, B3, D4 (Bdim)
            "D": [50, 57, 62, 66],              // D3, A3, D4, F#4 (Open D)
            "Em": [40, 47, 52, 55, 59, 64],     // E2, B2, E3, G3, B3, E4 (Open Em)
            "A7": [45, 52, 55, 61, 64],         // A2, E3, G3, C#4, E4 (Open A7)
            "Dm7": [50, 57, 60, 65]             // D3, A3, C4, F4 (Dm7)
        };

        let midiNotes = VOICINGS[chordName];
        if (!midiNotes) {
            const parsed = parseChordName(chordName);
            if (parsed) {
                const q = CHORD_QUALITIES[parsed.qualityKey];
                const baseMidi = 48 + parsed.rootIndex;
                midiNotes = q.intervals.map(int => baseMidi + int);
            } else {
                midiNotes = [60, 64, 67];
            }
        }

        for (const midi of midiNotes) {
            const f0 = 440.0 * Math.pow(2.0, (midi - 69.0) / 12.0);

            for (let h = 1; h <= 6; h++) {
                const harmFreq = f0 * h;
                if (harmFreq >= sampleRate / 2.0) break;

                // Physical string harmonic decay
                const harmAmp = 1.0 / Math.pow(h, 1.4);
                const centerBin = harmFreq / binRes;

                for (let delta = -3; delta <= 3; delta++) {
                    const bin = Math.round(centerBin + delta);
                    if (bin >= 0 && bin < numBins) {
                        const dist = Math.abs((bin * binRes) - harmFreq) / binRes;
                        const leak = Math.exp(-0.5 * (dist / 1.2) * (dist / 1.2));
                        floatPower[bin] += harmAmp * leak;
                    }
                }
            }
        }

        let maxP = 0.0;
        for (let i = 0; i < numBins; i++) {
            if (floatPower[i] > maxP) maxP = floatPower[i];
        }

        const scale = maxP > 0 ? 230.0 / maxP : 1.0;
        for (let i = 0; i < numBins; i++) {
            if (floatPower[i] > 0) {
                spectrum[i] = Math.min(255, Math.round(floatPower[i] * scale) + 5);
            }
        }

        return spectrum;
    }

    /**
     * Built-in test datasets for automated verification.
     */
    const BUILTIN_TEST_DATA = [
        { chordName: "C", expectedRoot: "C", expectedQuality: "major", type: "Triad" },
        { chordName: "Am", expectedRoot: "A", expectedQuality: "minor", type: "Triad" },
        { chordName: "G7", expectedRoot: "G", expectedQuality: "dom7", type: "7th" },
        { chordName: "Fmaj7", expectedRoot: "F", expectedQuality: "maj7", type: "7th" },
        { chordName: "Cmaj7", expectedRoot: "C", expectedQuality: "maj7", type: "7th" },
        { chordName: "Am7", expectedRoot: "A", expectedQuality: "m7", type: "7th" },
        { chordName: "Em7", expectedRoot: "E", expectedQuality: "m7", type: "7th" },
        { chordName: "Dsus2", expectedRoot: "D", expectedQuality: "sus2", type: "Suspended" },
        { chordName: "Asus4", expectedRoot: "A", expectedQuality: "sus4", type: "Suspended" },
        { chordName: "Bdim", expectedRoot: "B", expectedQuality: "dim", type: "Diminished" }
    ];

    /**
     * Executes verification suite over all built-in chord test cases.
     */
    function verifyChordDetection() {
        const recognizer = new PolyphonicChordRecognizer({ stabilityThreshold: 1 });
        const results = [];

        for (const testCase of BUILTIN_TEST_DATA) {
            recognizer.reset();
            const spectrum = generateChordSpectrum(testCase.chordName, 44100, 4096);
            const detection = recognizer.processFrame(spectrum, 44100);

            const passed = (detection.chord === testCase.chordName) && (detection.confidence >= 50);
            results.push({
                testChord: testCase.chordName,
                detectedChord: detection.chord,
                confidence: detection.confidence,
                root: detection.root,
                quality: detection.quality,
                passed: passed
            });
        }

        return results;
    }

    // =========================================================================
    // EXPORTS
    // =========================================================================

    return {
        // Specified clean exports
        analyzeChroma: analyzeChroma,
        getScaleOverlay: getScaleOverlay,

        // Engine classes & utilities
        PolyphonicChordRecognizer: PolyphonicChordRecognizer,
        computeChromagram: computeChromagram,
        detectLowestBassPitchClass: detectLowestBassPitchClass,
        parseChordName: parseChordName,
        generateChordSpectrum: generateChordSpectrum,

        // Test Data & Verification
        BUILTIN_TEST_DATA: BUILTIN_TEST_DATA,
        verifyChordDetection: verifyChordDetection,

        // Constants
        NOTE_NAMES: NOTE_NAMES,
        CHORD_QUALITIES: CHORD_QUALITIES,
        ALL_TEMPLATES: ALL_TEMPLATES,
        STANDARD_TUNING_MIDI: STANDARD_TUNING_MIDI
    };
}));
