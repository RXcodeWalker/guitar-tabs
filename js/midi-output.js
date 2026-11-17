/**
 * FretDSP — Web MIDI & Low-Latency Audio-to-MIDI Bridge Module
 * File: js/midi-output.js
 * 
 * Converts live guitar audio analysis (fundamental pitch f0, RMS energy,
 * transient onset triggers, and pitch confidence) into standard Web MIDI output
 * messages (Note On, Note Off, Velocity, and 14-bit continuous Pitch Bend).
 * 
 * Key Capabilities:
 * 1. Web MIDI Interface & Port Discovery:
 *    - Wraps navigator.requestMIDIAccess() with dynamic hardware & virtual port detection.
 *    - Listens to device hot-plugging via onstatechange.
 *    - Falls back gracefully to a software loopback logger in headless/denied environments.
 * 2. Transient-to-Velocity & Note On/Off State Machine:
 *    - Maps attack transient amplitude (RMS peak at onset) to MIDI velocity (1-127)
 *      using a musical logarithmic sensitivity curve.
 *    - Acoustic noise gate & hysteresis threshold (energy floor, confidence floor,
 *      and minimum note duration lock ~50ms) to suppress finger squeaks and fret rattles.
 *    - Timely Note Off emission when string vibration decays below threshold.
 * 3. Continuous 14-Bit Pitch Bend (Vibrato & Bends):
 *    - Tracks real-time micro-pitch deviations (cents off nominal equal temperament note).
 *    - Converts ±2 semitone (or user-configurable ±12 / ±24 semitone) bends into standard
 *      14-bit MIDI pitch wheel messages (LSB and MSB) with centering at 0x2000 (8192).
 *    - Musical deadband filtering to prevent jitter on straight notes.
 * 4. MIDI Channel & Monophonic / MPE Modes:
 *    - Standard Monophonic mode (Channel 1 default) with voice transition handling.
 *    - Full MPE (MIDI Polyphonic Expression) per-string routing (Channels 2-7 default)
 *      allowing independent pitch bends on individual strings.
 *    - Standard MIDI RPN (Registered Parameter Number) Pitch Bend Sensitivity configuration.
 */

class GuitarMIDIOutput {
    /**
     * @param {Object} [options={}] - Configuration options
     */
    constructor(options = {}) {
        this.options = options;

        // 1. Operating Modes & Routing
        // 'monophonic' | 'mpe' | 'polyphonic'
        this.mode = options.mode || 'monophonic';
        this.baseChannel = (options.channel !== undefined) ? Math.max(1, Math.min(16, options.channel)) : 1;

        // MPE Lower Zone configuration
        // Master: Ch 1; Member channels for 6-string guitar: Ch 2..7
        this.mpeZone = {
            masterChannel: options.mpeMasterChannel || 1,
            lowerChannel: options.mpeLowerChannel || 2,
            upperChannel: options.mpeUpperChannel || 7
        };
        // Per-string channel allocation (default strings 0..5 -> Ch 2..7)
        this.stringChannels = options.stringChannels || [2, 3, 4, 5, 6, 7];

        // 2. Pitch Bend Settings
        this.pitchBendRange = options.pitchBendRange !== undefined ? options.pitchBendRange : 2; // ±2 semitones default
        this.deadbandCents = options.deadbandCents !== undefined ? options.deadbandCents : 3.0; // deadband around 0 cents
        this.bendSmoothing = options.bendSmoothing !== undefined ? options.bendSmoothing : 0.0; // 0 to 0.9 filter factor

        // 3. Acoustic Noise Gate & Hysteresis Thresholds
        this.noiseGateRMS = options.noiseGateRMS !== undefined ? options.noiseGateRMS : 0.008; // Base energy floor
        this.attackThresholdRMS = options.attackThresholdRMS !== undefined ? options.attackThresholdRMS : 0.012; // Onset trigger floor
        this.hysteresisRatio = options.hysteresisRatio !== undefined ? options.hysteresisRatio : 0.75; // noteOff = noiseGate * 0.75
        this.minPitchConfidence = options.minPitchConfidence !== undefined ? options.minPitchConfidence : 0.60;
        this.minFreq = options.minFreq || 65.0; // Minimum valid guitar frequency (Hz)
        this.maxFreq = options.maxFreq || 1500.0; // Maximum valid guitar frequency (Hz)
        this.minNoteDurationMs = options.minNoteDurationMs !== undefined ? options.minNoteDurationMs : 50; // 50ms duration lock
        this.releaseHoldMs = options.releaseHoldMs !== undefined ? options.releaseHoldMs : 30; // Debounce before Note Off

        // 4. Velocity Mapping Settings (Musical Logarithmic Curve)
        this.velocityCurve = options.velocityCurve || 'logarithmic'; // 'logarithmic' | 'linear' | 'exponential'
        this.velocitySensitivity = options.velocitySensitivity !== undefined ? options.velocitySensitivity : 9.0; // alpha compression factor
        this.rmsMin = options.rmsMin !== undefined ? options.rmsMin : 0.010; // Softest attack threshold
        this.rmsMax = options.rmsMax !== undefined ? options.rmsMax : 0.400; // Fortissimo attack ceiling
        this.minVelocity = options.minVelocity !== undefined ? options.minVelocity : 1;
        this.maxVelocity = options.maxVelocity !== undefined ? options.maxVelocity : 127;
        this.defaultReleaseVelocity = options.defaultReleaseVelocity !== undefined ? options.defaultReleaseVelocity : 64;

        // 5. Web MIDI State & Ports
        this.isSupported = false;
        this.isLoopback = false;
        this.midiAccess = null;
        this.selectedOutput = null; // Target MIDIOutput or loopback mock
        this.outputs = new Map(); // id -> port descriptor
        this.preferredPort = options.preferredPort || null;

        // 6. Software Loopback Logger
        this.loopbackLog = [];
        this.maxLogEntries = options.maxLogEntries || 500;

        // 7. Voice Management & State Machine
        // Channel (1-16) -> VoiceState
        this.voices = new Map();
        this._initVoices();

        // 8. Event Callbacks
        this.onMessage = options.onMessage || null; // (bytes, parsed)
        this.onPortChange = options.onPortChange || null; // (portsArray)
        this.onError = options.onError || null; // (error)

        // Musical Pitch Lookup
        this.noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    }

