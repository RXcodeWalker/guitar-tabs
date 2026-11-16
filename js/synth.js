/**
 * Guitar Audio Playback Engine & Polyphonic Synthesizer
 * 
 * Features:
 * 1. Physical Karplus-Strong String Synthesis Model with fractional delay & body resonance.
 * 2. Polyphonic Web Audio Clean Electric Synthesizer with pluck envelopes.
 * 3. Playback Controller that scrubs the animated playhead through tablature,
 *    triggers audible plucks, and synchronizes real-time fretboard illumination.
 */

class GuitarSynth {
    constructor(options = {}) {
        this.sampleRate = options.sampleRate || 44100;
        this.audioCtx = options.audioCtx || null;
        this.soundEngine = options.soundEngine || 'karplus'; // 'karplus' | 'polysynth'
        this.masterVolume = options.volume !== undefined ? options.volume : 0.85;
        this.a4 = options.a4 || 440;

        // Active voices for polyphonic clean synth
        this.activeVoices = new Set();

        // Master gain node
        this.masterGain = null;
        this.bodyFilter = null;
    }

    /**
     * Initializes or resumes the Web Audio context.
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

        if (!this.masterGain) {
            this.masterGain = this.audioCtx.createGain();
            this.masterGain.gain.setValueAtTime(this.masterVolume, this.audioCtx.currentTime);

            // Guitar body resonance filter (acoustic cavity emulation ~110Hz body air resonance)
            this.bodyFilter = this.audioCtx.createBiquadFilter();
            this.bodyFilter.type = 'peaking';
            this.bodyFilter.frequency.setValueAtTime(115, this.audioCtx.currentTime);
            this.bodyFilter.Q.setValueAtTime(1.8, this.audioCtx.currentTime);
            this.bodyFilter.gain.setValueAtTime(3.5, this.audioCtx.currentTime);

            this.masterGain.connect(this.bodyFilter);
            this.bodyFilter.connect(this.audioCtx.destination);

            // Connect to Analyser for FFT spectral visualization & meters
            this.analyser = this.audioCtx.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.2;
            this.masterGain.connect(this.analyser);
        }
    }

    /**
     * Routes synth audio through an external GuitarEffectsRack or restores direct destination routing.
     * @param {GuitarEffectsRack|null} effectsRack
     */
    routeThroughEffectsRack(effectsRack) {
        this.effectsRack = effectsRack || null;
        if (this.bodyFilter && this.audioCtx) {
            try {
                this.bodyFilter.disconnect();
            } catch (e) {}

            if (effectsRack && effectsRack.inputNode) {
                // Route through Effects Rack input
                this.bodyFilter.connect(effectsRack.inputNode);
            } else {
                // Direct to destination
                this.bodyFilter.connect(this.audioCtx.destination);
            }
        }
    }

    getAnalyser() {
        return this.analyser;
    }

    setVolume(vol) {
        this.masterVolume = Math.max(0, Math.min(1, vol));
        if (this.masterGain && this.audioCtx) {
            this.masterGain.gain.setTargetAtTime(this.masterVolume, this.audioCtx.currentTime, 0.02);
        }
    }

    setSoundEngine(engine) {
        if (engine === 'karplus' || engine === 'polysynth') {
            this.soundEngine = engine;
        }
    }

    midiToFrequency(midi) {
        return this.a4 * Math.pow(2, (midi - 69) / 12);
    }

    /**
     * Plays a note using the currently active synthesis engine.
     * @param {number} midiNote
     * @param {number} duration - seconds
     * @param {number} velocity - 0.0 to 1.0
     * @param {number} stringNum - string index (1-6) for string-specific physical damping
     */
    playNote(midiNote, duration = 1.2, velocity = 0.85, stringNum = 1) {
        if (!this.audioCtx) return;
        if (this.soundEngine === 'polysynth') {
            this.playPolySynthNote(midiNote, duration, velocity);
        } else {
            this.playKarplusStrongNote(midiNote, duration, velocity, stringNum);
        }
    }

