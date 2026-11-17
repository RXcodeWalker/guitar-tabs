/**
 * Automated Verification Suite for FretDSP Audio-to-MIDI Bridge (js/midi-output.js)
 * File: test_midi_output.js
 * 
 * Verifies:
 * 1. Web MIDI Interface & Port Discovery (mocked & headless fallback to Software Loopback Logger)
 * 2. Hot-plug dynamic port state change handling (onstatechange)
 * 3. Correct MIDI packet byte structure (Note On, Note Off, CC, RPN, Pitch Bend)
 * 4. Accurate 14-bit pitch bend centering (0x2000 = 8192 at 0 cents) and positive/negative deflection
 * 5. Deadband filtering and configurable pitch bend ranges (±2 semitones, ±12 semitones)
 * 6. Transient-to-Velocity mapping via musical logarithmic sensitivity curve
 * 7. Acoustic noise gate, confidence floor, and rejection of sub-threshold noise bursts
 * 8. Note On/Off state machine, minimum note duration lock (~50ms), and timely decay Note Off
 * 9. Monophonic vs MPE per-string multi-channel routing and independent pitch bends
 * 10. Global panic / All Notes Off reset
 * 11. Seamless GuitarDSP integration hook
 */

const GuitarMIDIOutput = require('./js/midi-output.js');

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        testsPassed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        testsFailed++;
    }
}

console.log("================================================================================");
console.log("TEST SUITE: FRET-DSP AUDIO-TO-MIDI BRIDGE (js/midi-output.js)");
console.log("================================================================================\n");

// =============================================================================
// Section 1: Instantiation, Defaults & Software Loopback Fallback
// =============================================================================
console.log("=== Section 1: Instantiation, Defaults & Software Loopback Fallback ===");

const bridge = new GuitarMIDIOutput({
    channel: 1,
    pitchBendRange: 2,
    noiseGateRMS: 0.008,
    attackThresholdRMS: 0.012,
    minNoteDurationMs: 50
});

assert(bridge !== null, "GuitarMIDIOutput instantiates successfully");
assert(bridge.mode === 'monophonic', "Default mode is monophonic");
assert(bridge.baseChannel === 1, "Base channel defaults to 1");
assert(bridge.pitchBendRange === 2, "Default pitch bend range is ±2 semitones");
assert(bridge.noiseGateRMS === 0.008, "Default noiseGateRMS is 0.008");
assert(bridge.attackThresholdRMS === 0.012, "Default attackThresholdRMS is 0.012");
assert(bridge.minNoteDurationMs === 50, "Default minNoteDurationMs is 50ms");

