/**
 * Guitar Cabinet & Microphone Simulator DSP Module
 * Procedural/Synthetic Impulse Response (IR) Convolution Engine
 * 
 * Eliminates harsh digital fizz and aliasing harmonics from high-gain overdrive
 * and distortion stages, modeling authentic guitar amplifier speaker resonance,
 * cone dispersion, enclosure acoustics, and directional microphone placement.
 * 
 * Features:
 * 1. Procedural IR Synthesis (zero external .wav asset dependencies)
 *    - 100% deterministic mathematical filter cascades + boundary reflection taps.
 * 2. 3 Distinct Guitar Cabinet Profiles:
 *    - "4x12 Closed-Back UK": Tight low-end resonance at 110 Hz, Celestion mid bite at 2.8 kHz,
 *      notched high-end cut above 5.5 kHz eliminating clipping fizz.
 *    - "2x12 Open-Back US": Dipole rear-wave cancellation scoop at 500 Hz, airy top end,
 *      smooth high roll-off.
 *    - "1x12 Compact Tweed": Boxy midrange punch at 900 Hz, vintage small pine box enclosure,
 *      quick high-frequency roll-off above 4.5 kHz.
 * 3. Virtual Microphone Controls:
 *    - Position: Center (bright, aggressive, cutting on-axis dustcap) to Edge (dark, warm, smooth off-axis).
 *    - Distance: Near (acoustic proximity effect bass boost) to Far (ambient boundary reflections & room blend).
 * 4. True-Bypass Crossfading & Calibrated Peak Normalization (0.95 peakFS, no clipping).
 */

class CabinetBiquad {
    constructor() {
        this.b0 = 1.0;
        this.b1 = 0.0;
        this.b2 = 0.0;
        this.a1 = 0.0;
        this.a2 = 0.0;
        this.reset();
    }

    reset() {
        this.x1 = 0.0;
        this.x2 = 0.0;
        this.y1 = 0.0;
        this.y2 = 0.0;
    }

    process(x) {
        const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = x;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
    }

    setLowpass(f0, Q, fs) {
        const f = Math.max(20, Math.min(fs * 0.49, f0));
        const w0 = (2 * Math.PI * f) / fs;
        const cosw = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * Math.max(0.01, Q));
        const b0 = (1 - cosw) / 2;
        const b1 = 1 - cosw;
        const b2 = (1 - cosw) / 2;
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cosw) / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    setHighpass(f0, Q, fs) {
        const f = Math.max(20, Math.min(fs * 0.49, f0));
        const w0 = (2 * Math.PI * f) / fs;
        const cosw = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * Math.max(0.01, Q));
        const b0 = (1 + cosw) / 2;
        const b1 = -(1 + cosw);
        const b2 = (1 + cosw) / 2;
        const a0 = 1 + alpha;
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = (-2 * cosw) / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    setPeaking(f0, Q, gainDb, fs) {
        const f = Math.max(20, Math.min(fs * 0.49, f0));
        const A = Math.pow(10, gainDb / 40);
        const w0 = (2 * Math.PI * f) / fs;
        const cosw = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * Math.max(0.01, Q));
        const a0 = 1 + alpha / A;
        this.b0 = (1 + alpha * A) / a0;
        this.b1 = (-2 * cosw) / a0;
        this.b2 = (1 - alpha * A) / a0;
        this.a1 = (-2 * cosw) / a0;
        this.a2 = (1 - alpha / A) / a0;
        return this;
    }

    setNotch(f0, Q, fs) {
        const f = Math.max(20, Math.min(fs * 0.49, f0));
        const w0 = (2 * Math.PI * f) / fs;
        const cosw = Math.cos(w0);
        const alpha = Math.sin(w0) / (2 * Math.max(0.01, Q));
        const a0 = 1 + alpha;
        this.b0 = 1 / a0;
        this.b1 = (-2 * cosw) / a0;
        this.b2 = 1 / a0;
        this.a1 = (-2 * cosw) / a0;
        this.a2 = (1 - alpha) / a0;
        return this;
    }

    setLowShelf(f0, gainDb, fs) {
        const f = Math.max(20, Math.min(fs * 0.49, f0));
        const A = Math.pow(10, gainDb / 40);
        const w0 = (2 * Math.PI * f) / fs;
        const cosw = Math.cos(w0);
        const alpha = (Math.sin(w0) / 2) * Math.SQRT2;
        const a0 = (A + 1) + (A - 1) * cosw + 2 * Math.sqrt(A) * alpha;
        this.b0 = (A * ((A + 1) - (A - 1) * cosw + 2 * Math.sqrt(A) * alpha)) / a0;
        this.b1 = (2 * A * ((A - 1) - (A + 1) * cosw)) / a0;
        this.b2 = (A * ((A + 1) - (A - 1) * cosw - 2 * Math.sqrt(A) * alpha)) / a0;
        this.a1 = (-2 * ((A - 1) + (A + 1) * cosw)) / a0;
        this.a2 = ((A + 1) + (A - 1) * cosw - 2 * Math.sqrt(A) * alpha) / a0;
        return this;
    }
}