    /**
     * High-Precision Karplus-Strong Physical String Model
     * Implements filtered burst, fractional delay, string-dependent damping,
     * and string gauge tone characteristics.
     */
    playKarplusStrongNote(midiNote, duration = 1.5, velocity = 0.85, stringNum = 1) {
        const freq = this.midiToFrequency(midiNote);
        const sampleRate = this.audioCtx.sampleRate;
        const exactPeriod = sampleRate / freq;
        const periodSamples = Math.floor(exactPeriod);
        const fractionalDelay = exactPeriod - periodSamples;

        // Render duration samples (allow ring-out beyond nominal duration)
        const renderDuration = Math.min(4.0, Math.max(0.4, duration * 1.6));
        const numSamples = Math.floor(sampleRate * renderDuration);

        const audioBuffer = this.audioCtx.createBuffer(1, numSamples, sampleRate);
        const channelData = audioBuffer.getChannelData(0);

        // Circular delay line
        const ringBuffer = new Float32Array(periodSamples + 2);

        // Pick brightness and pluck excitation:
        // Thicker strings (string 5, 6) have darker initial pick noise.
        // Thinner strings (string 1, 2) have brighter pick attack.
        const pickBrightness = 0.25 + (7 - stringNum) * 0.08;
        let prevNoise = 0;
        for (let i = 0; i < periodSamples; i++) {
            const white = (Math.random() * 2 - 1);
            prevNoise = pickBrightness * white + (1 - pickBrightness) * prevNoise;
            ringBuffer[i] = prevNoise * velocity;
        }

        // Physical damping factor tuned by string frequency and register
        // Bass strings decay more slowly; high treble frets decay more rapidly.
        const baseDamping = 0.995 - Math.min(0.015, (freq / 3500) * 0.015);
        const damping = Math.max(0.970, baseDamping);

        let bufferIdx = 0;
        let filterMemory = 0;
        let allpassMemory = 0;

        // Allpass coefficient for fractional delay tuning: C = (1 - D) / (1 + D)
        const C = (1 - fractionalDelay) / (1 + fractionalDelay);

        for (let i = 0; i < numSamples; i++) {
            const currentSample = ringBuffer[bufferIdx];
            const nextIdx = (bufferIdx + 1) % periodSamples;

            // 1. First-order lowpass filter in feedback loop (string dispersion & loss)
            const lowpassed = (currentSample + ringBuffer[nextIdx]) * 0.5;

            // 2. First-order allpass filter for fractional delay phase correction
            const tuned = C * lowpassed + filterMemory - C * allpassMemory;
            filterMemory = lowpassed;
            allpassMemory = tuned;

            // Write back with damping
            ringBuffer[bufferIdx] = tuned * damping;

            channelData[i] = currentSample;
            bufferIdx = nextIdx;
        }

        // Audio node routing with gentle dynamic envelope
        const source = this.audioCtx.createBufferSource();
        source.buffer = audioBuffer;

        const gainNode = this.audioCtx.createGain();
        const now = this.audioCtx.currentTime;

        gainNode.gain.setValueAtTime(velocity, now);
        // Exponential decay envelope
        gainNode.gain.setValueAtTime(velocity, now + Math.max(0.05, duration * 0.7));
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + renderDuration);

        source.connect(gainNode);
        gainNode.connect(this.masterGain || this.audioCtx.destination);

        source.start(now);
    }

    /**
     * Web Audio Polyphonic Clean Synthesizer
     * Dual oscillators with pluck envelope and lowpass filter.
     */
    playPolySynthNote(midiNote, duration = 1.0, velocity = 0.85) {
        const freq = this.midiToFrequency(midiNote);
        const now = this.audioCtx.currentTime;

        const osc1 = this.audioCtx.createOscillator();
        const osc2 = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        const filterNode = this.audioCtx.createBiquadFilter();

        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(freq, now);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(freq * 2, now); // 1st overtone sparkle

        // Dynamic Pluck Filter
        filterNode.type = 'lowpass';
        filterNode.frequency.setValueAtTime(freq * 5.0, now);
        filterNode.frequency.exponentialRampToValueAtTime(freq * 1.2, now + Math.min(0.4, duration));

        // Pluck ADSR Amplitude Envelope
        const attack = 0.006;
        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.exponentialRampToValueAtTime(velocity, now + attack);
        gainNode.gain.setValueAtTime(velocity * 0.75, now + attack + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.1);

        osc1.connect(filterNode);
        osc2.connect(filterNode);
        filterNode.connect(gainNode);
        gainNode.connect(this.masterGain || this.audioCtx.destination);

        osc1.start(now);
        osc2.start(now);

        const stopTime = now + duration + 0.15;
        osc1.stop(stopTime);
        osc2.stop(stopTime);
    }
}

/**
 * Tablature Playback Controller
 * Orchestrates animated playhead scrubbing through recorded tablature,
 * audible note playback, and synchronized fretboard lighting.
 */
class TablaturePlaybackController {
    constructor(options = {}) {
        this.tablature = options.tablature;
        this.fretboard = options.fretboard;
        this.synth = options.synth;
        this.optimizer = options.optimizer;

        this.isPlaying = false;
        this.isPaused = false;
        this.isLooping = options.isLooping || false;
        this.playbackTime = 0;
        this.animationId = null;
        this.lastFrameTime = 0;
        this.scheduledNoteIndices = new Set();

        // Callbacks
        this.onPlaybackStateChange = options.onPlaybackStateChange || null;
        this.onNoteTrigger = options.onNoteTrigger || null;
    }

