/**
 * FretDSP Music Transcription & Audio Slow-Downer Engine (Phase 4)
 * File: js/transcriber.js
 * 
 * 100% Client-Side Pure Web Audio & Float32Array DSP:
 * 1. WSOLA (Waveform Similarity Overlap-Add) Time-Stretching Engine
 *    - Variable speed from 25% to 150% with 100% pitch preservation.
 *    - Normalized Cross-Correlation (NCC) alignment offset search preventing
 *      phase cancellation, comb filtering, and transient smearing.
 * 2. Pitch Transposition / Pitch Shift Engine
 *    - Independent pitch shifting (±12 semitones, fine-tuned in cents)
 *      without affecting playback duration.
 *    - High-fidelity C1-smooth Cubic Hermite Resampling.
 * 3. Mid/Side Center Channel Extraction (Solo Isolator)
 *    - Orthonormal Mid/Side matrixing (M = (L+R)/sqrt(2), S = (L-R)/sqrt(2)).
 *    - Algebraic matrix inversion guarantee (T * T = I, reconstruction error < 1e-7).
 *    - "Solo Focus" mode: isolates centered mono lead guitar and suppresses stereo noise.
 *    - "Backing Track / Lead Mute" mode: phase-cancels centered lead guitar for play-along practice,
 *      with optional zero-phase bass preservation.
 * 4. FretDSP Pipe & Auto-Tab Integration
 *    - Direct offline batch piping into GuitarDSP's pitch detector (js/dsp.js)
 *      for fast, automated guitar tablature transcription.
 *    - Real-time Web Audio graph routing to GuitarDSP analyser and speakers.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./dsp.js'], factory);
    } else if (typeof module === 'object' && module.exports) {
        let GuitarDSP = null;
        try {
            GuitarDSP = require('./dsp.js');
        } catch (e) {
            // Optional in test environments if not strictly required upfront
        }
        module.exports = factory(GuitarDSP);
    } else {
        root.MusicTranscriber = factory(root.GuitarDSP);
        root.FretTranscriber = root.MusicTranscriber;
    }
}(typeof self !== 'undefined' ? self : this, function (GuitarDSP) {
    'use strict';

    const SQRT2 = Math.SQRT2;
    const INV_SQRT2 = 1.0 / Math.SQRT2; // 1 / sqrt(2) ~ 0.70710678

    /**
     * Standard Preset Tempo Ratios
     */
    const TEMPO_PRESETS = Object.freeze({
        SLOW_25: 0.25,     // 25% speed (quarter speed, 4x duration)
        HALF_50: 0.50,     // 50% speed (half speed, 2x duration)
        PRACTICE_75: 0.75, // 75% speed (practice tempo, 1.33x duration)
        NORMAL_100: 1.00,  // 100% speed (original tempo)
        FAST_125: 1.25,    // 125% speed (1.25x speed, 0.8x duration)
        SHRED_150: 1.50    // 150% speed (1.5x speed, 0.67x duration)
    });

    /**
     * Common Guitar Tuning Semitone Offsets
     */
    const TUNING_PRESETS = Object.freeze({
        STANDARD_E: 0,
        HALF_STEP_DOWN_EB: -1, // Eb Ab Db Gb Bb Eb
        WHOLE_STEP_DOWN_D: -2, // D G C F A D
        DROP_D: 0,
        CAPO_1: 1,
        CAPO_2: 2,
        OCTAVE_UP: 12,
        OCTAVE_DOWN: -12
    });

    /**
     * Mid/Side Processing Modes
     */
    const MID_SIDE_MODES = Object.freeze({
        STEREO: 'stereo',
        SOLO_FOCUS: 'solo_focus',
        LEAD_MUTE: 'lead_mute'
    });

    /**
     * Main MusicTranscriber Class
     */
    class MusicTranscriber {
        /**
         * @param {Object} options
         * @param {number} [options.sampleRate=44100] Audio sample rate in Hz
         * @param {number} [options.tempo=1.0] Playback speed factor (0.25 to 1.50)
         * @param {number} [options.semitones=0] Pitch transposition (-12 to +12 semitones)
         * @param {number} [options.cents=0] Fine pitch tuning (-100 to +100 cents)
         * @param {string} [options.midSideMode='stereo'] 'stereo', 'solo_focus', or 'lead_mute'
         * @param {number} [options.focusAmount=1.0] Center extraction focus intensity (0.0 to 1.0)
         * @param {number} [options.muteAmount=1.0] Center cancellation intensity (0.0 to 1.0)
         * @param {boolean} [options.preserveBass=false] Retain bass <150Hz in lead mute mode
         * @param {number} [options.bassCrossoverFreq=150] Bass retention crossover in Hz
         * @param {number} [options.windowSize=2048] WSOLA analysis window size
         * @param {number} [options.hopSize=512] WSOLA synthesis hop size (default windowSize / 4)
         * @param {number} [options.searchRange=512] WSOLA correlation search range in samples
         * @param {AudioContext} [options.audioCtx=null] Web Audio context
         */
        constructor(options = {}) {
            this.sampleRate = options.sampleRate || 44100;
            this.tempo = options.tempo !== undefined ? options.tempo : 1.0;
            this.semitones = options.semitones || 0;
            this.cents = options.cents || 0;
            this.midSideMode = options.midSideMode || MID_SIDE_MODES.STEREO;
            this.focusAmount = options.focusAmount !== undefined ? options.focusAmount : 1.0;
            this.muteAmount = options.muteAmount !== undefined ? options.muteAmount : 1.0;
            this.preserveBass = options.preserveBass || false;
            this.bassCrossoverFreq = options.bassCrossoverFreq || 150;

            this.windowSize = options.windowSize || 2048;
            this.hopSize = options.hopSize || Math.floor(this.windowSize / 4);
            this.searchRange = options.searchRange || Math.floor(this.windowSize / 4);

            this.audioCtx = options.audioCtx || null;
            this.currentSourceNode = null;
            this.currentGainNode = null;
            this.isPlaying = false;
            this.playbackStartTime = 0;
            this.playbackPauseOffset = 0;
            this.lastProcessedResult = null;
        }

        // =========================================================================
        // SECTION 1: Mid/Side Matrixing & Center Channel Isolation
        // =========================================================================

        /**
         * Encodes stereo (L, R) into Mid/Side (M, S) representation.
         * Formula:
         *   M = (L + R) / sqrt(2)
         *   S = (L - R) / sqrt(2)
         * 
         * Preserves total acoustic power: M^2 + S^2 = L^2 + R^2.
         * 
         * @param {Float32Array} left - Left channel audio
         * @param {Float32Array} right - Right channel audio
         * @returns {{ mid: Float32Array, side: Float32Array }}
         */
        static encodeMidSide(left, right) {
            if (!left || !right) {
                throw new Error("Both left and right audio channels are required for Mid/Side encoding.");
            }
            const length = Math.min(left.length, right.length);
            const mid = new Float32Array(length);
            const side = new Float32Array(length);

            for (let i = 0; i < length; i++) {
                const l = left[i];
                const r = right[i];
                mid[i] = (l + r) * INV_SQRT2;
                side[i] = (l - r) * INV_SQRT2;
            }

            return { mid, side };
        }

        /**
         * Decodes Mid/Side (M, S) representation back into stereo (L, R).
         * Formula:
         *   L = (M + S) / sqrt(2)
         *   R = (M - S) / sqrt(2)
         * 
         * Notice that the inverse transformation matrix is identical to the forward matrix:
         *   T = T^(-1) = T^T (symmetric orthonormal matrix).
         * 
         * @param {Float32Array} mid - Mid (sum) channel audio
         * @param {Float32Array} side - Side (difference) channel audio
         * @returns {{ left: Float32Array, right: Float32Array }}
         */
        static decodeMidSide(mid, side) {
            if (!mid || !side) {
                throw new Error("Both mid and side audio channels are required for Mid/Side decoding.");
            }
            const length = Math.min(mid.length, side.length);
            const left = new Float32Array(length);
            const right = new Float32Array(length);

            for (let i = 0; i < length; i++) {
                const m = mid[i];
                const s = side[i];
                left[i] = (m + s) * INV_SQRT2;
                right[i] = (m - s) * INV_SQRT2;
            }

            return { left, right };
        }

        /**
         * Zero-phase bi-directional IIR low-pass filter (forward & backward pass).
         * Ensures zero phase shift and delay, preventing comb filtering when recombining bands.
         * 
         * @param {Float32Array} input - Input signal
         * @param {number} cutoffFreq - Cutoff frequency in Hz
         * @param {number} sampleRate - Sample rate in Hz
         * @returns {Float32Array}
         */
        static zeroPhaseLowpass(input, cutoffFreq, sampleRate) {
            const length = input.length;
            if (length === 0) return new Float32Array(0);

            const wc = 2.0 * Math.PI * cutoffFreq / sampleRate;
            const alpha = 1.0 - Math.exp(-wc);

            // Forward pass
            const forward = new Float32Array(length);
            let prev = input[0];
            for (let i = 0; i < length; i++) {
                prev += alpha * (input[i] - prev);
                forward[i] = prev;
            }

            // Backward pass (reverses phase distortion)
            const output = new Float32Array(length);
            prev = forward[length - 1];
            for (let i = length - 1; i >= 0; i--) {
                prev += alpha * (forward[i] - prev);
                output[i] = prev;
            }

            return output;
        }

        /**
         * Isolates or attenuates the centered mono channel using Mid/Side matrixing.
         * 
         * Modes:
         * 1. 'solo_focus': Enhances centered mono image (where guitar solos and vocals reside)
         *    while suppressing stereo panning noise and hard-panned rhythm guitars.
         * 2. 'lead_mute' (Backing Track mode): Phase-cancels centered audio to create an
         *    instant play-along backing track.
         *    Supports optional 'preserveBass' to retain bass <150Hz.
         * 3. 'stereo': Passes through unaltered or applies custom midGain/sideGain.
         * 
         * @param {Float32Array} left - Input left channel
         * @param {Float32Array} right - Input right channel
         * @param {string} [mode='solo_focus'] - 'solo_focus', 'lead_mute', or 'stereo'
         * @param {Object} [options={}]
         * @param {number} [options.focusAmount=1.0] 0.0 (wide stereo) to 1.0 (pure mono center)
         * @param {number} [options.muteAmount=1.0] 0.0 (unmuted) to 1.0 (full center cancellation)
         * @param {boolean} [options.preserveBass=false] Retain bass below crossover frequency
         * @param {number} [options.bassCrossoverFreq=150] Bass retention crossover in Hz
         * @param {number} [options.sampleRate=44100] Audio sample rate
         * @returns {{ left: Float32Array, right: Float32Array, mid: Float32Array, side: Float32Array }}
         */
        static isolateCenter(left, right, mode = MID_SIDE_MODES.SOLO_FOCUS, options = {}) {
            const { mid, side } = MusicTranscriber.encodeMidSide(left, right);
            const length = mid.length;

            const processedMid = new Float32Array(length);
            const processedSide = new Float32Array(length);

            const focusAmount = options.focusAmount !== undefined ? options.focusAmount : 1.0;
            const muteAmount = options.muteAmount !== undefined ? options.muteAmount : 1.0;
            const preserveBass = options.preserveBass || false;
            const bassCrossoverFreq = options.bassCrossoverFreq || 150;
            const sampleRate = options.sampleRate || 44100;

            const normalizedMode = (mode || '').toLowerCase();

            if (normalizedMode === MID_SIDE_MODES.SOLO_FOCUS || normalizedMode === 'solo') {
                // SOLO FOCUS: Enhance Mid, attenuate Side
                // At focusAmount = 1.0: Side gain = 0.0 -> Perfect mono center isolation
                const sideGain = Math.max(0.0, 1.0 - focusAmount);
                const midGain = options.midGain !== undefined ? options.midGain : 1.0;

                for (let i = 0; i < length; i++) {
                    processedMid[i] = mid[i] * midGain;
                    processedSide[i] = side[i] * sideGain;
                }
            } else if (normalizedMode === MID_SIDE_MODES.LEAD_MUTE || normalizedMode === 'backing') {
                // LEAD MUTE / BACKING TRACK: Phase-cancel Mid, preserve Side
                // At muteAmount = 1.0: Mid gain = 0.0 -> Perfect center cancellation
                const midGain = Math.max(0.0, 1.0 - muteAmount);
                const sideGain = options.sideGain !== undefined ? options.sideGain : 1.0;

                if (preserveBass && bassCrossoverFreq > 20) {
                    // Extract bass below crossover with zero-phase filter
                    const midBass = MusicTranscriber.zeroPhaseLowpass(mid, bassCrossoverFreq, sampleRate);
                    for (let i = 0; i < length; i++) {
                        const midHigh = mid[i] - midBass[i];
                        processedMid[i] = midBass[i] + (midHigh * midGain);
                        processedSide[i] = side[i] * sideGain;
                    }
                } else {
                    for (let i = 0; i < length; i++) {
                        processedMid[i] = mid[i] * midGain;
                        processedSide[i] = side[i] * sideGain;
                    }
                }
            } else {
                // STEREO / BYPASS / CUSTOM
                const midGain = options.midGain !== undefined ? options.midGain : 1.0;
                const sideGain = options.sideGain !== undefined ? options.sideGain : 1.0;

                for (let i = 0; i < length; i++) {
                    processedMid[i] = mid[i] * midGain;
                    processedSide[i] = side[i] * sideGain;
                }
            }

            const decoded = MusicTranscriber.decodeMidSide(processedMid, processedSide);
            return {
                left: decoded.left,
                right: decoded.right,
                mid: processedMid,
                side: processedSide
            };
        }

        // =========================================================================
        // SECTION 2: WSOLA Time-Stretching Engine
        // =========================================================================

        /**
         * Generates a periodic Hann (Hanning) window of length N.
         * w[j] = 0.5 * (1 - cos(2 * pi * j / N))
         * 
         * @param {number} N - Window size
         * @returns {Float32Array}
         */
        static createHannWindow(N) {
            const w = new Float32Array(N);
            const factor = (2.0 * Math.PI) / N;
            for (let j = 0; j < N; j++) {
                w[j] = 0.5 * (1.0 - Math.cos(factor * j));
            }
            return w;
        }

        /**
         * Computes Normalized Cross-Correlation (NCC) between two signal segments:
         * 
         *              sum( ref[j] * cand[j] )
         *   NCC = ---------------------------------
         *         sqrt( sum(ref[j]^2) * sum(cand[j]^2) )
         * 
         * Returns value in [-1.0, 1.0]. A value of +1.0 indicates perfect waveform alignment.
         * 
         * @param {Float32Array} ref - Reference signal buffer
         * @param {number} refOffset - Start offset in reference buffer
         * @param {Float32Array} cand - Candidate signal buffer
         * @param {number} candOffset - Start offset in candidate buffer
         * @param {number} length - Correlation window length
         * @returns {number}
         */
        static computeNormalizedCrossCorrelation(ref, refOffset, cand, candOffset, length) {
            let crossSum = 0.0;
            let refEnergy = 0.0;
            let candEnergy = 0.0;

            for (let j = 0; j < length; j++) {
                const r = ref[refOffset + j];
                const c = cand[candOffset + j];
                crossSum += r * c;
                refEnergy += r * r;
                candEnergy += c * c;
            }

            const denom = Math.sqrt(refEnergy * candEnergy);
            if (denom < 1e-12) return 0.0;
            return crossSum / denom;
        }

        /**
         * Searches for optimal alignment offset Delta* around nominal target position
         * to maximize waveform similarity with the natural continuation of the prior frame.
         * 
         * Uses fast sliding energy update for candidate energy to eliminate redundant multiplications.
         * 
         * @param {Float32Array} monoAudio - Mono audio buffer
         * @param {number} refPos - Start index of reference continuation template
         * @param {number} nominalTarget - Nominal analysis target index (k * Ha)
         * @param {number} searchRange - Maximum search delta (± searchRange)
         * @param {number} templateLength - Cross-correlation segment length L
         * @returns {{ bestOffset: number, maxCorrelation: number }}
         */
        static findOptimalOffset(monoAudio, refPos, nominalTarget, searchRange, templateLength) {
            const inLen = monoAudio.length;

            // Bounds check for reference template
            if (refPos < 0 || refPos + templateLength > inLen) {
                return { bestOffset: 0, maxCorrelation: 1.0 };
            }

            // Calculate constant reference energy
            let refEnergy = 0.0;
            for (let j = 0; j < templateLength; j++) {
                const s = monoAudio[refPos + j];
                refEnergy += s * s;
            }

            // Silence check
            if (refEnergy < 1e-10) {
                return { bestOffset: 0, maxCorrelation: 0.0 };
            }

            // Constrain search range within buffer limits
            const minDelta = Math.max(-searchRange, -nominalTarget);
            const maxDelta = Math.min(searchRange, inLen - templateLength - nominalTarget);

            if (minDelta > maxDelta) {
                return { bestOffset: 0, maxCorrelation: 1.0 };
            }

            let bestOffset = 0;
            let maxCorrelation = -Infinity;

            // Initial candidate energy at minDelta
            let candStart = nominalTarget + minDelta;
            let candEnergy = 0.0;
            for (let j = 0; j < templateLength; j++) {
                const s = monoAudio[candStart + j];
                candEnergy += s * s;
            }

            for (let delta = minDelta; delta <= maxDelta; delta++) {
                candStart = nominalTarget + delta;

                if (delta > minDelta) {
                    // Fast O(1) sliding energy update:
                    // subtract departed sample, add newly entered sample
                    const leftSample = monoAudio[candStart - 1];
                    const rightSample = monoAudio[candStart + templateLength - 1];
                    candEnergy = candEnergy - (leftSample * leftSample) + (rightSample * rightSample);
                    if (candEnergy < 0) candEnergy = 0;
                }

                if (candEnergy > 1e-10) {
                    // Compute cross-correlation
                    let cross = 0.0;
                    for (let j = 0; j < templateLength; j++) {
                        cross += monoAudio[refPos + j] * monoAudio[candStart + j];
                    }

                    const denom = Math.sqrt(refEnergy * candEnergy);
                    const ncc = denom > 1e-12 ? (cross / denom) : 0.0;

                    if (ncc > maxCorrelation) {
                        maxCorrelation = ncc;
                        bestOffset = delta;
                        // Early break if near-perfect correlation found
                        if (ncc > 0.9999) break;
                    }
                }
            }

            return {
                bestOffset: maxCorrelation > -Infinity ? bestOffset : 0,
                maxCorrelation: maxCorrelation > -Infinity ? maxCorrelation : 0.0
            };
        }

        /**
         * WSOLA (Waveform Similarity Overlap-Add) Time-Stretching.
         * 
         * Stretches or compresses audio duration by tempo factor:
         *   duration_out = duration_in / tempo
         *   - tempo = 0.50 -> 2x duration (half speed)
         *   - tempo = 0.75 -> 1.33x duration (75% speed)
         *   - tempo = 1.00 -> 1x duration (unaltered)
         *   - tempo = 1.50 -> 0.67x duration (1.5x speed)
         * 
         * Pitch is 100% preserved.
         * Stereo phase is 100% coherent (alignment offsets computed once from mono sum).
         * 
         * @param {Object|Float32Array|Array<Float32Array>} audio - Stereo channels { left, right } or mono Float32Array
         * @param {number} tempo - Speed ratio (0.25 to 1.50)
         * @param {Object} [options={}]
         * @param {number} [options.windowSize=2048] Analysis window length
         * @param {number} [options.hopSize=512] Synthesis hop size (default windowSize / 4)
         * @param {number} [options.searchRange=512] Search offset range Delta_max
         * @param {number} [options.templateLength=1024] NCC template length L (default windowSize / 2)
         * @returns {{ left: Float32Array, right: Float32Array, mono: Float32Array }}
         */
        static timeStretch(audio, tempo, options = {}) {
            if (tempo < 0.20 || tempo > 3.0) {
                console.warn(`Tempo ${tempo} is outside typical range [0.25, 1.50]. Clamping for stability.`);
                tempo = Math.max(0.20, Math.min(3.0, tempo));
            }

            // Normalize audio channels
            let leftIn, rightIn;
            if (audio instanceof Float32Array) {
                leftIn = audio;
                rightIn = audio;
            } else if (Array.isArray(audio)) {
                leftIn = audio[0];
                rightIn = audio[1] || audio[0];
            } else if (audio && audio.left) {
                leftIn = audio.left;
                rightIn = audio.right || audio.left;
            } else {
                throw new Error("Invalid audio input provided to timeStretch.");
            }

            const inLen = leftIn.length;
            if (inLen === 0) {
                return {
                    left: new Float32Array(0),
                    right: new Float32Array(0),
                    mono: new Float32Array(0)
                };
            }

            // If tempo is 1.0 within floating point tolerance, return clean clone
            if (Math.abs(tempo - 1.0) < 1e-5 && !options.forceWsola) {
                const leftCopy = new Float32Array(leftIn);
                const rightCopy = new Float32Array(rightIn);
                const monoCopy = new Float32Array(inLen);
                for (let i = 0; i < inLen; i++) {
                    monoCopy[i] = 0.5 * (leftCopy[i] + rightCopy[i]);
                }
                return { left: leftCopy, right: rightCopy, mono: monoCopy };
            }

            const N = options.windowSize || 2048;
            const Hs = options.hopSize || Math.floor(N / 4);
            const Ha = Math.max(1, Math.round(Hs * tempo));
            const deltaMax = options.searchRange || Math.floor(N / 4);
            const L = options.templateLength || Math.floor(N / 2);

            const outLen = Math.round(inLen / tempo);
            const window = MusicTranscriber.createHannWindow(N);

            // Create mono reference mix for inter-channel phase-coherent alignment
            const monoIn = new Float32Array(inLen);
            for (let i = 0; i < inLen; i++) {
                monoIn[i] = 0.5 * (leftIn[i] + rightIn[i]);
            }

            const leftOut = new Float32Array(outLen);
            const rightOut = new Float32Array(outLen);
            const weights = new Float32Array(outLen);

            // Step 1: Synthesize initial frame (k = 0) at start of track
            let prevTau = 0;
            const initLen = Math.min(N, inLen, outLen);
            for (let j = 0; j < initLen; j++) {
                const w = window[j];
                leftOut[j] += w * leftIn[j];
                rightOut[j] += w * rightIn[j];
                weights[j] += w;
            }

            // Step 2: Overlap-Add synthesis loop
            let k = 1;
            let m = Hs;

            while (m < outLen) {
                const nominalTau = Math.round(k * Ha);
                const refTau = prevTau + Hs;

                // Optimal offset search via Normalized Cross-Correlation
                const { bestOffset } = MusicTranscriber.findOptimalOffset(
                    monoIn,
                    refTau,
                    nominalTau,
                    deltaMax,
                    L
                );

                const chosenTau = Math.max(0, Math.min(inLen - N, nominalTau + bestOffset));

                // Overlap-add windowed slices to synthesis buffer
                for (let j = 0; j < N; j++) {
                    const outIdx = m + j;
                    if (outIdx >= outLen) break;

                    const inIdx = chosenTau + j;
                    if (inIdx < inLen) {
                        const w = window[j];
                        leftOut[outIdx] += w * leftIn[inIdx];
                        rightOut[outIdx] += w * rightIn[inIdx];
                        weights[outIdx] += w;
                    }
                }

                prevTau = chosenTau;
                k++;
                m = k * Hs;
            }

            // Step 3: Constant overlap-add envelope normalization
            const monoOut = new Float32Array(outLen);
            for (let i = 0; i < outLen; i++) {
                const w = weights[i];
                if (w > 1e-4) {
                    leftOut[i] /= w;
                    rightOut[i] /= w;
                }
                monoOut[i] = 0.5 * (leftOut[i] + rightOut[i]);
            }

            return { left: leftOut, right: rightOut, mono: monoOut };
        }

        // =========================================================================
        // SECTION 3: Resampling & Independent Pitch Transposition Engine
        // =========================================================================

        /**
         * Converts semitones and fine cents to pitch frequency multiplier ratio.
         * Formula:
         *   P = 2^( (semitones + cents/100) / 12 )
         * 
         * @param {number} semitones - Transposition semitones (e.g. -12 to +12)
         * @param {number} [cents=0] - Fine tuning cents (-100 to +100)
         * @returns {number}
         */
        static semitonesToRatio(semitones, cents = 0) {
            const totalSemitones = semitones + (cents / 100.0);
            return Math.pow(2.0, totalSemitones / 12.0);
        }

        /**
         * Converts frequency ratio back to total semitones.
         * 
         * @param {number} ratio - Frequency multiplier ratio
         * @returns {number}
         */
        static ratioToSemitones(ratio) {
            if (ratio <= 0) return 0;
            return 12.0 * Math.log2(ratio);
        }

        /**
         * High-quality C1-smooth Cubic Hermite (Catmull-Rom) interpolation.
         * Reconstructs continuous waveforms with continuous 1st derivative,
         * suppressing high-frequency imaging and aliasing far superior to linear interpolation.
         * 
         * @param {Float32Array} buffer - Sample array
         * @param {number} pos - Continuous fractional sample index
         * @returns {number}
         */
        static cubicHermite(buffer, pos) {
            const len = buffer.length;
            const i = Math.floor(pos);
            const f = pos - i;

            const y0 = i > 0 ? buffer[i - 1] : buffer[0];
            const y1 = i < len ? buffer[i] : buffer[len - 1];
            const y2 = i + 1 < len ? buffer[i + 1] : buffer[len - 1];
            const y3 = i + 2 < len ? buffer[i + 2] : buffer[len - 1];

            const c0 = y1;
            const c1 = 0.5 * (y2 - y0);
            const c2 = y0 - (2.5 * y1) + (2.0 * y2) - (0.5 * y3);
            const c3 = (0.5 * (y3 - y0)) + (1.5 * (y1 - y2));

            return (((c3 * f + c2) * f + c1) * f) + c0;
        }

        /**
         * Resamples an audio buffer by a pitch/speed ratio using Cubic Hermite interpolation.
         * When ratio > 1.0: Pitch increases, duration shortens by 1 / ratio.
         * When ratio < 1.0: Pitch decreases, duration lengthens by 1 / ratio.
         * 
         * @param {Float32Array} channel - Audio channel buffer
         * @param {number} ratio - Resample ratio
         * @returns {Float32Array}
         */
        static resample(channel, ratio) {
            if (Math.abs(ratio - 1.0) < 1e-6) {
                return new Float32Array(channel);
            }

            const inLen = channel.length;
            const outLen = Math.max(1, Math.round(inLen / ratio));
            const out = new Float32Array(outLen);

            for (let m = 0; m < outLen; m++) {
                out[m] = MusicTranscriber.cubicHermite(channel, m * ratio);
            }

            return out;
        }

        /**
         * Pitch shifts audio by semitones and cents INDEPENDENTLY of playback tempo.
         * Duration is 100% preserved.
         * 
         * Mathematical duality:
         * 1. WSOLA time-stretch by factor 1 / P (lengthening duration by P).
         * 2. Resample by factor P (shortening duration by 1 / P and scaling frequency by P).
         * 
         * Net duration ratio: P * (1 / P) = 1.00 (identical duration).
         * Net pitch factor: P = 2^(semitones / 12).
         * 
         * @param {Object|Float32Array} audio - Audio channels or mono buffer
         * @param {number} semitones - Transposition semitones (±12)
         * @param {number} [cents=0] - Fine tuning cents (±100)
         * @param {Object} [options={}] - WSOLA options
         * @returns {{ left: Float32Array, right: Float32Array, mono: Float32Array }}
         */
        static pitchShift(audio, semitones, cents = 0, options = {}) {
            const pitchRatio = MusicTranscriber.semitonesToRatio(semitones, cents);

            // Identity check
            if (Math.abs(pitchRatio - 1.0) < 1e-5) {
                let left, right;
                if (audio instanceof Float32Array) {
                    left = audio; right = audio;
                } else {
                    left = audio.left; right = audio.right || audio.left;
                }
                const l = new Float32Array(left);
                const r = new Float32Array(right);
                const m = new Float32Array(left.length);
                for (let i = 0; i < left.length; i++) m[i] = 0.5 * (l[i] + r[i]);
                return { left: l, right: r, mono: m };
            }

            // WSOLA intermediate stretch
            const wsolaTempo = 1.0 / pitchRatio;
            const stretched = MusicTranscriber.timeStretch(audio, wsolaTempo, options);

            // Resample back to original duration
            const resampledLeft = MusicTranscriber.resample(stretched.left, pitchRatio);
            const resampledRight = MusicTranscriber.resample(stretched.right, pitchRatio);
            const resampledMono = new Float32Array(resampledLeft.length);

            for (let i = 0; i < resampledLeft.length; i++) {
                resampledMono[i] = 0.5 * (resampledLeft[i] + resampledRight[i]);
            }

            return {
                left: resampledLeft,
                right: resampledRight,
                mono: resampledMono
            };
        }

        // =========================================================================
        // SECTION 4: Unified Processing Pipeline
        // =========================================================================

        /**
         * Unified master processing method combining:
         * 1. Mid/Side Center Channel Extraction (Solo Focus / Lead Mute / Stereo)
         * 2. WSOLA Time-Stretching (25% to 150%)
         * 3. Independent Pitch Transposition (±12 semitones, cents)
         * 
         * Performs WSOLA and pitch shift in a single consolidated pass:
         *   effective_wsola_tempo = target_tempo / pitch_ratio
         * This eliminates redundant stretching passes and maximizes DSP performance.
         * 
         * @param {Object|Float32Array|Array<Float32Array>} inputAudio
         * @param {Object} [options={}]
         * @returns {{ left: Float32Array, right: Float32Array, mono: Float32Array, sampleRate: number, duration: number, tempo: number, semitones: number, cents: number, midSideMode: string, toAudioBuffer: Function }}
         */
        static process(inputAudio, options = {}) {
            const sampleRate = options.sampleRate || 44100;
            const tempo = options.tempo !== undefined ? options.tempo : 1.0;
            const semitones = options.semitones || 0;
            const cents = options.cents || 0;
            const midSideMode = options.midSideMode || MID_SIDE_MODES.STEREO;

            // Normalize input channels
            let leftIn, rightIn;
            if (inputAudio instanceof Float32Array) {
                leftIn = inputAudio;
                rightIn = inputAudio;
            } else if (Array.isArray(inputAudio)) {
                leftIn = inputAudio[0];
                rightIn = inputAudio[1] || inputAudio[0];
            } else if (inputAudio && typeof inputAudio.getChannelData === 'function') {
                // Native Web Audio AudioBuffer
                leftIn = inputAudio.getChannelData(0);
                rightIn = inputAudio.numberOfChannels > 1 ? inputAudio.getChannelData(1) : inputAudio.getChannelData(0);
            } else if (inputAudio && inputAudio.left) {
                leftIn = inputAudio.left;
                rightIn = inputAudio.right || inputAudio.left;
            } else {
                throw new Error("Unsupported audio format passed to MusicTranscriber.process");
            }

            // Step 1: Mid/Side Center Channel Isolation
            let isolatedLeft = leftIn;
            let isolatedRight = rightIn;

            if (midSideMode !== MID_SIDE_MODES.STEREO || options.focusAmount !== undefined || options.muteAmount !== undefined) {
                const isolated = MusicTranscriber.isolateCenter(leftIn, rightIn, midSideMode, {
                    focusAmount: options.focusAmount,
                    muteAmount: options.muteAmount,
                    preserveBass: options.preserveBass,
                    bassCrossoverFreq: options.bassCrossoverFreq,
                    sampleRate: sampleRate,
                    midGain: options.midGain,
                    sideGain: options.sideGain
                });
                isolatedLeft = isolated.left;
                isolatedRight = isolated.right;
            }

            // Step 2: Consolidated WSOLA & Pitch Shift
            const pitchRatio = MusicTranscriber.semitonesToRatio(semitones, cents);
            const needsPitchShift = Math.abs(pitchRatio - 1.0) >= 1e-5;
            const needsTimeStretch = Math.abs(tempo - 1.0) >= 1e-5;

            let finalLeft, finalRight, finalMono;

            if (!needsPitchShift && !needsTimeStretch) {
                // Direct pass-through
                finalLeft = new Float32Array(isolatedLeft);
                finalRight = new Float32Array(isolatedRight);
                finalMono = new Float32Array(isolatedLeft.length);
                for (let i = 0; i < isolatedLeft.length; i++) {
                    finalMono[i] = 0.5 * (finalLeft[i] + finalRight[i]);
                }
            } else {
                // Optimal single-pass formula:
                // WSOLA tempo = target_tempo / pitch_ratio
                // Then resample by pitch_ratio.
                const effectiveWsolaTempo = tempo / pitchRatio;
                const stretched = MusicTranscriber.timeStretch(
                    { left: isolatedLeft, right: isolatedRight },
                    effectiveWsolaTempo,
                    options
                );

                if (needsPitchShift) {
                    finalLeft = MusicTranscriber.resample(stretched.left, pitchRatio);
                    finalRight = MusicTranscriber.resample(stretched.right, pitchRatio);
                } else {
                    finalLeft = stretched.left;
                    finalRight = stretched.right;
                }

                finalMono = new Float32Array(finalLeft.length);
                for (let i = 0; i < finalLeft.length; i++) {
                    finalMono[i] = 0.5 * (finalLeft[i] + finalRight[i]);
                }
            }

            const duration = finalLeft.length / sampleRate;

            return {
                left: finalLeft,
                right: finalRight,
                mono: finalMono,
                sampleRate: sampleRate,
                duration: duration,
                tempo: tempo,
                semitones: semitones,
                cents: cents,
                midSideMode: midSideMode,
                toAudioBuffer: (ctx) => {
                    const audioContext = ctx || (typeof AudioContext !== 'undefined' ? new AudioContext() : null);
                    if (!audioContext) {
                        throw new Error("No AudioContext available to create AudioBuffer.");
                    }
                    const buffer = audioContext.createBuffer(2, finalLeft.length, sampleRate);
                    buffer.copyToChannel(finalLeft, 0);
                    buffer.copyToChannel(finalRight, 1);
                    return buffer;
                }
            };
        }

        /**
         * Instance process method using instance settings.
         * 
         * @param {Object|Float32Array} inputAudio
         * @returns {Object}
         */
        processAudio(inputAudio) {
            const result = MusicTranscriber.process(inputAudio, {
                sampleRate: this.sampleRate,
                tempo: this.tempo,
                semitones: this.semitones,
                cents: this.cents,
                midSideMode: this.midSideMode,
                focusAmount: this.focusAmount,
                muteAmount: this.muteAmount,
                preserveBass: this.preserveBass,
                bassCrossoverFreq: this.bassCrossoverFreq,
                windowSize: this.windowSize,
                hopSize: this.hopSize,
                searchRange: this.searchRange
            });
            this.lastProcessedResult = result;
            return result;
        }

        // =========================================================================
        // SECTION 5: Piping to FretDSP (js/dsp.js) for Auto-Tab Transcription
        // =========================================================================

        /**
         * Batch-transcribes processed slowed guitar audio directly through FretDSP's pitch detector.
         * 
         * Slices audio into overlapping frames and feeds them sequentially to
         * guitarDSP.analyzeFrame(frame, currentTime), recording plucks and detected pitches.
         * 
         * @param {Object} guitarDSP - Instance of GuitarDSP (from js/dsp.js)
         * @param {Object|Float32Array} [audioInput=null] - Audio to transcribe (defaults to lastProcessedResult)
         * @param {Object} [options={}]
         * @param {number} [options.frameSize=2048] Frame buffer size
         * @param {number} [options.hopSize=512] Hop size between frames
         * @param {Function} [options.onProgress=null] Progress callback (pct, note)
         * @returns {{ notes: Array, events: Array, totalDuration: number, framesAnalyzed: number }}
         */
        transcribeBuffer(guitarDSP, audioInput = null, options = {}) {
            if (!guitarDSP) {
                throw new Error("A valid GuitarDSP instance must be provided to transcribeBuffer.");
            }

            let audio = audioInput || this.lastProcessedResult;
            if (!audio) {
                throw new Error("No processed audio available for transcription. Run processAudio first.");
            }

            // Extract mono channel for pitch detection
            let mono;
            if (audio instanceof Float32Array) {
                mono = audio;
            } else if (audio.mono) {
                mono = audio.mono;
            } else if (audio.left && audio.right) {
                mono = new Float32Array(audio.left.length);
                for (let i = 0; i < audio.left.length; i++) {
                    mono[i] = 0.5 * (audio.left[i] + audio.right[i]);
                }
            } else if (audio.left) {
                mono = audio.left;
            } else {
                throw new Error("Could not extract mono audio channel for transcription.");
            }

            const sampleRate = options.sampleRate || audio.sampleRate || this.sampleRate || 44100;
            const frameSize = options.frameSize || guitarDSP.bufferSize || 2048;
            const hopSize = options.hopSize || Math.floor(frameSize / 4);

            const events = [];
            const notes = [];
            let currentNote = null;

            // Preserve existing GuitarDSP callbacks
            const origOnPitch = guitarDSP.onPitchDetected;
            const origOnPluck = guitarDSP.onPluck;
            const origOnNoteOff = guitarDSP.onNoteOff;

            guitarDSP.onPitchDetected = (payload) => {
                events.push({ ...payload });
                if (origOnPitch) origOnPitch(payload);

                if (payload.isPluck) {
                    if (currentNote) {
                        currentNote.endTime = payload.time;
                        currentNote.duration = Math.max(0.02, currentNote.endTime - currentNote.startTime);
                        notes.push(currentNote);
                    }
                    currentNote = {
                        midi: payload.midi,
                        midiExact: payload.midiExact,
                        noteName: payload.noteName,
                        octave: payload.octave,
                        cents: payload.cents,
                        frequency: payload.frequency,
                        confidence: payload.confidence,
                        rms: payload.rms,
                        startTime: payload.time,
                        endTime: payload.time + 0.1,
                        duration: 0.1
                    };
                } else if (currentNote && currentNote.midi === payload.midi) {
                    currentNote.endTime = payload.time;
                    currentNote.duration = Math.max(0.02, currentNote.endTime - currentNote.startTime);
                }
            };

            guitarDSP.onPluck = (payload) => {
                if (origOnPluck) origOnPluck(payload);
            };

            guitarDSP.onNoteOff = (payload) => {
                if (currentNote) {
                    currentNote.endTime = payload ? payload.time : (currentNote.startTime + currentNote.duration);
                    currentNote.duration = Math.max(0.02, currentNote.endTime - currentNote.startTime);
                    notes.push(currentNote);
                    currentNote = null;
                }
                if (origOnNoteOff) origOnNoteOff(payload);
            };

            const totalSamples = mono.length;
            let framesAnalyzed = 0;
            const frameBuffer = new Float32Array(frameSize);

            // Sequential analysis loop
            for (let offset = 0; offset + frameSize <= totalSamples; offset += hopSize) {
                for (let j = 0; j < frameSize; j++) {
                    frameBuffer[j] = mono[offset + j];
                }
                const simulatedCurrentTime = offset / sampleRate;

                // Call public GuitarDSP method
                guitarDSP.analyzeFrame(frameBuffer, simulatedCurrentTime);
                framesAnalyzed++;

                if (options.onProgress && (framesAnalyzed % 50 === 0)) {
                    options.onProgress(offset / totalSamples, currentNote);
                }
            }

            // Close last note if active
            if (currentNote) {
                currentNote.endTime = totalSamples / sampleRate;
                currentNote.duration = Math.max(0.02, currentNote.endTime - currentNote.startTime);
                notes.push(currentNote);
                currentNote = null;
            }

            // Restore callbacks
            guitarDSP.onPitchDetected = origOnPitch;
            guitarDSP.onPluck = origOnPluck;
            guitarDSP.onNoteOff = origOnNoteOff;

            return {
                notes: notes,
                events: events,
                totalDuration: totalSamples / sampleRate,
                framesAnalyzed: framesAnalyzed
            };
        }

        /**
         * Routes the slowed/processed audio in real time into FretDSP's Web Audio graph.
         * Connects to guitarDSP.analyser for live visualizer and tuner tracking,
         * and to destination speakers so the guitarist can listen while transcribing.
         * 
         * @param {Object} guitarDSP - Instance of GuitarDSP
         * @param {Object} [processedAudio=null] - Audio object or lastProcessedResult
         * @param {Object} [options={}]
         * @returns {Object} Playback controller { play, pause, stop, isPlaying }
         */
        pipeToGuitarDSP(guitarDSP, processedAudio = null, options = {}) {
            if (!guitarDSP || !guitarDSP.audioCtx) {
                throw new Error("GuitarDSP with active audioCtx is required for real-time piping.");
            }

            const ctx = guitarDSP.audioCtx;
            const audio = processedAudio || this.lastProcessedResult;
            if (!audio) {
                throw new Error("No processed audio to pipe. Run processAudio first.");
            }

            // Stop any ongoing playback
            this.stopPlayback();

            const audioBuffer = audio.toAudioBuffer ? audio.toAudioBuffer(ctx) : ctx.createBuffer(2, audio.left.length, audio.sampleRate || ctx.sampleRate);
            if (!audio.toAudioBuffer) {
                audioBuffer.copyToChannel(audio.left, 0);
                audioBuffer.copyToChannel(audio.right, 1);
            }

            const sourceNode = ctx.createBufferSource();
            sourceNode.buffer = audioBuffer;

            const gainNode = ctx.createGain();
            gainNode.gain.value = options.gain !== undefined ? options.gain : 0.85;

            // Route 1: Connect to guitarDSP AnalyserNode (triggers pitch tracking)
            if (guitarDSP.analyser) {
                sourceNode.connect(guitarDSP.analyser);
            }

            // Route 2: Connect to Master Output speakers
            sourceNode.connect(gainNode);
            gainNode.connect(ctx.destination);

            this.currentSourceNode = sourceNode;
            this.currentGainNode = gainNode;
            this.isPlaying = true;

            sourceNode.onended = () => {
                this.isPlaying = false;
                if (options.onEnded) options.onEnded();
            };

            const startPlayback = (timeOffset = 0) => {
                sourceNode.start(0, timeOffset);
                this.playbackStartTime = ctx.currentTime - timeOffset;
            };

            const stopPlayback = () => {
                try {
                    sourceNode.stop();
                    sourceNode.disconnect();
                } catch (e) {}
                this.isPlaying = false;
            };

            return {
                sourceNode: sourceNode,
                gainNode: gainNode,
                start: startPlayback,
                stop: stopPlayback,
                isPlaying: () => this.isPlaying
            };
        }

        /**
         * Stops active Web Audio playback.
         */
        stopPlayback() {
            if (this.currentSourceNode) {
                try {
                    this.currentSourceNode.stop();
                    this.currentSourceNode.disconnect();
                } catch (e) {}
                this.currentSourceNode = null;
            }
            if (this.currentGainNode) {
                try {
                    this.currentGainNode.disconnect();
                } catch (e) {}
                this.currentGainNode = null;
            }
            this.isPlaying = false;
        }

        // =========================================================================
        // SECTION 6: File & AudioBuffer Utilities
        // =========================================================================

        /**
         * Decodes an ArrayBuffer (e.g. from File or fetch) using Web Audio API decodeAudioData.
         * 
         * @param {ArrayBuffer} arrayBuffer
         * @param {AudioContext} [audioCtx=null]
         * @returns {Promise<AudioBuffer>}
         */
        static async decodeAudioData(arrayBuffer, audioCtx = null) {
            const ctx = audioCtx || (typeof AudioContext !== 'undefined' ? new AudioContext() : null);
            if (!ctx) {
                throw new Error("Web Audio API AudioContext not available for decoding audio data.");
            }
            return await ctx.decodeAudioData(arrayBuffer);
        }

        /**
         * Extracts Float32Array stereo channels from a Web Audio AudioBuffer.
         * 
         * @param {AudioBuffer} audioBuffer
         * @returns {{ left: Float32Array, right: Float32Array, sampleRate: number, duration: number }}
         */
        static audioBufferToChannels(audioBuffer) {
            const left = audioBuffer.getChannelData(0);
            const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
            return {
                left: new Float32Array(left),
                right: new Float32Array(right),
                sampleRate: audioBuffer.sampleRate,
                duration: audioBuffer.duration
            };
        }
    }

    // Attach static presets to class definition
    MusicTranscriber.TEMPO_PRESETS = TEMPO_PRESETS;
    MusicTranscriber.TUNING_PRESETS = TUNING_PRESETS;
    MusicTranscriber.MID_SIDE_MODES = MID_SIDE_MODES;

    return MusicTranscriber;
}));
