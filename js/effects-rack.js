/**
 * Guitar Effects Rack (Stompbox Chain)
 * Real-time analog audio modeling DSP using native Web Audio API nodes.
 * 
 * Features:
 * 1. Tube Screamer / Overdrive:
 *    - WaveShaperNode with asymmetric sigmoid transfer curve (analog triode / diode clipping).
 *    - Drive (0-100), Tone (Biquad low-pass tilt filter 800Hz-6500Hz), Output Level.
 * 2. Analog BBD Delay:
 *    - DelayNode with feedback loop and BiquadFilterNode (2200 Hz roll-off)
 *      simulating vintage bucket-brigade device (MN3005) analog degradation.
 *    - Time (20ms - 1000ms), Feedback (0-90% safe clamp), Wet/Dry Mix.
 * 3. Studio Ambient Reverb:
 *    - Algorithmic synthetic impulse response generated for ConvolverNode,
 *      simulating warm guitar spring tank flutter and plate dispersion.
 *    - Size (0.5s - 4.0s), Damping (0-100%), Wet/Dry Mix.
 * 4. Routing & Performance:
 *    - Master True-Bypass switches for each pedal and entire rack.
 *    - Split signal routing: Raw/unprocessed audio goes to pitch detection AnalyserNode
 *      while wet processed audio routes to audioContext.destination.
 * 5. Modular API: GuitarEffectsRack(audioContext, sourceNode) with .setParam(effect, param, value).
 */

class GuitarEffectsRack {
    /**
     * @param {AudioContext} audioContext - Native Web Audio API context
     * @param {AudioNode} [sourceNode=null] - Optional audio input source (e.g. MediaStreamSource or Synth)
     * @param {Object} [options={}] - Configuration options
     */
    constructor(audioContext, sourceNode = null, options = {}) {
        if (!audioContext) {
            throw new Error("GuitarEffectsRack requires an active Web Audio AudioContext instance.");
        }

        this.ctx = audioContext;
        this.sourceNode = null;
        this.destination = options.destination || this.ctx.destination;
        this.sampleRate = this.ctx.sampleRate || 44100;

        // Internal State Storage
        this.state = {
            overdrive: {
                drive: 45,       // 0 - 100
                tone: 50,        // 0 - 100 (800 Hz - 6500 Hz)
                level: 70,       // 0 - 100 (0.0 - 1.5 gain)
                bypass: false    // true-bypass
            },
            delay: {
                time: 350,       // 20ms - 1000ms
                feedback: 42,    // 0% - 90%
                mix: 35,         // 0% - 100%
                bypass: false    // true-bypass
            },
            reverb: {
                size: 2.2,       // 0.5s - 4.0s
                damping: 55,     // 0% - 100%
                mix: 30,         // 0% - 100%
                bypass: false    // true-bypass
            },
            master: {
                volume: 85,      // 0 - 100
                bypass: false,   // true-bypass all pedals
                mute: false,     // master audio output mute (avoids acoustic feedback when monitoring)
                monitorSpeakers: false // safety gate for mic monitoring to speakers
            }
        };

        // Reverb IR debounce handle
        this._irDebounceTimer = null;

        // Build Audio Node Graph
        this._buildNodeGraph();

        // Connect source if provided
        if (sourceNode) {
            this.setSourceNode(sourceNode);
        }

        // Apply initial parameters
        this._applyAllParams();
    }

