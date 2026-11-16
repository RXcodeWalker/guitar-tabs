/**
 * High-Precision Guitar Strobe Tuner & Inharmonicity Analyzer
 * 
 * Physics & Signal Processing Architecture:
 * 1. Virtual Strobe Disc Visualizer:
 *    - Dual-ring concentric strobe wheel on HTML5 Canvas.
 *    - Angular velocity: omega = k * cents, where cents = 1200 * log2(f_det / f_target).
 *    - Clockwise rotation for sharp (cents > 0), counter-clockwise for flat (cents < 0).
 *    - Stationary (omega = 0) at 0.0 cents down to 0.1 cent precision.
 * 
 * 2. String Stiffness & Inharmonicity Calculation:
 *    - Modal dispersion from flexural rigidity (stiffness):
 *      f_n = n * f0 * sqrt(1 + B * n^2)
 *      where B = (pi^3 * E * d^4) / (64 * T * L^2) is the inharmonicity coefficient.
 *    - Linearized form: (f_n / n)^2 = f0^2 + (f0^2 * B) * n^2.
 *    - High-precision quadratic interpolation on FFT bins around partials n = 1, 2, 3, 4.
 *    - Ordinary Least Squares (OLS) regression over x = n^2 vs y = (f_n / n)^2 extracts
 *      exact B, baseline f0, and correlation goodness R^2.
 *    - Acoustic String Wear evaluation gauge based on measured B.
 * 
 * 3. Alternate Tuning Engine:
 *    - Instant presets: Standard (EADGBE), Drop D (DADGBE), DADGAD,
 *      Open D (DADF#AD), Open G (DGDGBD), and Half-Step Down (Eb Ab Db Gb Bb Eb).
 *    - Emits updated open-string base frequencies array [f6, f5, f4, f3, f2, f1].
 * 
 * 4. Modular Web Audio Pipeline Integration:
 *    - Standalone class StrobeTuner(canvasId, audioContext, analyserNode, options).
 *    - UMD / ES Module / CommonJS / Global browser compatibility.
 */

// ============================================================================
// 1. ALTERNATE TUNING PRESETS & MUSICAL CONSTANTS
// ============================================================================

const TUNING_PRESETS = {
    standard: {
        id: 'standard',
        name: 'Standard',
        display: 'E A D G B e',
        // String 6 (Low E) to String 1 (High e)
        midi: [40, 45, 50, 55, 59, 64],
        notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        stringNames: ['E', 'A', 'D', 'G', 'B', 'e']
    },
    dropD: {
        id: 'dropD',
        name: 'Drop D',
        display: 'D A D G B e',
        midi: [38, 45, 50, 55, 59, 64],
        notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'],
        stringNames: ['D', 'A', 'D', 'G', 'B', 'e']
    },
    dadgad: {
        id: 'dadgad',
        name: 'DADGAD',
        display: 'D A D G A d',
        midi: [38, 45, 50, 55, 57, 62],
        notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'],
        stringNames: ['D', 'A', 'D', 'G', 'A', 'd']
    },
    openD: {
        id: 'openD',
        name: 'Open D',
        display: 'D A D F# A d',
        midi: [38, 45, 50, 54, 57, 62],
        notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'],
        stringNames: ['D', 'A', 'D', 'F#', 'A', 'd']
    },
    openG: {
        id: 'openG',
        name: 'Open G',
        display: 'D G D G B d',
        midi: [38, 43, 50, 55, 59, 62],
        notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'],
        stringNames: ['D', 'G', 'D', 'G', 'B', 'd']
    },
    halfStep: {
        id: 'halfStep',
        name: 'Half-Step Down',
        display: 'Eb Ab Db Gb Bb eb',
        midi: [39, 44, 49, 54, 58, 63],
        notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'],
        stringNames: ['Eb', 'Ab', 'Db', 'Gb', 'Bb', 'eb']
    }
};

const NOTE_STRINGS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Calculates equal-temperament frequency from MIDI number given reference A4.
 */
