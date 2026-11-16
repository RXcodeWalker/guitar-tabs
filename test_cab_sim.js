/**
 * Automated Verification Suite for CabinetSimulator (js/cab-sim.js)
 * & Effects Rack Integration (js/effects-rack.js)
 * 
 * Tests:
 * 1. Web Audio Node Graph Construction & Procedural IR Generation
 * 2. 3 Distinct Cabinet Profiles:
 *    - 4x12 Closed-Back UK (tight low-end bump @ 110 Hz, notched high cut above 5.5 kHz)
 *    - 2x12 Open-Back US (warm scoop @ 500 Hz, airy top end)
 *    - 1x12 Compact Tweed (boxy midrange punch @ 900 Hz, quick roll-off)
 * 3. Finite Values & Calibrated Peak Normalization (0.95 peakFS, no NaNs/Infs)
 * 4. Frequency Attenuation Above 6 kHz (Elimination of Overdrive Clipping Fizz)
 * 5. Virtual Microphone Controls:
 *    - Position: Center (bright/cutting) to Edge (dark/smooth)
 *    - Distance: Near (proximity bass boost) to Far (ambient room blend & reflections)
 * 6. Effects Rack Wiring: Overdrive -> CabSim -> Delay -> Reverb
 * 7. Modular API: setParam, getParam, setBypass, getState
 */

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

// =========================================================================
// Lightweight Pure-JavaScript Web Audio API Mock for Headless Node.js Tests
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
    setTargetAtTime(val, startTime, timeConstant) {
        this.targetValue = val;
        this.value = val;
    }
}