    /**
     * Constructs the modular DSP node graph with split signal routing.
     * @private
     */
    _buildNodeGraph() {
        const c = this.ctx;

        // =====================================================================
        // 0. Input Stage & Split Signal Tap
        // =====================================================================
        // Main input summing node for the rack
        this.inputNode = c.createGain();
        this.inputNode.gain.setValueAtTime(1.0, c.currentTime);

        // Raw / Unprocessed Tap: Dedicated AnalyserNode for Pitch Detection
        // Kept isolated so distortion/delay/reverb harmonics never degrade pitch tracking.
        this.pitchAnalyser = c.createAnalyser();
        this.pitchAnalyser.fftSize = 2048;
        this.pitchAnalyser.smoothingTimeConstant = 0.0;
        this.inputNode.connect(this.pitchAnalyser);

        // Rack Wet Path Input Gate
        this.rackWetInput = c.createGain();
        this.rackWetInput.gain.setValueAtTime(1.0, c.currentTime);
        this.inputNode.connect(this.rackWetInput);

        // =====================================================================
        // 1. Tube Screamer / Overdrive Pedal
        // =====================================================================
        this.od = {
            input: c.createGain(),
            // Pre-emphasis highpass: cuts flubby sub-bass before clipping (classic TS 720Hz roll-off)
            preFilter: c.createBiquadFilter(),
            driveGain: c.createGain(),
            waveShaper: c.createWaveShaper(),
            toneFilter: c.createBiquadFilter(),
            levelGain: c.createGain(),
            dryGain: c.createGain(),
            wetGain: c.createGain(),
            output: c.createGain()
        };

        this.od.preFilter.type = 'highpass';
        this.od.preFilter.frequency.setValueAtTime(320, c.currentTime);
        this.od.preFilter.Q.setValueAtTime(0.707, c.currentTime);

        this.od.waveShaper.oversample = '4x'; // 4x oversampling suppresses digital aliasing
        this.od.waveShaper.curve = this._generateOverdriveCurve(4096);

        this.od.toneFilter.type = 'lowpass';
        this.od.toneFilter.Q.setValueAtTime(0.707, c.currentTime);

        // Overdrive internal wiring:
        // Input splits to dry and wet paths
        this.od.input.connect(this.od.dryGain);
        this.od.dryGain.connect(this.od.output);

        this.od.input.connect(this.od.preFilter);
        this.od.preFilter.connect(this.od.driveGain);
        this.od.driveGain.connect(this.od.waveShaper);
        this.od.waveShaper.connect(this.od.toneFilter);
        this.od.toneFilter.connect(this.od.levelGain);
        this.od.levelGain.connect(this.od.wetGain);
        this.od.wetGain.connect(this.od.output);

        // Connect Rack input to Overdrive
        this.rackWetInput.connect(this.od.input);

        // =====================================================================
        // 2. Analog BBD Delay Pedal
        // =====================================================================
        this.delay = {
            input: c.createGain(),
            dryGain: c.createGain(),
            wetGain: c.createGain(),
            delayNode: c.createDelay(2.0), // up to 2 seconds max buffer
            feedbackGain: c.createGain(),
            // BBD analog roll-off filter: suppresses clock noise and darkens successive repeats
            bbdFilter: c.createBiquadFilter(),
            // True-bypass crossfade gains
            bypassDryGain: c.createGain(),
            bypassWetGain: c.createGain(),
            output: c.createGain()
        };

        this.delay.bbdFilter.type = 'lowpass';
        this.delay.bbdFilter.frequency.setValueAtTime(2200, c.currentTime);
        this.delay.bbdFilter.Q.setValueAtTime(0.707, c.currentTime);

        // Delay internal wiring:
        // Input -> Dry path
        this.delay.input.connect(this.delay.dryGain);
        this.delay.dryGain.connect(this.delay.bypassWetGain);

        // Input -> Delay Node
        this.delay.input.connect(this.delay.delayNode);

        // Feedback loop: delay -> feedbackGain -> bbdFilter -> delay
        this.delay.delayNode.connect(this.delay.feedbackGain);
        this.delay.feedbackGain.connect(this.delay.bbdFilter);
        this.delay.bbdFilter.connect(this.delay.delayNode);

        // Delay Wet Output
        this.delay.delayNode.connect(this.delay.wetGain);
        this.delay.wetGain.connect(this.delay.bypassWetGain);

        // True-Bypass path
        this.delay.input.connect(this.delay.bypassDryGain);
        this.delay.bypassDryGain.connect(this.delay.output);
        this.delay.bypassWetGain.connect(this.delay.output);

        // Chain Overdrive -> Delay
        this.od.output.connect(this.delay.input);

        // =====================================================================
        // 3. Studio Ambient Reverb Pedal (Spring / Plate IR Convolver)
        // =====================================================================
        this.reverb = {
            input: c.createGain(),
            convolver: c.createConvolver(),
            dryGain: c.createGain(),
            wetGain: c.createGain(),
            // True-bypass crossfade gains
            bypassDryGain: c.createGain(),
            bypassWetGain: c.createGain(),
            output: c.createGain()
        };

        this.reverb.convolver.normalize = false; // We do calibrated normalization in synthetic IR

        // Reverb internal wiring:
        // Input -> Dry
        this.reverb.input.connect(this.reverb.dryGain);
        this.reverb.dryGain.connect(this.reverb.bypassWetGain);

        // Input -> Convolver -> Wet
        this.reverb.input.connect(this.reverb.convolver);
        this.reverb.convolver.connect(this.reverb.wetGain);
        this.reverb.wetGain.connect(this.reverb.bypassWetGain);

        // True-Bypass path
        this.reverb.input.connect(this.reverb.bypassDryGain);
        this.reverb.bypassDryGain.connect(this.reverb.output);
        this.reverb.bypassWetGain.connect(this.reverb.output);

        // Chain Delay -> Reverb
        this.delay.output.connect(this.reverb.input);

        // =====================================================================
        // 4. Master Output & Master True-Bypass Stage
        // =====================================================================
        this.master = {
            processedInput: c.createGain(),
            masterBypassDry: c.createGain(),
            outputGain: c.createGain(),
            muteGain: c.createGain()
        };

        // Reverb connects to processed input
        this.reverb.output.connect(this.master.processedInput);

        // Master bypass dry connects straight from inputNode
        this.inputNode.connect(this.master.masterBypassDry);

        // Summing into output
        this.master.processedInput.connect(this.master.outputGain);
        this.master.masterBypassDry.connect(this.master.outputGain);

        // Safety mute gate
        this.master.outputGain.connect(this.master.muteGain);

        // Finally connect to audioContext.destination
        if (this.destination) {
            this.master.muteGain.connect(this.destination);
        }

        // Generate initial reverb impulse response
        this._updateReverbImpulse();
    }

