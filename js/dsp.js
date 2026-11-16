/**
 * Audio DSP Engine (Phase 1)
 * Real-time guitar pitch detection, onset/pluck transient detector,
 * Karplus-Strong physical string synthesizer, and metronome timing engine.
 * 
 * Supports AudioWorkletProcessor offloading for glitch-free real-time pitch tracking,
 * with graceful fallback to ScriptProcessor/AnalyserNode.
 */

class GuitarDSP {
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || 44100;
        this.bufferSize = options.bufferSize || 2048;
        this.audioCtx = null;
        this.analyser = null;
        this.micStream = null;
        this.sourceNode = null;
        this.scriptNode = null;
        this.workletNode = null;
        this.workletGain = null;
        this.workletModuleLoaded = false;
        this.useWorklet = false;
        this.useScriptProcessor = options.useScriptProcessor || false;
        this.workletPath = options.workletPath || 'js/pitch-processor.worklet.js';
        this.pitchConfidenceThreshold = options.pitchConfidenceThreshold !== undefined ? options.pitchConfidenceThreshold : 0.65;
        this.isRunning = false;

        // Tuner & Pitch settings
        this.a4 = options.a4 || 440;
        this.minFreq = options.minFreq || 70.0;   // Below Low D (73.4 Hz)
        this.maxFreq = options.maxFreq || 1350.0; // Above 22nd fret High E (D6 = 1175 Hz, E6 = 1318 Hz)
        this.yinThreshold = options.yinThreshold !== undefined ? options.yinThreshold : 0.12; // YIN dip threshold
        this.noiseGateRMS = options.noiseGateRMS !== undefined ? options.noiseGateRMS : 0.008; // Minimum RMS signal level
        this.onsetThreshold = options.onsetThreshold !== undefined ? options.onsetThreshold : 0.015; // Sudden energy jump for pluck detection

        // State tracking
        this.prevRMS = 0;
        this.lastNoteTime = 0;
        this.lastDetectedMidi = -1;
        this.pluckCooldown = 0.08; // 80ms debounce between rapid plucks
        this.pitchHistory = [];
        this.historySize = 5;

        // Callback hooks
        this.onPitchDetected = options.onPitchDetected || null;
        this.onPluck = options.onPluck || null;
        this.onNoteOff = options.onNoteOff || null;
        this.onSilence = options.onSilence || null;
        this.onWaveformData = options.onWaveformData || null;
        this.onAudioMetrics = options.onAudioMetrics || null;
        this.onChromaData = options.onChromaData || null;

        // Buffers & FFT Settings
        this.fftSize = options.fftSize || 8192; // 8192 fftSize yields 4096 frequency bins
        this.timeDomainBuffer = new Float32Array(this.bufferSize);
        this.freqByteData = null;

