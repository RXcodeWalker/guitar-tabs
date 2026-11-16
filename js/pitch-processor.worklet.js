/**
 * FretDSP Pitch Detection AudioWorkletProcessor
 * File: js/pitch-processor.worklet.js
 * 
 * Offloads microphone pitch detection and analysis pipeline off the main
 * browser UI thread into a dedicated AudioWorklet render thread with zero
 * main-thread audio glitching.
 * 
 * Implements:
 * - Circular buffer management for 2048 / 4096 sample frames
 * - Signal RMS amplitude & peak measurement
 * - Autocorrelation pitch estimation with parabolic peak refinement (derivative zero-crossing)
 * - Parabolic waveform zero-crossing pitch estimation
 * - Sub-sample mathematical frequency resolution across the guitar register
 * - ~60 Hz MessagePort posting to main thread
 */

// Safe base class allowing PitchProcessor to execute seamlessly in both
// AudioWorkletGlobalScope and Node.js automated test environments
const AudioWorkletProcessorBase = (typeof AudioWorkletProcessor !== 'undefined')
    ? AudioWorkletProcessor
    : class MockAudioWorkletProcessor {
        constructor() {
            const processorPort = {
                onmessage: null,
                _nodePort: null,
                postMessage(msg) {
                    if (this._nodePort && typeof this._nodePort.onmessage === 'function') {
                        this._nodePort.onmessage({ data: msg });
                    }
                    if (typeof this._onmessage === 'function') {
                        this._onmessage({ data: msg });
                    }
                    if (typeof this.onmessageout === 'function') {
                        this.onmessageout({ data: msg });
                    }
                }
            };
            const nodePort = {
                onmessage: null,
                postMessage(msg) {
                    if (processorPort && typeof processorPort.onmessage === 'function') {
                        processorPort.onmessage({ data: msg });
                    }
                }
            };
            processorPort._nodePort = nodePort;
            this.port = processorPort;
            this.nodePort = nodePort;
        }
    };

class PitchProcessor extends AudioWorkletProcessorBase {
    constructor(options = {}) {
        super(options);
        const procOpts = (options && options.processorOptions) || {};

        this.sampleRate = procOpts.sampleRate || (typeof sampleRate !== 'undefined' ? sampleRate : 44100);
        this.bufferSize = procOpts.bufferSize || 2048;
        this.minFreq = procOpts.minFreq || 70.0;     // Below Low D (73.4 Hz)
        this.maxFreq = procOpts.maxFreq || 1350.0;   // Above 22nd fret High E (1318 Hz)
        this.noiseGate = procOpts.noiseGate !== undefined ? procOpts.noiseGate : 0.008;
        this.algorithm = procOpts.algorithm || 'autocorrelation';

        // Circular buffer allocation
        this.circularBuffer = new Float32Array(this.bufferSize);
        this.analysisBuffer = new Float32Array(this.bufferSize);
        this.writeIndex = 0;
        this.totalSamples = 0;

        // Rate-limiting to ~60 Hz: hopSize samples between consecutive message posts
        // For 44100 Hz, hopSize = 735 samples (44100 / 60 = 735, exactly 60.0 Hz)
        // For 48000 Hz, hopSize = 800 samples (48000 / 60 = 800, exactly 60.0 Hz)
        this.targetRateHz = procOpts.targetRateHz || 60;
        this.hopSize = procOpts.hopSize || Math.round(this.sampleRate / this.targetRateHz);
        this.samplesSinceLastAnalysis = 0;

        // Support runtime parameter reconfiguration from main thread via MessagePort
        if (this.port) {
            this.port.onmessage = (event) => {
                const data = event.data;
                if (!data) return;
                if (data.type === 'config') {
                    if (data.minFreq !== undefined) this.minFreq = data.minFreq;
                    if (data.maxFreq !== undefined) this.maxFreq = data.maxFreq;
                    if (data.noiseGate !== undefined) this.noiseGate = data.noiseGate;
                    if (data.algorithm !== undefined) this.algorithm = data.algorithm;
                    if (data.targetRateHz !== undefined) {
                        this.targetRateHz = data.targetRateHz;
                        this.hopSize = Math.round(this.sampleRate / this.targetRateHz);
                    }
                } else if (data.type === 'reset') {
                    this.reset();
                }
            };
        }
    }

    /**
     * Resets circular buffer state and sample counters.
     */
    reset() {
        this.circularBuffer.fill(0);
        this.analysisBuffer.fill(0);
        this.writeIndex = 0;
        this.totalSamples = 0;
        this.samplesSinceLastAnalysis = 0;
    }