    /**
     * Connects an external audio source node (e.g. mic stream or synth) to the rack input.
     * @param {AudioNode} source
     */
    setSourceNode(source) {
        if (this.sourceNode) {
            try {
                this.sourceNode.disconnect(this.inputNode);
            } catch (e) {
                // Ignore if already disconnected
            }
        }
        this.sourceNode = source;
        if (this.sourceNode) {
            this.sourceNode.connect(this.inputNode);
        }
    }

    /**
     * Sets a parameter on the guitar effects rack.
     * @param {string} effect - 'overdrive' | 'delay' | 'reverb' | 'master' (or aliases: 'tubeScreamer', 'bbd', etc.)
     * @param {string} param - Parameter name
     * @param {number|boolean} value - Parameter value
     * @returns {GuitarEffectsRack} returns this for chaining
     */
    setParam(effect, param, value) {
        const effKey = this._normalizeEffectName(effect);
        const pKey = String(param).toLowerCase().trim();

        if (!effKey || !this.state[effKey]) {
            console.warn(`[GuitarEffectsRack] Unknown effect '${effect}'. Valid: overdrive, delay, reverb, master`);
            return this;
        }

        const now = this.ctx.currentTime;
        const rampTime = 0.025; // 25ms smoothing prevents audio clicks

        switch (effKey) {
            case 'overdrive':
                this._setOverdriveParam(pKey, value, now, rampTime);
                break;
            case 'delay':
                this._setDelayParam(pKey, value, now, rampTime);
                break;
            case 'reverb':
                this._setReverbParam(pKey, value, now, rampTime);
                break;
            case 'master':
                this._setMasterParam(pKey, value, now, rampTime);
                break;
        }

        return this;
    }

    /**
     * Gets current value of a parameter.
     * @param {string} effect
     * @param {string} param
     * @returns {*}
     */
    getParam(effect, param) {
        const effKey = this._normalizeEffectName(effect);
        const pKey = String(param).toLowerCase().trim();
        if (effKey && this.state[effKey] && this.state[effKey][pKey] !== undefined) {
            return this.state[effKey][pKey];
        }
        return undefined;
    }

    /**
     * Toggles or sets true-bypass on an individual pedal or master rack.
     * @param {string} effect - 'overdrive' | 'delay' | 'reverb' | 'master'
     * @param {boolean} [bypassState] - If omitted, toggles current bypass state
     * @returns {boolean} New bypass state
     */
    setBypass(effect, bypassState) {
        const effKey = this._normalizeEffectName(effect);
        if (!effKey || !this.state[effKey]) return false;

        const current = this.state[effKey].bypass;
        const target = bypassState !== undefined ? Boolean(bypassState) : !current;
        this.setParam(effKey, 'bypass', target);
        return target;
    }