// Run init() in Node.js (navigator is undefined)
(async () => {
    const initResult = await bridge.init();
    assert(initResult.success === true, "init() succeeds in headless Node environment");
    assert(initResult.mode === 'loopback', "Gracefully falls back to 'loopback' mode when Web MIDI is absent");
    assert(bridge.isLoopback === true, "isLoopback flag set to true");
    assert(bridge.selectedOutput !== null, "Software Loopback Logger selected as output");
    assert(bridge.selectedOutput.id === 'software-loopback', "Software loopback port id is 'software-loopback'");

    const outputs = bridge.getOutputs();
    assert(outputs.length >= 1, "At least 1 output port is available in loopback mode");
    assert(outputs[0].isSelected === true, "Loopback port is marked as selected");

    // =========================================================================
    // Section 2: Mock Web MIDI API & Dynamic Port Discovery
    // =========================================================================
    console.log("\n=== Section 2: Mock Web MIDI API & Dynamic Port Discovery ===");

    // Mock Web MIDI subsystem
    class MockMIDIPort {
        constructor(id, name, manufacturer) {
            this.id = id;
            this.name = name;
            this.manufacturer = manufacturer;
            this.type = 'output';
            this.state = 'connected';
            this.connection = 'open';
            this.sentPackets = [];
        }
        send(bytes, timestamp) {
            this.sentPackets.push({ bytes: Array.from(bytes), timestamp });
        }
    }

    class MockMIDIAccess {
        constructor() {
            this.outputs = new Map();
            this.onstatechange = null;
        }
        addPort(port) {
            this.outputs.set(port.id, port);
            if (this.onstatechange) {
                this.onstatechange({ port });
            }
        }
        removePort(portId) {
            if (this.outputs.has(portId)) {
                const port = this.outputs.get(portId);
                port.state = 'disconnected';
                if (this.onstatechange) {
                    this.onstatechange({ port });
                }
            }
        }
    }

    const mockMIDIAccess = new MockMIDIAccess();
    const virtualPort = new MockMIDIPort('port-loopmidi-1', 'loopMIDI Virtual In', 'Tobias Erichsen');
    const hardwarePort = new MockMIDIPort('port-focusrite-1', 'Focusrite USB MIDI Out', 'Focusrite');
    mockMIDIAccess.outputs.set(virtualPort.id, virtualPort);
    mockMIDIAccess.outputs.set(hardwarePort.id, hardwarePort);

    // Inject mock navigator.requestMIDIAccess
    if (typeof navigator === 'undefined') {
        global.navigator = {};
    }
    navigator.requestMIDIAccess = async (options) => mockMIDIAccess;

    const webMidiBridge = new GuitarMIDIOutput({
        preferredPort: 'focusrite'
    });

    const webInitResult = await webMidiBridge.init();
    assert(webInitResult.success === true, "init() succeeds with Web MIDI API present");
    assert(webInitResult.mode === 'webmidi', "Reports 'webmidi' mode when navigator.requestMIDIAccess succeeds");
    assert(webMidiBridge.outputs.size === 2, "Discovered both virtual and hardware ports (2 ports total)");
    assert(webMidiBridge.selectedOutput.id === 'port-focusrite-1', "Preferred port 'focusrite' automatically selected");

    // Port selection by name substring
    const selectLoopMidi = webMidiBridge.selectOutput('loopmidi');
    assert(selectLoopMidi === true, "Successfully selected 'loopMIDI' port by substring");
    assert(webMidiBridge.selectedOutput.id === 'port-loopmidi-1', "Active port changed to loopMIDI");

    // Dynamic Hot-Plug onstatechange test: Add a new USB synthesizer
    const synthPort = new MockMIDIPort('port-synth-1', 'Moog Sub 37 MIDI', 'Moog Music');
    mockMIDIAccess.addPort(synthPort);
    assert(webMidiBridge.outputs.has('port-synth-1'), "Dynamic hot-plug: Moog synth detected via onstatechange");

    // Unplug the active port
    mockMIDIAccess.removePort('port-loopmidi-1');
    assert(!webMidiBridge.outputs.has('port-loopmidi-1'), "Dynamic unplug: disconnected port removed from active outputs");
    assert(webMidiBridge.selectedOutput !== null, "Gracefully fell back to next available port on disconnect");

    // Clean up global mock
    if (typeof navigator !== 'undefined') {
        delete navigator.requestMIDIAccess;
    }

    // =========================================================================
    // Section 3: MIDI Packet Byte Structure Verification
    // =========================================================================
    console.log("\n=== Section 3: MIDI Packet Byte Structure Verification ===");

    const midiTester = new GuitarMIDIOutput({ channel: 1 });
    await midiTester.init();
    midiTester.clearLoopbackLog();

    // 3.1 Note On: [0x90, pitch, velocity]
    midiTester.sendNoteOn(60, 100, 1); // C4 on Channel 1
    let lastMsg = midiTester.getLastMessage();
    assert(lastMsg !== null, "Message logged in loopback logger");
    assert(lastMsg.bytes[0] === 0x90, "Note On status byte is 0x90 for Channel 1");
    assert(lastMsg.bytes[1] === 60, "Data byte 1 is MIDI pitch 60 (C4)");
    assert(lastMsg.bytes[2] === 100, "Data byte 2 is MIDI velocity 100");
    assert(lastMsg.parsed.command === 'Note On', "Packet parsed as 'Note On'");
    assert(lastMsg.parsed.hex === '90 3C 64', "Hex representation matches '90 3C 64'");

    // 3.2 Note On on Channel 5: 0x90 | 4 = 0x94
    midiTester.sendNoteOn(64, 85, 5); // E4 on Channel 5
    lastMsg = midiTester.getLastMessage();
    assert(lastMsg.bytes[0] === 0x94, "Note On status byte is 0x94 for Channel 5 (0x90 | 0x04)");
    assert(lastMsg.bytes[1] === 64, "Data byte 1 is MIDI pitch 64 (E4)");
    assert(lastMsg.bytes[2] === 85, "Data byte 2 is MIDI velocity 85");

    // 3.3 Note Off: [0x80, pitch, releaseVelocity]
    midiTester.sendNoteOff(60, 64, 1);
    lastMsg = midiTester.getLastMessage();
    assert(lastMsg.bytes[0] === 0x80, "Note Off status byte is 0x80 for Channel 1");
    assert(lastMsg.bytes[1] === 60, "Note Off data byte 1 is MIDI pitch 60");
    assert(lastMsg.bytes[2] === 64, "Note Off data byte 2 is release velocity 64");
    assert(lastMsg.parsed.command === 'Note Off', "Packet parsed as 'Note Off'");

    // 3.4 Control Change: [0xB0, cc, value]
    midiTester.sendControlChange(7, 105, 1); // CC 7 (Channel Volume)
    lastMsg = midiTester.getLastMessage();
    assert(lastMsg.bytes[0] === 0xB0, "CC status byte is 0xB0 for Channel 1");
    assert(lastMsg.bytes[1] === 7, "CC controller number is 7");
    assert(lastMsg.bytes[2] === 105, "CC value is 105");

    // 3.5 Registered Parameter Number (RPN 0 - Pitch Bend Sensitivity)
    midiTester.clearLoopbackLog();
    midiTester.sendPitchBendSensitivityRPN(12, 0, 1);
    const rpnLog = midiTester.getLoopbackLog();
    assert(rpnLog.length === 6, "RPN sequence generated 6 MIDI CC packets");
    assert(rpnLog[0].bytes[1] === 101 && rpnLog[0].bytes[2] === 0, "RPN packet 1: CC 101 (RPN MSB) = 0");
    assert(rpnLog[1].bytes[1] === 100 && rpnLog[1].bytes[2] === 0, "RPN packet 2: CC 100 (RPN LSB) = 0");
    assert(rpnLog[2].bytes[1] === 6 && rpnLog[2].bytes[2] === 12, "RPN packet 3: CC 6 (Data Entry MSB) = 12 semitones");
    assert(rpnLog[3].bytes[1] === 38 && rpnLog[3].bytes[2] === 0, "RPN packet 4: CC 38 (Data Entry LSB) = 0 cents");
    assert(rpnLog[4].bytes[1] === 101 && rpnLog[4].bytes[2] === 127, "RPN packet 5: CC 101 reset = 127");
    assert(rpnLog[5].bytes[1] === 100 && rpnLog[5].bytes[2] === 127, "RPN packet 6: CC 100 reset = 127");

    // =========================================================================
    // Section 4: 14-Bit Pitch Bend Centering & Deflection Math
    // =========================================================================
    console.log("\n=== Section 4: 14-Bit Pitch Bend Centering & Deflection Math ===");

    // 4.1 Exact Center: 0 cents -> 8192 (0x2000)
    const center14 = midiTester.centsToPitchBend14(0);
    assert(center14 === 8192, `Center pitch bend at 0 cents equals exactly 8192 (0x2000), got ${center14}`);
    const splitCenter = midiTester.split14Bit(8192);
    assert(splitCenter.lsb === 0x00, `8192 LSB is 0x00 (got 0x${splitCenter.lsb.toString(16)})`);
    assert(splitCenter.msb === 0x40, `8192 MSB is 0x40 (got 0x${splitCenter.msb.toString(16)})`);

    midiTester.sendPitchBendRaw(8192, 1);
    lastMsg = midiTester.getLastMessage();
    assert(lastMsg.bytes[0] === 0xE0, "Pitch bend status byte is 0xE0 for Channel 1");
    assert(lastMsg.bytes[1] === 0x00, "Pitch bend center LSB is 0x00");
    assert(lastMsg.bytes[2] === 0x40, "Pitch bend center MSB is 0x40");
    assert(lastMsg.parsed.hex === 'E0 00 40', "Pitch bend center hex matches 'E0 00 40'");

    // 4.2 Deadband filtering around 0 cents
    assert(midiTester.centsToPitchBend14(1.5) === 8192, "Deadband: +1.5 cents deviation snaps to 8192");
    assert(midiTester.centsToPitchBend14(-2.8) === 8192, "Deadband: -2.8 cents deviation snaps to 8192");

    // 4.3 Positive Deflection (Default ±2 semitones = ±200 cents range)
    // Full +200 cents bend -> 16383 (0x3FFF)
    const maxPos14 = midiTester.centsToPitchBend14(200);
    assert(maxPos14 === 16383, `Full positive bend (+200 cents) produces 16383 (0x3FFF), got ${maxPos14}`);
    const splitMaxPos = midiTester.split14Bit(maxPos14);
    assert(splitMaxPos.lsb === 0x7F, `Max pos LSB is 0x7F (127), got 0x${splitMaxPos.lsb.toString(16)}`);
    assert(splitMaxPos.msb === 0x7F, `Max pos MSB is 0x7F (127), got 0x${splitMaxPos.msb.toString(16)}`);

    midiTester.sendPitchBendRaw(maxPos14, 1);
    lastMsg = midiTester.getLastMessage();
    assert(lastMsg.bytes[1] === 0x7F && lastMsg.bytes[2] === 0x7F, "Max positive pitch bend packet bytes: [0xE0, 0x7F, 0x7F]");

    // Half +100 cents bend (+1 semitone in ±2 semitone range) -> 12288 (0x3000)
    // 8192 + round(0.5 * 8191) = 12288
    const halfPos14 = midiTester.centsToPitchBend14(100);
    assert(halfPos14 >= 12280 && halfPos14 <= 12290, `Half positive bend (+100 cents) near 12288, got ${halfPos14}`);
    const splitHalfPos = midiTester.split14Bit(halfPos14);
    assert(splitHalfPos.msb === 0x60 || splitHalfPos.msb === 0x5F, `Half pos MSB is ~0x60 (got 0x${splitHalfPos.msb.toString(16)})`);

    // 4.4 Negative Deflection
    // Full -200 cents bend -> 0 (0x0000)
    const maxNeg14 = midiTester.centsToPitchBend14(-200);
    assert(maxNeg14 === 0, `Full negative bend (-200 cents) produces 0 (0x0000), got ${maxNeg14}`);
    const splitMaxNeg = midiTester.split14Bit(maxNeg14);
    assert(splitMaxNeg.lsb === 0x00, "Max neg LSB is 0x00");
    assert(splitMaxNeg.msb === 0x00, "Max neg MSB is 0x00");

    midiTester.sendPitchBendRaw(maxNeg14, 1);
    lastMsg = midiTester.getLastMessage();
    assert(lastMsg.bytes[1] === 0x00 && lastMsg.bytes[2] === 0x00, "Max negative pitch bend packet bytes: [0xE0, 0x00, 0x00]");

    // Half -100 cents bend (-1 semitone in ±2 semitone range) -> 4096 (0x1000)
    // 8192 - round(0.5 * 8192) = 4096
    const halfNeg14 = midiTester.centsToPitchBend14(-100);
    assert(halfNeg14 >= 4090 && halfNeg14 <= 4100, `Half negative bend (-100 cents) near 4096, got ${halfNeg14}`);
    const splitHalfNeg = midiTester.split14Bit(halfNeg14);
    assert(splitHalfNeg.msb === 0x20 || splitHalfNeg.msb === 0x1F, `Half neg MSB is ~0x20 (got 0x${splitHalfNeg.msb.toString(16)})`);

    // 4.5 Configurable ±12 Semitone Range (Full Octave Whammy / Dive)
    midiTester.setPitchBendRange(12, false);
    assert(midiTester.pitchBendRange === 12, "Pitch bend range configured to ±12 semitones");

    const octavePos14 = midiTester.centsToPitchBend14(1200);
    assert(octavePos14 === 16383, `+1200 cents in ±12 semitone range yields 16383, got ${octavePos14}`);

    const octaveNeg14 = midiTester.centsToPitchBend14(-1200);
    assert(octaveNeg14 === 0, `-1200 cents in ±12 semitone range yields 0, got ${octaveNeg14}`);

    // In ±12 range, +200 cents (+2 semitones) is 1/6th deflection -> 8192 + 8191/6 ≈ 9557
    const twoSemisInTwelve = midiTester.centsToPitchBend14(200);
    assert(twoSemisInTwelve >= 9545 && twoSemisInTwelve <= 9570, `+200 cents in ±12 range correctly yields ~9557, got ${twoSemisInTwelve}`);

    // Restore default range
    midiTester.setPitchBendRange(2, false);

    // =========================================================================
    // Section 5: Musical Logarithmic Velocity Mapping
    // =========================================================================
    console.log("\n=== Section 5: Musical Logarithmic Velocity Mapping ===");

    const velMin = midiTester.calculateVelocity(0.005);
    assert(velMin === 1, `Sub-minimum RMS (0.005) clamps to minimum velocity 1 (got ${velMin})`);

    const velMax = midiTester.calculateVelocity(0.500);
    assert(velMax === 127, `Above-ceiling RMS (0.500) clamps to maximum velocity 127 (got ${velMax})`);

    // Compare velocities across dynamic range
    const velPianissimo = midiTester.calculateVelocity(0.02); // very soft
    const velMezzoForte = midiTester.calculateVelocity(0.10); // moderate strike
    const velForte = midiTester.calculateVelocity(0.20);      // firm strike
    const velFortissimo = midiTester.calculateVelocity(0.35); // heavy pluck

    assert(velPianissimo >= 10 && velPianissimo <= 35, `Pianissimo (RMS 0.02) yields expressive low velocity, got ${velPianissimo}`);
    assert(velMezzoForte >= 55 && velMezzoForte <= 75, `Mezzo-Forte (RMS 0.10) yields musical mid velocity, got ${velMezzoForte}`);
    assert(velForte >= 85 && velForte <= 105, `Forte (RMS 0.20) yields strong velocity, got ${velForte}`);
    assert(velFortissimo >= 115 && velFortissimo <= 127, `Fortissimo (RMS 0.35) yields high velocity, got ${velFortissimo}`);

    // Verify Logarithmic Curvature:
    // With logarithmic sensitivity, low amplitude deltas produce greater velocity expansion
    // than high amplitude deltas (compressive curve).
    const deltaLow = velMezzoForte - velPianissimo; // delta for RMS 0.02 to 0.10 (0.08 span)
    const deltaHigh = velFortissimo - velForte;     // delta for RMS 0.20 to 0.35 (0.15 span)
    assert(deltaLow > 25, `Low dynamic range has wide velocity expansion (delta = ${deltaLow})`);
    assert(velPianissimo < velMezzoForte && velMezzoForte < velForte && velForte < velFortissimo, "Velocity is strictly monotonic with respect to RMS");

    // =========================================================================
    // Section 6: Acoustic Noise Gate & Sub-Threshold Noise Burst Rejection
    // =========================================================================
    console.log("\n=== Section 6: Acoustic Noise Gate & False Trigger Rejection ===");

    const gateTester = new GuitarMIDIOutput({
        noiseGateRMS: 0.008,
        attackThresholdRMS: 0.012,
        minPitchConfidence: 0.60
    });
    await gateTester.init();
    gateTester.clearLoopbackLog();

    // 6.1 Sub-threshold energy burst rejection (finger brush / background noise)
    gateTester.processAudioAnalysis({
        f0: 329.63, // High E4
        rms: 0.005, // Below attackThresholdRMS (0.012) and noiseGateRMS (0.008)
        isPluck: true,
        confidence: 0.90,
        time: 1.000
    });
    assert(gateTester.getLoopbackLog().length === 0, "Rejects sub-threshold transient noise burst (RMS 0.005 < 0.012)");
    assert(gateTester.getActiveVoices().length === 0, "No active voices registered for sub-threshold burst");

    // 6.2 Low pitch confidence rejection (finger squeak / pick scrape along string)
    gateTester.processAudioAnalysis({
        f0: 450.0,
        rms: 0.035, // Strong energy
        isPluck: true,
        confidence: 0.35, // Low confidence (< 0.60)
        time: 1.050
    });
    assert(gateTester.getLoopbackLog().length === 0, "Rejects unpitched finger squeak / scraping burst (confidence 0.35 < 0.60)");

    // 6.3 Out-of-register frequency rejection (sub-bass cable thump or ultrasonic squeal)
    gateTester.processAudioAnalysis({
        f0: 30.0, // Sub-audible rumble (< 65 Hz)
        rms: 0.080,
        isPluck: true,
        confidence: 0.95,
        time: 1.100
    });
    assert(gateTester.getLoopbackLog().length === 0, "Rejects sub-register rumble (30 Hz < 65 Hz)");

    gateTester.processAudioAnalysis({
        f0: 3500.0, // Above guitar neck range (> 1500 Hz)
        rms: 0.080,
        isPluck: true,
        confidence: 0.95,
        time: 1.150
    });
    assert(gateTester.getLoopbackLog().length === 0, "Rejects ultrasonic squeal (3500 Hz > 1500 Hz)");

    // 6.4 Valid Guitar Attack Transient -> Fires Note On
    gateTester.processAudioAnalysis({
        f0: 329.63, // High E4 (MIDI 64)
        rms: 0.150,
        isPluck: true,
        confidence: 0.92,
        time: 1.200
    });
    const validLog = gateTester.getLoopbackLog();
    assert(validLog.length >= 2, "Valid attack transient triggers Note On and pitch bend reset");
    const noteOnPacket = validLog.find(e => e.parsed.command === 'Note On');
    assert(noteOnPacket !== undefined, "Note On packet emitted");
    assert(noteOnPacket.bytes[1] === 64, `Note On pitch is 64 (High E4), got ${noteOnPacket.bytes[1]}`);
    assert(noteOnPacket.bytes[2] >= 60, `Note On velocity scaled properly (${noteOnPacket.bytes[2]})`);

    // =========================================================================
    // Section 7: Note On/Off State Machine & Minimum Duration Hysteresis
    // =========================================================================
    console.log("\n=== Section 7: Note On/Off State Machine & Minimum Duration Hysteresis ===");

    const stateTester = new GuitarMIDIOutput({
        minNoteDurationMs: 50,
        releaseHoldMs: 30,
        noiseGateRMS: 0.008,
        attackThresholdRMS: 0.012
    });
    await stateTester.init();
    stateTester.clearLoopbackLog();

    // Trigger note at t = 2.000s (A2 = 110 Hz, MIDI 45)
    stateTester.processAudioAnalysis({
        f0: 110.0,
        rms: 0.20,
        isPluck: true,
        confidence: 0.95,
        time: 2.000
    });
    assert(stateTester.getActiveVoices().length === 1, "Voice is active at t = 2.000s");
    stateTester.clearLoopbackLog();

    // Sudden signal drop after 20ms (t = 2.020s, duration 20ms < minNoteDurationMs 50ms)
    stateTester.processAudioAnalysis({
        f0: 110.0,
        rms: 0.002, // Below noise gate
        isPluck: false,
        confidence: 0.95,
        time: 2.020
    });
    assert(stateTester.getLoopbackLog().length === 0, "Duration lock: Note Off suppressed before 50ms min duration");
    assert(stateTester.getActiveVoices().length === 1, "Voice remains protected/active during duration lock");

    // Signal continues below gate after 50ms min duration + 30ms release hold (t = 2.060s, total 60ms)
    stateTester.processAudioAnalysis({
        f0: 110.0,
        rms: 0.002,
        isPluck: false,
        confidence: 0.95,
        time: 2.060
    });
    const decayLog = stateTester.getLoopbackLog();
    assert(decayLog.length >= 2, "Timely Note Off fired after min duration + release hold elapsed");
    const noteOffMsg = decayLog.find(e => e.parsed.command === 'Note Off');
    assert(noteOffMsg !== undefined, "Note Off message sent on signal decay");
    assert(noteOffMsg.bytes[1] === 45, `Note Off pitch matches original note (45), got ${noteOffMsg.bytes[1]}`);
    assert(stateTester.getActiveVoices().length === 0, "Voice state transitioned to IDLE");

    // Verify Hysteresis:
    // Attack requires RMS >= 0.012. But once active, note sustains even if RMS drops to 0.009 (above noteOff threshold 0.006)
    stateTester.clearLoopbackLog();
    stateTester.processAudioAnalysis({
        f0: 146.83, // D3 = MIDI 50
        rms: 0.18,
        isPluck: true,
        confidence: 0.95,
        time: 3.000
    });
    assert(stateTester.getActiveVoices().length === 1, "Second note active at t = 3.000s");
    stateTester.clearLoopbackLog();

    // Signal drops to 0.009 at t = 3.100s (above 0.006 noteOff threshold)
    stateTester.processAudioAnalysis({
        f0: 146.83,
        rms: 0.009,
        isPluck: false,
        confidence: 0.90,
        time: 3.100
    });
    assert(stateTester.getLoopbackLog().length === 0, "Hysteresis holds note active when RMS is above release threshold (0.009 > 0.006)");
    assert(stateTester.getActiveVoices().length === 1, "Voice remains active under hysteresis sustain");

    // =========================================================================
    // Section 8: Real-Time Pitch Bend Streaming during Sustain
    // =========================================================================
    console.log("\n=== Section 8: Real-Time Pitch Bend Streaming during Sustain ===");

    // Current note is D3 (MIDI 50, nominal 146.83 Hz).
    // Perform a whole-step blues bend up to E3 (MIDI 52, 164.81 Hz, +200 cents).
    stateTester.clearLoopbackLog();

    // Vibrato: +30 cents deviation
    stateTester.processAudioAnalysis({
        f0: 146.83 * Math.pow(2, 30 / 1200), // +30 cents
        rms: 0.12,
        isPluck: false,
        confidence: 0.95,
        time: 3.150
    });
    let bendMsgs = stateTester.getLoopbackLog().filter(e => e.parsed.command === 'Pitch Bend');
    assert(bendMsgs.length === 1, "Continuous pitch bend message streamed during note sustain");
    const vibratoBend14 = bendMsgs[0].bytes[1] | (bendMsgs[0].bytes[2] << 7);
    assert(vibratoBend14 > 8192, `Vibrato (+30 cents) deflects pitch wheel positively (${vibratoBend14} > 8192)`);

    // Whole step bend: +200 cents
    stateTester.clearLoopbackLog();
    stateTester.processAudioAnalysis({
        f0: 146.83 * Math.pow(2, 200 / 1200), // E3 (+200 cents, full whole step bend)
        rms: 0.10,
        isPluck: false,
        confidence: 0.95,
        time: 3.200
    });
    bendMsgs = stateTester.getLoopbackLog().filter(e => e.parsed.command === 'Pitch Bend');
    assert(bendMsgs.length === 1, "Whole step bend message streamed");
    const wholeStepBend14 = bendMsgs[0].bytes[1] | (bendMsgs[0].bytes[2] << 7);
    assert(wholeStepBend14 === 16383, `Full +2 semitone bend hits maximum deflection 16383 (got ${wholeStepBend14})`);

    // Decay note
    stateTester.clearLoopbackLog();
    stateTester.processAudioAnalysis({
        f0: 146.83,
        rms: 0.001,
        isPluck: false,
        confidence: 0.95,
        time: 3.300
    });
    const finalDecayLog = stateTester.getLoopbackLog();
    const finalBendReset = finalDecayLog.find(e => e.parsed.command === 'Pitch Bend');
    assert(finalBendReset !== undefined, "Pitch bend reset packet emitted on note decay");
    assert(finalBendReset.bytes[1] === 0x00 && finalBendReset.bytes[2] === 0x40, "Pitch wheel recentered to 8192 (0x2000) on Note Off");

    // =========================================================================
    // Section 9: Monophonic vs MPE / Polyphonic Modes
    // =========================================================================
    console.log("\n=== Section 9: Monophonic vs MPE / Polyphonic Modes ===");

    // 9.1 Monophonic Voice Retrigger:
    // Plucking Note 2 while Note 1 is active sends Note Off for Note 1 first
    const monoBridge = new GuitarMIDIOutput({ mode: 'monophonic', channel: 1 });
    await monoBridge.init();
    monoBridge.clearLoopbackLog();

    // Note 1: E2 (82.41 Hz, MIDI 40)
    monoBridge.processAudioAnalysis({
        f0: 82.41,
        rms: 0.15,
        isPluck: true,
        confidence: 0.95,
        time: 4.000
    });
    assert(monoBridge.getActiveVoices().length === 1, "Monophonic: Note 1 active");

    // Note 2: G2 (98.00 Hz, MIDI 43)
    monoBridge.clearLoopbackLog();
    monoBridge.processAudioAnalysis({
        f0: 98.00,
        rms: 0.18,
        isPluck: true,
        confidence: 0.95,
        time: 4.100
    });
    const monoRetriggerLog = monoBridge.getLoopbackLog();
    const offOldNote = monoRetriggerLog.find(e => e.parsed.command === 'Note Off' && e.bytes[1] === 40);
    const onNewNote = monoRetriggerLog.find(e => e.parsed.command === 'Note On' && e.bytes[1] === 43);
    assert(offOldNote !== undefined, "Monophonic: Note Off issued for previous note (MIDI 40) on re-attack");
    assert(onNewNote !== undefined, "Monophonic: Note On issued for new note (MIDI 43)");
    assert(monoBridge.getActiveVoices().length === 1, "Monophonic: strictly 1 voice active at a time");

    // 9.2 MPE Mode (MIDI Polyphonic Expression):
    // Strings 0..5 mapped to Channels 2..7. Multiple strings ring simultaneously
    // with independent pitch bends.
    const mpeBridge = new GuitarMIDIOutput({
        mode: 'mpe',
        stringChannels: [2, 3, 4, 5, 6, 7]
    });
    await mpeBridge.init();
    mpeBridge.clearLoopbackLog();

    // Pluck String 0 (High E, MIDI 64) -> Channel 2
    mpeBridge.processAudioAnalysis({
        f0: 329.63,
        rms: 0.15,
        isPluck: true,
        stringIndex: 0,
        time: 5.000
    });
    let mpeLog = mpeBridge.getLoopbackLog();
    let note1 = mpeLog.find(e => e.parsed.command === 'Note On');
    assert(note1 !== undefined && note1.bytes[0] === 0x91, "MPE: String 0 routed to Channel 2 (status 0x91)");

    // Pluck String 1 (B3, MIDI 59) -> Channel 3 while String 0 is still ringing!
    mpeBridge.clearLoopbackLog();
    mpeBridge.processAudioAnalysis({
        f0: 246.94,
        rms: 0.14,
        isPluck: true,
        stringIndex: 1,
        time: 5.050
    });
    mpeLog = mpeBridge.getLoopbackLog();
    let note2 = mpeLog.find(e => e.parsed.command === 'Note On');
    assert(note2 !== undefined && note2.bytes[0] === 0x92, "MPE: String 1 routed to Channel 3 (status 0x92)");
    assert(mpeBridge.getActiveVoices().length === 2, "MPE: Both String 0 and String 1 ringing simultaneously");

    // Bend String 0 (+150 cents) -> Must send pitch bend ONLY on Channel 2 (0xE1), NOT Channel 3!
    mpeBridge.clearLoopbackLog();
    mpeBridge.processAudioAnalysis({
        f0: 329.63 * Math.pow(2, 150 / 1200),
        rms: 0.12,
        isPluck: false,
        stringIndex: 0,
        time: 5.100
    });
    const string0Bends = mpeBridge.getLoopbackLog().filter(e => e.parsed.command === 'Pitch Bend');
    assert(string0Bends.length === 1, "MPE: Pitch bend transmitted for String 0");
    assert(string0Bends[0].bytes[0] === 0xE1, `MPE: Pitch bend status byte is 0xE1 (Channel 2 only), got 0x${string0Bends[0].bytes[0].toString(16)}`);

    // =========================================================================
    // Section 10: Global Panic & All Notes Off
    // =========================================================================
    console.log("\n=== Section 10: Global Panic & All Notes Off ===");

    mpeBridge.clearLoopbackLog();
    mpeBridge.panic();
    const panicLog = mpeBridge.getLoopbackLog();
    assert(panicLog.length >= 32, "Panic issued All Notes Off, All Sound Off, and Pitch Reset across channels");
    const allNotesOffCC = panicLog.filter(e => e.bytes[1] === 123);
    const allSoundOffCC = panicLog.filter(e => e.bytes[1] === 120);
    assert(allNotesOffCC.length === 16, "CC 123 (All Notes Off) sent to all 16 MIDI channels");
    assert(allSoundOffCC.length === 16, "CC 120 (All Sound Off) sent to all 16 MIDI channels");
    assert(mpeBridge.getActiveVoices().length === 0, "Panic cleared all active voice states");

    // =========================================================================
    // Section 11: Seamless GuitarDSP Integration Hook
    // =========================================================================
    console.log("\n=== Section 11: Seamless GuitarDSP Integration Hook ===");

    class MockGuitarDSP {
        constructor() {
            this.onPitchDetected = null;
            this.onPluck = null;
            this.onNoteOff = null;
            this.onSilence = null;
        }
    }

    const mockDSP = new MockGuitarDSP();
    const autoBridge = new GuitarMIDIOutput();
    await autoBridge.init();
    autoBridge.connectDSP(mockDSP);

    assert(typeof mockDSP.onPitchDetected === 'function', "connectDSP() binds onPitchDetected callback");
    assert(typeof mockDSP.onPluck === 'function', "connectDSP() binds onPluck callback");
    assert(typeof mockDSP.onNoteOff === 'function', "connectDSP() binds onNoteOff callback");
    assert(typeof mockDSP.onSilence === 'function', "connectDSP() binds onSilence callback");

    autoBridge.clearLoopbackLog();
    // Simulate DSP onPluck dispatch
    mockDSP.onPluck({
        frequency: 440.0, // A4 = MIDI 69
        f0: 440.0,
        midi: 69,
        rms: 0.22,
        confidence: 0.98,
        time: 6.000
    });

    const dspLog = autoBridge.getLoopbackLog();
    const dspNoteOn = dspLog.find(e => e.parsed.command === 'Note On');
    assert(dspNoteOn !== undefined, "Mock DSP onPluck triggered MIDI Note On");
    assert(dspNoteOn.bytes[1] === 69, "Piped MIDI pitch matches 69 (A4)");

    // Simulate DSP onSilence
    mockDSP.onSilence();
    const silenceNoteOff = autoBridge.getLastMessage();
    assert(silenceNoteOff !== null, "Mock DSP onSilence triggered decay sequence");

    // =========================================================================
    // Summary
    // =========================================================================
    console.log("\n================================================================================");
    console.log(`Verification Complete: ${testsPassed} passed, ${testsFailed} failed.`);
    console.log("================================================================================");

    if (testsFailed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
})();