class CabinetSimulator {
    /**
     * Canonical list of available cabinet profiles.
     */
    static PROFILES = [
        '4x12 Closed-Back UK',
        '2x12 Open-Back US',
        '1x12 Compact Tweed'
    ];

    /**
     * Normalizes arbitrary user/string inputs to canonical profile names.
     * @param {string} name
     * @returns {string}
     */
    static normalizeProfile(name) {
        if (!name) return '4x12 Closed-Back UK';
        const str = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
        if (str.includes('2x12') || str.includes('open') || str.includes('us') || str.includes('twin') || str.includes('fender')) {
            return '2x12 Open-Back US';
        }
        if (str.includes('1x12') || str.includes('tweed') || str.includes('compact') || str.includes('deluxe') || str.includes('champ')) {
            return '1x12 Compact Tweed';
        }
        if (str.includes('4x12') || str.includes('closed') || str.includes('uk') || str.includes('marshall') || str.includes('celestion')) {
            return '4x12 Closed-Back UK';
        }
        return '4x12 Closed-Back UK';
    }

    /**
     * Synthesizes an acoustic impulse response procedurally using digital biquad cascades,
     * cone momentum damping, and early acoustic room reflection taps.
     * 
     * @param {string} profile - Cabinet profile
     * @param {number} position - Mic position (0 = Center / bright, 100 = Edge / dark)
     * @param {number} distance - Mic distance (0 = Near / proximity bass, 100 = Far / ambient room)
     * @param {number} [sampleRate=44100] - Sample rate in Hz
     * @param {Object} [audioContext=null] - Optional Web Audio context to allocate AudioBuffer
     * @param {number} [length=2048] - Buffer sample count
     * @returns {{left: Float32Array, right: Float32Array, buffer: AudioBuffer|null}}
     */
    static generateImpulseResponse(profile, position, distance, sampleRate = 44100, audioContext = null, length = 2048) {
        const fs = sampleRate || 44100;
        const normProfile = CabinetSimulator.normalizeProfile(profile);

        // Normalize microphone parameters (0.0 to 1.0)
        let posVal = Number(position);
        if (isNaN(posVal)) {
            const posStr = String(position).toLowerCase();
            posVal = posStr.includes('edge') ? 100 : (posStr.includes('mid') ? 50 : 0);
        }
        const posNorm = Math.max(0, Math.min(100, posVal)) / 100.0;

        let distVal = Number(distance);
        if (isNaN(distVal)) {
            const distStr = String(distance).toLowerCase();
            distVal = distStr.includes('far') ? 100 : (distStr.includes('mid') ? 50 : 0);
        }
        const distNorm = Math.max(0, Math.min(100, distVal)) / 100.0;

        const filters = [];

        // 1. Microphone Proximity Effect (Low-End Bass Boost when Near)
        // Directional dynamic mics (e.g. SM57) boost low frequencies < 150 Hz when right on the grille cloth.
        const proxDb = (1.0 - distNorm) * 5.0; // 0 dB (Far) to +5.0 dB (Near)
        if (Math.abs(proxDb) > 0.05) {
            filters.push(new CabinetBiquad().setLowShelf(115, proxDb, fs));
        }

        // 2. Microphone Placement: Center (on-axis dustcap) vs Edge (off-axis cone edge)
        // Center: cutting presence boost (+3.5 dB @ 3800 Hz) and extended high cutoff
        // Edge: darker, smooth high-frequency absorption (-6.0 dB @ 3800 Hz) and lowered cutoff
        const presenceDb = (1.0 - posNorm) * 3.5 - posNorm * 6.0;
        filters.push(new CabinetBiquad().setPeaking(3800, 1.3, presenceDb, fs));

        // Shift lowpass cutoff frequencies based on mic position
        // Center pushes cutoff up by +400 Hz; Edge pulls cutoff down by -750 Hz
        const lpShift = (1.0 - posNorm) * 400 - posNorm * 750;

        // 3. Cabinet Profile Filter Cascade
        switch (normProfile) {
            case '4x12 Closed-Back UK': {
                // Highpass sub-bass rumble cutoff
                filters.push(new CabinetBiquad().setHighpass(70, 0.707, fs));
                // Tight low-end bump at 110 Hz (+5.5 dB, Q=2.0)
                filters.push(new CabinetBiquad().setPeaking(110, 2.0, +5.5, fs));
                // Lower-midbody articulation
                filters.push(new CabinetBiquad().setPeaking(400, 1.0, -1.5, fs));
                // Celestion Vintage 30 cone breakup presence bite at 2.8 kHz
                filters.push(new CabinetBiquad().setPeaking(2800, 1.8, +3.8, fs));
                // Notched high-end cut above 5.5 kHz (attenuates upper harmonic fizz)
                filters.push(new CabinetBiquad().setNotch(5800, 2.8, fs));
                // Steep lowpass cascade eliminating harsh fizzy frequencies > 5.5 kHz
                filters.push(new CabinetBiquad().setLowpass(Math.min(5600, 5200 + lpShift), 0.707, fs));
                filters.push(new CabinetBiquad().setLowpass(Math.min(5800, 5500 + lpShift), 0.707, fs));
                filters.push(new CabinetBiquad().setLowpass(Math.min(6200, 5900 + lpShift), 0.707, fs));
                break;
            }

            case '2x12 Open-Back US': {
                // Highpass cutoff
                filters.push(new CabinetBiquad().setHighpass(65, 0.707, fs));
                // Resonant low-end bump
                filters.push(new CabinetBiquad().setPeaking(95, 1.4, +3.2, fs));
                // Warm scoop at 500 Hz (dipole rear-wave acoustic cancellation)
                filters.push(new CabinetBiquad().setPeaking(500, 1.2, -5.5, fs));
                // Upper-mid chime and airy presence
                filters.push(new CabinetBiquad().setPeaking(3500, 1.4, +3.2, fs));
                filters.push(new CabinetBiquad().setPeaking(4800, 1.1, +2.5, fs));
                // Airy top-end roll-off (preserves high detail up to ~6 kHz, then rolls off cleanly)
                filters.push(new CabinetBiquad().setLowpass(Math.min(6200, 5700 + lpShift), 0.707, fs));
                filters.push(new CabinetBiquad().setLowpass(Math.min(6400, 6000 + lpShift), 0.707, fs));
                filters.push(new CabinetBiquad().setLowpass(Math.min(6600, 6300 + lpShift), 0.707, fs));
                break;
            }

            case '1x12 Compact Tweed': {
                // Small box enclosure highpass (less sub-bass extension)
                filters.push(new CabinetBiquad().setHighpass(95, 0.707, fs));
                // Enclosure resonance bump
                filters.push(new CabinetBiquad().setPeaking(135, 1.8, +2.5, fs));
                // Boxy midrange punch at 900 Hz (+6.0 dB, Q=1.5)
                filters.push(new CabinetBiquad().setPeaking(900, 1.5, +6.0, fs));
                // Quick roll-off above 4.5 kHz (vintage paper cone, smooth warm roll-off)
                filters.push(new CabinetBiquad().setLowpass(Math.min(5000, 4500 + lpShift), 0.707, fs));
                filters.push(new CabinetBiquad().setLowpass(Math.min(5200, 4800 + lpShift), 0.707, fs));
                filters.push(new CabinetBiquad().setLowpass(Math.min(5500, 5100 + lpShift), 0.707, fs));
                break;
            }
        }

        // Initialize unit impulse signals
        const left = new Float32Array(length);
        const right = new Float32Array(length);
        left[0] = 1.0;
        right[0] = 1.0;

        // Process impulse through the full biquad filter chain
        for (const f of filters) {
            for (let i = 0; i < length; i++) left[i] = f.process(left[i]);
            f.reset();
            for (let i = 0; i < length; i++) right[i] = f.process(right[i]);
            f.reset();
        }

        // 4. Ambient Room Blend (Boundary & Wall Reflections for Far Distance)
        if (distNorm > 0.05) {
            const tapsL = [
                { delaySec: 0.0018, amp: -0.22 * distNorm }, // Floor bounce
                { delaySec: 0.0036, amp: 0.16 * distNorm },  // Cabinet baffle diffraction
                { delaySec: 0.0062, amp: -0.11 * distNorm }  // Room side wall reflection
            ];
            const tapsR = [
                { delaySec: 0.0022, amp: -0.20 * distNorm },
                { delaySec: 0.0041, amp: 0.15 * distNorm },
                { delaySec: 0.0069, amp: -0.12 * distNorm }
            ];

            for (const tap of tapsL) {
                const idx = Math.floor(tap.delaySec * fs);
                for (let i = 0; i < length - idx; i++) {
                    left[i + idx] += left[i] * tap.amp;
                }
            }
            for (const tap of tapsR) {
                const idx = Math.floor(tap.delaySec * fs);
                for (let i = 0; i < length - idx; i++) {
                    right[i + idx] += right[i] * tap.amp;
                }
            }
        }

        // 5. Speaker Cone Exponential Decay Envelope & Window Fade-Out
        const decayTau = 0.020 + 0.008 * distNorm; // 20ms - 28ms time constant
        for (let i = 0; i < length; i++) {
            const t = i / fs;
            const env = Math.exp(-t / decayTau);
            // Window fade-out over final 64 samples prevents click at buffer boundary
            const fade = i > length - 64 ? (length - 1 - i) / 64 : 1.0;
            left[i] *= env * fade;
            right[i] *= env * fade;
        }

        // 6. Finite Values Verification & Calibrated Peak Normalization
        let peak = 1e-9;
        for (let i = 0; i < length; i++) {
            if (!Number.isFinite(left[i])) left[i] = 0.0;
            if (!Number.isFinite(right[i])) right[i] = 0.0;
            if (Math.abs(left[i]) > peak) peak = Math.abs(left[i]);
            if (Math.abs(right[i]) > peak) peak = Math.abs(right[i]);
        }

        const targetPeak = 0.95; // -0.45 dBFS headroom prevents digital clipping
        const normFactor = targetPeak / peak;
        for (let i = 0; i < length; i++) {
            left[i] *= normFactor;
            right[i] *= normFactor;
        }

        // 7. Allocate Web Audio AudioBuffer if audioContext is provided
        let buffer = null;
        if (audioContext && typeof audioContext.createBuffer === 'function') {
            try {
                buffer = audioContext.createBuffer(2, length, fs);
                const bufL = buffer.getChannelData(0);
                const bufR = buffer.getChannelData(1);
                for (let i = 0; i < length; i++) {
                    bufL[i] = left[i];
                    bufR[i] = right[i];
                }
            } catch (err) {
                console.error("[CabinetSimulator] Failed to create AudioBuffer:", err);
            }
        }

        return { left, right, buffer };
    }