    /**
     * Checks if an effect is currently bypassed.
     * @param {string} effect
     * @returns {boolean}
     */
    isBypassed(effect) {
        const effKey = this._normalizeEffectName(effect);
        return Boolean(this.state[effKey] && this.state[effKey].bypass);
    }

    /**
     * Returns a deep copy of the full rack state snapshot.
     * @returns {Object}
     */
    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    /**
     * Returns the dedicated raw AnalyserNode for pitch detection.
     * Pristine unprocessed signal guarantees rock-solid pitch detection accuracy.
     * @returns {AnalyserNode}
     */
    getPitchAnalyser() {
        return this.pitchAnalyser;
    }

    /**
     * Connects the rack's final audio output to a custom audio destination node.
     * @param {AudioNode} destinationNode
     */
    connect(destinationNode) {
        if (this.destination && this.master && this.master.muteGain) {
            try {
                this.master.muteGain.disconnect(this.destination);
            } catch (e) {}
        }
        this.destination = destinationNode || this.ctx.destination;
        if (this.destination && this.master && this.master.muteGain) {
            this.master.muteGain.connect(this.destination);
        }
    }

    /**
     * Disconnects the rack output from the destination.
     */
    disconnect() {
        if (this.master && this.master.muteGain) {
            try {
                this.master.muteGain.disconnect();
            } catch (e) {}
        }
    }

    /**
     * Cleans up all audio nodes and disconnects everything.
     */
    destroy() {
        if (this._irDebounceTimer) {
            clearTimeout(this._irDebounceTimer);
            this._irDebounceTimer = null;
        }
        this.disconnect();
        if (this.sourceNode) {
            try {
                this.sourceNode.disconnect(this.inputNode);
            } catch (e) {}
            this.sourceNode = null;
        }
    }

    // =========================================================================
    // Internal Parameter Setters
    // =========================================================================

    /**
     * @private
     */
    _setOverdriveParam(param, value, now, rampTime) {
        switch (param) {
            case 'drive': {
                const val = Math.max(0, Math.min(100, Number(value) || 0));
                this.state.overdrive.drive = val;
                // Linear to exponential drive mapping: gain 1.0 (clean) to 25.0 (saturated lead)
                const preGain = 1.0 + (val / 100) * 24.0;
                this.od.driveGain.gain.setTargetAtTime(preGain, now, rampTime);
                break;
            }
            case 'tone': {
                const val = Math.max(0, Math.min(100, Number(value) || 0));
                this.state.overdrive.tone = val;
                // Logarithmic tilt mapping from 800 Hz to 6500 Hz
                const minF = 800;
                const maxF = 6500;
                const cutoff = minF * Math.pow(maxF / minF, val / 100);
                this.od.toneFilter.frequency.setTargetAtTime(cutoff, now, rampTime);
                break;
            }
            case 'level': {
                const val = Math.max(0, Math.min(100, Number(value) || 0));
                this.state.overdrive.level = val;
                // Output level scaling (0.0 to 1.5)
                const levelGain = (val / 100) * 1.5;
                this.od.levelGain.gain.setTargetAtTime(levelGain, now, rampTime);
                break;
            }
            case 'bypass': {
                const bypass = Boolean(value);
                this.state.overdrive.bypass = bypass;
                if (bypass) {
                    this.od.dryGain.gain.setTargetAtTime(1.0, now, 0.015);
                    this.od.wetGain.gain.setTargetAtTime(0.0, now, 0.015);
                } else {
                    this.od.dryGain.gain.setTargetAtTime(0.0, now, 0.015);
                    this.od.wetGain.gain.setTargetAtTime(1.0, now, 0.015);
                }
                break;
            }
        }
    }