function midiToFreq(midi, a4 = 440) {
    return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Calculates cents deviation between measured frequency and target frequency.
 */
function getCentsDeviation(freq, targetFreq) {
    if (freq <= 0 || targetFreq <= 0) return 0;
    return 1200 * Math.log2(freq / targetFreq);
}

// ============================================================================
// 2. STROBE TUNER & INHARMONICITY ANALYZER CLASS
// ============================================================================

class StrobeTuner {
    /**
     * @param {string|HTMLCanvasElement|null} canvasId - Canvas element or ID.
     * @param {AudioContext|null} audioContext - Existing AudioContext or null.
     * @param {AnalyserNode|null} analyserNode - Existing AnalyserNode or null.
     * @param {Object} options - Configuration parameters.
     */
    constructor(canvasId = null, audioContext = null, analyserNode = null, options = {}) {
        // 1. Canvas & Rendering setup
        this.canvas = null;
        this.ctx = null;
        if (typeof document !== 'undefined') {
            if (typeof canvasId === 'string') {
                this.canvas = document.getElementById(canvasId);
            } else if (canvasId instanceof HTMLElement) {
                this.canvas = canvasId;
            }
            if (this.canvas && this.canvas.getContext) {
                this.ctx = this.canvas.getContext('2d');
            }
        }

        // 2. Audio Pipeline references
        this.audioCtx = audioContext || null;
        this.analyser = analyserNode || null;
        this.a4 = options.a4 || 440;
        this.noiseGate = options.noiseGate !== undefined ? options.noiseGate : 0.006;
        this.strobeSpeedFactor = options.strobeSpeedFactor || 0.085; // rad/s per cent

        // 3. Tuning State
        this.currentPresetKey = options.preset || 'standard';
        this.currentTuning = null;
        this.targetStringIndex = options.targetString !== undefined ? options.targetString : 0; // 0 = Auto-detect, 1..6 = manual
        this.initTuning(this.currentPresetKey);

        // 4. Strobe Visualization State
        this.outerAngle = 0;       // Fundamental ring phase (rad)
        this.innerAngle = 0;       // 2nd partial ring phase (rad)
        this.cents = 0.0;          // Cents deviation down to 0.1 precision
        this.centsPartial2 = 0.0;  // Cents deviation of 2nd partial
        this.detectedFreq = 0.0;   // Measured fundamental frequency (Hz)
        this.targetFreq = this.currentTuning.frequencies[0]; // Current target (Hz)
        this.activeString = 6;     // 1 to 6 (default Low E)
        this.signalLevel = 0.0;    // Signal RMS
        this.hasSignal = false;
        this.smoothedCents = 0.0;  // Smooth visual response

        // Strobe Disc configuration
        this.outerSpokes = options.outerSpokes || 32; // Fundamental ring spoke teeth
        this.innerSpokes = options.innerSpokes || 16; // Harmonic ring spoke teeth

        // 5. Inharmonicity Analysis State
        this.inharmonicityB = 0.0;   // Inharmonicity coefficient B
        this.rSquared = 1.0;         // Regression fit goodness R^2
        this.stringWear = 'Fresh';   // 'Fresh' | 'Good' | 'Aged' | 'Worn'
        this.wearSeverity = 0.0;     // 0.0 (brand new) to 1.0 (dead string)
        this.detectedPartials = [];  // Detected 4 spectral peaks: [{ n, f, expected, cents, amp }]

        // 6. Audio Buffers & FFT configuration
        this.fftSize = options.fftSize || 8192;
        this.timeDomainBuffer = null;
        this.freqDomainBuffer = null;
        this.sampleRate = this.audioCtx ? this.audioCtx.sampleRate : 44100;
        if (this.analyser) {
            this.analyser.fftSize = this.fftSize;
            this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);
            this.freqDomainBuffer = new Float32Array(this.analyser.frequencyBinCount);
            this.sampleRate = this.audioCtx ? this.audioCtx.sampleRate : 44100;
        }

        // 7. Animation & Lifecycle
        this.isRunning = false;
        this.animFrameId = null;
        this.lastFrameTime = 0;

        // 8. Event Callbacks
        this.onTuningChange = options.onTuningChange || null;
        this.onPitchAnalysis = options.onPitchAnalysis || null;
        this.onInharmonicity = options.onInharmonicity || null;

        // Auto-resize canvas on High-DPI screens if canvas exists
        if (this.canvas) {
            this.resizeCanvas();
        }
    }

    /**
     * Initializes tuning parameters and open string base frequencies.
     * @param {string} presetKey
     */
    initTuning(presetKey) {
        const preset = TUNING_PRESETS[presetKey] || TUNING_PRESETS.standard;
        this.currentPresetKey = preset.id;

        // Calculate exact base frequencies for Strings 6 to 1 (Low to High)
        const frequencies = preset.midi.map(m => midiToFreq(m, this.a4));
        
        // High to Low mapping for 1-based guitar indexing (String 1 = high e, String 6 = low E)
        const byString = {
            1: frequencies[5],
            2: frequencies[4],
            3: frequencies[3],
            4: frequencies[2],
            5: frequencies[1],
            6: frequencies[0]
        };

        const midiByString = {
            1: preset.midi[5],
            2: preset.midi[4],
            3: preset.midi[3],
            4: preset.midi[2],
            5: preset.midi[1],
            6: preset.midi[0]
        };

        const namesByString = {
            1: preset.stringNames[5],
            2: preset.stringNames[4],
            3: preset.stringNames[3],
            4: preset.stringNames[2],
            5: preset.stringNames[1],
            6: preset.stringNames[0]
        };

        this.currentTuning = {
            preset: preset.id,
            name: preset.name,
            display: preset.display,
            frequencies: frequencies, // [f6, f5, f4, f3, f2, f1]
            frequenciesHighToLow: [frequencies[5], frequencies[4], frequencies[3], frequencies[2], frequencies[1], frequencies[0]],
            midi: preset.midi,        // [m6, m5, m4, m3, m2, m1]
            midiHighToLow: [preset.midi[5], preset.midi[4], preset.midi[3], preset.midi[2], preset.midi[1], preset.midi[0]],
            notes: preset.notes,      // ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
            stringNames: preset.stringNames, // ['E', 'A', 'D', 'G', 'B', 'e']
            byString: byString,
            midiByString: midiByString,
            namesByString: namesByString
        };

        // Default target is Low E (String 6)
        this.targetFreq = this.currentTuning.frequencies[0];
    }

    /**
     * Resizes canvas to match container with crisp HiDPI backing store.
     */
    resizeCanvas() {
        if (!this.canvas || typeof window === 'undefined') return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || this.canvas.width || 360;
        const height = rect.height || this.canvas.height || 360;

        if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
            this.canvas.width = Math.round(width * dpr);
            this.canvas.height = Math.round(height * dpr);
            this.canvas.style.width = `${width}px`;
            this.canvas.style.height = `${height}px`;
        }
    }

    // ========================================================================
    // 3. PUBLIC API METHODS
    // ========================================================================

    /**
     * Starts the audio analysis and canvas strobe visualizer animation loop.
     * @returns {StrobeTuner} this
     */
    start() {
        if (this.isRunning) return this;

        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        this.isRunning = true;
        this.lastFrameTime = performance.now();

        const loop = (timestamp) => {
            if (!this.isRunning) return;
            this.update(timestamp);
            this.render();
            if (typeof requestAnimationFrame !== 'undefined') {
                this.animFrameId = requestAnimationFrame(loop);
            }
        };

        if (typeof requestAnimationFrame !== 'undefined') {
            this.animFrameId = requestAnimationFrame(loop);
        }

        return this;
    }

    /**
     * Stops the audio analysis and visualizer loop.
     * @returns {StrobeTuner} this
     */
    stop() {
        this.isRunning = false;
        if (this.animFrameId && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this.animFrameId);
            this.animFrameId = null;
        }
        return this;
    }

    /**
     * Switches to an alternate tuning preset and outputs updated open-string base frequencies.
     * @param {string} presetName - 'standard' | 'dropD' | 'dadgad' | 'openD' | 'openG' | 'halfStep'
     * @returns {Object} Updated tuning information with base frequencies
     */
    setTuning(presetName) {
        if (!TUNING_PRESETS[presetName]) {
            console.warn(`[StrobeTuner] Unknown tuning preset: "${presetName}". Defaulting to "standard".`);
            presetName = 'standard';
        }

        this.initTuning(presetName);

        // Update target frequency based on current manual/auto string
        if (this.targetStringIndex >= 1 && this.targetStringIndex <= 6) {
            this.targetFreq = this.currentTuning.byString[this.targetStringIndex];
        } else {
            this.targetFreq = this.currentTuning.frequencies[0];
        }

        // Trigger callback hook if registered
        if (typeof this.onTuningChange === 'function') {
            this.onTuningChange({
                preset: this.currentPresetKey,
                name: this.currentTuning.name,
                frequencies: [...this.currentTuning.frequencies],
                frequenciesHighToLow: [...this.currentTuning.frequenciesHighToLow],
                midi: [...this.currentTuning.midi],
                midiHighToLow: [...this.currentTuning.midiHighToLow],
                stringNames: [...this.currentTuning.stringNames],
                byString: { ...this.currentTuning.byString }
            });
        }

        // Dispatch DOM event if running in browser
        if (typeof window !== 'undefined' && this.canvas) {
            const event = new CustomEvent('strobe-tuning-change', {
                detail: this.currentTuning,
                bubbles: true
            });
            this.canvas.dispatchEvent(event);
        }

        return this.getTuning();
    }

    /**
     * Returns an array of the 6 open-string base frequencies (Strings 6 to 1).
     * @returns {number[]} [f6, f5, f4, f3, f2, f1]
     */
    getFrequencies() {
        return [...this.currentTuning.frequencies];
    }

    /**
     * Returns full tuning metadata object.
     * @returns {Object}
     */
    getTuning() {
        return {
            preset: this.currentPresetKey,
            name: this.currentTuning.name,
            display: this.currentTuning.display,
            frequencies: [...this.currentTuning.frequencies],
            frequenciesHighToLow: [...this.currentTuning.frequenciesHighToLow],
            midi: [...this.currentTuning.midi],
            midiHighToLow: [...this.currentTuning.midiHighToLow],
            stringNames: [...this.currentTuning.stringNames],
            notes: [...this.currentTuning.notes],
            byString: { ...this.currentTuning.byString }
        };
    }

    /**
     * Sets target string selection: 0 for Auto-detect, or 1 to 6 for manual string lock.
     * @param {number} stringNum - 0 (Auto), or 1 (High e) to 6 (Low E)
     */
    setTargetString(stringNum) {
        this.targetStringIndex = Math.max(0, Math.min(6, parseInt(stringNum, 10) || 0));
        if (this.targetStringIndex > 0) {
            this.activeString = this.targetStringIndex;
            this.targetFreq = this.currentTuning.byString[this.targetStringIndex];
        }
    }

    /**
     * Updates reference concert pitch A4 (e.g. 440 Hz, 432 Hz).
     * @param {number} a4
     */
    setReferenceA4(a4) {
        if (a4 > 300 && a4 < 550) {
            this.a4 = a4;
            this.initTuning(this.currentPresetKey);
        }
    }

    /**
     * Connects or updates Web Audio nodes dynamically.
     * @param {AudioContext} audioContext
     * @param {AnalyserNode} analyserNode
     */
    connectAudio(audioContext, analyserNode) {
        this.audioCtx = audioContext;
        this.analyser = analyserNode;
        if (this.audioCtx) {
            this.sampleRate = this.audioCtx.sampleRate;
        }
        if (this.analyser) {
            this.analyser.fftSize = this.fftSize;
            this.timeDomainBuffer = new Float32Array(this.analyser.fftSize);
            this.freqDomainBuffer = new Float32Array(this.analyser.frequencyBinCount);
        }
    }

    // ========================================================================
    // 4. ACOUSTIC INHARMONICITY & STRING STIFFNESS CALCULATION
    // ========================================================================

    /**
     * Calculates the inharmonicity coefficient (B) from the detected first 4 spectral peaks:
     * Model: f_n = n * f0 * sqrt(1 + B * n^2)
     * Linearized: (f_n / n)^2 = f0^2 + (f0^2 * B) * n^2
     * Let x_n = n^2, y_n = (f_n / n)^2 -> y = alpha + beta * x
     * B = beta / alpha,  f0 = sqrt(alpha)
     * 
     * @param {Array<Object>} peaks - Array of at least 2 detected peaks: [{ n: 1, freq: 82.41 }, ...]
     * @returns {Object} Inharmonicity analysis results
     */
    calculateInharmonicity(peaks) {
        if (!peaks || peaks.length < 2) {
            return {
                B: 0.0,
                f0: peaks && peaks[0] ? peaks[0].freq : 0,
                rSquared: 0.0,
                stringWear: 'Unknown',
                wearSeverity: 0.0,
                partials: []
            };
        }

        const validPeaks = peaks.filter(p => p && p.n >= 1 && p.freq > 0);
        const K = validPeaks.length;
        if (K < 2) {
            return {
                B: 0.0,
                f0: validPeaks[0] ? validPeaks[0].freq : 0,
                rSquared: 0.0,
                stringWear: 'Unknown',
                wearSeverity: 0.0,
                partials: []
            };
        }

        // Build data points for Ordinary Least Squares (OLS)
        const x = []; // n^2
        const y = []; // (f_n / n)^2
        let sumX = 0;
        let sumY = 0;

        for (let i = 0; i < K; i++) {
            const n = validPeaks[i].n;
            const fn = validPeaks[i].freq;
            const xi = n * n;
            const yi = Math.pow(fn / n, 2);
            x.push(xi);
            y.push(yi);
            sumX += xi;
            sumY += yi;
        }

        const meanX = sumX / K;
        const meanY = sumY / K;

        let covXY = 0;
        let varX = 0;
        for (let i = 0; i < K; i++) {
            const dx = x[i] - meanX;
            const dy = y[i] - meanY;
            covXY += dx * dy;
            varX += dx * dx;
        }

        let beta = varX > 1e-12 ? covXY / varX : 0;
        let alpha = meanY - beta * meanX;

        // Physical constraint: alpha = f0^2 must be positive
        let B = 0.0;
        let f0 = Math.sqrt(Math.max(0, alpha));

        if (alpha > 0 && beta > 0) {
            B = beta / alpha;
        } else if (beta <= 0) {
            // Ideal flexible string with negligible stiffness
            B = 0.0;
            f0 = Math.sqrt(Math.max(0, meanY));
        }

        // Calculate coefficient of determination R^2
        let ssTot = 0;
        let ssRes = 0;
        for (let i = 0; i < K; i++) {
            const yPred = alpha + beta * x[i];
            ssTot += Math.pow(y[i] - meanY, 2);
            ssRes += Math.pow(y[i] - yPred, 2);
        }
        let rSquared = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1.0;

        // Evaluate string wear / degradation category
        // In physical acoustic/electric guitar strings:
        // Fresh plain/wound string: B ≈ 0.00008 to 0.00025
        // Good playable condition:  B ≈ 0.00025 to 0.00055
        // Aged intonation drift:    B ≈ 0.00055 to 0.00110
        // Dead / worn string:       B >= 0.00110
        let stringWear = 'Fresh';
        let wearSeverity = 0.0; // 0.0 to 1.0 scale

        if (B < 0.00025) {
            stringWear = 'Fresh';
            wearSeverity = Math.min(0.25, (B / 0.00025) * 0.25);
        } else if (B < 0.00055) {
            stringWear = 'Good';
            wearSeverity = 0.25 + ((B - 0.00025) / 0.00030) * 0.25;
        } else if (B < 0.00110) {
            stringWear = 'Aged';
            wearSeverity = 0.50 + ((B - 0.00055) / 0.00055) * 0.25;
        } else {
            stringWear = 'Worn';
            wearSeverity = Math.min(1.0, 0.75 + ((B - 0.00110) / 0.00100) * 0.25);
        }

        // Compile detailed partial deviation info
        const partials = validPeaks.map(p => {
            const pureHarmonic = p.n * f0;
            const deltaHz = p.freq - pureHarmonic;
            const centsShift = pureHarmonic > 0 ? 1200 * Math.log2(p.freq / pureHarmonic) : 0;
            return {
                n: p.n,
                freq: p.freq,
                pureHarmonic: pureHarmonic,
                deltaHz: deltaHz,
                centsShift: centsShift,
                amp: p.amp || 0
            };
        });

        return {
            B: B,
            f0: f0,
            rSquared: rSquared,
            stringWear: stringWear,
            wearSeverity: wearSeverity,
            partials: partials
        };
    }

    /**
     * Extracts the first 4 spectral peaks (n = 1, 2, 3, 4) from FFT magnitude buffer
     * using high-precision parabolic/quadratic peak interpolation.
     * 
     * @param {Float32Array} freqBuffer - Frequency magnitude data (in dB)
     * @param {number} fundamentalFreq - Estimated fundamental frequency (Hz)
     * @param {number} sampleRate - Audio sample rate (Hz)
     * @returns {Array<Object>} First 4 spectral peaks
     */
    detectSpectralPeaks(freqBuffer, fundamentalFreq, sampleRate = this.sampleRate) {
        if (!freqBuffer || fundamentalFreq <= 20) return [];

        const binCount = freqBuffer.length;
        const binWidth = (sampleRate / 2) / binCount;
        const peaks = [];

        // Search for partials n = 1, 2, 3, 4
        for (let n = 1; n <= 4; n++) {
            const expectedFreq = n * fundamentalFreq;
            if (expectedFreq >= sampleRate / 2 - 100) break;

            // Search window around expected harmonic: ±12% (stiffness shifts up, not down)
            const minFreq = expectedFreq * 0.92;
            const maxFreq = expectedFreq * 1.15;

            const minBin = Math.max(1, Math.floor(minFreq / binWidth));
            const maxBin = Math.min(binCount - 2, Math.ceil(maxFreq / binWidth));

            let maxVal = -Infinity;
            let peakBin = -1;

            for (let b = minBin; b <= maxBin; b++) {
                if (freqBuffer[b] > maxVal && freqBuffer[b] > freqBuffer[b - 1] && freqBuffer[b] >= freqBuffer[b + 1]) {
                    maxVal = freqBuffer[b];
                    peakBin = b;
                }
            }

            // Fallback: if no strict local peak, take maximum bin in range
            if (peakBin === -1) {
                for (let b = minBin; b <= maxBin; b++) {
                    if (freqBuffer[b] > maxVal) {
                        maxVal = freqBuffer[b];
                        peakBin = b;
                    }
                }
            }

            if (peakBin > 0 && peakBin < binCount - 1) {
                // Parabolic / Quadratic Peak Interpolation on dB magnitudes:
                // delta = 0.5 * (alpha - gamma) / (alpha - 2*beta + gamma)
                const alpha = freqBuffer[peakBin - 1];
                const beta = freqBuffer[peakBin];
                const gamma = freqBuffer[peakBin + 1];

                const denom = alpha - 2 * beta + gamma;
                let delta = 0;
                if (Math.abs(denom) > 1e-6) {
                    delta = 0.5 * (alpha - gamma) / denom;
                    delta = Math.max(-0.5, Math.min(0.5, delta));
                }

                const refinedBin = peakBin + delta;
                const refinedFreq = refinedBin * binWidth;
                const refinedAmp = beta - 0.25 * (alpha - gamma) * delta;

                peaks.push({
                    n: n,
                    freq: refinedFreq,
                    bin: refinedBin,
                    amp: refinedAmp
                });
            }
        }

        return peaks;
    }

    /**
     * Pitch detection using normalized autocorrelation with parabolic peak refinement.
     * @param {Float32Array} buffer - Time-domain samples
     * @param {number} sampleRate - Sample rate
     * @returns {Object|null} { frequency, confidence, rms }
     */
    detectPitch(buffer, sampleRate = this.sampleRate) {
        if (!buffer || buffer.length === 0) return null;

        // Calculate RMS signal energy
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
            sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        if (rms < this.noiseGate) {
            return { frequency: 0, confidence: 0, rms: rms };
        }

        // Guitar search limits: Low D (70 Hz) to High E Lead (1400 Hz)
        const minPeriod = Math.floor(sampleRate / 1400);
        const maxPeriod = Math.floor(sampleRate / 68);

        let bestPeriod = -1;
        let maxCorr = -Infinity;

        // Normalized Autocorrelation
        for (let lag = minPeriod; lag <= maxPeriod; lag++) {
            let corr = 0;
            let norm1 = 0;
            let norm2 = 0;
            const len = buffer.length - lag;

            for (let i = 0; i < len; i += 2) { // 2x stride for high-speed performance
                const a = buffer[i];
                const b = buffer[i + lag];
                corr += a * b;
                norm1 += a * a;
                norm2 += b * b;
            }

            const denom = Math.sqrt(norm1 * norm2);
            const normCorr = denom > 1e-7 ? corr / denom : 0;

            if (normCorr > maxCorr) {
                maxCorr = normCorr;
                bestPeriod = lag;
            }
        }

        if (bestPeriod <= 0 || maxCorr < 0.45) {
            return { frequency: 0, confidence: maxCorr, rms: rms };
        }

        // Parabolic interpolation around best lag for sub-sample accuracy
        let periodRefined = bestPeriod;
        if (bestPeriod > minPeriod && bestPeriod < maxPeriod) {
            let cLeft = 0, cMid = 0, cRight = 0;
            const len = buffer.length - bestPeriod - 1;
            for (let i = 0; i < len; i += 2) {
                cLeft  += buffer[i] * buffer[i + bestPeriod - 1];
                cMid   += buffer[i] * buffer[i + bestPeriod];
                cRight += buffer[i] * buffer[i + bestPeriod + 1];
            }
            const denom = cLeft - 2 * cMid + cRight;
            if (Math.abs(denom) > 1e-6) {
                const delta = 0.5 * (cLeft - cRight) / denom;
                periodRefined += Math.max(-0.5, Math.min(0.5, delta));
            }
        }

        const frequency = sampleRate / periodRefined;
        return {
            frequency: frequency,
            confidence: Math.max(0, Math.min(1, maxCorr)),
            rms: rms
        };
    }

    // ========================================================================
    // 5. REAL-TIME UPDATE & FRAME PROCESSING
    // ========================================================================

    /**
     * Executes real-time analysis of the current Web Audio buffer frame.
     * @param {number} timestamp - Animation frame timestamp
     */
    update(timestamp) {
        if (!this.lastFrameTime) this.lastFrameTime = timestamp;
        const dt = Math.min(0.1, (timestamp - this.lastFrameTime) / 1000.0);
        this.lastFrameTime = timestamp;

        if (this.analyser && this.timeDomainBuffer && this.freqDomainBuffer) {
            this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
            this.analyser.getFloatFrequencyData(this.freqDomainBuffer);

            const pitch = this.detectPitch(this.timeDomainBuffer, this.sampleRate);
            if (pitch && pitch.rms >= this.noiseGate && pitch.frequency > 50) {
                this.hasSignal = true;
                this.signalLevel = pitch.rms;
                this.detectedFreq = pitch.frequency;

                // 1. Determine target string
                if (this.targetStringIndex === 0) {
                    // Auto-detect closest string in current preset
                    let bestDiff = Infinity;
                    let matchedStr = 6;
                    for (let s = 1; s <= 6; s++) {
                        const openF = this.currentTuning.byString[s];
                        const diff = Math.abs(1200 * Math.log2(pitch.frequency / openF));
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            matchedStr = s;
                        }
                    }
                    this.activeString = matchedStr;
                    this.targetFreq = this.currentTuning.byString[matchedStr];
                } else {
                    this.activeString = this.targetStringIndex;
                    this.targetFreq = this.currentTuning.byString[this.targetStringIndex];
                }

                // 2. Compute exact cents deviation down to 0.1 precision
                this.cents = getCentsDeviation(this.detectedFreq, this.targetFreq);

                // 3. Extract spectral peaks for inharmonicity
                const peaks = this.detectSpectralPeaks(this.freqDomainBuffer, this.detectedFreq, this.sampleRate);
                if (peaks.length >= 2) {
                    this.detectedPartials = peaks;
                    const inharm = this.calculateInharmonicity(peaks);
                    this.inharmonicityB = inharm.B;
                    this.rSquared = inharm.rSquared;
                    this.stringWear = inharm.stringWear;
                    this.wearSeverity = inharm.wearSeverity;

                    // 2nd partial deviation for inner strobe ring
                    const p2 = peaks.find(p => p.n === 2);
                    if (p2) {
                        this.centsPartial2 = getCentsDeviation(p2.freq, this.targetFreq * 2);
                    } else {
                        this.centsPartial2 = this.cents;
                    }

                    if (typeof this.onInharmonicity === 'function') {
                        this.onInharmonicity(inharm);
                    }
                }

                if (typeof this.onPitchAnalysis === 'function') {
                    this.onPitchAnalysis({
                        frequency: this.detectedFreq,
                        targetFrequency: this.targetFreq,
                        cents: this.cents,
                        string: this.activeString,
                        stringName: this.currentTuning.namesByString[this.activeString],
                        noteName: this.currentTuning.notes[6 - this.activeString],
                        inharmonicityB: this.inharmonicityB,
                        stringWear: this.stringWear
                    });
                }
            } else {
                this.hasSignal = false;
                this.signalLevel *= 0.85; // smooth decay
            }
        }

        // Strobe disc angular velocity:
        // Direct proportionality: omega = k * cents
        // Clockwise if sharp (cents > 0), Counter-clockwise if flat (cents < 0)
        // If silence, gently decelerate to a stop
        if (this.hasSignal) {
            // Apply a slight deadzone for true zero stop within 0.05 cents
            const activeCents = Math.abs(this.cents) < 0.05 ? 0 : this.cents;
            const activeCents2 = Math.abs(this.centsPartial2) < 0.05 ? 0 : this.centsPartial2;

            const omegaOuter = activeCents * this.strobeSpeedFactor;
            const omegaInner = activeCents2 * this.strobeSpeedFactor;

            this.outerAngle += omegaOuter * dt;
            this.innerAngle += omegaInner * dt;
            this.smoothedCents += (this.cents - this.smoothedCents) * Math.min(1.0, dt * 15);
        } else {
            // Gentle visual coasting
            this.smoothedCents *= Math.max(0, 1 - dt * 4);
        }

        // Keep angles normalized between 0 and 2*PI
        const TWO_PI = Math.PI * 2;
        this.outerAngle = ((this.outerAngle % TWO_PI) + TWO_PI) % TWO_PI;
        this.innerAngle = ((this.innerAngle % TWO_PI) + TWO_PI) % TWO_PI;
    }

    /**
     * Manually feeds audio data or synthetic plucks for testing and offline analysis.
     * @param {Float32Array} timeBuffer
     * @param {Float32Array} freqBuffer
     */
    analyzeSignal(timeBuffer, freqBuffer) {
        if (timeBuffer) {
            const pitch = this.detectPitch(timeBuffer, this.sampleRate);
            if (pitch && pitch.frequency > 50) {
                this.hasSignal = true;
                this.detectedFreq = pitch.frequency;
                this.cents = getCentsDeviation(this.detectedFreq, this.targetFreq);
            }
        }
        if (freqBuffer && this.detectedFreq > 50) {
            const peaks = this.detectSpectralPeaks(freqBuffer, this.detectedFreq, this.sampleRate);
            if (peaks.length >= 2) {
                this.detectedPartials = peaks;
                const inharm = this.calculateInharmonicity(peaks);
                this.inharmonicityB = inharm.B;
                this.rSquared = inharm.rSquared;
                this.stringWear = inharm.stringWear;
                this.wearSeverity = inharm.wearSeverity;
                return inharm;
            }
        }
        return null;
    }

    /**
     * Simulates an acoustic guitar string pluck with controlled inharmonicity B.
     * Generates physical partial frequencies and harmonic spectrum for testing.
     * 
     * @param {number} fundFreq - Fundamental frequency (Hz), e.g. 82.41 for Low E
     * @param {number} inharmonicityB - String stiffness coefficient (e.g. 0.00035)
     * @param {number} duration - Pluck duration in seconds
     */
    simulatePluck(fundFreq, inharmonicityB = 0.00035, duration = 2.0) {
        const sr = this.sampleRate || 44100;
        const numSamples = Math.floor(sr * Math.min(3.0, duration));
        const buffer = new Float32Array(numSamples);

        // Generate first 6 stiff string partials: fn = n * f0 * sqrt(1 + B * n^2)
        const partialAmps = [1.0, 0.75, 0.50, 0.35, 0.20, 0.10];
        const partialDecays = [1.2, 1.8, 2.4, 3.2, 4.0, 5.0];

        for (let n = 1; n <= 6; n++) {
            const fn = n * fundFreq * Math.sqrt(1 + inharmonicityB * n * n);
            const amp = partialAmps[n - 1] || 0.1;
            const decay = partialDecays[n - 1] || 3.0;

            for (let i = 0; i < numSamples; i++) {
                const t = i / sr;
                const env = Math.exp(-t * decay);
                buffer[i] += amp * env * Math.sin(2 * Math.PI * fn * t);
            }
        }

        // Normalize
        let maxVal = 0;
        for (let i = 0; i < numSamples; i++) {
            if (Math.abs(buffer[i]) > maxVal) maxVal = Math.abs(buffer[i]);
        }
        if (maxVal > 0) {
            for (let i = 0; i < numSamples; i++) {
                buffer[i] = (buffer[i] / maxVal) * 0.85;
            }
        }

        // Inject into analyser if audioContext is active
        if (this.audioCtx && this.analyser) {
            const audioBuf = this.audioCtx.createBuffer(1, numSamples, sr);
            audioBuf.copyToChannel(buffer, 0);
            const src = this.audioCtx.createBufferSource();
            src.buffer = audioBuf;
            src.connect(this.analyser);
            src.start();
        }

        // Also update local buffers directly
        if (this.timeDomainBuffer) {
            const copyLen = Math.min(this.timeDomainBuffer.length, buffer.length);
            for (let i = 0; i < copyLen; i++) {
                this.timeDomainBuffer[i] = buffer[i];
            }
        }

        return buffer;
    }

    // ========================================================================
    // 6. CANVAS RENDERING & VIRTUAL STROBE VISUALIZER
    // ========================================================================

    /**
     * Renders the complete Virtual Strobe Disc, Neon Ticks, Inharmonicity Gauge,
     * and Precision Digital Readout on HTML5 Canvas.
     */
    render() {
        if (!this.ctx || !this.canvas) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

        ctx.save();
        ctx.clearRect(0, 0, width, height);

        // Center coordinates and radius
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.46;

        // 1. Draw outer metallic bezel & background chassis
        this.drawBezel(ctx, cx, cy, radius);

        // 2. Draw Dual Concentric Strobe Rings
        // Outer Ring: Fundamental strobe band
        const rOuterMax = radius * 0.92;
        const rOuterMin = radius * 0.68;
        this.drawStrobeBand(ctx, cx, cy, rOuterMin, rOuterMax, this.outerSpokes, this.outerAngle, '#00f3ff', '#0a1628');

        // Ring Separator
        ctx.beginPath();
        ctx.arc(cx, cy, rOuterMin, 0, Math.PI * 2);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        // Inner Ring: 2nd Harmonic strobe band
        const rInnerMax = radius * 0.67;
        const rInnerMin = radius * 0.44;
        this.drawStrobeBand(ctx, cx, cy, rInnerMin, rInnerMax, this.innerSpokes, this.innerAngle, '#10b981', '#06201b');

        // 3. Draw Stationary Strobe Stator Pointers (Top & Bottom 12 o'clock / 6 o'clock)
        this.drawStatorIndices(ctx, cx, cy, radius, rOuterMax, rInnerMin);

        // 4. Draw Center Digital HUD Hub
        const rHub = radius * 0.42;
        this.drawCenterHub(ctx, cx, cy, rHub, dpr);

        ctx.restore();
    }

    /**
     * Draws brushed metallic housing bezel, degree ticks, and neon glow.
     */
    drawBezel(ctx, cx, cy, radius) {
        // Outer glow
        const inTune = this.hasSignal && Math.abs(this.cents) <= 0.5;
        const glowColor = !this.hasSignal 
            ? 'rgba(30, 41, 59, 0.4)' 
            : inTune 
                ? 'rgba(16, 185, 129, 0.45)' 
                : Math.abs(this.cents) <= 3 
                    ? 'rgba(0, 243, 255, 0.35)' 
                    : this.cents > 0 
                        ? 'rgba(245, 158, 11, 0.35)' 
                        : 'rgba(59, 130, 246, 0.35)';

        const bgGrad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
        bgGrad.addColorStop(0, '#0a0d14');
        bgGrad.addColorStop(0.85, '#0f172a');
        bgGrad.addColorStop(1, '#1e293b');

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = bgGrad;
        ctx.fill();

        // Bezel rim
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 4;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = inTune ? 16 : 8;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset

        // Precision tick marks around perimeter
        const numTicks = 60;
        for (let i = 0; i < numTicks; i++) {
            const angle = (i * Math.PI * 2) / numTicks;
            const isMajor = i % 5 === 0;
            const tickLen = isMajor ? radius * 0.05 : radius * 0.025;
            const r1 = radius * 0.94;
            const r2 = r1 - tickLen;

            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
            ctx.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
            ctx.strokeStyle = isMajor ? '#64748b' : '#334155';
            ctx.lineWidth = isMajor ? 1.5 : 1;
            ctx.stroke();
        }
    }

    /**
     * Draws an alternating strobe disc ring with spoke segments.
     */
    drawStrobeBand(ctx, cx, cy, rMin, rMax, spokes, rotationAngle, neonColor, darkColor) {
        const step = (Math.PI * 2) / spokes;
        const halfStep = step / 2;

        for (let i = 0; i < spokes; i++) {
            const aStart = rotationAngle + i * step;
            const aEnd = aStart + halfStep;

            // Light teeth (spoke)
            ctx.beginPath();
            ctx.arc(cx, cy, rMax, aStart, aEnd, false);
            ctx.arc(cx, cy, rMin, aEnd, aStart, true);
            ctx.closePath();
            ctx.fillStyle = neonColor;
            ctx.fill();

            // Dark teeth (gap)
            ctx.beginPath();
            ctx.arc(cx, cy, rMax, aEnd, aStart + step, false);
            ctx.arc(cx, cy, rMin, aStart + step, aEnd, true);
            ctx.closePath();
            ctx.fillStyle = darkColor;
            ctx.fill();
        }
    }

    /**
     * Draws top and bottom alignment reference stator pointers (12 and 6 o'clock).
     */
    drawStatorIndices(ctx, cx, cy, radius, rOuterMax, rInnerMin) {
        const topY = cy - rOuterMax;
        const bottomY = cy + rOuterMax;

        ctx.save();
        // Top stator indicator arrow pointing downward at 12 o'clock
        ctx.fillStyle = '#f8fafc';
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 8;

        ctx.beginPath();
        ctx.moveTo(cx, topY + 4);
        ctx.lineTo(cx - 7, topY - 10);
        ctx.lineTo(cx + 7, topY - 10);
        ctx.closePath();
        ctx.fill();

        // Bottom stator arrow pointing upward at 6 o'clock
        ctx.beginPath();
        ctx.moveTo(cx, bottomY - 4);
        ctx.lineTo(cx - 7, bottomY + 10);
        ctx.lineTo(cx + 7, bottomY + 10);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    /**
     * Draws the center digital HUD hub displaying Note Name, Cents, Frequency, and Inharmonicity.
     */
    drawCenterHub(ctx, cx, cy, rHub, dpr) {
        // Dark metallic center circle
        const hubGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rHub);
        hubGrad.addColorStop(0, '#0a0d14');
        hubGrad.addColorStop(0.85, '#111827');
        hubGrad.addColorStop(1, '#1f2937');

        ctx.beginPath();
        ctx.arc(cx, cy, rHub, 0, Math.PI * 2);
        ctx.fillStyle = hubGrad;
        ctx.fill();
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 1. Target String Label & Tuning Name
        const stringName = this.currentTuning.namesByString[this.activeString] || 'E';
        const strNumText = this.targetStringIndex === 0 
            ? `AUTO • STR ${this.activeString} (${stringName})` 
            : `STR ${this.activeString} (${stringName})`;

        ctx.font = `600 ${Math.max(10, Math.round(11 * dpr))}px 'Inter', sans-serif`;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(strNumText, cx, cy - rHub * 0.65);

        // 2. Large Note Badge
        const noteText = this.hasSignal 
            ? this.currentTuning.notes[6 - this.activeString] || `${stringName}2`
            : '--';

        const inTune = this.hasSignal && Math.abs(this.cents) <= 0.5;
        const noteColor = !this.hasSignal 
            ? '#475569' 
            : inTune 
                ? '#10b981' 
                : Math.abs(this.cents) <= 3 
                    ? '#00f3ff' 
                    : this.cents > 0 
                        ? '#f59e0b' 
                        : '#38bdf8';

        ctx.font = `900 ${Math.max(22, Math.round(28 * dpr))}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = noteColor;
        ctx.shadowColor = inTune ? 'rgba(16, 185, 129, 0.6)' : 'transparent';
        ctx.shadowBlur = inTune ? 12 : 0;
        ctx.fillText(noteText, cx, cy - rHub * 0.22);
        ctx.shadowBlur = 0;

        // 3. Precision Cents Readout (0.1 Cent precision)
        let centsStr = '0.0 ¢';
        let statusStr = 'IDLE';

        if (this.hasSignal) {
            const roundedCents = Math.round(this.cents * 10) / 10;
            const sign = roundedCents > 0 ? '+' : '';
            centsStr = `${sign}${roundedCents.toFixed(1)} ¢`;
            
            if (Math.abs(this.cents) <= 0.5) {
                statusStr = 'IN TUNE';
            } else if (this.cents > 0) {
                statusStr = 'SHARP ▶';
            } else {
                statusStr = '◀ FLAT';
            }
        }

        ctx.font = `700 ${Math.max(14, Math.round(16 * dpr))}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = noteColor;
        ctx.fillText(centsStr, cx, cy + rHub * 0.16);

        // 4. Frequency & Inharmonicity Summary Line
        ctx.font = `500 ${Math.max(9, Math.round(10 * dpr))}px 'JetBrains Mono', monospace`;
        if (this.hasSignal) {
            ctx.fillStyle = '#cbd5e1';
            const freqText = `${this.detectedFreq.toFixed(1)}Hz (tgt ${this.targetFreq.toFixed(1)}Hz)`;
            ctx.fillText(freqText, cx, cy + rHub * 0.44);

            // B factor & Wear badge
            ctx.font = `600 ${Math.max(8, Math.round(9 * dpr))}px 'Inter', sans-serif`;
            const bScientific = (this.inharmonicityB * 1000).toFixed(2);
            const wearColor = this.stringWear === 'Fresh' ? '#10b981' : this.stringWear === 'Good' ? '#00f3ff' : this.stringWear === 'Aged' ? '#f59e0b' : '#ef4444';
            ctx.fillStyle = wearColor;
            ctx.fillText(`B: ${bScientific}×10⁻³ • ${this.stringWear}`, cx, cy + rHub * 0.70);
        } else {
            ctx.fillStyle = '#64748b';
            ctx.fillText(`${this.currentTuning.name} Preset`, cx, cy + rHub * 0.45);
            ctx.fillText('Listening for pluck...', cx, cy + rHub * 0.68);
        }
    }

    /**
     * Cleans up all animation loops and event listeners.
     */
    destroy() {
        this.stop();
        this.canvas = null;
        this.ctx = null;
        this.audioCtx = null;
        this.analyser = null;
    }
}

// ============================================================================
// 7. EXPORT DECLARATIONS (ESM, CommonJS, and Browser Global)
// ============================================================================

// Browser Global
if (typeof window !== 'undefined') {
    window.StrobeTuner = StrobeTuner;
    window.TUNING_PRESETS = TUNING_PRESETS;
}

// CommonJS (for Node unit testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        StrobeTuner,
        TUNING_PRESETS,
        midiToFreq,
        getCentsDeviation
    };
    module.exports.default = StrobeTuner;
}