    /**
     * Initializes internal voice state structures for all channels (1-16).
     * @private
     */
    _initVoices() {
        for (let ch = 1; ch <= 16; ch++) {
            this.voices.set(ch, {
                channel: ch,
                state: 'IDLE', // 'IDLE' | 'ACTIVE'
                nominalMidi: -1,
                nominalFreq: 0,
                attackTime: 0,
                attackRms: 0,
                lastRms: 0,
                belowThresholdSince: null,
                lastPitchBend14: 8192,
                stringIndex: -1
            });
        }
    }

    /**
     * Retrieves or creates voice state for a given channel.
     * @param {number} channel - 1 to 16
     * @returns {Object} VoiceState
     */
    _getVoice(channel) {
        if (!this.voices.has(channel)) {
            this.voices.set(channel, {
                channel: channel,
                state: 'IDLE',
                nominalMidi: -1,
                nominalFreq: 0,
                attackTime: 0,
                attackRms: 0,
                lastRms: 0,
                belowThresholdSince: null,
                lastPitchBend14: 8192,
                stringIndex: -1
            });
        }
        return this.voices.get(channel);
    }

    // =========================================================================
    // 1. Web MIDI Interface & Port Discovery
    // =========================================================================

    /**
     * Initializes the Web MIDI subsystem.
     * Requests access via navigator.requestMIDIAccess(), discovers hardware and virtual
     * ports, attaches dynamic state listeners, and gracefully falls back to the
     * software loopback logger if unsupported, denied, or headless.
     * 
     * @returns {Promise<Object>} Initialization outcome { success, mode, ports, selectedPort }
     */
    async init() {
        this.isSupported = Boolean(typeof navigator !== 'undefined' && navigator.requestMIDIAccess);

        if (!this.isSupported) {
            this.isLoopback = true;
            this._setupLoopbackPort();
            return {
                success: true,
                mode: 'loopback',
                ports: this.getOutputs(),
                selectedPort: this.selectedOutput
            };
        }

        try {
            this.midiAccess = await navigator.requestMIDIAccess({
                sysex: Boolean(this.options.sysex)
            });

            this.midiAccess.onstatechange = (event) => {
                this._handleStateChange(event);
            };

            this._refreshPorts();

            if (this.outputs.size === 0) {
                // Supported API but no physical or virtual ports connected yet
                this.isLoopback = true;
                this._setupLoopbackPort();
            } else {
                this.isLoopback = false;
                this._selectDefaultPort();
            }

            return {
                success: true,
                mode: this.isLoopback ? 'loopback' : 'webmidi',
                ports: this.getOutputs(),
                selectedPort: this.selectedOutput
            };
        } catch (err) {
            console.warn("Web MIDI access unavailable or denied. Falling back to Software Loopback Logger:", err);
            this.isLoopback = true;
            this._setupLoopbackPort();
            if (this.onError) {
                this.onError(err);
            }
            return {
                success: false,
                error: err.message,
                mode: 'loopback',
                ports: this.getOutputs(),
                selectedPort: this.selectedOutput
            };
        }
    }

    /**
     * Configures the internal software loopback logger mock port.
     * @private
     */
    _setupLoopbackPort() {
        const loopbackId = 'software-loopback';
        const loopbackPort = {
            id: loopbackId,
            name: 'Software Loopback Logger',
            manufacturer: 'FretDSP Virtual Systems',
            state: 'connected',
            connection: 'open',
            type: 'output',
            isVirtual: true,
            send: (bytes, timestamp) => {
                // Handled natively by sendRaw -> _recordMessage
            }
        };
        this.outputs.set(loopbackId, loopbackPort);
        this.selectedOutput = loopbackPort;
    }

    /**
     * Refreshes the internal cache of detected MIDI output ports from MIDIAccess.
     * @private
     */
    _refreshPorts() {
        this.outputs.clear();

        if (!this.midiAccess || !this.midiAccess.outputs) {
            return;
        }

        // MIDIAccess.outputs is a Map-like MIDIOutputMap
        const outputIter = (typeof this.midiAccess.outputs.values === 'function')
            ? this.midiAccess.outputs.values()
            : Object.values(this.midiAccess.outputs);

        for (const port of outputIter) {
            if (!port || !port.id) continue;
            const name = port.name || `MIDI Port ${port.id}`;
            const manufacturer = port.manufacturer || 'Generic';
            const isVirtual = /virtual|iac|loopmidi|bridge|internal|network/i.test(`${name} ${manufacturer}`);

            this.outputs.set(port.id, {
                id: port.id,
                name: name,
                manufacturer: manufacturer,
                state: port.state || 'connected',
                connection: port.connection || 'open',
                type: 'output',
                isVirtual: isVirtual,
                rawPort: port
            });
        }
    }