    /**
     * @private
     */
    _setDelayParam(param, value, now, rampTime) {
        switch (param) {
            case 'time': {
                // Input accepts ms (20 - 1000) or fractional seconds (0.02 - 1.0)
                let ms = Number(value) || 0;
                if (ms < 2.0 && ms > 0.0) ms *= 1000; // treat values < 2 as seconds
                ms = Math.max(20, Math.min(1000, ms));
                this.state.delay.time = ms;
                const timeSec = ms / 1000.0;
                this.delay.delayNode.delayTime.setTargetAtTime(timeSec, now, 0.035);
                break;
            }
            case 'feedback': {
                // Input accepts 0-90 (percent) or 0.0-0.90 (fraction)
                let fb = Number(value) || 0;
                if (fb <= 1.0 && fb > 0.0) fb *= 100;
                // STRICT SAFETY CLAMP: 0% to 90% max to guarantee no runaway infinite squeal
                fb = Math.max(0, Math.min(90, fb));
                this.state.delay.feedback = fb;
                const fbGain = fb / 100.0;
                this.delay.feedbackGain.gain.setTargetAtTime(fbGain, now, rampTime);
                break;
            }
            case 'mix': {
                // Wet/Dry mix: 0% to 100%
                let mix = Number(value) || 0;
                if (mix <= 1.0 && mix > 0.0) mix *= 100;
                mix = Math.max(0, Math.min(100, mix));
                this.state.delay.mix = mix;
                // Equal-power crossfade
                const rad = (mix / 100) * (Math.PI / 2);
                this.delay.dryGain.gain.setTargetAtTime(Math.cos(rad), now, rampTime);
                this.delay.wetGain.gain.setTargetAtTime(Math.sin(rad), now, rampTime);
                break;
            }
            case 'bypass': {
                const bypass = Boolean(value);
                this.state.delay.bypass = bypass;
                if (bypass) {
                    this.delay.bypassDryGain.gain.setTargetAtTime(1.0, now, 0.015);
                    this.delay.bypassWetGain.gain.setTargetAtTime(0.0, now, 0.015);
                } else {
                    this.delay.bypassDryGain.gain.setTargetAtTime(0.0, now, 0.015);
                    this.delay.bypassWetGain.gain.setTargetAtTime(1.0, now, 0.015);
                }
                break;
            }
        }
    }

    /**
     * @private
     */
    _setReverbParam(param, value, now, rampTime) {
        switch (param) {
            case 'size': {
                // Size in seconds (0.5s - 4.0s) or 0-100 scale
                let s = Number(value) || 0;
                if (s > 10.0) {
                    // map 0-100 to 0.5 - 4.0s
                    s = 0.5 + (s / 100) * 3.5;
                }
                s = Math.max(0.5, Math.min(4.0, s));
                this.state.reverb.size = s;
                this._scheduleReverbImpulseUpdate();
                break;
            }
            case 'damping': {
                // High frequency damping 0% to 100%
                let d = Number(value) || 0;
                if (d <= 1.0 && d > 0.0) d *= 100;
                d = Math.max(0, Math.min(100, d));
                this.state.reverb.damping = d;
                this._scheduleReverbImpulseUpdate();
                break;
            }
            case 'mix': {
                // Wet/Dry mix: 0% to 100%
                let mix = Number(value) || 0;
                if (mix <= 1.0 && mix > 0.0) mix *= 100;
                mix = Math.max(0, Math.min(100, mix));
                this.state.reverb.mix = mix;
                // Equal-power crossfade
                const rad = (mix / 100) * (Math.PI / 2);
                this.reverb.dryGain.gain.setTargetAtTime(Math.cos(rad), now, rampTime);
                this.reverb.wetGain.gain.setTargetAtTime(Math.sin(rad), now, rampTime);
                break;
            }
            case 'bypass': {
                const bypass = Boolean(value);
                this.state.reverb.bypass = bypass;
                if (bypass) {
                    this.reverb.bypassDryGain.gain.setTargetAtTime(1.0, now, 0.015);
                    this.reverb.bypassWetGain.gain.setTargetAtTime(0.0, now, 0.015);
                } else {
                    this.reverb.bypassDryGain.gain.setTargetAtTime(0.0, now, 0.015);
                    this.reverb.bypassWetGain.gain.setTargetAtTime(1.0, now, 0.015);
                }
                break;
            }
        }
    }

    /**
     * @private
     */
    _setMasterParam(param, value, now, rampTime) {
        switch (param) {
            case 'volume': {
                let vol = Number(value) || 0;
                if (vol <= 1.5 && vol > 0.0) vol *= 100;
                vol = Math.max(0, Math.min(100, vol));
                this.state.master.volume = vol;
                const gain = (vol / 100) * 1.0;
                this.master.outputGain.gain.setTargetAtTime(gain, now, rampTime);
                break;
            }
            case 'bypass': {
                const bypass = Boolean(value);
                this.state.master.bypass = bypass;
                if (bypass) {
                    this.master.processedInput.gain.setTargetAtTime(0.0, now, 0.015);
                    this.master.masterBypassDry.gain.setTargetAtTime(1.0, now, 0.015);
                } else {
                    this.master.processedInput.gain.setTargetAtTime(1.0, now, 0.015);
                    this.master.masterBypassDry.gain.setTargetAtTime(0.0, now, 0.015);
                }
                break;
            }
            case 'mute': {
                const mute = Boolean(value);
                this.state.master.mute = mute;
                this.master.muteGain.gain.setTargetAtTime(mute ? 0.0 : 1.0, now, 0.015);
                break;
            }
            case 'monitorspeakers': {
                const monitor = Boolean(value);
                this.state.master.monitorSpeakers = monitor;
                // If monitoring is disabled (default for live mic), mute speaker path to avoid feedback
                this.master.muteGain.gain.setTargetAtTime(monitor ? 1.0 : 0.0, now, 0.015);
                break;
            }
        }
    }