    /**
     * @param {AudioContext} audioContext - Web Audio Context instance
     * @param {Object} [options={}] - Configuration options
     */
    constructor(audioContext, options = {}) {
        if (!audioContext) {
            throw new Error("CabinetSimulator requires an active AudioContext instance.");
        }

        this.ctx = audioContext;
        this.sampleRate = this.ctx.sampleRate || 44100;

        this.state = {
            profile: CabinetSimulator.normalizeProfile(options.profile || '4x12 Closed-Back UK'),
            position: options.position !== undefined ? options.position : (options.micPosition !== undefined ? options.micPosition : 20),
            distance: options.distance !== undefined ? options.distance : (options.micDistance !== undefined ? options.micDistance : 15),
            level: options.level !== undefined ? options.level : 100,
            bypass: options.bypass !== undefined ? Boolean(options.bypass) : false
        };

        this._irDebounceTimer = null;
        this.irBuffer = null;
        this.irLeft = null;
        this.irRight = null;

        // Build AudioNode Graph
        this._buildNodeGraph();

        // Generate initial Impulse Response
        this.updateImpulseResponse(true);

        // Apply initial bypass and level
        this._applyState();
    }

    /**
     * Constructs the Web Audio convolution graph with true-bypass crossfading.
     * @private
     */
    _buildNodeGraph() {
        const c = this.ctx;

        this.input = c.createGain();
        this.output = c.createGain();

        // Wet convolution path
        this.convolver = c.createConvolver();
        this.convolver.normalize = false; // We use internal calibrated peak normalization
        this.wetGain = c.createGain();

        // True-bypass dry path
        this.dryGain = c.createGain();

        // Internal wiring:
        // Input -> Convolver -> WetGain -> Output
        this.input.connect(this.convolver);
        this.convolver.connect(this.wetGain);
        this.wetGain.connect(this.output);

        // Input -> DryGain -> Output
        this.input.connect(this.dryGain);
        this.dryGain.connect(this.output);
    }