    /**
     * Toggles loop mode.
     */
    toggleLoop() {
        this.isLooping = !this.isLooping;
        return this.isLooping;
    }

    setLoop(looping) {
        this.isLooping = !!looping;
    }

    /**
     * Starts or resumes tablature playback from the beginning or current playhead.
     */
    async startPlayback(fromStart = true) {
        if (!this.tablature || this.tablature.notes.length === 0) {
            return false;
        }

        if (this.synth) {
            await this.synth.initAudioContext();
        }

        // Sort notes chronologically
        this.tablature.notes.sort((a, b) => a.time - b.time);

        if (fromStart || this.playbackTime >= this.getSongEndTime()) {
            this.playbackTime = 0;
            this.scheduledNoteIndices.clear();
            this.tablature.currentTime = 0;
        }

        this.isPlaying = true;
        this.isPaused = false;
        this.lastFrameTime = performance.now();

        // Pause normal manual staff auto-scrolling while in dedicated playback mode
        this.tablature.pause();

        if (this.onPlaybackStateChange) {
            this.onPlaybackStateChange({ isPlaying: true, isPaused: false });
        }

        this.loop();
        return true;
    }

    /**
     * Pauses playback.
     */
    pausePlayback() {
        this.isPlaying = false;
        this.isPaused = true;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.onPlaybackStateChange) {
            this.onPlaybackStateChange({ isPlaying: false, isPaused: true });
        }
    }

    /**
     * Stops playback and resets playhead.
     */
    stopPlayback() {
        this.isPlaying = false;
        this.isPaused = false;
        this.playbackTime = 0;
        this.scheduledNoteIndices.clear();

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.tablature) {
            this.tablature.currentTime = 0;
        }

        if (this.onPlaybackStateChange) {
            this.onPlaybackStateChange({ isPlaying: false, isPaused: false });
        }
    }

    /**
     * Toggles play/stop.
     */
    togglePlayback() {
        if (this.isPlaying) {
            this.stopPlayback();
            return false;
        } else {
            return this.startPlayback(true);
        }
    }

    getSongEndTime() {
        if (!this.tablature || this.tablature.notes.length === 0) return 0;
        let maxTime = 0;
        for (const n of this.tablature.notes) {
            const end = n.time + (n.duration || 0.4);
            if (end > maxTime) maxTime = end;
        }
        return maxTime + 0.5; // Small margin after last note
    }

    /**
     * Animation loop: scrubs playhead smoothly and fires audible note triggers.
     */
    loop() {
        if (!this.isPlaying) return;

        const now = performance.now();
        const dt = (now - this.lastFrameTime) / 1000;
        this.lastFrameTime = now;

        this.playbackTime += dt;
        this.tablature.currentTime = this.playbackTime;

        // Check for notes falling under current playhead window
        const notes = this.tablature.notes;
        const triggerWindow = 0.045; // 45ms lookahead window

        for (let i = 0; i < notes.length; i++) {
            const note = notes[i];
            if (!this.scheduledNoteIndices.has(i)) {
                if (this.playbackTime >= note.time - 0.015 && this.playbackTime <= note.time + triggerWindow) {
                    this.scheduledNoteIndices.add(i);
                    this.triggerNotePlayback(note);
                }
            }
        }

        // Check if playback reached the end of the score
        const songEndTime = this.getSongEndTime();
        if (this.playbackTime >= songEndTime) {
            if (this.isLooping && notes.length > 0) {
                this.playbackTime = 0;
                this.scheduledNoteIndices.clear();
                this.tablature.currentTime = 0;
            } else {
                this.stopPlayback();
                return;
            }
        }

        this.animationId = requestAnimationFrame(() => this.loop());
    }

    /**
     * Triggers sound and fretboard visual feedback for a note.
     */
    triggerNotePlayback(note) {
        // Calculate MIDI pitch if not present
        let midi = note.midi;
        if (typeof midi !== 'number' && this.optimizer) {
            const strIdx = (note.string || 1) - 1;
            const openMidi = this.optimizer.openMidi[strIdx];
            midi = openMidi + (note.fret || 0);
        }

        // 1. Play audible sound via Synth Engine
        if (this.synth && typeof midi === 'number') {
            this.synth.playNote(midi, note.duration || 0.8, 0.85, note.string || 1);
        }

        // 2. Light up fretboard
        if (this.fretboard) {
            this.fretboard.lightUpNote(
                note.string,
                note.fret,
                note.noteName || '',
                note.finger || 0
            );
        }

        if (this.onNoteTrigger) {
            this.onNoteTrigger(note, midi);
        }
    }
}

if (typeof module !== 'undefined') {
    module.exports = { GuitarSynth, TablaturePlaybackController };
}