    /**
     * Applies all stored state parameters to the Web Audio nodes.
     * @private
     */
    _applyAllParams() {
        const now = this.ctx.currentTime;
        const ramp = 0.01;

        this._setOverdriveParam('drive', this.state.overdrive.drive, now, ramp);
        this._setOverdriveParam('tone', this.state.overdrive.tone, now, ramp);
        this._setOverdriveParam('level', this.state.overdrive.level, now, ramp);
        this._setOverdriveParam('bypass', this.state.overdrive.bypass, now, ramp);

        this._setDelayParam('time', this.state.delay.time, now, ramp);
        this._setDelayParam('feedback', this.state.delay.feedback, now, ramp);
        this._setDelayParam('mix', this.state.delay.mix, now, ramp);
        this._setDelayParam('bypass', this.state.delay.bypass, now, ramp);

        this._setReverbParam('mix', this.state.reverb.mix, now, ramp);
        this._setReverbParam('bypass', this.state.reverb.bypass, now, ramp);

        this._setMasterParam('volume', this.state.master.volume, now, ramp);
        this._setMasterParam('bypass', this.state.master.bypass, now, ramp);
        this._setMasterParam('mute', this.state.master.mute, now, ramp);
        this._setMasterParam('monitorspeakers', this.state.master.monitorSpeakers, now, ramp);
    }

    // =========================================================================
    // DSP Mathematical Modeling Algorithms
    // =========================================================================

    /**
     * Generates a custom non-linear sigmoid transfer curve modeling asymmetric tube saturation
     * and soft-knee clipping (similar to 12AX7 vacuum triode and Ibanez TS808 diode clipping).
     * 
     * Formula:
     *   f(x) = tanh(k * x + alpha * x^2)
     *   Zero DC offset: f(0) = 0
     *   Asymmetric positive vs negative saturation produces rich 2nd and 3rd harmonic bloom.
     * 
     * @param {number} [samples=4096] - Number of points in the lookup curve
     * @param {number} [asymmetry=0.35] - Quadratic asymmetry coefficient
     * @param {number} [driveK=2.2] - Non-linear sigmoid slope steepness
     * @returns {Float32Array}
     */
    _generateOverdriveCurve(samples = 4096, asymmetry = 0.35, driveK = 2.2) {
        const curve = new Float32Array(samples);
        const yPosMax = Math.tanh(driveK + asymmetry);
        const yNegMax = Math.abs(Math.tanh(-driveK + asymmetry));
        const norm = Math.max(yPosMax, yNegMax);

        for (let i = 0; i < samples; i++) {
            // Normalized input x in [-1.0, 1.0]
            const x = (2 * i) / (samples - 1) - 1.0;
            // Asymmetric polynomial argument: x^2 term introduces even harmonics (tube warmth)
            const u = driveK * x + asymmetry * x * x;
            // Hyperbolic tangent provides smooth saturation asymptotic soft clipping
            const y = Math.tanh(u);
            curve[i] = y / norm;
        }

        return curve;
    }

    /**
     * Debounces reverb impulse response regeneration to avoid audio thread stalls
     * during rapid parameter dragging.
     * @private
     */
    _scheduleReverbImpulseUpdate() {
        if (this._irDebounceTimer) {
            clearTimeout(this._irDebounceTimer);
        }
        this._irDebounceTimer = setTimeout(() => {
            this._updateReverbImpulse();
            this._irDebounceTimer = null;
        }, 60);
    }