    /**
     * Sets Cabinet Profile ('4x12 Closed-Back UK', '2x12 Open-Back US', '1x12 Compact Tweed').
     * @param {string} profileName
     * @param {boolean} [immediate=true]
     * @returns {CabinetSimulator}
     */
    setProfile(profileName, immediate = true) {
        this.state.profile = CabinetSimulator.normalizeProfile(profileName);
        this.updateImpulseResponse(immediate);
        return this;
    }

    getProfile() {
        return this.state.profile;
    }

    getAvailableProfiles() {
        return CabinetSimulator.PROFILES.slice();
    }

    /**
     * Sets virtual Microphone Position: 0 (Center / bright) to 100 (Edge / dark).
     * @param {number|string} val
     * @param {boolean} [immediate=false]
     * @returns {CabinetSimulator}
     */
    setMicPosition(val, immediate = false) {
        let pos = Number(val);
        if (isNaN(pos)) {
            const str = String(val).toLowerCase();
            pos = str.includes('edge') ? 100 : (str.includes('mid') ? 50 : 0);
        }
        this.state.position = Math.max(0, Math.min(100, pos));
        this.updateImpulseResponse(immediate);
        return this;
    }

    setPosition(val, immediate = false) {
        return this.setMicPosition(val, immediate);
    }