    /**
     * Selects default port based on preferredPort criteria or the first available port.
     * @private
     */
    _selectDefaultPort() {
        if (this.outputs.size === 0) {
            this._setupLoopbackPort();
            return;
        }

        // 1. Try preferred port matching
        if (this.preferredPort) {
            for (const [id, port] of this.outputs.entries()) {
                if (id === this.preferredPort ||
                    port.name.toLowerCase().includes(String(this.preferredPort).toLowerCase())) {
                    this.selectedOutput = port;
                    return;
                }
            }
        }

        // 2. Default to first connected output port
        const firstPort = this.outputs.values().next().value;
        this.selectedOutput = firstPort || null;
    }

    /**
     * Handles dynamic device plug/unplug events from MIDIAccess.
     * @private
     */
    _handleStateChange(event) {
        if (!event || !event.port || event.port.type !== 'output') {
            return;
        }

        const port = event.port;
        const portId = port.id;

        if (port.state === 'disconnected') {
            this.outputs.delete(portId);
            if (this.selectedOutput && this.selectedOutput.id === portId) {
                // Active port was unplugged; failover gracefully
                this._selectDefaultPort();
            }
        } else {
            // Port connected / re-connected
            const name = port.name || `MIDI Port ${port.id}`;
            const manufacturer = port.manufacturer || 'Generic';
            const isVirtual = /virtual|iac|loopmidi|bridge|internal|network/i.test(`${name} ${manufacturer}`);

            this.outputs.set(portId, {
                id: portId,
                name: name,
                manufacturer: manufacturer,
                state: port.state,
                connection: port.connection,
                type: 'output',
                isVirtual: isVirtual,
                rawPort: port
            });

            if (!this.selectedOutput || this.selectedOutput.id === 'software-loopback') {
                this.selectedOutput = this.outputs.get(portId);
                this.isLoopback = false;
            }
        }

        if (this.onPortChange) {
            this.onPortChange(this.getOutputs());
        }
    }

    /**
     * Returns an array of all detected output ports with selection status.
     * @returns {Array<Object>}
     */
    getOutputs() {
        const result = [];
        for (const port of this.outputs.values()) {
            result.push({
                id: port.id,
                name: port.name,
                manufacturer: port.manufacturer,
                state: port.state,
                connection: port.connection,
                isVirtual: Boolean(port.isVirtual),
                isSelected: Boolean(this.selectedOutput && this.selectedOutput.id === port.id)
            });
        }
        return result;
    }

    /**
     * Selects an output port by ID or by matching name substring.
     * @param {string} portIdOrName
     * @returns {boolean} True if successfully selected
     */
    selectOutput(portIdOrName) {
        if (!portIdOrName) return false;

        // Exact ID match
        if (this.outputs.has(portIdOrName)) {
            this.selectedOutput = this.outputs.get(portIdOrName);
            this.isLoopback = (this.selectedOutput.id === 'software-loopback');
            return true;
        }

        // Substring name match
        const lower = String(portIdOrName).toLowerCase();
        for (const [id, port] of this.outputs.entries()) {
            if (port.name.toLowerCase().includes(lower)) {
                this.selectedOutput = port;
                this.isLoopback = (id === 'software-loopback');
                return true;
            }
        }

        return false;
    }

    /**
     * Returns currently selected output port metadata.
     * @returns {Object|null}
     */
    getSelectedOutput() {
        return this.selectedOutput ? {
            id: this.selectedOutput.id,
            name: this.selectedOutput.name,
            manufacturer: this.selectedOutput.manufacturer,
            isVirtual: Boolean(this.selectedOutput.isVirtual),
            isLoopback: Boolean(this.isLoopback)
        } : null;
    }

    // =========================================================================
    // 2. Velocity Mapping & Transient Analysis
    // =========================================================================

    /**
     * Maps attack transient amplitude (RMS peak at onset) to MIDI velocity (1-127)
     * using a musical logarithmic sensitivity curve.
     * 
     * Logarithmic sensitivity models human acoustic loudness perception, providing
     * expressive dynamic gradation for light fingerpicking without sacrificing
     * fortissimo headroom for heavy plectrum strikes.
     * 
     * Formula:
     *   norm = clamp((rms - rmsMin) / (rmsMax - rmsMin), 0, 1)
     *   curve = ln(1 + alpha * norm) / ln(1 + alpha)
     *   velocity = clamp(round(minVel + curve * (maxVel - minVel)), 1, 127)
     * 
     * @param {number} rms - Root Mean Square amplitude of attack peak
     * @returns {number} MIDI velocity (1-127)
     */
    calculateVelocity(rms) {
        if (!Number.isFinite(rms) || rms <= this.rmsMin) {
            return this.minVelocity;
        }
        if (rms >= this.rmsMax) {
            return this.maxVelocity;
        }

        // Normalized linear amplitude in [0.0, 1.0]
        const norm = (rms - this.rmsMin) / (this.rmsMax - this.rmsMin);

        let curveVal = 0;
        if (this.velocityCurve === 'logarithmic') {
            const alpha = this.velocitySensitivity;
            curveVal = Math.log(1 + alpha * norm) / Math.log(1 + alpha);
        } else if (this.velocityCurve === 'exponential') {
            curveVal = Math.pow(norm, 2.0);
        } else {
            // Linear
            curveVal = norm;
        }

        const vel = Math.round(this.minVelocity + curveVal * (this.maxVelocity - this.minVelocity));
        return Math.max(1, Math.min(127, vel));
    }

    // =========================================================================
    // 3. Continuous 14-Bit Pitch Bend (Vibrato & Bends)
    // =========================================================================