        // Note names lookup table
        this.noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    }

    /**
     * Initializes the Web Audio context if not already done.
     */
    async initAudioContext() {
        if (!this.audioCtx) {
            const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext))
                || (typeof AudioContext !== 'undefined' ? AudioContext : null);
            if (AudioContextClass) {
                this.audioCtx = new AudioContextClass({
                    latencyHint: 'interactive',
                    sampleRate: this.sampleRate
                });
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }
        if (this.audioCtx) {
            this.sampleRate = this.audioCtx.sampleRate;
        }
    }

    /**
     * Enumerates available audio input devices (microphones/interfaces).
     */
    async getAudioInputDevices() {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            return [];
        }
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.filter(d => d.kind === 'audioinput');
        } catch (err) {
            console.warn("Could not enumerate audio devices:", err);
            return [];
        }
    }

    /**
     * Connects physical microphone or audio interface for live guitar analysis.
     * Instantiates AudioWorkletProcessor off the main UI thread with graceful fallback.
     * @param {string|null} deviceId - Specific audio input device ID
     */
    async startMicrophone(deviceId = null) {
        await this.initAudioContext();

        try {
            const audioConstraints = {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                latency: 0
            };
            if (deviceId) {
                audioConstraints.deviceId = { exact: deviceId };
            }

            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: audioConstraints
            });

            this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);
            
            // Analyser node for time-domain and frequency extraction (4096 bins via fftSize 8192)
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = 0.0;
            this.freqByteData = new Uint8Array(this.analyser.frequencyBinCount);
            
            // 1. Split signal routing: send raw/unprocessed audio to pitch detection analyser
            // DSP effects do not alter or degrade pitch tracking accuracy
            this.sourceNode.connect(this.analyser);

            // 2. Connect input to GuitarEffectsRack stompbox chain
            if (typeof GuitarEffectsRack !== 'undefined') {
                if (!this.effectsRack) {
                    this.effectsRack = new GuitarEffectsRack(this.audioCtx, this.sourceNode);
                } else {
                    this.effectsRack.setSourceNode(this.sourceNode);
                }
            }

            // 3. AudioWorklet pitch processor initialization with fallback
            await this.initWorkletNode();

            this.isRunning = true;
            this.processAudioLoop();
            return { success: true, useWorklet: this.useWorklet };
        } catch (err) {
            console.error("Microphone access failed:", err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Initializes AudioWorkletNode off the main UI thread.
     * Falls back gracefully to ScriptProcessor/AnalyserNode if blocked or unsupported.
     */
    async initWorkletNode() {
        this.useWorklet = false;

        // Check if AudioWorklet is supported
        if (!this.audioCtx || !this.audioCtx.audioWorklet || typeof this.audioCtx.audioWorklet.addModule !== 'function') {
            console.warn("AudioWorklet is not supported in this environment. Falling back to ScriptProcessor/AnalyserNode.");
            this.initFallbackNode();
            return;
        }

        try {
            // Load the worklet module dynamically if not already registered
            if (!this.workletModuleLoaded) {
                await this.audioCtx.audioWorklet.addModule(this.workletPath);
                this.workletModuleLoaded = true;
            }

            // Instantiate dedicated pitch processor worklet
            this.workletNode = new AudioWorkletNode(this.audioCtx, 'pitch-processor', {
                processorOptions: {
                    bufferSize: this.bufferSize,
                    sampleRate: this.sampleRate,
                    minFreq: this.minFreq,
                    maxFreq: this.maxFreq,
                    noiseGate: this.noiseGateRMS,
                    hopSize: Math.round(this.sampleRate / 60)
                }
            });

            // Listen to 60 Hz pitch & analysis messages posted from the worklet thread
            this.workletNode.port.onmessage = (event) => {
                if (event && event.data) {
                    this.handleWorkletMessage(event.data);
                }
            };

            this.workletNode.onprocessorerror = (err) => {
                console.warn("AudioWorkletProcessor error encountered, engaging main-thread fallback:", err);
                this.useWorklet = false;
                this.initFallbackNode();
            };

            // Connect input source to worklet node
            this.sourceNode.connect(this.workletNode);

            // Connect worklet node through a silent gain node to destination to ensure
            // the Web Audio graph scheduler keeps the worklet active across all browsers
            this.workletGain = this.audioCtx.createGain();
            this.workletGain.gain.value = 0;
            this.workletNode.connect(this.workletGain);
            this.workletGain.connect(this.audioCtx.destination);

            this.useWorklet = true;
        } catch (err) {
            console.warn("AudioWorklet initialization failed or blocked by origin policies, gracefully falling back to ScriptProcessor/AnalyserNode:", err);
            this.useWorklet = false;
            if (this.workletNode) {
                try { this.workletNode.disconnect(); } catch (e) {}
                this.workletNode = null;
            }
            this.initFallbackNode();
        }
    }

    /**
     * Gracefully configures fallback to ScriptProcessor or AnalyserNode.
     */
    initFallbackNode() {
        this.useWorklet = false;
        if (this.useScriptProcessor && this.audioCtx && typeof this.audioCtx.createScriptProcessor === 'function') {
            try {
                this.scriptNode = this.audioCtx.createScriptProcessor(this.bufferSize, 1, 1);
                this.scriptNode.onaudioprocess = (e) => {
                    if (!this.isRunning) return;
                    const input = e.inputBuffer.getChannelData(0);
                    this.analyzeFrame(input, this.audioCtx.currentTime);
                };
                this.sourceNode.connect(this.scriptNode);
                this.scriptNode.connect(this.audioCtx.destination);
            } catch (err) {
                console.warn("ScriptProcessor fallback creation failed, relying on AnalyserNode loop:", err);
                this.scriptNode = null;
            }
        }
    }

    /**
     * Seamlessly pipes worklet message payload to existing pitch listeners and callbacks
     * without altering the external API contract.
     * @param {Object} data - Message payload from AudioWorkletProcessor
     */
    handleWorkletMessage(data) {
        if (!this.isRunning || !data) return;

        const currentTime = (data.time !== undefined) ? data.time : (this.audioCtx ? this.audioCtx.currentTime : 0);
        const rms = data.rms || 0;
        const peakSample = (data.peakSample !== undefined) ? data.peakSample : Math.min(1, rms * 1.414);
        const rmsDb = rms > 0.0001 ? 20 * Math.log10(rms / 0.707) : -96;
        const isClipping = peakSample >= 0.96 || rms > 0.45;

        // 1. Dispatch Audio Metrics to UI
        if (this.onAudioMetrics) {
            this.onAudioMetrics({
                rms,
                peakSample,
                rmsDb,
                isClipping
            });
        }

        // 2. Check noise gate / silence
        if (rms < this.noiseGateRMS || data.isSilence) {
            this.prevRMS = rms;
            this.pitchHistory = [];
            if (this.lastDetectedMidi !== -1) {
                if (this.onNoteOff) {
                    this.onNoteOff({ time: currentTime, midi: this.lastDetectedMidi });
                }
                this.lastDetectedMidi = -1;
            }
            if (this.onSilence) this.onSilence();
            return;
        }

        // 3. Detect Transient Pluck Onset
        const rmsDelta = rms - this.prevRMS;
        const isTransient = (rmsDelta > this.onsetThreshold) && ((currentTime - this.lastNoteTime) > this.pluckCooldown);
        this.prevRMS = rms;

        // 4. Fundamental Frequency ($f_0$) & Note Processing
        const freq = (data.f0 !== undefined) ? data.f0 : (data.frequency || 0);
        const confidence = (data.confidence !== undefined) ? data.confidence : 0;

        if (freq >= this.minFreq && freq <= this.maxFreq && confidence >= this.pitchConfidenceThreshold) {
            const midiExact = 69 + 12 * Math.log2(freq / this.a4);
            const midi = Math.round(midiExact);
            const cents = Math.round((midiExact - midi) * 100);
            const noteName = this.midiToNoteName(midi);
            const octave = Math.floor(midi / 12) - 1;

            // Median smoothing over recent frames to stabilize
            this.pitchHistory.push(midi);
            if (this.pitchHistory.length > this.historySize) {
                this.pitchHistory.shift();
            }
            const stableMidi = this.getMedian(this.pitchHistory);

            const notePayload = {
                frequency: freq,
                midi: stableMidi,
                midiExact: midiExact,
                noteName: noteName,
                octave: octave,
                cents: cents,
                confidence: confidence,
                rms: rms,
                time: currentTime,
                isPluck: isTransient || (stableMidi !== this.lastDetectedMidi)
            };

            if (this.onPitchDetected) {
                this.onPitchDetected(notePayload);
            }

            if (notePayload.isPluck) {
                this.lastNoteTime = currentTime;
                this.lastDetectedMidi = stableMidi;
                if (this.onPluck) {
                    this.onPluck(notePayload);
                }
            }
        }
    }

    /**
     * Returns the active Web Audio AnalyserNode.
     */
    getAnalyser() {
        return this.analyser;
    }

    /**
     * Stops microphone capture, audio processing, and disconnects all nodes.
     */
    stopMicrophone() {
        this.isRunning = false;
        if (this.workletNode) {
            try {
                this.workletNode.port.onmessage = null;
                this.workletNode.disconnect();
            } catch (e) {}
            this.workletNode = null;
        }
        if (this.workletGain) {
            try {
                this.workletGain.disconnect();
            } catch (e) {}
            this.workletGain = null;
        }
        if (this.scriptNode) {
            try {
                this.scriptNode.disconnect();
                this.scriptNode.onaudioprocess = null;
            } catch (e) {}
            this.scriptNode = null;
        }
        if (this.effectsRack) {
            this.effectsRack.setSourceNode(null);
        }
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
        this.useWorklet = false;
    }

    /**
     * Audio visualization loop using requestAnimationFrame.
     * When AudioWorklet is engaged, heavy pitch detection is offloaded to the
     * audio thread, freeing the main UI thread from any CPU spikes or audio glitches.
     */
    processAudioLoop() {
        if (!this.isRunning) return;

        if (this.analyser) {
            // Read time-domain buffer if waveform visualizer is subscribed or in fallback mode
            if (this.onWaveformData || (!this.useWorklet && !this.scriptNode)) {
                this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
            }

            // Only run main-thread pitch analysis in fallback mode (when worklet is not active)
            if (!this.useWorklet && !this.scriptNode) {
                this.analyzeFrame(this.timeDomainBuffer, this.audioCtx ? this.audioCtx.currentTime : 0);
            }

            if (this.onWaveformData) {
                this.onWaveformData(this.timeDomainBuffer);
            }

            if (this.onChromaData) {
                if (!this.freqByteData || this.freqByteData.length !== this.analyser.frequencyBinCount) {
                    this.freqByteData = new Uint8Array(this.analyser.frequencyBinCount);
                }
                this.analyser.getByteFrequencyData(this.freqByteData);
                this.onChromaData(this.freqByteData, this.sampleRate);
            }
        }

        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => this.processAudioLoop());
        }
    }

    /**
     * Analyzes a single frame of raw audio samples for pitch, RMS, and onset pluck.
     * Used in fallback mode when AudioWorklet is unavailable or for unit tests.
     */
    analyzeFrame(buffer, currentTime = 0) {
        // 1. Calculate RMS Energy and Peak Sample
        let sumSq = 0;
        let peakSample = 0;
        for (let i = 0; i < buffer.length; i++) {
            const abs = Math.abs(buffer[i]);
            if (abs > peakSample) peakSample = abs;
            sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / buffer.length);
        const rmsDb = rms > 0.0001 ? 20 * Math.log10(rms / 0.707) : -96;
        const isClipping = peakSample >= 0.96 || rms > 0.45;

        if (this.onAudioMetrics) {
            this.onAudioMetrics({
                rms,
                peakSample,
                rmsDb,
                isClipping
            });
        }

        // Check noise gate
        if (rms < this.noiseGateRMS) {
            this.prevRMS = rms;
            this.pitchHistory = [];
            if (this.lastDetectedMidi !== -1) {
                if (this.onNoteOff) {
                    this.onNoteOff({ time: currentTime, midi: this.lastDetectedMidi });
                }
                this.lastDetectedMidi = -1;
            }
            if (this.onSilence) this.onSilence();
            return;
        }

        // 2. Detect Transient Pluck Onset
        const rmsDelta = rms - this.prevRMS;
        const isTransient = (rmsDelta > this.onsetThreshold) && ((currentTime - this.lastNoteTime) > this.pluckCooldown);
        this.prevRMS = rms;

        // 3. YIN Pitch Detection Algorithm
        const pitchResult = this.detectPitchYIN(buffer, this.sampleRate);

        if (pitchResult && pitchResult.confidence > 0.80) {
            const freq = pitchResult.frequency;

            if (freq >= this.minFreq && freq <= this.maxFreq) {
                const midiExact = 69 + 12 * Math.log2(freq / this.a4);
                const midi = Math.round(midiExact);
                const cents = Math.round((midiExact - midi) * 100);
                const noteName = this.midiToNoteName(midi);
                const octave = Math.floor(midi / 12) - 1;

                // Median smoothing over recent frames to stabilize
                this.pitchHistory.push(midi);
                if (this.pitchHistory.length > this.historySize) {
                    this.pitchHistory.shift();
                }
                const stableMidi = this.getMedian(this.pitchHistory);

                const notePayload = {
                    frequency: freq,
                    midi: stableMidi,
                    midiExact: midiExact,
                    noteName: noteName,
                    octave: octave,
                    cents: cents,
                    confidence: pitchResult.confidence,
                    rms: rms,
                    time: currentTime,
                    isPluck: isTransient || (stableMidi !== this.lastDetectedMidi)
                };

                if (this.onPitchDetected) {
                    this.onPitchDetected(notePayload);
                }

                if (notePayload.isPluck) {
                    this.lastNoteTime = currentTime;
                    this.lastDetectedMidi = stableMidi;
                    if (this.onPluck) {
                        this.onPluck(notePayload);
                    }
                }
            }
        }
    }

    /**
     * High precision YIN pitch detection algorithm.
     */
    detectPitchYIN(buffer, sampleRate) {
        const halfSize = Math.floor(buffer.length / 2);
        const minTau = Math.floor(sampleRate / this.maxFreq);
        const maxTau = Math.floor(sampleRate / this.minFreq);

        // Step 1: Difference Function d(tau)
        const d = new Float32Array(maxTau + 2);
        for (let tau = 1; tau <= maxTau; tau++) {
            let sum = 0;
            for (let j = 0; j < halfSize; j++) {
                const delta = buffer[j] - buffer[j + tau];
                sum += delta * delta;
            }
            d[tau] = sum;
        }

        // Step 2: Cumulative Mean Normalized Difference Function d'(tau)
        const dPrime = new Float32Array(maxTau + 2);
        dPrime[0] = 1;
        let runningSum = 0;

        for (let tau = 1; tau <= maxTau; tau++) {
            runningSum += d[tau];
            dPrime[tau] = (runningSum === 0) ? 1 : d[tau] / (runningSum / tau);
        }

        // Step 3: Absolute Thresholding
        let bestTau = -1;
        for (let tau = minTau; tau <= maxTau; tau++) {
            if (dPrime[tau] < this.yinThreshold) {
                // Find local minimum
                while (tau + 1 <= maxTau && dPrime[tau + 1] < dPrime[tau]) {
                    tau++;
                }
                bestTau = tau;
                break;
            }
        }

        // If no value falls below threshold, pick global minimum in valid range
        if (bestTau === -1) {
            let minVal = 1.0;
            for (let tau = minTau; tau <= maxTau; tau++) {
                if (dPrime[tau] < minVal) {
                    minVal = dPrime[tau];
                    bestTau = tau;
                }
            }
            if (minVal > 0.40) {
                return null; // Too noisy / unvoiced
            }
        }

        // Step 4: Parabolic Interpolation for sub-sample accuracy
        let betterTau = bestTau;
        if (bestTau > 0 && bestTau < maxTau) {
            const s0 = dPrime[bestTau - 1];
            const s1 = dPrime[bestTau];
            const s2 = dPrime[bestTau + 1];
            const denom = 2 * (s0 - 2 * s1 + s2);
            if (Math.abs(denom) > 1e-6) {
                betterTau = bestTau + (s0 - s2) / denom;
            }
        }

        const frequency = sampleRate / betterTau;
        const confidence = Math.max(0, 1 - dPrime[bestTau]);

        return { frequency, confidence };
    }

    /**
     * Karplus-Strong String Synthesis
     * Synthesizes a plucked guitar string tone with realistic physical decay.
     */
    playGuitarPluck(midiNote, duration = 1.8, velocity = 0.8) {
        if (!this.audioCtx) return;
        if (this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }

        const freq = this.midiToFrequency(midiNote);
        const sampleRate = this.audioCtx.sampleRate;
        const periodSamples = Math.round(sampleRate / freq);
        
        // Duration in samples
        const numSamples = Math.floor(sampleRate * duration);
        const audioBuffer = this.audioCtx.createBuffer(1, numSamples, sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Circular buffer initialized with filtered noise (pluck burst)
        const ringBuffer = new Float32Array(periodSamples);
        let prevNoise = 0;
        for (let i = 0; i < periodSamples; i++) {
            const white = (Math.random() * 2 - 1);
            // Low-pass filter the initial noise to simulate a soft guitar pick
            prevNoise = 0.5 * white + 0.5 * prevNoise;
            ringBuffer[i] = prevNoise * velocity;
        }

        // Decay feedback factor (higher for bass strings, slightly lower for treble)
        const damping = 0.992 - (freq / 4000) * 0.01;

        let bufferIdx = 0;
        let lastOutput = 0;

        for (let i = 0; i < numSamples; i++) {
            const currentSample = ringBuffer[bufferIdx];
            
            // Two-point averaging lowpass filter in feedback loop
            const nextIdx = (bufferIdx + 1) % periodSamples;
            const newSample = (currentSample + ringBuffer[nextIdx]) * 0.5 * damping;
            ringBuffer[bufferIdx] = newSample;

            channelData[i] = currentSample;

            bufferIdx = nextIdx;
        }

        // Play the generated buffer through gain node
        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gainNode = this.audioCtx.createGain();
        gainNode.gain.setValueAtTime(velocity, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + duration);

        source.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);
        source.start();
    }

    /**
     * Plays a high-precision metronome click.
     * @param {boolean} isDownbeat - True for beat 1 of measure.
     */
    playMetronomeClick(isDownbeat = false) {
        if (!this.audioCtx) return;
        const now = this.audioCtx.currentTime;

        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(isDownbeat ? 1600 : 1000, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.04);

        gain.gain.setValueAtTime(isDownbeat ? 0.9 : 0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
    }

    // Helper math & musical converters
    midiToFrequency(midi) {
        return this.a4 * Math.pow(2, (midi - 69) / 12);
    }

    midiToNoteName(midi) {
        return this.noteStrings[midi % 12];
    }

    getMedian(arr) {
        if (!arr.length) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
    }
}

if (typeof module !== 'undefined') {
    module.exports = GuitarDSP;
    module.exports.GuitarDSP = GuitarDSP;
}