    getMicPosition() {
        return this.state.position;
    }

    /**
     * Sets virtual Microphone Distance: 0 (Near / proximity boost) to 100 (Far / ambient room blend).
     * @param {number|string} val
     * @param {boolean} [immediate=false]
     * @returns {CabinetSimulator}
     */
    setMicDistance(val, immediate = false) {
        let dist = Number(val);
        if (isNaN(dist)) {
            const str = String(val).toLowerCase();
            dist = str.includes('far') ? 100 : (str.includes('mid') ? 50 : 0);
        }
        this.state.distance = Math.max(0, Math.min(100, dist));
        this.updateImpulseResponse(immediate);
        return this;
    }

    setDistance(val, immediate = false) {
        return this.setMicDistance(val, immediate);
    }

    getMicDistance() {
        return this.state.distance;
    }

    /**
     * Sets output level (0 - 100).
     * @param {number} val
     * @returns {CabinetSimulator}
     */
    setLevel(val) {
        this.state.level = Math.max(0, Math.min(100, Number(val) || 0));
        this._applyState();
        return this;
    }

    getLevel() {
        return this.state.level;
    }

    /**
     * Sets true-bypass state.
     * @param {boolean} [bypassState] - If omitted, toggles bypass
     * @returns {boolean}
     */
    setBypass(bypassState) {
        const target = bypassState !== undefined ? Boolean(bypassState) : !this.state.bypass;
        this.state.bypass = target;
        this._applyState();
        return target;
    }

    isBypassed() {
        return Boolean(this.state.bypass);
    }

    /**
     * Sets parameter by name.
     * @param {string} param
     * @param {*} value
     * @returns {CabinetSimulator}
     */
    setParam(param, value) {
        const p = String(param).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        switch (p) {
            case 'profile':
            case 'cab':
            case 'type':
                this.setProfile(value, true);
                break;
            case 'position':
            case 'micposition':
            case 'pos':
            case 'micpos':
                this.setMicPosition(value, false);
                break;
            case 'distance':
            case 'micdistance':
            case 'dist':
            case 'micdist':
                this.setMicDistance(value, false);
                break;
            case 'level':
            case 'volume':
                this.setLevel(value);
                break;
            case 'bypass':
                this.setBypass(Boolean(value));
                break;
        }
        return this;
    }