    /**
     * Converts micro-pitch deviation in cents into a standard 14-bit MIDI pitch bend value.
     * 
     * MIDI Pitch Bend Specification:
     * - Range: 0 to 16383 (0x0000 to 0x3FFF).
     * - Exact Center (0 cents / no bend): 8192 (0x2000).
     * - Maximum Positive (+bendRange semitones): 16383 (0x3FFF).
     * - Maximum Negative (-bendRange semitones): 0 (0x0000).
     * 
     * Applies deadband around 0 cents to suppress finger tremolo jitter on straight notes.
     * 
     * @param {number} cents - Deviation in cents (-range*100 to +range*100)
     * @param {number} [rangeSemitones] - Optional override for pitch bend range in semitones
     * @returns {number} 14-bit unsigned integer [0, 16383]
     */
    centsToPitchBend14(cents, rangeSemitones = null) {
        if (!Number.isFinite(cents)) {
            return 8192;
        }

        const range = (rangeSemitones !== null && rangeSemitones > 0) ? rangeSemitones : this.pitchBendRange;
        const maxCents = range * 100;

        // 1. Deadband filter around 0 cents
        if (Math.abs(cents) <= this.deadbandCents) {
            return 8192;
        }

        // 2. Linear deflection clamped to [-1.0, 1.0] (with 0.1% tolerance for IEEE 754 float rounding)
        let normalized = cents / maxCents;
        if (Math.abs(normalized) >= 0.999) {
            normalized = Math.sign(normalized) * 1.0;
        }
        const deflection = Math.max(-1.0, Math.min(1.0, normalized));

        // 3. 14-bit encoding centered at 8192 (0x2000)
        let value14;
        if (deflection >= 0) {
            value14 = 8192 + Math.round(deflection * 8191);
        } else {
            value14 = 8192 + Math.round(deflection * 8192);
        }

        return Math.max(0, Math.min(16383, value14));
    }

    /**
     * Inverse conversion from 14-bit MIDI pitch bend integer to cents deviation.
     * @param {number} value14 - 14-bit integer [0, 16383]
     * @param {number} [rangeSemitones] - Pitch bend range in semitones
     * @returns {number} Cents deviation
     */
    pitchBend14ToCents(value14, rangeSemitones = null) {
        if (!Number.isFinite(value14)) return 0;
        const val = Math.max(0, Math.min(16383, value14));
        const range = (rangeSemitones !== null && rangeSemitones > 0) ? rangeSemitones : this.pitchBendRange;
        const maxCents = range * 100;

        if (val === 8192) return 0;
        if (val > 8192) {
            return ((val - 8192) / 8191) * maxCents;
        } else {
            return ((val - 8192) / 8192) * maxCents;
        }
    }

    /**
     * Splits 14-bit integer into MIDI 7-bit LSB and MSB.
     * @param {number} value14 - 14-bit integer [0, 16383]
     * @returns {{lsb: number, msb: number}}
     */
    split14Bit(value14) {
        const val = Math.max(0, Math.min(16383, Math.round(value14)));
        return {
            lsb: val & 0x7F,
            msb: (val >> 7) & 0x7F
        };
    }

    // =========================================================================
    // 4. MIDI Channel Routing & Voice Allocation
    // =========================================================================

    /**
     * Resolves the appropriate MIDI channel for an incoming audio event.
     * In Monophonic mode: uses baseChannel (1-16).
     * In MPE mode: routes by guitar stringIndex (strings 0..5 -> Ch 2..7)
     * or dynamic member channel allocation.
     * 
     * @param {number|null} [stringIndex=null] - Guitar string index (0 to 5)
     * @param {number|null} [requestedChannel=null] - Explicit channel override
     * @returns {number} MIDI channel (1 to 16)
     */
    resolveChannel(stringIndex = null, requestedChannel = null) {
        if (requestedChannel !== null && requestedChannel >= 1 && requestedChannel <= 16) {
            return requestedChannel;
        }

        if (this.mode === 'mpe') {
            if (stringIndex !== null && stringIndex >= 0 && stringIndex < this.stringChannels.length) {
                return this.stringChannels[stringIndex];
            }
            // Auto-allocate: find first IDLE member channel
            for (let ch = this.mpeZone.lowerChannel; ch <= this.mpeZone.upperChannel; ch++) {
                const voice = this.voices.get(ch);
                if (voice && voice.state === 'IDLE') {
                    return ch;
                }
            }
            // Fallback to lower channel if all busy
            return this.mpeZone.lowerChannel;
        }

        // Monophonic or Polyphonic mode
        return this.baseChannel;
    }

    // =========================================================================
    // 5. Audio Analysis Consumer & State Machine
    // =========================================================================

