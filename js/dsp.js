/**
 * Audio DSP Engine (Phase 1)
 * Real-time guitar pitch detection, onset/pluck transient detector,
 * Karplus-Strong physical string synthesizer, and metronome timing engine.
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
        this.isRunning = false;

        // Tuner & Pitch settings
        this.a4 = options.a4 || 440;
        this.minFreq = 70.0;   // Below Low D (73.4 Hz)
        this.maxFreq = 1350.0; // Above 22nd fret High E (D6 = 1175 Hz, E6 = 1318 Hz)
        this.yinThreshold = 0.12; // YIN dip threshold
        this.noiseGateRMS = 0.008; // Minimum RMS signal level
        this.onsetThreshold = 0.015; // Sudden energy jump for pluck detection

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
        this.onSilence = options.onSilence || null;
        this.onWaveformData = options.onWaveformData || null;

        // Buffers
        this.timeDomainBuffer = new Float32Array(this.bufferSize);

        // Note names lookup table
        this.noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    }

    /**
     * Initializes the Web Audio context if not already done.
     */
    async initAudioContext() {
        if (!this.audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            this.audioCtx = new AudioContextClass({
                latencyHint: 'interactive',
                sampleRate: this.sampleRate
            });
        }
        if (this.audioCtx.state === 'suspended') {
            await this.audioCtx.resume();
        }
        this.sampleRate = this.audioCtx.sampleRate;
    }

    /**
     * Connects physical microphone for live guitar analysis.
     */
    async startMicrophone() {
        await this.initAudioContext();

        try {
            this.micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                    latency: 0
                }
            });

            this.sourceNode = this.audioCtx.createMediaStreamSource(this.micStream);
            
            // Analyser node for time-domain extraction
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = this.bufferSize * 2;
            this.analyser.smoothingTimeConstant = 0.0;
            
            // Connect to analyser (do not connect to audioCtx.destination to avoid mic feedback!)
            this.sourceNode.connect(this.analyser);

            this.isRunning = true;
            this.processAudioLoop();
            return { success: true };
        } catch (err) {
            console.error("Microphone access failed:", err);
            return { success: false, error: err.message };
        }
    }

    /**
     * Stops microphone capture.
     */
    stopMicrophone() {
        this.isRunning = false;
        if (this.micStream) {
            this.micStream.getTracks().forEach(track => track.stop());
            this.micStream = null;
        }
        if (this.sourceNode) {
            this.sourceNode.disconnect();
            this.sourceNode = null;
        }
    }

    /**
     * Continuous audio processing loop using requestAnimationFrame for zero audio-thread stutter.
     */
    processAudioLoop() {
        if (!this.isRunning) return;

        if (this.analyser) {
            this.analyser.getFloatTimeDomainData(this.timeDomainBuffer);
            this.analyzeFrame(this.timeDomainBuffer, this.audioCtx.currentTime);

            if (this.onWaveformData) {
                this.onWaveformData(this.timeDomainBuffer);
            }
        }

        requestAnimationFrame(() => this.processAudioLoop());
    }

    /**
     * Analyzes a single frame of raw audio samples for pitch, RMS, and onset pluck.
     */
    analyzeFrame(buffer, currentTime) {
        // 1. Calculate RMS Energy
        let sumSq = 0;
        for (let i = 0; i < buffer.length; i++) {
            sumSq += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSq / buffer.length);

        // Check noise gate
        if (rms < this.noiseGateRMS) {
            this.prevRMS = rms;
            this.pitchHistory = [];
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
}