    /**
     * Synthesizes an algorithmic impulse response buffer for the ConvolverNode,
     * simulating a warm guitar spring tank and plate reverb.
     * 
     * Features:
     * - Multi-tap early reflections simulating spring transducer dispersion and bounces.
     * - Exponential decay envelope.
     * - Time-varying recursive lowpass filter implementing high-frequency damping.
     * - Stereo decorrelation for a wide, natural spatial soundstage.
     * - Calibrated peak normalization.
     * @private
     */
    _updateReverbImpulse() {
        const sizeSeconds = this.state.reverb.size;
        const damping = this.state.reverb.damping;
        const sr = this.sampleRate;
        const length = Math.floor(sr * sizeSeconds);

        if (length <= 0) return;

        // Allocate stereo buffer
        let buffer;
        try {
            buffer = this.ctx.createBuffer(2, length, sr);
        } catch (err) {
            console.error("[GuitarEffectsRack] Failed to create reverb AudioBuffer:", err);
            return;
        }

        const left = buffer.getChannelData(0);
        const right = buffer.getChannelData(1);

        const decayRate = 3.6 / sizeSeconds;
        const dampingNorm = damping / 100.0;
        const alphaTarget = 0.12 + dampingNorm * 0.72; // higher damping -> filter closes more severely

        // Early spring tank bounce taps (seconds, amplitude, stereo pan)
        const earlyTaps = [
            { time: 0.012, amp: 0.65, pan: -0.35 },
            { time: 0.021, amp: -0.55, pan: 0.40 },
            { time: 0.033, amp: 0.48, pan: -0.20 },
            { time: 0.046, amp: -0.42, pan: 0.30 },
            { time: 0.062, amp: 0.35, pan: -0.10 }
        ];

        let yL = 0;
        let yR = 0;
        let peak = 1e-6;

        for (let i = 0; i < length; i++) {
            const t = i / sr;

            // Attack envelope (8ms rise) + exponential decay tail
            const env = (1.0 - Math.exp(-t / 0.008)) * Math.exp(-t * decayRate);

            // Progressive time-varying damping: high frequencies damp out faster over tail duration
            const progress = Math.min(1.0, t / (sizeSeconds * 0.75));
            const alpha = 0.06 + (alphaTarget - 0.06) * progress;

            // Decorrelated noise burst
            const nL = (Math.random() * 2 - 1) * env;
            const nR = (Math.random() * 2 - 1) * env;

            // 1-pole recursive lowpass filter for high-frequency absorption
            yL = yL * alpha + nL * (1 - alpha);
            yR = yR * alpha + nR * (1 - alpha);

            left[i] = yL;
            right[i] = yR;
        }

        // Inject early spring reflections into head of buffer
        for (const tap of earlyTaps) {
            const idx = Math.floor(tap.time * sr);
            if (idx < length) {
                const lGain = tap.amp * (0.5 - tap.pan * 0.5);
                const rGain = tap.amp * (0.5 + tap.pan * 0.5);
                left[idx] += lGain;
                right[idx] += rGain;
            }
        }

        // Measure peak for calibrated normalization
        for (let i = 0; i < length; i++) {
            if (Math.abs(left[i]) > peak) peak = Math.abs(left[i]);
            if (Math.abs(right[i]) > peak) peak = Math.abs(right[i]);
        }

        // Normalize peak to 0.92 to prevent digital clipping
        const normFactor = 0.92 / peak;
        for (let i = 0; i < length; i++) {
            left[i] *= normFactor;
            right[i] *= normFactor;
        }

        // Assign to ConvolverNode
        this.reverb.convolver.buffer = buffer;
    }

    /**
     * @private
     */
    _normalizeEffectName(effect) {
        if (!effect) return null;
        const e = String(effect).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (e === 'overdrive' || e === 'od' || e === 'tubescreamer' || e === 'ts' || e === 'distortion' || e === 'drive') {
            return 'overdrive';
        }
        if (e === 'delay' || e === 'bbd' || e === 'bbddelay' || e === 'echo') {
            return 'delay';
        }
        if (e === 'reverb' || e === 'spring' || e === 'plate' || e === 'ambient' || e === 'springreverb') {
            return 'reverb';
        }
        if (e === 'master' || e === 'rack' || e === 'global' || e === 'main') {
            return 'master';
        }
        return null;
    }
}

// Universal module export for Browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GuitarEffectsRack;
}
if (typeof window !== 'undefined') {
    window.GuitarEffectsRack = GuitarEffectsRack;
}
