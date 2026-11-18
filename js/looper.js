/**
 * FretDSP — Multi-Track Sound-on-Sound Phrase Looper Pedal Engine
 * 
 * Standalone Web Audio phrase looper pedal allowing guitarists to record layered loops,
 * overdub harmonies, undo mistakes, and apply vintage tape effects (reverse and half-speed).
 * 
 * Core Architectural Modules:
 * 1. Circular Buffer Engine & Loop Operations:
 *    - Standard states: EMPTY, RECORDING, PLAYING, OVERDUBBING, STOPPED.
 *    - Seamless equal-power crossfading (10ms) across the loop seam to prevent audio clicks/pops.
 *    - Dual-Track Architecture: Track 1 (base rhythm loop) and Track 2 (synchronized lead/counterpoint).
 *    - Single-level Non-Destructive Undo/Redo for the most recent overdub layer.
 * 2. Creative Tape FX & Speed Controls:
 *    - Reverse: Buffer time-reversal on playback without interrupting loop length or timing.
 *    - Half-Speed / Octave Down: Resamples playback by 2x for basslines and vintage tape textures.
 * 3. Quantization & Metronome Sync:
 *    - Optional autoQuantize mode: snaps loop start/end points to the nearest musical measure
 *      or beat based on the active BPM and time signature.
 * 4. High-Fidelity WAV Export:
 *    - Combines active loops into an uncompressed stereo 16-bit 44.1kHz WAV Blob.
 * 5. Headless & Web Audio Routing:
 *    - Accepts an audio node source (from mic or effects output) and outputs a mix node to destination.
 *    - Built-in MockAudioContext for headless Node.js verification and zero-dependency unit tests.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        const exports = factory();
        root.PhraseLooper = exports.PhraseLooper;
        root.LooperEngine = exports.LooperEngine;
        root.LooperTrack = exports.LooperTrack;
        root.LOOPER_STATES = exports.LOOPER_STATES;
        root.createLooper = exports.createLooper;
        root.equalPowerCrossfade = exports.equalPowerCrossfade;
        root.calculatePanGains = exports.calculatePanGains;
        root.quantizeSamples = exports.quantizeSamples;
        root.encodeWav = exports.encodeWav;
        root.MockAudioContext = exports.MockAudioContext;
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // =========================================================================
    // 1. CONSTANTS & ENUMS
    // =========================================================================

    /**
     * Standard Looper Pedal Operating States
     */
    const LOOPER_STATES = Object.freeze({
        EMPTY: 'EMPTY',             // No audio recorded in track
        RECORDING: 'RECORDING',     // Initial loop capture setting loop length
        PLAYING: 'PLAYING',         // Circular playback of recorded audio
        OVERDUBBING: 'OVERDUBBING', // Sound-on-sound layering onto active loop
        STOPPED: 'STOPPED'          // Loop preserved in memory but paused
    });

    const DEFAULT_SAMPLE_RATE = 44100;
    const DEFAULT_FADE_DURATION = 0.010; // 10 milliseconds
    const DEFAULT_MAX_DURATION = 300;   // 5 minutes maximum loop capacity

    // =========================================================================
    // 2. MATHEMATICAL & DSP UTILITIES
    // =========================================================================

    /**
     * Applies equal-power crossfading (10ms default) across the loop seam.
     * Prevents transient audio clicks and pops caused by step discontinuities when wrapping.
     * 
     * Invariant: gainIn^2 + gainOut^2 = sin^2(theta) + cos^2(theta) = 1.0
     * 
     * @param {Float32Array} buffer - Audio channel data
     * @param {number} length - Active loop length in samples
     * @param {number} sampleRate - Audio context sample rate (e.g. 44100)
     * @param {number} fadeDurationSec - Crossfade duration in seconds (default 0.010s)
     * @returns {Float32Array} - The crossfaded buffer
     */
    function equalPowerCrossfade(buffer, length, sampleRate = DEFAULT_SAMPLE_RATE, fadeDurationSec = DEFAULT_FADE_DURATION) {
        if (!buffer || length <= 0 || fadeDurationSec <= 0) return buffer;
        const targetFadeSamples = Math.round(fadeDurationSec * sampleRate);
        // Only apply crossfade if loop length is large enough to contain the seam window
        if (length < targetFadeSamples * 2) {
            return buffer;
        }
        const fadeSamples = targetFadeSamples;

        // Equal-power crossfade across seam:
        // Tail (length - fadeSamples ... length - 1) smoothly blends with Head (0 ... fadeSamples - 1)
        for (let i = 0; i < fadeSamples; i++) {
            const theta = (Math.PI / 2) * (i / fadeSamples);
            const gainOut = Math.cos(theta); // 1.0 -> 0.0
            const gainIn = Math.sin(theta);  // 0.0 -> 1.0

            const headIdx = i;
            const tailIdx = length - fadeSamples + i;

            const headVal = buffer[headIdx];
            const tailVal = buffer[tailIdx];

            // Blend with equal-power preservation
            const blended = gainIn * headVal + gainOut * tailVal;
            buffer[headIdx] = blended;
            buffer[tailIdx] = blended;
        }

        return buffer;
    }

    /**
     * Computes constant-power stereo panning gains.
     * Panning law: Left^2 + Right^2 = 1.0 (no perceived drop in acoustic power).
     * 
     * @param {number} pan - Panning position (-1.0 full Left, 0.0 Center, +1.0 full Right)
     * @returns {{ left: number, right: number }}
     */
    function calculatePanGains(pan) {
        const clampedPan = Math.max(-1.0, Math.min(1.0, Number.isFinite(pan) ? pan : 0));
        // Normalized 0.0 (Left) to 1.0 (Right)
        const norm = (clampedPan + 1.0) * 0.5;
        const theta = norm * (Math.PI * 0.5);
        return {
            left: Math.cos(theta),
            right: Math.sin(theta)
        };
    }

    /**
     * Quantizes loop sample length to nearest musical beat or measure based on active BPM.
     * 
     * @param {number} rawSamples - Number of recorded samples
     * @param {number} sampleRate - Audio context sample rate
     * @param {number} bpm - Active tempo in beats per minute
     * @param {number} beatsPerBar - Time signature numerator (e.g. 4 for 4/4)
     * @param {string} mode - 'bar' or 'beat'
     * @returns {{ targetSamples: number, rawSamples: number, beats: number, bars: number, samplesPerBeat: number, samplesPerBar: number }}
     */
    function quantizeSamples(rawSamples, sampleRate = DEFAULT_SAMPLE_RATE, bpm = 120, beatsPerBar = 4, mode = 'bar') {
        const safeBpm = Math.max(20, Math.min(320, bpm || 120));
        const safeBeatsPerBar = Math.max(1, beatsPerBar || 4);
        const beatDurationSec = 60.0 / safeBpm;
        const samplesPerBeat = Math.round(beatDurationSec * sampleRate);
        const samplesPerBar = samplesPerBeat * safeBeatsPerBar;

        let targetSamples;
        let beats;
        let bars;

        if (mode === 'beat') {
            beats = Math.max(1, Math.round(rawSamples / samplesPerBeat));
            targetSamples = beats * samplesPerBeat;
            bars = beats / safeBeatsPerBar;
        } else {
            // Default to 'bar' (measure) snapping
            bars = Math.max(1, Math.round(rawSamples / samplesPerBar));
            targetSamples = bars * samplesPerBar;
            beats = bars * safeBeatsPerBar;
        }

        return {
            rawSamples,
            targetSamples,
            beats,
            bars,
            samplesPerBeat,
            samplesPerBar,
            bpm: safeBpm,
            beatsPerBar: safeBeatsPerBar,
            mode
        };
    }

    /**
     * Encodes stereo Float32 audio channel arrays into an uncompressed stereo 16-bit 44.1kHz WAV container.
     * Compatible with browser Blob and Node.js environments.
     * 
     * @param {Float32Array} leftChannel - Left channel samples
     * @param {Float32Array} rightChannel - Right channel samples
     * @param {number} sampleRate - Sample rate (e.g. 44100)
     * @returns {Blob|Object} - WAV Blob with .buffer and .arrayBuffer() attachments
     */
    function encodeWav(leftChannel, rightChannel, sampleRate = 44100) {
        const numFrames = leftChannel.length;
        const numChannels = 2;
        const bitsPerSample = 16;
        const bytesPerSample = bitsPerSample / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = numFrames * blockAlign;
        const bufferSize = 44 + dataSize;

        const arrayBuffer = new ArrayBuffer(bufferSize);
        const view = new DataView(arrayBuffer);

        function writeString(offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        // --- RIFF Chunk Descriptor ---
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true); // Chunk size (little endian)
        writeString(8, 'WAVE');

        // --- fmt Sub-chunk ---
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);             // Sub-chunk size: 16 for PCM
        view.setUint16(20, 1, true);              // Audio format: 1 (PCM uncompressed)
        view.setUint16(22, numChannels, true);    // Number of channels: 2
        view.setUint32(24, sampleRate, true);     // Sample rate: 44100
        view.setUint32(28, byteRate, true);       // Byte rate
        view.setUint16(32, blockAlign, true);     // Block align
        view.setUint16(34, bitsPerSample, true);  // Bits per sample: 16

        // --- data Sub-chunk ---
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);       // Data chunk size

        // --- Write Interleaved 16-bit PCM Audio Data ---
        let offset = 44;
        for (let i = 0; i < numFrames; i++) {
            // Left sample clamping (-1.0 to 1.0)
            let sL = Math.max(-1.0, Math.min(1.0, leftChannel[i] || 0));
            let pcmL = sL < 0 ? Math.round(sL * 32768) : Math.round(sL * 32767);
            view.setInt16(offset, pcmL, true);
            offset += 2;

            // Right sample clamping (-1.0 to 1.0)
            let sR = Math.max(-1.0, Math.min(1.0, rightChannel[i] || 0));
            let pcmR = sR < 0 ? Math.round(sR * 32768) : Math.round(sR * 32767);
            view.setInt16(offset, pcmR, true);
            offset += 2;
        }

        const uint8 = new Uint8Array(arrayBuffer);

        if (typeof Blob !== 'undefined') {
            const blob = new Blob([uint8], { type: 'audio/wav' });
            // Attach buffer directly for headless inspection & Node compatibility
            blob.buffer = uint8.buffer;
            return blob;
        }

        // Polyfill/fallback container if Blob is not available
        return {
            buffer: uint8.buffer,
            size: bufferSize,
            type: 'audio/wav',
            arrayBuffer: async () => arrayBuffer
        };
    }

    // =========================================================================
    // 3. LOOPER TRACK CLASS
    // =========================================================================

    /**
     * Individual sound-on-sound looper track (Track 1 or Track 2)
     */
    class LooperTrack {
        /**
         * @param {number|string} id - Track identifier (1 or 2)
         * @param {Object} options - Track configuration
         */
        constructor(id = 1, options = {}) {
            this.id = id;
            this.name = options.name || `Track ${id}`;
            this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
            this.maxDuration = options.maxDuration || DEFAULT_MAX_DURATION;
            this.fadeDuration = options.fadeDuration !== undefined ? options.fadeDuration : DEFAULT_FADE_DURATION;

            // Maximum memory buffer capacity in samples
            this.maxCapacity = Math.round(this.maxDuration * this.sampleRate);

            // Stereo Audio Buffers (Allocated up to max capacity)
            this.bufferL = new Float32Array(this.maxCapacity);
            this.bufferR = new Float32Array(this.maxCapacity);

            // Active loop metrics
            this.length = 0;              // Active loop length in samples
            this.playhead = 0.0;          // Read playhead (floating point for half-speed interpolation)
            this.recordingPlayhead = 0;   // Write playhead during initial capture
            this.state = LOOPER_STATES.EMPTY;

            // Mixer & Panning
            this.volume = options.volume !== undefined ? options.volume : 1.0;
            this.pan = options.pan !== undefined ? options.pan : 0.0;
            this.isMuted = false;
            this.isSoloed = false;
            this.feedback = options.feedback !== undefined ? options.feedback : 1.0; // 1.0 = 100% sound-on-sound

            // Vintage Tape FX
            this.isReverse = false;       // Time-reversed playback
            this.isHalfSpeed = false;     // 2x down-sampled octave-down playback

            // Single-Level Non-Destructive Undo/Redo Snapshots
            this.undoSnapshot = null;
            this.redoSnapshot = null;

            // Crossfade & Seam State
            this.lastOverdubEndSample = 0;
        }

        /**
         * Whether an undo layer is available.
         */
        get canUndo() {
            return this.undoSnapshot !== null;
        }

        /**
         * Whether a redo layer is available.
         */
        get canRedo() {
            return this.redoSnapshot !== null;
        }

        /**
         * Loop duration in seconds (normal speed).
         */
        get duration() {
            return this.length > 0 ? this.length / this.sampleRate : 0;
        }

        /**
         * Effective loop cycle duration in seconds (accounts for half-speed).
         */
        get cycleDuration() {
            const baseDur = this.duration;
            return this.isHalfSpeed ? baseDur * 2 : baseDur;
        }

        /**
         * Creates an independent deep snapshot of the active loop buffer.
         * @private
         */
        _createSnapshot() {
            if (this.length <= 0) return null;
            const snapshotL = new Float32Array(this.length);
            const snapshotR = new Float32Array(this.length);
            snapshotL.set(this.bufferL.subarray(0, this.length));
            snapshotR.set(this.bufferR.subarray(0, this.length));
            return {
                length: this.length,
                bufferL: snapshotL,
                bufferR: snapshotR
            };
        }

        /**
         * Restores audio buffer and length from a snapshot.
         * @private
         */
        _restoreSnapshot(snapshot) {
            if (!snapshot) return;
            this.length = snapshot.length;
            this.bufferL.fill(0);
            this.bufferR.fill(0);
            this.bufferL.set(snapshot.bufferL);
            this.bufferR.set(snapshot.bufferR);
            if (this.playhead >= this.length) {
                this.playhead = 0.0;
            }
        }

        /**
         * Begins initial loop recording.
         * Only valid from EMPTY or STOPPED when empty.
         */
        record() {
            if (this.state === LOOPER_STATES.EMPTY || (this.state === LOOPER_STATES.STOPPED && this.length === 0)) {
                this.bufferL.fill(0);
                this.bufferR.fill(0);
                this.length = 0;
                this.playhead = 0.0;
                this.recordingPlayhead = 0;
                this.undoSnapshot = null;
                this.redoSnapshot = null;
                this.state = LOOPER_STATES.RECORDING;
                return true;
            } else if (this.state === LOOPER_STATES.PLAYING || this.state === LOOPER_STATES.STOPPED) {
                // If track already has content, record acts as overdub
                return this.overdub();
            }
            return false;
        }

        /**
         * Closes recording/overdubbing or resumes playback.
         */
        play() {
            if (this.state === LOOPER_STATES.RECORDING) {
                // Finalize initial recording
                this.length = this.recordingPlayhead;
                if (this.length > 0) {
                    this.applySeamCrossfade(this.fadeDuration);
                    this.playhead = 0.0;
                    this.state = LOOPER_STATES.PLAYING;
                    return true;
                } else {
                    this.state = LOOPER_STATES.EMPTY;
                    return false;
                }
            } else if (this.state === LOOPER_STATES.OVERDUBBING) {
                // Finish overdub layer; undo snapshot is already secured
                this.state = LOOPER_STATES.PLAYING;
                return true;
            } else if (this.state === LOOPER_STATES.STOPPED) {
                if (this.length > 0) {
                    this.state = LOOPER_STATES.PLAYING;
                    return true;
                }
            }
            return false;
        }

        /**
         * Engages sound-on-sound overdubbing.
         * Saves single-level non-destructive undo snapshot of current layer.
         */
        overdub() {
            if (this.state === LOOPER_STATES.EMPTY) {
                return this.record();
            }
            if (this.length <= 0) return false;

            if (this.state === LOOPER_STATES.PLAYING || this.state === LOOPER_STATES.STOPPED) {
                // Save undo snapshot before modifying audio buffer with new layer
                this.undoSnapshot = this._createSnapshot();
                // A new overdub invalidates any previous redo
                this.redoSnapshot = null;
                this.state = LOOPER_STATES.OVERDUBBING;
                return true;
            }
            return false;
        }

        /**
         * Stops loop playback and preserves recorded buffer.
         * @param {boolean} resetPlayhead - Reset playhead to start (default true)
         */
        stop(resetPlayhead = true) {
            if (this.state === LOOPER_STATES.RECORDING) {
                this.length = this.recordingPlayhead;
                if (this.length > 0) {
                    this.applySeamCrossfade(this.fadeDuration);
                } else {
                    this.state = LOOPER_STATES.EMPTY;
                    return;
                }
            }
            this.state = this.length > 0 ? LOOPER_STATES.STOPPED : LOOPER_STATES.EMPTY;
            if (resetPlayhead) {
                this.playhead = 0.0;
            }
        }

        /**
         * Clears all recorded audio, undo/redo buffers, and resets to EMPTY.
         */
        clear() {
            this.bufferL.fill(0);
            this.bufferR.fill(0);
            this.length = 0;
            this.playhead = 0.0;
            this.recordingPlayhead = 0;
            this.undoSnapshot = null;
            this.redoSnapshot = null;
            this.state = LOOPER_STATES.EMPTY;
        }

        /**
         * Reverts the most recent overdub layer.
         * Non-destructive: preserves the undone layer in redo snapshot.
         * @returns {boolean} Whether undo succeeded
         */
        undo() {
            if (!this.canUndo) return false;
            // Save current state into redo before reverting
            this.redoSnapshot = this._createSnapshot();
            this._restoreSnapshot(this.undoSnapshot);
            this.undoSnapshot = null;
            return true;
        }

        /**
         * Restores the most recently undone overdub layer.
         * @returns {boolean} Whether redo succeeded
         */
        redo() {
            if (!this.canRedo) return false;
            // Save pre-redo state into undo so user can undo again
            this.undoSnapshot = this._createSnapshot();
            this._restoreSnapshot(this.redoSnapshot);
            this.redoSnapshot = null;
            return true;
        }

        /**
         * Sets or toggles reverse tape playback.
         * Does not alter loop length or tempo.
         */
        setReverse(isReverse) {
            this.isReverse = !!isReverse;
        }

        toggleReverse() {
            this.isReverse = !this.isReverse;
            return this.isReverse;
        }

        /**
         * Sets or toggles half-speed tape playback (octave down, 2x duration).
         */
        setHalfSpeed(isHalfSpeed) {
            this.isHalfSpeed = !!isHalfSpeed;
        }

        toggleHalfSpeed() {
            this.isHalfSpeed = !this.isHalfSpeed;
            return this.isHalfSpeed;
        }

        setVolume(vol) {
            this.volume = Math.max(0.0, Math.min(2.0, Number.isFinite(vol) ? vol : 1.0));
        }

        setPan(pan) {
            this.pan = Math.max(-1.0, Math.min(1.0, Number.isFinite(pan) ? pan : 0.0));
        }

        setMute(isMuted) {
            this.isMuted = !!isMuted;
        }

        toggleMute() {
            this.isMuted = !this.isMuted;
            return this.isMuted;
        }

        setSolo(isSoloed) {
            this.isSoloed = !!isSoloed;
        }

        toggleSolo() {
            this.isSoloed = !this.isSoloed;
            return this.isSoloed;
        }

        setFeedback(fb) {
            this.feedback = Math.max(0.0, Math.min(1.0, Number.isFinite(fb) ? fb : 1.0));
        }

        /**
         * Seamless equal-power seam crossfade (10ms) across the loop seam.
         */
        applySeamCrossfade(fadeDurationSec = DEFAULT_FADE_DURATION) {
            if (this.length <= 0) return;
            equalPowerCrossfade(this.bufferL, this.length, this.sampleRate, fadeDurationSec);
            equalPowerCrossfade(this.bufferR, this.length, this.sampleRate, fadeDurationSec);
        }

        /**
         * Reads interpolated raw sample values from the buffer without applying volume or pan.
         * Useful for DSP analysis, meter displays, and audio processing pipelines.
         */
        readSample(pos = this.playhead, isReverse = this.isReverse) {
            if (this.length <= 0) return { sampleL: 0, sampleR: 0 };
            const len = this.length;
            let effectivePos = isReverse ? (len - 1) - pos : pos;
            effectivePos = ((effectivePos % len) + len) % len;

            const indexA = Math.floor(effectivePos);
            const frac = effectivePos - indexA;
            const indexB = (indexA + 1) % len;

            const sampleL = (1.0 - frac) * this.bufferL[indexA] + frac * this.bufferL[indexB];
            const sampleR = (1.0 - frac) * this.bufferR[indexA] + frac * this.bufferR[indexB];
            return { sampleL, sampleR };
        }

        /**
         * Direct DSP sample processing method.
         * Handles recording, overdubbing, reverse index transformation,
         * half-speed fractional interpolation, and stereo panning.
         * 
         * @param {number} inL - Left input sample (-1.0 to 1.0)
         * @param {number} inR - Right input sample (-1.0 to 1.0)
         * @returns {{ outL: number, outR: number }} - Panned & scaled stereo output samples
         */
        processSample(inL, inR) {
            // 1. Initial Recording Mode
            if (this.state === LOOPER_STATES.RECORDING) {
                if (this.recordingPlayhead < this.maxCapacity) {
                    this.bufferL[this.recordingPlayhead] = inL;
                    this.bufferR[this.recordingPlayhead] = inR;
                    this.recordingPlayhead++;
                } else {
                    // Auto-finalize if reaching maximum buffer capacity
                    this.play();
                }
                // During initial record, looper output is silent (dry-thru handles live guitar monitoring)
                return { outL: 0.0, outR: 0.0 };
            }

            // 2. Playback / Overdub Mode
            if ((this.state === LOOPER_STATES.PLAYING || this.state === LOOPER_STATES.OVERDUBBING) && this.length > 0) {
                const len = this.length;

                // --- Calculate Effective Sample Read Position ---
                // In reverse mode: playhead maps from end of loop towards start
                let effectivePos;
                if (this.isReverse) {
                    effectivePos = (len - 1) - this.playhead;
                } else {
                    effectivePos = this.playhead;
                }

                // Wrap into [0, len)
                effectivePos = ((effectivePos % len) + len) % len;

                // --- Resampling / Fractional Interpolation (Half-Speed Support) ---
                const indexA = Math.floor(effectivePos);
                const frac = effectivePos - indexA;
                const indexB = (indexA + 1) % len;

                // Linear interpolation across fractional sample boundary
                const readL = (1.0 - frac) * this.bufferL[indexA] + frac * this.bufferL[indexB];
                const readR = (1.0 - frac) * this.bufferR[indexA] + frac * this.bufferR[indexB];

                // --- Sound-on-Sound Overdubbing ---
                if (this.state === LOOPER_STATES.OVERDUBBING) {
                    const writeIndex = Math.round(effectivePos) % len;
                    this.bufferL[writeIndex] = this.bufferL[writeIndex] * this.feedback + inL;
                    this.bufferR[writeIndex] = this.bufferR[writeIndex] * this.feedback + inR;
                }

                // --- Advance Playhead by Speed Factor ---
                // Half-speed advances by 0.5 sample per tick; normal speed advances by 1.0
                const speedIncrement = this.isHalfSpeed ? 0.5 : 1.0;
                this.playhead += speedIncrement;
                if (this.playhead >= len) {
                    this.playhead -= len;
                }

                // --- Check Mute State ---
                if (this.isMuted) {
                    return { outL: 0.0, outR: 0.0 };
                }

                // --- Apply Track Volume and Constant-Power Panning ---
                const panGains = calculatePanGains(this.pan);
                const outL = readL * this.volume * panGains.left;
                const outR = readR * this.volume * panGains.right;

                return { outL, outR };
            }

            // 3. STOPPED or EMPTY
            return { outL: 0.0, outR: 0.0 };
        }
    }

    // =========================================================================
    // 4. MOCK AUDIO CONTEXT FOR ZERO-DEPENDENCY HEADLESS TESTS
    // =========================================================================

    class MockAudioParam {
        constructor(val = 0) {
            this.value = val;
            this.targetValue = val;
        }
        setValueAtTime(val) {
            this.value = val;
            this.targetValue = val;
        }
        setTargetAtTime(val) {
            this.targetValue = val;
            this.value = val;
        }
        linearRampToValueAtTime(val) {
            this.value = val;
            this.targetValue = val;
        }
    }

    class MockAudioNode {
        constructor(ctx, type) {
            this.context = ctx;
            this.nodeType = type;
            this.connections = [];
        }
        connect(dest) {
            if (!this.connections.includes(dest)) {
                this.connections.push(dest);
            }
            return dest;
        }
        disconnect(dest) {
            if (!dest) {
                this.connections = [];
            } else {
                this.connections = this.connections.filter(c => c !== dest);
            }
        }
    }

    class MockGainNode extends MockAudioNode {
        constructor(ctx) {
            super(ctx, 'GainNode');
            this.gain = new MockAudioParam(1.0);
        }
    }

    class MockStereoPannerNode extends MockAudioNode {
        constructor(ctx) {
            super(ctx, 'StereoPannerNode');
            this.pan = new MockAudioParam(0.0);
        }
    }

    class MockScriptProcessorNode extends MockAudioNode {
        constructor(ctx, bufferSize = 2048, numberOfInputChannels = 2, numberOfOutputChannels = 2) {
            super(ctx, 'ScriptProcessorNode');
            this.bufferSize = bufferSize;
            this.numberOfInputChannels = numberOfInputChannels;
            this.numberOfOutputChannels = numberOfOutputChannels;
            this.onaudioprocess = null;
        }
    }

    class MockAudioBuffer {
        constructor(channels, length, sampleRate) {
            this.numberOfChannels = channels;
            this.length = length;
            this.sampleRate = sampleRate;
            this.channels = [];
            for (let i = 0; i < channels; i++) {
                this.channels.push(new Float32Array(length));
            }
        }
        getChannelData(c) {
            return this.channels[c];
        }
    }

    class MockAudioContext {
        constructor(options = {}) {
            this.sampleRate = options.sampleRate || DEFAULT_SAMPLE_RATE;
            this.currentTime = 0;
            this.destination = new MockAudioNode(this, 'AudioDestinationNode');
        }
        createGain() { return new MockGainNode(this); }
        createStereoPanner() { return new MockStereoPannerNode(this); }
        createScriptProcessor(bufferSize = 2048, inCh = 2, outCh = 2) {
            return new MockScriptProcessorNode(this, bufferSize, inCh, outCh);
        }
        createBuffer(channels, length, sampleRate) {
            return new MockAudioBuffer(channels, length, sampleRate || this.sampleRate);
        }
    }

    // =========================================================================
    // 5. PHRASE LOOPER MAIN PEDAL ENGINE
    // =========================================================================

    /**
     * Standalone Multi-Track Sound-on-Sound Phrase Looper Pedal Engine
     */
    class PhraseLooper {
        /**
         * @param {AudioContext|MockAudioContext} audioCtx - Web Audio context
         * @param {AudioNode|null} sourceNode - Audio source (e.g. mic or effects rack output)
         * @param {Object} options - Pedal configuration
         */
        constructor(audioCtx = null, sourceNode = null, options = {}) {
            this.audioCtx = audioCtx || (typeof AudioContext !== 'undefined' ? new AudioContext() : new MockAudioContext());
            this.sampleRate = this.audioCtx.sampleRate || DEFAULT_SAMPLE_RATE;
            this.bufferSize = options.bufferSize || 2048;

            // --- Multi-Track Architecture ---
            // Track 1: Rhythm base loop
            // Track 2: Synchronized lead / counterpoint loop
            this.track1 = new LooperTrack(1, { sampleRate: this.sampleRate, name: 'Rhythm Base' });
            this.track2 = new LooperTrack(2, { sampleRate: this.sampleRate, name: 'Lead Counterpoint' });
            this.tracks = [this.track1, this.track2];

            // Track Synchronization Mode
            // 'sync': Track 2 loop length snaps to Track 1 (or integer factor) and locks playheads
            // 'free': Track 2 is completely unlinked / asynchronous
            this.syncMode = options.syncMode || 'sync';

            // --- Quantization & Metronome Sync Settings ---
            this.autoQuantize = !!options.autoQuantize;
            this.bpm = options.bpm || 120;
            this.timeSignature = options.timeSignature ? [...options.timeSignature] : [4, 4]; // [numerator, denominator]
            this.quantizeMode = options.quantizeMode || 'bar'; // 'bar' or 'beat'

            // --- Master Mixer Parameters ---
            this.masterVolume = options.masterVolume !== undefined ? options.masterVolume : 1.0;
            this.dryLevel = options.dryLevel !== undefined ? options.dryLevel : 1.0; // Dry guitar thru level
            this.wetLevel = options.wetLevel !== undefined ? options.wetLevel : 1.0;

            // --- Web Audio Graph Construction ---
            this._setupAudioGraph();

            // Connect external source node if provided
            if (sourceNode) {
                this.setSourceNode(sourceNode);
            }
        }

        /**
         * Constructs the Web Audio node graph.
         * Routing:
         *   sourceNode -> inputNode -> [dryGain] -------------------------> outputNode (mix)
         *                           -> [processorNode (Looper DSP)] -> [wetGain] -> outputNode
         * @private
         */
        _setupAudioGraph() {
            // Master Input Summing Node (receives raw or effects-chain signal)
            this.inputNode = this.audioCtx.createGain();

            // Dry-Thru Gain Node (allows guitarist to hear direct guitar alongside looper)
            this.dryGainNode = this.audioCtx.createGain();
            this.dryGainNode.gain.value = this.dryLevel;

            // Wet Looper Playback Mix Gain
            this.wetGainNode = this.audioCtx.createGain();
            this.wetGainNode.gain.value = this.wetLevel;

            // Master Output Mix Node (destination for guitar amp or cab sim)
            this.outputNode = this.audioCtx.createGain();
            this.outputNode.gain.value = this.masterVolume;
            this.mixNode = this.outputNode; // Convenient alias

            // Route Dry signal: input -> dryGain -> output
            this.inputNode.connect(this.dryGainNode);
            this.dryGainNode.connect(this.outputNode);

            // Real-time audio stream processor
            if (typeof this.audioCtx.createScriptProcessor === 'function') {
                this.processorNode = this.audioCtx.createScriptProcessor(this.bufferSize, 2, 2);
                this.processorNode.onaudioprocess = (e) => {
                    const inputBuffer = e.inputBuffer;
                    const outputBuffer = e.outputBuffer;
                    const inL = inputBuffer.getChannelData(0);
                    const inR = inputBuffer.numberOfChannels > 1 ? inputBuffer.getChannelData(1) : inL;
                    const outL = outputBuffer.getChannelData(0);
                    const outR = outputBuffer.getChannelData(1);

                    this.processAudioBlock(inL, inR, outL, outR, inputBuffer.length);
                };

                // Connect looper processor into wet mix
                this.inputNode.connect(this.processorNode);
                this.processorNode.connect(this.wetGainNode);
                this.wetGainNode.connect(this.outputNode);
            } else {
                this.processorNode = null;
            }
        }

        /**
         * Sets or replaces the active input audio source node.
         * @param {AudioNode} sourceNode
         */
        setSourceNode(sourceNode) {
            if (this._currentSourceNode) {
                try {
                    this._currentSourceNode.disconnect(this.inputNode);
                } catch (e) {
                    // Ignore disconnection errors
                }
            }
            this._currentSourceNode = sourceNode;
            if (sourceNode && typeof sourceNode.connect === 'function') {
                sourceNode.connect(this.inputNode);
            }
        }

        /**
         * Connects the looper output to an external destination node (e.g. Master Destination, Cab Sim).
         * @param {AudioNode} destinationNode
         */
        connect(destinationNode) {
            return this.outputNode.connect(destinationNode);
        }

        /**
         * Disconnects looper output.
         * @param {AudioNode} [destinationNode]
         */
        disconnect(destinationNode) {
            return this.outputNode.disconnect(destinationNode);
        }

        /**
         * Retrieves a track by ID (1 or 2).
         * @param {number|string} trackId
         * @returns {LooperTrack}
         */
        getTrack(trackId) {
            const id = Number(trackId) || 1;
            return id === 2 ? this.track2 : this.track1;
        }

        // =====================================================================
        // LOOP OPERATIONS & DUAL-TRACK COORDINATION
        // =====================================================================

        /**
         * Begins recording on the target track.
         * @param {number} trackId - 1 or 2 (default 1)
         */
        record(trackId = 1) {
            const track = this.getTrack(trackId);

            // Track 2 Synchronization Handling
            if (trackId === 2 && this.syncMode === 'sync') {
                // If Track 1 is active, sync Track 2 start to Track 1's playhead
                if (this.track1.length > 0 && (this.track1.state === LOOPER_STATES.PLAYING || this.track1.state === LOOPER_STATES.OVERDUBBING)) {
                    track.playhead = this.track1.playhead;
                }
            }

            return track.record();
        }

        /**
         * Finalizes recording or engages playback on target track.
         * Applies quantization if enabled on Track 1.
         * @param {number} trackId - 1 or 2 (default 1)
         */
        play(trackId = 1) {
            const track = this.getTrack(trackId);

            if (track.state === LOOPER_STATES.RECORDING) {
                const rawLength = track.recordingPlayhead;

                // Auto-Quantize Snapping if enabled
                if (this.autoQuantize && rawLength > 0) {
                    const q = quantizeSamples(
                        rawLength,
                        this.sampleRate,
                        this.bpm,
                        this.timeSignature[0],
                        this.quantizeMode
                    );
                    const targetLen = Math.min(q.targetSamples, track.maxCapacity);

                    if (targetLen < rawLength) {
                        track.recordingPlayhead = targetLen;
                    } else if (targetLen > rawLength) {
                        // Zero-pad up to quantized boundary
                        for (let i = rawLength; i < targetLen; i++) {
                            track.bufferL[i] = 0;
                            track.bufferR[i] = 0;
                        }
                        track.recordingPlayhead = targetLen;
                    }
                }

                // If Track 2 is in sync mode and Track 1 has established length, snap Track 2 length
                if (trackId === 2 && this.syncMode === 'sync' && this.track1.length > 0) {
                    const baseLen = this.track1.length;
                    // Snap Track 2 to nearest integer multiple or exact Track 1 cycle
                    const factor = Math.max(1, Math.round(track.recordingPlayhead / baseLen));
                    const syncedTarget = baseLen * factor;
                    if (syncedTarget <= track.maxCapacity) {
                        track.recordingPlayhead = syncedTarget;
                    }
                }

                const success = track.play();

                // If Track 2 is synced to Track 1, align playhead to Track 1
                if (trackId === 2 && this.syncMode === 'sync' && this.track1.length > 0) {
                    track.playhead = this.track1.playhead % track.length;
                }

                return success;
            }

            return track.play();
        }

        /**
         * Engages overdubbing on target track with non-destructive undo snapshot.
         * @param {number} trackId
         */
        overdub(trackId = 1) {
            return this.getTrack(trackId).overdub();
        }

        /**
         * Stops playback/recording on target track.
         * @param {number} trackId
         * @param {boolean} resetPlayhead
         */
        stop(trackId = 1, resetPlayhead = true) {
            return this.getTrack(trackId).stop(resetPlayhead);
        }

        /**
         * Clears target track.
         * @param {number} trackId
         */
        clear(trackId = 1) {
            return this.getTrack(trackId).clear();
        }

        /**
         * Undoes the last overdub layer on target track.
         * @param {number} trackId
         */
        undo(trackId = 1) {
            return this.getTrack(trackId).undo();
        }

        /**
         * Redoes the last undone overdub layer on target track.
         * @param {number} trackId
         */
        redo(trackId = 1) {
            return this.getTrack(trackId).redo();
        }

        /**
         * Starts playback on all tracks that have recorded content.
         */
        playAll() {
            this.tracks.forEach(track => {
                if (track.length > 0) {
                    track.play();
                }
            });
        }

        /**
         * Stops playback on all tracks.
         */
        stopAll(resetPlayhead = true) {
            this.tracks.forEach(track => track.stop(resetPlayhead));
        }

        /**
         * Clears all tracks to EMPTY.
         */
        clearAll() {
            this.tracks.forEach(track => track.clear());
        }

        // =====================================================================
        // TAPE FX & SPEED CONTROLS
        // =====================================================================

        setReverse(trackId, isReverse) {
            this.getTrack(trackId).setReverse(isReverse);
        }

        toggleReverse(trackId) {
            return this.getTrack(trackId).toggleReverse();
        }

        setHalfSpeed(trackId, isHalfSpeed) {
            this.getTrack(trackId).setHalfSpeed(isHalfSpeed);
        }

        toggleHalfSpeed(trackId) {
            return this.getTrack(trackId).toggleHalfSpeed();
        }

        // =====================================================================
        // QUANTIZATION & METRONOME CONTROLS
        // =====================================================================

        setAutoQuantize(enabled) {
            this.autoQuantize = !!enabled;
        }

        setBpm(bpm) {
            this.bpm = Math.max(20, Math.min(320, Number.isFinite(bpm) ? bpm : 120));
        }

        setTimeSignature(numerator, denominator = 4) {
            this.timeSignature = [Math.max(1, numerator || 4), Math.max(1, denominator || 4)];
        }

        setQuantizeMode(mode) {
            this.quantizeMode = mode === 'beat' ? 'beat' : 'bar';
        }

        setSyncMode(mode) {
            this.syncMode = mode === 'free' ? 'free' : 'sync';
        }

        // =====================================================================
        // MIXER & ROUTING CONTROLS
        // =====================================================================

        setMasterVolume(vol) {
            this.masterVolume = Math.max(0.0, Math.min(2.0, Number.isFinite(vol) ? vol : 1.0));
            if (this.outputNode && this.outputNode.gain) {
                this.outputNode.gain.value = this.masterVolume;
            }
        }

        setDryLevel(level) {
            this.dryLevel = Math.max(0.0, Math.min(2.0, Number.isFinite(level) ? level : 1.0));
            if (this.dryGainNode && this.dryGainNode.gain) {
                this.dryGainNode.gain.value = this.dryLevel;
            }
        }

        setWetLevel(level) {
            this.wetLevel = Math.max(0.0, Math.min(2.0, Number.isFinite(level) ? level : 1.0));
            if (this.wetGainNode && this.wetGainNode.gain) {
                this.wetGainNode.gain.value = this.wetLevel;
            }
        }

        setTrackGain(trackId, gain) {
            this.getTrack(trackId).setVolume(gain);
        }

        setTrackPan(trackId, pan) {
            this.getTrack(trackId).setPan(pan);
        }

        setTrackMute(trackId, isMuted) {
            this.getTrack(trackId).setMute(isMuted);
        }

        setTrackSolo(trackId, isSoloed) {
            this.getTrack(trackId).setSolo(isSoloed);
        }

        // =====================================================================
        // REAL-TIME AUDIO PROCESSING ENGINE
        // =====================================================================

        /**
         * Processes an audio block across both tracks with full solo/mute logic.
         * 
         * @param {Float32Array} inL - Left input channel
         * @param {Float32Array} inR - Right input channel
         * @param {Float32Array} outL - Left output channel (written in-place)
         * @param {Float32Array} outR - Right output channel (written in-place)
         * @param {number} frameCount - Number of audio samples in this quantum
         */
        processAudioBlock(inL, inR, outL, outR, frameCount) {
            // Check if any track is soloed
            const hasSolo = this.track1.isSoloed || this.track2.isSoloed;

            for (let i = 0; i < frameCount; i++) {
                const sampleInL = inL[i] || 0;
                const sampleInR = inR[i] || 0;

                let sumL = 0;
                let sumR = 0;

                // Process Track 1
                if (!hasSolo || this.track1.isSoloed) {
                    const t1 = this.track1.processSample(sampleInL, sampleInR);
                    sumL += t1.outL;
                    sumR += t1.outR;
                } else if (this.track1.state === LOOPER_STATES.RECORDING || this.track1.state === LOOPER_STATES.OVERDUBBING) {
                    // Still capture audio even if muted by solo
                    this.track1.processSample(sampleInL, sampleInR);
                }

                // Process Track 2
                if (!hasSolo || this.track2.isSoloed) {
                    const t2 = this.track2.processSample(sampleInL, sampleInR);
                    sumL += t2.outL;
                    sumR += t2.outR;
                } else if (this.track2.state === LOOPER_STATES.RECORDING || this.track2.state === LOOPER_STATES.OVERDUBBING) {
                    // Still capture audio even if muted by solo
                    this.track2.processSample(sampleInL, sampleInR);
                }

                outL[i] = sumL;
                outR[i] = sumR;
            }
        }

        /**
         * Generic process method compatible with AudioWorklet / test harnesses.
         */
        process(inputs, outputs, frameCount = 128) {
            const inL = (inputs && inputs[0] && inputs[0][0]) || new Float32Array(frameCount);
            const inR = (inputs && inputs[0] && inputs[0][1]) || inL;
            const outL = (outputs && outputs[0] && outputs[0][0]) || new Float32Array(frameCount);
            const outR = (outputs && outputs[0] && outputs[0][1]) || new Float32Array(frameCount);

            this.processAudioBlock(inL, inR, outL, outR, frameCount);
            return true;
        }

        // =====================================================================
        // HIGH-FIDELITY WAV EXPORT ENGINE
        // =====================================================================

        /**
         * Renders combined active loops into an uncompressed stereo 16-bit 44.1kHz WAV Blob.
         * Preserves volume levels, constant-power panning, mute/solo buses, reverse, and half-speed.
         * 
         * @param {Object} options - Export options (cycles, targetSampleRate)
         * @returns {Blob|Object} - WAV Blob
         */
        exportWav(options = {}) {
            const cycles = Math.max(1, options.cycles || 1);
            const targetSampleRate = 44100;

            // Check which tracks have audio content
            const activeTracks = this.tracks.filter(t => t.length > 0);
            if (activeTracks.length === 0) {
                // Export 1-second of clean silence if empty
                const silence = new Float32Array(targetSampleRate);
                return encodeWav(silence, silence, targetSampleRate);
            }

            // Determine export length in samples (longest active track cycle * cycles)
            let maxCycleSamples = 0;
            activeTracks.forEach(t => {
                const trackCycleSamples = t.isHalfSpeed ? t.length * 2 : t.length;
                if (trackCycleSamples > maxCycleSamples) {
                    maxCycleSamples = trackCycleSamples;
                }
            });

            const totalExportFrames = maxCycleSamples * cycles;
            const mixL = new Float32Array(totalExportFrames);
            const mixR = new Float32Array(totalExportFrames);

            const hasSolo = this.track1.isSoloed || this.track2.isSoloed;

            // Render audio for each active track
            activeTracks.forEach(track => {
                // Skip if muted or defeated by solo
                if (hasSolo && !track.isSoloed) return;
                if (!hasSolo && track.isMuted) return;

                const panGains = calculatePanGains(track.pan);
                const speedFactor = track.isHalfSpeed ? 0.5 : 1.0;
                const len = track.length;

                for (let i = 0; i < totalExportFrames; i++) {
                    let pos = (i * speedFactor) % len;
                    if (track.isReverse) {
                        pos = (len - 1) - pos;
                    }
                    pos = ((pos % len) + len) % len;

                    const idxA = Math.floor(pos);
                    const frac = pos - idxA;
                    const idxB = (idxA + 1) % len;

                    const sampleL = (1.0 - frac) * track.bufferL[idxA] + frac * track.bufferL[idxB];
                    const sampleR = (1.0 - frac) * track.bufferR[idxA] + frac * track.bufferR[idxB];

                    mixL[i] += sampleL * track.volume * panGains.left * this.masterVolume;
                    mixR[i] += sampleR * track.volume * panGains.right * this.masterVolume;
                }
            });

            // If internal sampleRate is different from 44.1kHz, resample
            let finalL = mixL;
            let finalR = mixR;
            if (this.sampleRate !== targetSampleRate) {
                const ratio = targetSampleRate / this.sampleRate;
                const resampledLength = Math.round(totalExportFrames * ratio);
                finalL = new Float32Array(resampledLength);
                finalR = new Float32Array(resampledLength);

                for (let i = 0; i < resampledLength; i++) {
                    const srcPos = i / ratio;
                    const idxA = Math.floor(srcPos);
                    const frac = srcPos - idxA;
                    const idxB = Math.min(totalExportFrames - 1, idxA + 1);

                    finalL[i] = (1.0 - frac) * mixL[idxA] + frac * mixL[idxB];
                    finalR[i] = (1.0 - frac) * mixR[idxA] + frac * mixR[idxB];
                }
            }

            return encodeWav(finalL, finalR, targetSampleRate);
        }

        // =====================================================================
        // STATE SERIALIZATION
        // =====================================================================

        /**
         * Returns an immutable state snapshot of the looper pedal.
         */
        getState() {
            return {
                bpm: this.bpm,
                timeSignature: [...this.timeSignature],
                autoQuantize: this.autoQuantize,
                quantizeMode: this.quantizeMode,
                syncMode: this.syncMode,
                masterVolume: this.masterVolume,
                dryLevel: this.dryLevel,
                wetLevel: this.wetLevel,
                tracks: this.tracks.map(t => ({
                    id: t.id,
                    name: t.name,
                    state: t.state,
                    length: t.length,
                    duration: t.duration,
                    cycleDuration: t.cycleDuration,
                    volume: t.volume,
                    pan: t.pan,
                    isMuted: t.isMuted,
                    isSoloed: t.isSoloed,
                    isReverse: t.isReverse,
                    isHalfSpeed: t.isHalfSpeed,
                    canUndo: t.canUndo,
                    canRedo: t.canRedo,
                    feedback: t.feedback
                }))
            };
        }
    }

    /**
     * Factory function to instantiate a PhraseLooper pedal.
     */
    function createLooper(audioCtx, sourceNode, options) {
        return new PhraseLooper(audioCtx, sourceNode, options);
    }

    return {
        PhraseLooper,
        LooperEngine: PhraseLooper, // Alias
        LooperTrack,
        LOOPER_STATES,
        createLooper,
        equalPowerCrossfade,
        calculatePanGains,
        quantizeSamples,
        encodeWav,
        MockAudioContext,
        DEFAULT_SAMPLE_RATE,
        DEFAULT_FADE_DURATION
    };
}));