    /**
     * Primary entry point: Consumes fundamental pitch (f0), RMS energy,
     * transient onset triggers, and confidence metrics from live audio analysis.
     * 
     * Executes the Note On / Note Off / Pitch Bend state machine:
     * - Suppresses finger squeaks, fret buzz, and sub-threshold noise bursts.
     * - Fires musical Note On with logarithmic velocity on valid onsets.
     * - Enforces minimum note duration lock (~50ms) to prevent chatter.
     * - Streams real-time 14-bit continuous pitch bend during sustain.
     * - Fires timely Note Off and recenters pitch wheel when signal decays.
     * 
     * @param {Object} data - Audio analysis frame
     * @param {number} [data.f0] - Fundamental frequency in Hz (alias: frequency)
     * @param {number} [data.frequency] - Fundamental frequency in Hz
     * @param {number} [data.rms=0] - Root Mean Square signal energy
     * @param {boolean} [data.isPluck=false] - Transient onset trigger (alias: isTransient, onset)
     * @param {boolean} [data.isTransient=false]
     * @param {boolean} [data.onset=false]
     * @param {number} [data.confidence=1.0] - Pitch harmonicity confidence (0.0 to 1.0)
     * @param {number} [data.time] - Timestamp in seconds (Web Audio or wall clock)
     * @param {number} [data.stringIndex=null] - Guitar string index (0 to 5)
     * @param {number} [data.midi] - Pre-quantized nominal MIDI note (optional)
     * @param {number} [data.cents] - Pre-calculated micro-pitch cents deviation (optional)
     */
    processAudioAnalysis(data) {
        if (!data) return;

        // 1. Extract and normalize frame metrics
        const nowSec = (Number.isFinite(data.time)) ? data.time :
            (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000);

        const rms = Number.isFinite(data.rms) ? Math.max(0, data.rms) : 0;
        const freq = Number.isFinite(data.f0) ? data.f0 :
            (Number.isFinite(data.frequency) ? data.frequency : 0);
        const confidence = Number.isFinite(data.confidence) ? data.confidence : 1.0;
        const isOnset = Boolean(data.isPluck || data.isTransient || data.onset);
        const stringIndex = (data.stringIndex !== undefined && data.stringIndex !== null) ?
            Math.max(0, Math.min(5, Math.round(data.stringIndex))) : null;

        // 2. Resolve target channel & voice state
        const channel = this.resolveChannel(stringIndex);
        const voice = this._getVoice(channel);

        // Hysteresis release threshold
        const noteOffThreshold = this.noiseGateRMS * this.hysteresisRatio;

        // =====================================================================
        // State A: IDLE (No note sounding on this channel)
        // =====================================================================
        if (voice.state === 'IDLE') {
            if (!isOnset) {
                return; // Nothing to do while idle without an onset
            }

            // Acoustic Noise Gate & False Trigger Suppression:
            // 1. Check energy floor (suppress quiet room noise and background clicks)
            if (rms < this.attackThresholdRMS) {
                return; // Sub-threshold transient rejected
            }

            // 2. Check pitch confidence floor (suppress non-harmonic finger squeaks & body thumps)
            if (confidence < this.minPitchConfidence) {
                return; // Low-confidence noise rejected
            }

            // 3. Check frequency register validity (suppress sub-audible rumbles and ultrasonic squeals)
            if (freq < this.minFreq || freq > this.maxFreq) {
                return; // Out-of-range pitch rejected
            }

            // Valid Attack Transient -> Note On Trigger!
            const nominalMidi = (data.midi !== undefined && Number.isFinite(data.midi)) ?
                Math.max(0, Math.min(127, Math.round(data.midi))) :
                Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(freq / 440))));

            const velocity = this.calculateVelocity(rms);

            // Emit Note On
            this.sendNoteOn(nominalMidi, velocity, channel);

            // Recenter pitch bend on channel to 0 cents (8192)
            this.sendPitchBendRaw(8192, channel);

            // Update Voice State
            voice.state = 'ACTIVE';
            voice.nominalMidi = nominalMidi;
            voice.nominalFreq = 440 * Math.pow(2, (nominalMidi - 69) / 12);
            voice.attackTime = nowSec;
            voice.attackRms = rms;
            voice.lastRms = rms;
            voice.belowThresholdSince = null;
            voice.lastPitchBend14 = 8192;
            voice.stringIndex = stringIndex !== null ? stringIndex : -1;
            return;
        }

        // =====================================================================
        // State B: ACTIVE (Note sounding on this channel)
        // =====================================================================
        const noteDurationMs = (nowSec - voice.attackTime) * 1000;

        // Sub-case B1: Signal Decay / Release Detection (Timely Note Off)
        if (rms < noteOffThreshold) {
            if (voice.belowThresholdSince === null) {
                voice.belowThresholdSince = nowSec;
            }

            const belowDurationMs = (nowSec - voice.belowThresholdSince) * 1000;

            // Enforce minimum note duration lock (~50ms) to suppress fret rattle chatter
            // plus release debounce hold to prevent premature cutoffs on flutter
            if (noteDurationMs >= this.minNoteDurationMs && belowDurationMs >= this.releaseHoldMs) {
                this._terminateVoice(voice, channel);
                return;
            }
        } else {
            // Signal energy healthy -> reset release debounce
            voice.belowThresholdSince = null;
        }

        // Sub-case B2: Re-attack / New Pluck while note sounding
        if (isOnset && rms >= this.attackThresholdRMS && confidence >= this.minPitchConfidence) {
            // Check if minimum note duration has elapsed, or if it is a definite new pitch
            const detectedMidi = Math.round(69 + 12 * Math.log2(freq / 440));
            const isDifferentNote = (detectedMidi !== voice.nominalMidi);

            if (noteDurationMs >= this.minNoteDurationMs || isDifferentNote) {
                // Legato / Voice Retrigger: End previous note cleanly
                this._terminateVoice(voice, channel);

                // Trigger new note immediately
                const velocity = this.calculateVelocity(rms);
                this.sendNoteOn(detectedMidi, velocity, channel);
                this.sendPitchBendRaw(8192, channel);

                voice.state = 'ACTIVE';
                voice.nominalMidi = detectedMidi;
                voice.nominalFreq = 440 * Math.pow(2, (detectedMidi - 69) / 12);
                voice.attackTime = nowSec;
                voice.attackRms = rms;
                voice.lastRms = rms;
                voice.belowThresholdSince = null;
                voice.lastPitchBend14 = 8192;
                voice.stringIndex = stringIndex !== null ? stringIndex : -1;
                return;
            }
        }

        // Sub-case B3: Real-Time 14-Bit Continuous Pitch Bend Tracking (Vibrato & Bends)
        if (freq >= this.minFreq && freq <= this.maxFreq && confidence >= this.minPitchConfidence) {
            let cents = 0;
            if (data.cents !== undefined && Number.isFinite(data.cents)) {
                cents = data.cents;
            } else if (voice.nominalFreq > 0) {
                cents = 1200 * Math.log2(freq / voice.nominalFreq);
            } else {
                const exactPitch = 69 + 12 * Math.log2(freq / 440);
                cents = (exactPitch - voice.nominalMidi) * 100;
            }

            const bend14 = this.centsToPitchBend14(cents);

            // Rate-limiting: only transmit when 14-bit integer deflects from prior transmitted value
            if (bend14 !== voice.lastPitchBend14) {
                this.sendPitchBendRaw(bend14, channel);
                voice.lastPitchBend14 = bend14;
            }
        }

        voice.lastRms = rms;
    }

    /**
     * Terminates an active voice by sending Note Off and recentering the pitch wheel.
     * @private
     */
    _terminateVoice(voice, channel) {
        if (voice.state === 'ACTIVE' && voice.nominalMidi >= 0) {
            this.sendNoteOff(voice.nominalMidi, this.defaultReleaseVelocity, channel);
            this.sendPitchBendRaw(8192, channel);
        }
        voice.state = 'IDLE';
        voice.nominalMidi = -1;
        voice.nominalFreq = 0;
        voice.attackTime = 0;
        voice.belowThresholdSince = null;
        voice.lastPitchBend14 = 8192;
    }

    // =========================================================================
    // 6. Direct MIDI Message Transmission & Encoding
    // =========================================================================

    /**
     * Sends standard MIDI Note On message: [0x90 | (channel-1), pitch, velocity].
     * 
     * @param {number} pitch - MIDI note number (0-127)
     * @param {number} velocity - MIDI velocity (1-127)
     * @param {number} [channel=1] - MIDI channel (1-16)
     */
    sendNoteOn(pitch, velocity, channel = 1) {
        const ch = Math.max(1, Math.min(16, channel));
        const p = Math.max(0, Math.min(127, Math.round(pitch)));
        const v = Math.max(1, Math.min(127, Math.round(velocity)));
        const status = 0x90 | ((ch - 1) & 0x0F);

        const packet = [status, p, v];
        this.sendRaw(packet);
    }

    /**
     * Sends standard MIDI Note Off message: [0x80 | (channel-1), pitch, releaseVelocity].
     * 
     * @param {number} pitch - MIDI note number (0-127)
     * @param {number} [releaseVelocity=64] - MIDI release velocity (0-127)
     * @param {number} [channel=1] - MIDI channel (1-16)
     */
    sendNoteOff(pitch, releaseVelocity = 64, channel = 1) {
        const ch = Math.max(1, Math.min(16, channel));
        const p = Math.max(0, Math.min(127, Math.round(pitch)));
        const v = Math.max(0, Math.min(127, Math.round(releaseVelocity)));
        const status = 0x80 | ((ch - 1) & 0x0F);

        const packet = [status, p, v];
        this.sendRaw(packet);
    }

    /**
     * Sends 14-bit pitch bend wheel message directly from integer [0, 16383].
     * Centering at 8192 (0x2000).
     * 
     * Packet: [0xE0 | (channel-1), LSB, MSB]
     * 
     * @param {number} value14 - 14-bit unsigned integer [0, 16383]
     * @param {number} [channel=1] - MIDI channel (1-16)
     */
    sendPitchBendRaw(value14, channel = 1) {
        const ch = Math.max(1, Math.min(16, channel));
        const { lsb, msb } = this.split14Bit(value14);
        const status = 0xE0 | ((ch - 1) & 0x0F);

        const packet = [status, lsb, msb];
        this.sendRaw(packet);
    }

    /**
     * Convenience method to send pitch bend from semitones or cents deviation.
     * 
     * @param {number} amount - Deviation amount
     * @param {number} [channel=1] - MIDI channel (1-16)
     * @param {boolean} [isCents=true] - True if amount is cents, false if semitones
     */
    sendPitchBend(amount, channel = 1, isCents = true) {
        const cents = isCents ? amount : amount * 100;
        const value14 = this.centsToPitchBend14(cents);
        this.sendPitchBendRaw(value14, channel);
    }

    /**
     * Sends Control Change (CC) message: [0xB0 | (channel-1), controller, value].
     * 
     * @param {number} controller - CC number (0-127)
     * @param {number} value - Value (0-127)
     * @param {number} [channel=1] - MIDI channel (1-16)
     */
    sendControlChange(controller, value, channel = 1) {
        const ch = Math.max(1, Math.min(16, channel));
        const cc = Math.max(0, Math.min(127, Math.round(controller)));
        const v = Math.max(0, Math.min(127, Math.round(value)));
        const status = 0xB0 | ((ch - 1) & 0x0F);

        const packet = [status, cc, v];
        this.sendRaw(packet);
    }

    /**
     * Sends standard MIDI Registered Parameter Number (RPN 0) message to configure
     * Pitch Bend Range / Sensitivity on receiving DAWs, plugins, and hardware synths.
     * 
     * RPN Sequence:
     * - CC 101 (RPN MSB) = 0
     * - CC 100 (RPN LSB) = 0
     * - CC 6 (Data Entry MSB) = semitones (e.g. 2 or 12)
     * - CC 38 (Data Entry LSB) = cents (usually 0)
     * - CC 101 = 127, CC 100 = 127 (RPN Reset / Deselect)
     * 
     * @param {number} semitones - Pitch bend range in semitones (1-24)
     * @param {number} [cents=0] - Additional cents (0-100)
     * @param {number|null} [channel=null] - Channel 1-16, or null for all active channels
     */
    sendPitchBendSensitivityRPN(semitones, cents = 0, channel = null) {
        const st = Math.max(1, Math.min(24, Math.round(semitones)));
        const ct = Math.max(0, Math.min(100, Math.round(cents)));
        const targetChannels = (channel !== null) ? [channel] :
            (this.mode === 'mpe' ? [1, 2, 3, 4, 5, 6, 7] : [this.baseChannel]);

        for (const ch of targetChannels) {
            this.sendControlChange(101, 0, ch);   // RPN MSB = 0
            this.sendControlChange(100, 0, ch);   // RPN LSB = 0
            this.sendControlChange(6, st, ch);    // Data Entry MSB = Semitones
            this.sendControlChange(38, ct, ch);   // Data Entry LSB = Cents
            this.sendControlChange(101, 127, ch); // Deselect RPN
            this.sendControlChange(100, 127, ch);
        }
    }

    /**
     * Transmits raw MIDI byte array to the selected port and appends to loopback log.
     * 
     * @param {Array<number>|Uint8Array} bytes - Raw MIDI message bytes
     * @param {number} [timestamp=0] - Optional Web MIDI scheduling timestamp
     */
    sendRaw(bytes, timestamp = 0) {
        if (!bytes || bytes.length === 0) return;

        const portId = this.selectedOutput ? this.selectedOutput.id : 'none';

        // 1. Record to internal loopback logger
        const parsed = this.parseMidiPacket(bytes);
        this._recordMessage(bytes, timestamp, portId, parsed);

        // 2. Transmit to physical/virtual Web MIDI port if available
        if (this.selectedOutput) {
            const rawPort = this.selectedOutput.rawPort || this.selectedOutput;
            if (rawPort && typeof rawPort.send === 'function' && !this.isLoopback) {
                try {
                    if (timestamp > 0) {
                        rawPort.send(bytes, timestamp);
                    } else {
                        rawPort.send(bytes);
                    }
                } catch (err) {
                    console.warn("Failed to transmit MIDI packet to hardware port:", err);
                    if (this.onError) this.onError(err);
                }
            }
        }

        // 3. Trigger onMessage listener
        if (this.onMessage) {
            this.onMessage(bytes, parsed);
        }
    }

    /**
     * Records a message into the circular loopback log buffer.
     * @private
     */
    _recordMessage(bytes, timestamp, portId, parsed = null) {
        const entry = {
            timestamp: (timestamp > 0) ? timestamp : (typeof performance !== 'undefined' ? performance.now() : Date.now()),
            bytes: Array.from(bytes),
            portId: portId,
            parsed: parsed || this.parseMidiPacket(bytes)
        };

        this.loopbackLog.push(entry);
        if (this.loopbackLog.length > this.maxLogEntries) {
            this.loopbackLog.shift();
        }
    }

    /**
     * Decodes raw MIDI bytes into structured metadata.
     * @param {Array<number>|Uint8Array} bytes
     * @returns {Object}
     */
    parseMidiPacket(bytes) {
        if (!bytes || bytes.length === 0) {
            return { type: 'Empty', raw: [] };
        }

        const b0 = bytes[0];
        const commandNibble = b0 & 0xF0;
        const channel = (b0 & 0x0F) + 1;
        const data1 = bytes.length > 1 ? bytes[1] : 0;
        const data2 = bytes.length > 2 ? bytes[2] : 0;

        let command = 'Unknown';
        let description = '';

        switch (commandNibble) {
            case 0x90:
                if (data2 > 0) {
                    command = 'Note On';
                    const noteName = this.noteStrings[data1 % 12];
                    const octave = Math.floor(data1 / 12) - 1;
                    description = `Note On: ${noteName}${octave} (${data1}), Vel: ${data2}, Ch: ${channel}`;
                } else {
                    command = 'Note Off';
                    const noteName = this.noteStrings[data1 % 12];
                    const octave = Math.floor(data1 / 12) - 1;
                    description = `Note Off (vel 0): ${noteName}${octave} (${data1}), Ch: ${channel}`;
                }
                break;
            case 0x80:
                command = 'Note Off';
                {
                    const noteName = this.noteStrings[data1 % 12];
                    const octave = Math.floor(data1 / 12) - 1;
                    description = `Note Off: ${noteName}${octave} (${data1}), RelVel: ${data2}, Ch: ${channel}`;
                }
                break;
            case 0xE0:
                command = 'Pitch Bend';
                {
                    const val14 = data1 | (data2 << 7);
                    const cents = this.pitchBend14ToCents(val14);
                    description = `Pitch Bend: ${val14} (0x${val14.toString(16).toUpperCase()}), ${cents >= 0 ? '+' : ''}${cents.toFixed(1)} cents, Ch: ${channel}`;
                }
                break;
            case 0xB0:
                command = 'Control Change';
                description = `CC ${data1}: ${data2}, Ch: ${channel}`;
                break;
            default:
                command = `Status 0x${b0.toString(16).toUpperCase()}`;
                description = `Raw MIDI: ${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')}`;
                break;
        }

        return {
            status: b0,
            commandNibble: commandNibble,
            channel: channel,
            command: command,
            data1: data1,
            data2: data2,
            raw: Array.from(bytes),
            hex: Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
            description: description
        };
    }

    // =========================================================================
    // 7. Global Controls & Panic
    // =========================================================================

    /**
     * Emergency Panic: Terminates all active notes, issues CC 123 (All Notes Off),
     * CC 120 (All Sound Off), and recenters pitch bend to 8192 across all channels.
     */
    panic() {
        // Send CC 123 (All Notes Off) & CC 120 (All Sound Off) across all 16 channels
        for (let ch = 1; ch <= 16; ch++) {
            this.sendControlChange(123, 0, ch); // All Notes Off
            this.sendControlChange(120, 0, ch); // All Sound Off
            this.sendPitchBendRaw(8192, ch);    // Recenter Pitch Bend
        }

        // Reset voice state machine
        this._initVoices();
    }

    /**
     * Sets operating mode: 'monophonic' | 'mpe' | 'polyphonic'.
     * @param {string} mode
     */
    setMode(mode) {
        if (mode === 'monophonic' || mode === 'mpe' || mode === 'polyphonic') {
            this.panic();
            this.mode = mode;
        }
    }

    /**
     * Sets pitch bend sensitivity range in semitones and optionally transmits RPN 0.
     * @param {number} semitones - e.g. 2, 12, 24
     * @param {boolean} [sendRPN=true] - Whether to send MIDI RPN 0 configuration packet
     */
    setPitchBendRange(semitones, sendRPN = true) {
        this.pitchBendRange = Math.max(1, Math.min(48, Math.round(semitones)));
        if (sendRPN) {
            this.sendPitchBendSensitivityRPN(this.pitchBendRange);
        }
    }

    /**
     * Sets the base MIDI channel for monophonic/polyphonic mode (1-16).
     * @param {number} channel
     */
    setBaseChannel(channel) {
        this.baseChannel = Math.max(1, Math.min(16, Math.round(channel)));
    }

    /**
     * Updates acoustic noise gate threshold.
     * @param {number} rms
     */
    setNoiseGate(rms) {
        if (Number.isFinite(rms) && rms >= 0) {
            this.noiseGateRMS = rms;
        }
    }

    /**
     * Updates minimum note duration lock in milliseconds.
     * @param {number} ms
     */
    setMinNoteDuration(ms) {
        if (Number.isFinite(ms) && ms >= 0) {
            this.minNoteDurationMs = ms;
        }
    }

    /**
     * Updates velocity sensitivity curve and parameters.
     * @param {Object} opts
     */
    setVelocityOptions(opts = {}) {
        if (opts.velocityCurve) this.velocityCurve = opts.velocityCurve;
        if (opts.velocitySensitivity !== undefined) this.velocitySensitivity = opts.velocitySensitivity;
        if (opts.rmsMin !== undefined) this.rmsMin = opts.rmsMin;
        if (opts.rmsMax !== undefined) this.rmsMax = opts.rmsMax;
    }

    // =========================================================================
    // 8. Loopback Inspection & State
    // =========================================================================

    /**
     * Returns a copy of the loopback message history log.
     * @returns {Array<Object>}
     */
    getLoopbackLog() {
        return [...this.loopbackLog];
    }

    /**
     * Clears loopback log history.
     */
    clearLoopbackLog() {
        this.loopbackLog = [];
    }

    /**
     * Returns the most recently transmitted MIDI message.
     * @returns {Object|null}
     */
    getLastMessage() {
        return this.loopbackLog.length > 0 ? this.loopbackLog[this.loopbackLog.length - 1] : null;
    }

    /**
     * Returns active voices currently sounding.
     * @returns {Array<Object>}
     */
    getActiveVoices() {
        const result = [];
        for (const [ch, voice] of this.voices.entries()) {
            if (voice.state === 'ACTIVE') {
                result.push({
                    channel: ch,
                    midi: voice.nominalMidi,
                    stringIndex: voice.stringIndex,
                    attackTime: voice.attackTime,
                    lastPitchBend14: voice.lastPitchBend14
                });
            }
        }
        return result;
    }

    /**
     * Returns full diagnostic state snapshot.
     * @returns {Object}
     */
    getState() {
        return {
            mode: this.mode,
            baseChannel: this.baseChannel,
            pitchBendRange: this.pitchBendRange,
            isSupported: this.isSupported,
            isLoopback: this.isLoopback,
            selectedOutput: this.getSelectedOutput(),
            activeVoices: this.getActiveVoices(),
            noiseGateRMS: this.noiseGateRMS,
            attackThresholdRMS: this.attackThresholdRMS,
            minNoteDurationMs: this.minNoteDurationMs,
            logCount: this.loopbackLog.length
        };
    }

    // =========================================================================
    // 9. Seamless GuitarDSP Integration Helper
    // =========================================================================

    /**
     * Automatically hooks into an active GuitarDSP instance, piping pitch detection,
     * transient plucks, note-offs, and silence events into this MIDI bridge.
     * 
     * @param {GuitarDSP} dsp - GuitarDSP instance
     */
    connectDSP(dsp) {
        if (!dsp) return;

        // Store original callbacks to support clean chaining
        const origPitch = dsp.onPitchDetected;
        const origPluck = dsp.onPluck;
        const origNoteOff = dsp.onNoteOff;
        const origSilence = dsp.onSilence;

        dsp.onPitchDetected = (data) => {
            if (origPitch) origPitch(data);
            this.processAudioAnalysis(data);
        };

        dsp.onPluck = (data) => {
            if (origPluck) origPluck(data);
            this.processAudioAnalysis(Object.assign({}, data, { isPluck: true }));
        };

        dsp.onNoteOff = (data) => {
            if (origNoteOff) origNoteOff(data);
            // Decay / Note Off
            this.processAudioAnalysis({
                rms: 0.0,
                f0: 0,
                time: data ? data.time : undefined
            });
        };

        dsp.onSilence = () => {
            if (origSilence) origSilence();
            this.processAudioAnalysis({
                rms: 0.0,
                f0: 0
            });
        };
    }
}

// Universal module export for Browser and Node.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = GuitarMIDIOutput;
}
if (typeof window !== 'undefined') {
    window.GuitarMIDIOutput = GuitarMIDIOutput;
    window.AudioToMidiBridge = GuitarMIDIOutput;
}