class MockAudioNode {
    constructor(ctx, type) {
        this.context = ctx;
        this.nodeType = type;
        this.connections = [];
    }
    connect(dest) {
        this.connections.push(dest);
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

class MockBiquadFilterNode extends MockAudioNode {
    constructor(ctx) {
        super(ctx, 'BiquadFilterNode');
        this.type = 'lowpass';
        this.frequency = new MockAudioParam(350);
        this.Q = new MockAudioParam(1.0);
        this.gain = new MockAudioParam(0);
    }
}

class MockWaveShaperNode extends MockAudioNode {
    constructor(ctx) {
        super(ctx, 'WaveShaperNode');
        this.curve = null;
        this.oversample = 'none';
    }
}

class MockDelayNode extends MockAudioNode {
    constructor(ctx, maxDelay = 1.0) {
        super(ctx, 'DelayNode');
        this.maxDelay = maxDelay;
        this.delayTime = new MockAudioParam(0.0);
    }
}

class MockConvolverNode extends MockAudioNode {
    constructor(ctx) {
        super(ctx, 'ConvolverNode');
        this.buffer = null;
        this.normalize = true;
    }
}

class MockAnalyserNode extends MockAudioNode {
    constructor(ctx) {
        super(ctx, 'AnalyserNode');
        this.fftSize = 2048;
        this.smoothingTimeConstant = 0.8;
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
    constructor() {
        this.sampleRate = 44100;
        this.currentTime = 0;
        this.destination = new MockAudioNode(this, 'AudioDestinationNode');
    }
    createGain() { return new MockGainNode(this); }
    createBiquadFilter() { return new MockBiquadFilterNode(this); }
    createWaveShaper() { return new MockWaveShaperNode(this); }
    createDelay(max) { return new MockDelayNode(this, max); }
    createConvolver() { return new MockConvolverNode(this); }
    createAnalyser() { return new MockAnalyserNode(this); }
    createBuffer(channels, length, sampleRate) {
        return new MockAudioBuffer(channels, length, sampleRate);
    }
}

/**
 * Computes Discrete Fourier Transform (DFT) magnitude of an audio buffer at a given frequency.
 */
function getDftMagnitude(buffer, freq, sampleRate = 44100) {
    let re = 0.0;
    let im = 0.0;
    const w = (2 * Math.PI * freq) / sampleRate;
    const len = buffer.length;
    for (let n = 0; n < len; n++) {
        const val = buffer[n];
        re += val * Math.cos(w * n);
        im -= val * Math.sin(w * n);
    }
    return Math.sqrt(re * re + im * im);
}

// =========================================================================
// RUN VERIFICATION SUITE
// =========================================================================
const CabinetSimulator = require('./js/cab-sim.js');
const GuitarEffectsRack = require('./js/effects-rack.js');

console.log("=== 1. Testing CabinetSimulator Web Audio Node Graph Construction ===");
const mockCtx = new MockAudioContext();
const cab = new CabinetSimulator(mockCtx, {
    profile: '4x12 Closed-Back UK',
    position: 20,
    distance: 15
});

assert(cab !== null, "CabinetSimulator instantiated successfully");
assert(cab.input instanceof MockGainNode, "Input summing node created");
assert(cab.output instanceof MockGainNode, "Output gain node created");
assert(cab.convolver instanceof MockConvolverNode, "ConvolverNode created for IR processing");
assert(cab.convolver.normalize === false, "Convolver normalize is disabled for calibrated peak normalization");
assert(cab.convolver.buffer !== null, "Convolver loaded with procedural synthetic IR buffer");
assert(cab.convolver.buffer.numberOfChannels === 2, "Synthetic IR buffer is stereo (2 channels)");
assert(cab.input.connections.includes(cab.convolver), "Input routes directly to ConvolverNode");
assert(cab.convolver.connections.includes(cab.wetGain), "Convolver routes to wetGain");
assert(cab.wetGain.connections.includes(cab.output), "WetGain routes to output");
assert(cab.input.connections.includes(cab.dryGain), "Input routes to dryGain for true-bypass");
assert(cab.dryGain.connections.includes(cab.output), "DryGain routes to output for true-bypass");

console.log("\n=== 2. Testing Synthetic IR Generation Across All 3 Cabinet Profiles ===");
const profiles = ['4x12 Closed-Back UK', '2x12 Open-Back US', '1x12 Compact Tweed'];

for (const prof of profiles) {
    const ir = CabinetSimulator.generateImpulseResponse(prof, 0, 0, 44100, mockCtx, 2048);
    assert(ir.left instanceof Float32Array, `${prof}: Left channel is Float32Array`);
    assert(ir.right instanceof Float32Array, `${prof}: Right channel is Float32Array`);
    assert(ir.left.length === 2048, `${prof}: IR buffer length is 2048 samples (~46.4ms)`);
    assert(ir.buffer !== null, `${prof}: AudioBuffer successfully created`);
}

// 2.1 Profile Specific Acoustic Checks
// Profile 1: 4x12 Closed-Back UK (Tight low-end bump @ 110 Hz, notched cut @ 5.8 kHz)
const ir412 = CabinetSimulator.generateImpulseResponse('4x12 Closed-Back UK', 0, 50, 44100, mockCtx, 2048);
const mag412_110 = getDftMagnitude(ir412.left, 110, 44100);
const mag412_40 = getDftMagnitude(ir412.left, 40, 44100);
const mag412_1k = getDftMagnitude(ir412.left, 1000, 44100);
const mag412_5800 = getDftMagnitude(ir412.left, 5800, 44100);

assert(mag412_110 > mag412_40 * 1.5, "4x12 Closed-Back UK: Tight resonant low-end bump @ 110 Hz confirmed (higher than sub-bass 40 Hz)");
const notchAttenDb = 20 * Math.log10(mag412_5800 / mag412_1k);
assert(notchAttenDb < -20.0, `4x12 Closed-Back UK: Notched high-end cut above 5.5 kHz confirmed (${notchAttenDb.toFixed(1)} dB @ 5.8 kHz)`);

// Profile 2: 2x12 Open-Back US (Warm scoop @ 500 Hz, airy top end)
const ir212 = CabinetSimulator.generateImpulseResponse('2x12 Open-Back US', 0, 50, 44100, mockCtx, 2048);
const mag212_1k = getDftMagnitude(ir212.left, 1000, 44100);
const mag212_500 = getDftMagnitude(ir212.left, 500, 44100);
const scoopDb = 20 * Math.log10(mag212_500 / mag212_1k);
assert(scoopDb < -2.0, `2x12 Open-Back US: Warm scoop @ 500 Hz confirmed (${scoopDb.toFixed(1)} dB relative to 1 kHz)`);

const mag212_4800 = getDftMagnitude(ir212.left, 4800, 44100);
const mag412_4800 = getDftMagnitude(ir412.left, 4800, 44100);
assert(mag212_4800 / mag212_1k > mag412_4800 / mag412_1k, "2x12 Open-Back US: Airy top end preserves higher upper-mid presence than 4x12");

// Profile 3: 1x12 Compact Tweed (Boxy midrange punch @ 900 Hz, quick roll-off)
const ir112 = CabinetSimulator.generateImpulseResponse('1x12 Compact Tweed', 0, 50, 44100, mockCtx, 2048);
const mag112_900 = getDftMagnitude(ir112.left, 900, 44100);
const mag112_110 = getDftMagnitude(ir112.left, 110, 44100);
assert(mag112_900 > mag112_110 * 1.5, "1x12 Compact Tweed: Boxy midrange punch @ 900 Hz confirmed (exceeds low-end bass)");

console.log("\n=== 3. Testing Finite Values & Calibrated Peak Normalization ===");
for (const prof of profiles) {
    for (const pos of [0, 50, 100]) {
        for (const dist of [0, 50, 100]) {
            const ir = CabinetSimulator.generateImpulseResponse(prof, pos, dist, 44100, mockCtx, 2048);
            let hasNaN = false;
            let maxPeak = 0.0;

            for (let i = 0; i < ir.left.length; i++) {
                const sl = ir.left[i];
                const sr = ir.right[i];
                if (!Number.isFinite(sl) || !Number.isFinite(sr)) {
                    hasNaN = true;
                    break;
                }
                if (Math.abs(sl) > maxPeak) maxPeak = Math.abs(sl);
                if (Math.abs(sr) > maxPeak) maxPeak = Math.abs(sr);
            }

            assert(!hasNaN, `${prof} [pos=${pos}, dist=${dist}]: All samples are strictly finite (no NaN/Infs)`);
            assert(Math.abs(maxPeak - 0.95) < 0.001, `${prof} [pos=${pos}, dist=${dist}]: Peak strictly normalized to 0.95 (got ${maxPeak.toFixed(5)})`);
        }
    }
}

console.log("\n=== 4. Testing Frequency Attenuation Above 6 kHz (Anti-Fizz Model) ===");
for (const prof of profiles) {
    const ir = CabinetSimulator.generateImpulseResponse(prof, 50, 50, 44100, mockCtx, 2048);
    const refMag = getDftMagnitude(ir.left, 1000, 44100);
    const mag8k = getDftMagnitude(ir.left, 8000, 44100);
    const mag10k = getDftMagnitude(ir.left, 10000, 44100);

    const atten8kDb = 20 * Math.log10(mag8k / refMag);
    const atten10kDb = 20 * Math.log10(mag10k / refMag);

    assert(atten8kDb < -15.0, `${prof}: High-end attenuation @ 8 kHz is ${atten8kDb.toFixed(1)} dB (strictly < -15 dB eliminates fizz)`);
    assert(atten10kDb < -20.0, `${prof}: High-end attenuation @ 10 kHz is ${atten10kDb.toFixed(1)} dB (strictly < -20 dB eliminates fizzy harmonics)`);
}

console.log("\n=== 5. Testing Virtual Microphone Controls (Position & Distance) ===");
// Position: Center (bright/cutting) vs Edge (dark/smooth)
const irCenter = CabinetSimulator.generateImpulseResponse('4x12 Closed-Back UK', 0, 0, 44100, mockCtx, 2048);   // Center
const irEdge = CabinetSimulator.generateImpulseResponse('4x12 Closed-Back UK', 100, 0, 44100, mockCtx, 2048);    // Edge

const highEnergyCenter = getDftMagnitude(irCenter.left, 4000, 44100);
const highEnergyEdge = getDftMagnitude(irEdge.left, 4000, 44100);

assert(highEnergyCenter > highEnergyEdge * 1.5, 
    `Mic Position: Center is significantly brighter than Edge @ 4 kHz (${highEnergyCenter.toFixed(2)} vs ${highEnergyEdge.toFixed(2)})`);

// Distance: Near (proximity bass boost) vs Far (ambient room blend)
const irNear = CabinetSimulator.generateImpulseResponse('4x12 Closed-Back UK', 50, 0, 44100, mockCtx, 2048);    // Near
const irFar = CabinetSimulator.generateImpulseResponse('4x12 Closed-Back UK', 50, 100, 44100, mockCtx, 2048);   // Far

const bassNear = getDftMagnitude(irNear.left, 110, 44100);
const bassFar = getDftMagnitude(irFar.left, 110, 44100);
assert(bassNear > bassFar * 1.15, `Mic Distance: Near exhibits acoustic proximity bass boost relative to Far`);

// Far distance ambient reflection presence
let farReflectionSum = 0;
let nearReflectionSum = 0;
// Sample interval between 1.5ms and 8ms
const startSample = Math.floor(0.0015 * 44100);
const endSample = Math.floor(0.0080 * 44100);
for (let i = startSample; i < endSample; i++) {
    farReflectionSum += Math.abs(irFar.left[i]);
    nearReflectionSum += Math.abs(irNear.left[i]);
}
assert(farReflectionSum > nearReflectionSum, "Mic Distance: Far contains ambient boundary reflection energy");

console.log("\n=== 6. Testing Effects Rack Pipeline Wiring (Overdrive -> CabSim -> Delay) ===");
const effectsRack = new GuitarEffectsRack(mockCtx);

assert(effectsRack.cabSim !== null, "GuitarEffectsRack instantiated with CabinetSimulator");
assert(effectsRack.od.output.connections.includes(effectsRack.cabSim.input), 
    "Signal Routing: Overdrive output connects directly into CabinetSimulator input");
assert(effectsRack.cabSim.output.connections.includes(effectsRack.delay.input), 
    "Signal Routing: CabinetSimulator output connects directly into Delay input");

console.log("\n=== 7. Testing Cabinet Simulator Rack Parameter & Bypass API ===");
// Profile switching
effectsRack.setParam('cabinet', 'profile', '2x12 Open-Back US');
assert(effectsRack.getParam('cabinet', 'profile') === '2x12 Open-Back US', "Updated cabinet profile to '2x12 Open-Back US'");
assert(effectsRack.cabSim.getProfile() === '2x12 Open-Back US', "Internal CabSim profile updated");

// Position control
effectsRack.setParam('cabinet', 'position', 65);
assert(effectsRack.getParam('cabinet', 'position') === 65, "Updated mic position to 65");
assert(effectsRack.cabSim.getMicPosition() === 65, "Internal CabSim mic position updated");

// Distance control
effectsRack.setParam('cabinet', 'distance', 80);
assert(effectsRack.getParam('cabinet', 'distance') === 80, "Updated mic distance to 80");
assert(effectsRack.cabSim.getMicDistance() === 80, "Internal CabSim mic distance updated");

// Aliases support ('cab', 'cabsim', 'speaker')
effectsRack.setParam('cab', 'position', 10);
assert(effectsRack.getParam('cabinet', 'position') === 10, "Alias 'cab' updates position");

effectsRack.setParam('cabsim', 'distance', 25);
assert(effectsRack.getParam('cabinet', 'distance') === 25, "Alias 'cabsim' updates distance");

effectsRack.setParam('speaker', 'profile', '1x12 Compact Tweed');
assert(effectsRack.getParam('cabinet', 'profile') === '1x12 Compact Tweed', "Alias 'speaker' updates profile");

// True-Bypass
effectsRack.setBypass('cabinet', true);
assert(effectsRack.isBypassed('cabinet') === true, "Cabinet true-bypass engaged");
assert(effectsRack.cabSim.isBypassed() === true, "Internal CabSim bypass engaged");
assert(effectsRack.cabSim.dryGain.gain.targetValue === 1.0, "Cabinet bypass routes dry signal at 1.0");
assert(effectsRack.cabSim.wetGain.gain.targetValue === 0.0, "Cabinet bypass mutes wet IR signal at 0.0");

effectsRack.setBypass('cabinet', false);
assert(effectsRack.isBypassed('cabinet') === false, "Cabinet engaged (bypass disabled)");
assert(effectsRack.cabSim.dryGain.gain.targetValue === 0.0, "Engaged cabinet mutes dry signal");
assert(effectsRack.cabSim.wetGain.gain.targetValue === 1.0, "Engaged cabinet passes wet IR signal at 1.0");

// State Snapshot
const state = effectsRack.getState();
assert(typeof state.cabinet === 'object', "getState() includes cabinet state object");
assert(state.cabinet.profile === '1x12 Compact Tweed', "State snapshot contains cabinet profile");
assert(state.cabinet.position === 10, "State snapshot contains mic position 10");
assert(state.cabinet.distance === 25, "State snapshot contains mic distance 25");

console.log("\n================================================================================");
console.log(`Cabinet Simulator Verification Complete: ${testsPassed} passed, ${testsFailed} failed.`);
console.log("================================================================================");

if (testsFailed > 0) {
    process.exit(1);
}