    getParam(param) {
        const p = String(param).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
        if (p === 'profile' || p === 'cab') return this.state.profile;
        if (p === 'position' || p === 'micposition' || p === 'pos') return this.state.position;
        if (p === 'distance' || p === 'micdistance' || p === 'dist') return this.state.distance;
        if (p === 'level' || p === 'volume') return this.state.level;
        if (p === 'bypass') return this.state.bypass;
        return undefined;
    }

    getState() {
        return JSON.parse(JSON.stringify(this.state));
    }

    /**
     * Updates and loads the synthetic impulse response into the ConvolverNode.
     * @param {boolean} [immediate=false] - If true, regenerates immediately without debounce
     */
    updateImpulseResponse(immediate = false) {
        if (this._irDebounceTimer) {
            clearTimeout(this._irDebounceTimer);
            this._irDebounceTimer = null;
        }

        if (immediate) {
            this._generateAndAssignIR();
        } else {
            this._irDebounceTimer = setTimeout(() => {
                this._generateAndAssignIR();
                this._irDebounceTimer = null;
            }, 45); // 45ms debounce prevents audio thread hitches during slider dragging
        }
    }

    _generateAndAssignIR() {
        const ir = CabinetSimulator.generateImpulseResponse(
            this.state.profile,
            this.state.position,
            this.state.distance,
            this.sampleRate,
            this.ctx,
            2048
        );

        this.irLeft = ir.left;
        this.irRight = ir.right;
        this.irBuffer = ir.buffer;

        if (this.convolver && ir.buffer) {
            this.convolver.buffer = ir.buffer;
        }
    }

    /**
     * Returns the current Impulse Response AudioBuffer.
     * @returns {AudioBuffer|null}
     */
    getImpulseResponse() {
        return this.irBuffer;
    }

    /**
     * Returns channel data Float32Array (0 for Left, 1 for Right).
     * @param {number} [channel=0]
     * @returns {Float32Array|null}
     */
    getChannelData(channel = 0) {
        if (channel === 1) return this.irRight;
        return this.irLeft;
    }

    /**
     * Connects cabinet simulator output to destination AudioNode.
     * @param {AudioNode} dest
     * @returns {AudioNode}
     */
    connect(dest) {
        return this.output.connect(dest);
    }

    /**
     * Disconnects cabinet simulator output.
     * @param {AudioNode} [dest]
     */
    disconnect(dest) {
        return this.output.disconnect(dest);
    }

    /**
     * Applies bypass and volume scaling to Web Audio nodes.
     * @private
     */
    _applyState() {
        const now = this.ctx.currentTime || 0;
        const ramp = 0.02; // 20ms click-free crossfade
        const levelMult = Math.max(0, Math.min(100, this.state.level)) / 100.0;

        if (this.state.bypass) {
            if (this.dryGain.gain.setTargetAtTime) {
                this.dryGain.gain.setTargetAtTime(1.0, now, ramp);
                this.wetGain.gain.setTargetAtTime(0.0, now, ramp);
            } else {
                this.dryGain.gain.value = 1.0;
                this.wetGain.gain.value = 0.0;
            }
        } else {
            if (this.dryGain.gain.setTargetAtTime) {
                this.dryGain.gain.setTargetAtTime(0.0, now, ramp);
                this.wetGain.gain.setTargetAtTime(levelMult, now, ramp);
            } else {
                this.dryGain.gain.value = 0.0;
                this.wetGain.gain.value = levelMult;
            }
        }
    }

    /**
     * Cleans up resources.
     */
    destroy() {
        if (this._irDebounceTimer) {
            clearTimeout(this._irDebounceTimer);
            this._irDebounceTimer = null;
        }
        try {
            this.disconnect();
        } catch (e) {}
    }
}

// Universal module export for Browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CabinetSimulator;
}
if (typeof window !== 'undefined') {
    window.CabinetSimulator = CabinetSimulator;
}