    /**
     * Web Audio render quantum processing loop (called every 128 audio frames).
     */
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0] || input[0].length === 0) {
            return true;
        }

        const channelData = input[0];
        const numSamples = channelData.length;

        // Push incoming samples into circular buffer
        for (let i = 0; i < numSamples; i++) {
            this.circularBuffer[this.writeIndex] = channelData[i];
            this.writeIndex = (this.writeIndex + 1) % this.bufferSize;
        }

        this.totalSamples += numSamples;
        this.samplesSinceLastAnalysis += numSamples;

        // Trigger pitch estimation & message posting at ~60 Hz
        if (this.samplesSinceLastAnalysis >= this.hopSize) {
            this.samplesSinceLastAnalysis -= this.hopSize;
            this.analyzeAndPost();
        }

        // Return true to keep processor alive in audio graph
        return true;
    }

    /**
     * Unrolls circular buffer into a linear analysis buffer in strict chronological order.
     * @returns {Float32Array} Chronologically ordered audio samples
     */
    unrollBuffer() {
        const tail = this.bufferSize - this.writeIndex;
        this.analysisBuffer.set(this.circularBuffer.subarray(this.writeIndex, this.bufferSize), 0);
        this.analysisBuffer.set(this.circularBuffer.subarray(0, this.writeIndex), tail);
        return this.analysisBuffer;
    }

    /**
     * Computes signal RMS energy and peak amplitude.
     * @param {Float32Array} buffer 
     * @returns {{ rms: number, peakSample: number }}
     */
    calculateRMS(buffer) {
        let sumSq = 0;
        let peakSample = 0;
        const len = buffer.length;
        for (let i = 0; i < len; i++) {
            const abs = Math.abs(buffer[i]);
            if (abs > peakSample) peakSample = abs;
            sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / len);
        return { rms, peakSample };
    }

    /**
     * Normalized autocorrelation pitch detection with parabolic peak refinement.
     * The parabolic interpolation around the correlation peak mathematically corresponds
     * to the exact zero-crossing of the continuous correlation derivative (d/dtau = 0).
     * 
     * @param {Float32Array} buffer - Audio samples
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {{ frequency: number, f0: number, confidence: number, period: number }|null}
     */
    detectPitchAutocorrelation(buffer, sampleRate = this.sampleRate) {
        if (!buffer || buffer.length === 0) return null;

        const minPeriod = Math.floor(sampleRate / this.maxFreq);
        const maxPeriod = Math.floor(sampleRate / this.minFreq);

        if (maxPeriod >= buffer.length) return null;

        const W = buffer.length - maxPeriod;

        // Zero-lag energy of reference window
        let energy0 = 0;
        for (let i = 0; i < W; i++) {
            energy0 += buffer[i] * buffer[i];
        }
        if (energy0 < 1e-9) {
            return { frequency: 0, f0: 0, confidence: 0, period: 0 };
        }

        const corrs = new Float32Array(maxPeriod + 2);
        let maxCorr = -Infinity;

        // Calculate normalized autocorrelation across valid guitar lag range
        for (let lag = minPeriod; lag <= maxPeriod; lag++) {
            let corr = 0;
            let energyLag = 0;
            for (let i = 0; i < W; i++) {
                const a = buffer[i];
                const b = buffer[i + lag];
                corr += a * b;
                energyLag += b * b;
            }
            const denom = Math.sqrt(energy0 * energyLag);
            const normCorr = denom > 1e-9 ? corr / denom : 0;
            corrs[lag] = normCorr;
            if (normCorr > maxCorr) {
                maxCorr = normCorr;
            }
        }

        if (maxCorr < 0.45) {
            return { frequency: 0, f0: 0, confidence: Math.max(0, maxCorr), period: 0 };
        }

        // Find all local peaks in the correlation function
        const peaks = [];
        for (let lag = minPeriod + 1; lag < maxPeriod; lag++) {
            if (corrs[lag] > corrs[lag - 1] && corrs[lag] >= corrs[lag + 1]) {
                peaks.push(lag);
            }
        }

        if (peaks.length === 0) {
            return { frequency: 0, f0: 0, confidence: Math.max(0, maxCorr), period: 0 };
        }

        // To prevent octave subharmonic errors (pitch halving), pick the FIRST prominent
        // peak whose correlation is within 88% of maxCorr (or above threshold)
        const threshold = Math.max(0.55, maxCorr * 0.88);
        const chosenLag = peaks.find(lag => corrs[lag] >= threshold) || peaks[0];

        // Parabolic peak interpolation (derivative zero-crossing) for sub-sample accuracy:
        // Fits parabola y(x) = a*x^2 + b*x + c over {-1, 0, +1} around chosenLag
        // Finding dy/dx = 2*a*x + b = 0 yields delta = -b / (2*a) = (cMinus - cPlus) / (2*(cMinus - 2*c0 + cPlus))
        let refinedPeriod = chosenLag;
        const cMinus = corrs[chosenLag - 1];
        const c0 = corrs[chosenLag];
        const cPlus = corrs[chosenLag + 1];

        const denom = 2 * (cMinus - 2 * c0 + cPlus);
        if (Math.abs(denom) > 1e-9) {
            const delta = (cMinus - cPlus) / denom;
            refinedPeriod = chosenLag + Math.max(-0.5, Math.min(0.5, delta));
        }

        const frequency = sampleRate / refinedPeriod;
        return {
            frequency: frequency,
            f0: frequency,
            confidence: Math.max(0, Math.min(1, maxCorr)),
            period: refinedPeriod
        };
    }

    /**
     * Parabolic waveform zero-crossing pitch estimation.
     * Computes exact sub-sample zero-crossing locations using 3-point parabolic root finding.
     * 
     * @param {Float32Array} buffer - Audio samples
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {{ frequency: number, f0: number, confidence: number, period: number }|null}
     */
    detectPitchZeroCrossing(buffer, sampleRate = this.sampleRate) {
        if (!buffer || buffer.length < 4) return null;

        const crossings = [];
        const len = buffer.length - 1;

        for (let i = 1; i < len; i++) {
            // Positive-going zero crossing: buffer[i] <= 0 and buffer[i + 1] > 0
            if (buffer[i] <= 0 && buffer[i + 1] > 0) {
                const ym1 = buffer[i - 1];
                const y0 = buffer[i];
                const y1 = buffer[i + 1];

                // Quadratic fit: y(x) = a*x^2 + b*x + c with x in [-1, 1] relative to i
                const a = 0.5 * (ym1 - 2 * y0 + y1);
                const b = 0.5 * (y1 - ym1);
                const c = y0;

                let t = 0;
                if (Math.abs(a) > 1e-7) {
                    const disc = b * b - 4 * a * c;
                    if (disc >= 0) {
                        const r1 = (-b + Math.sqrt(disc)) / (2 * a);
                        const r2 = (-b - Math.sqrt(disc)) / (2 * a);
                        t = (r1 >= 0 && r1 <= 1) ? r1 : ((r2 >= 0 && r2 <= 1) ? r2 : -c / b);
                    } else {
                        t = -c / b;
                    }
                } else if (Math.abs(b) > 1e-7) {
                    t = -c / b;
                }
                t = Math.max(0, Math.min(1, t));
                crossings.push(i + t);
            }
        }

        if (crossings.length < 2) {
            return { frequency: 0, f0: 0, confidence: 0, period: 0 };
        }

        const intervals = [];
        for (let j = 1; j < crossings.length; j++) {
            intervals.push(crossings[j] - crossings[j - 1]);
        }

        // Median period interval to reject transient harmonics
        const sorted = [...intervals].sort((a, b) => a - b);
        const medianPeriod = sorted[Math.floor(sorted.length / 2)];

        if (medianPeriod <= 0) {
            return { frequency: 0, f0: 0, confidence: 0, period: 0 };
        }

        const frequency = sampleRate / medianPeriod;
        return {
            frequency: frequency,
            f0: frequency,
            confidence: 0.95,
            period: medianPeriod
        };
    }

    /**
     * Pitch detection dispatcher.
     * @param {Float32Array} buffer
     * @param {number} sampleRate
     * @param {string} algorithm - 'autocorrelation' | 'zero-crossing'
     */
    detectPitch(buffer, sampleRate = this.sampleRate, algorithm = this.algorithm) {
        if (algorithm === 'zero-crossing') {
            return this.detectPitchZeroCrossing(buffer, sampleRate);
        }
        return this.detectPitchAutocorrelation(buffer, sampleRate);
    }

    /**
     * Extracts pitch & metrics from buffer and posts result to main thread MessagePort.
     */
    analyzeAndPost() {
        const buffer = this.unrollBuffer();
        const { rms, peakSample } = this.calculateRMS(buffer);
        const currentTime = this.totalSamples / this.sampleRate;

        // Silence / Noise gate check
        if (rms < this.noiseGate) {
            this.port.postMessage({
                type: 'pitch',
                f0: 0,
                frequency: 0,
                rms: rms,
                peakSample: peakSample,
                confidence: 0,
                isSilence: true,
                time: currentTime
            });
            return;
        }

        // Run pitch detection
        const pitchResult = this.detectPitch(buffer, this.sampleRate, this.algorithm);
        const f0 = pitchResult ? pitchResult.frequency : 0;
        const confidence = pitchResult ? pitchResult.confidence : 0;

        this.port.postMessage({
            type: 'pitch',
            f0: f0,
            frequency: f0,
            rms: rms,
            peakSample: peakSample,
            confidence: confidence,
            isSilence: false,
            time: currentTime
        });
    }
}

// Register processor in Web Audio AudioWorkletGlobalScope
if (typeof registerProcessor !== 'undefined') {
    registerProcessor('pitch-processor', PitchProcessor);
}

// CommonJS export for Node.js automated unit testing
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PitchProcessor;
    module.exports.PitchProcessor = PitchProcessor;
}
