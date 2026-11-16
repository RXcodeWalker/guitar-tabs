/**
 * Automated Verification Suite for GuitarEffectsRack (Stompbox Chain)
 * Tests:
 * 1. Web Audio Node Graph Construction & Zero Dependencies
 * 2. Tube Screamer / Overdrive Asymmetric Sigmoid Curve & Parameters
 * 3. Analog BBD Delay Feedback Safety Clamp (0-90%) & 2200Hz Roll-off Filter
 * 4. Studio Ambient Reverb Synthetic IR Generation, Damping & Normalization
 * 5. Split Signal Routing (Raw Pitch Analyser vs Wet Destination)
 * 6. Master & Individual True-Bypass Switches
 * 7. Modular API: .setParam(effect, param, value), .getParam(), .getState()
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

// =========================================================================
// RUN TESTS
// =========================================================================
const GuitarEffectsRack = require('./js/effects-rack.js');

console.log("=== 1. Instantiating GuitarEffectsRack with Split Routing ===");
const mockCtx = new MockAudioContext();
const mockSource = mockCtx.createGain();
const rack = new GuitarEffectsRack(mockCtx, mockSource);

assert(rack !== null, "GuitarEffectsRack instantiated successfully");
assert(rack.inputNode !== null, "Main input summing node created");
assert(rack.pitchAnalyser !== null, "Dedicated pitch AnalyserNode created");
assert(rack.inputNode.connections.includes(rack.pitchAnalyser), "Split signal: input directly connects to raw pitchAnalyser");
assert(mockSource.connections.includes(rack.inputNode), "Audio source node successfully connected to rack input");

console.log("\n=== 2. Testing Tube Screamer / Overdrive DSP Model ===");
assert(rack.od.waveShaper.oversample === '4x', "WaveShaper configured with 4x oversampling to eliminate aliasing");
assert(rack.od.preFilter.type === 'highpass', "Pre-emphasis highpass filter configured");
assert(rack.od.preFilter.frequency.value === 320, "Pre-filter frequency set to 320Hz to prevent low-end mud distortion");

const curve = rack._generateOverdriveCurve(4096, 0.35, 2.2);
assert(curve.length === 4096, "WaveShaper transfer curve has 4096 sample resolution");

// Curve math verification
const midIdx = Math.floor(curve.length / 2);
assert(Math.abs(curve[midIdx]) < 0.001, `Transfer curve at x=0 has zero DC offset (got ${curve[midIdx].toFixed(6)})`);

const posSample = curve[Math.floor(curve.length * 0.75)]; // x = +0.5
const negSample = curve[Math.floor(curve.length * 0.25)]; // x = -0.5
assert(posSample > 0 && negSample < 0, "Transfer curve is properly bipolar");
assert(Math.abs(Math.abs(posSample) - Math.abs(negSample)) > 0.05, 
    `Transfer curve exhibits asymmetric saturation (|pos|=${Math.abs(posSample).toFixed(4)} vs |neg|=${Math.abs(negSample).toFixed(4)})`);

// Verify max bounds strictly within [-1.0, 1.0]
let maxVal = 0;
for (let i = 0; i < curve.length; i++) {
    if (Math.abs(curve[i]) > maxVal) maxVal = Math.abs(curve[i]);
}
assert(maxVal <= 1.0001, `WaveShaper curve peak normalized within 1.0 (got ${maxVal.toFixed(4)})`);

// Overdrive Parameters
rack.setParam('overdrive', 'drive', 80);
assert(rack.getParam('overdrive', 'drive') === 80, "Drive parameter updated to 80");
assert(Math.abs(rack.od.driveGain.gain.targetValue - (1.0 + 0.8 * 24.0)) < 0.01, 
    `Drive pre-gain scaled correctly (got ${rack.od.driveGain.gain.targetValue.toFixed(2)})`);

rack.setParam('overdrive', 'tone', 0); // darkest
assert(rack.od.toneFilter.frequency.targetValue === 800, "Tone 0 sets low-pass cutoff to 800 Hz");
rack.setParam('overdrive', 'tone', 100); // brightest
assert(rack.od.toneFilter.frequency.targetValue === 6500, "Tone 100 sets low-pass cutoff to 6500 Hz");
rack.setParam('overdrive', 'tone', 50); // midpoint
assert(Math.abs(rack.od.toneFilter.frequency.targetValue - 2280) < 50, 
    `Tone 50 logarithmically sets cutoff to ~2280 Hz (got ${rack.od.toneFilter.frequency.targetValue.toFixed(1)} Hz)`);

rack.setParam('overdrive', 'level', 60);
assert(Math.abs(rack.od.levelGain.gain.targetValue - 0.9) < 0.01, "Level 60 sets level gain to 0.90");

rack.setBypass('overdrive', true);
assert(rack.isBypassed('overdrive') === true, "Overdrive true-bypass enabled");
assert(rack.od.dryGain.gain.targetValue === 1.0, "Overdrive bypass routes dry signal to 1.0");
assert(rack.od.wetGain.gain.targetValue === 0.0, "Overdrive bypass mutes wet signal to 0.0");

rack.setBypass('overdrive', false);
assert(rack.isBypassed('overdrive') === false, "Overdrive true-bypass disabled (engaged)");
assert(rack.od.dryGain.gain.targetValue === 0.0, "Engaged overdrive mutes dry signal");
assert(rack.od.wetGain.gain.targetValue === 1.0, "Engaged overdrive passes wet signal at 1.0");

console.log("\n=== 3. Testing Analog BBD Delay DSP Model ===");
assert(rack.delay.bbdFilter.type === 'lowpass', "BBD feedback filter is a lowpass filter");
assert(rack.delay.bbdFilter.frequency.value === 2200, "BBD feedback filter frequency set to 2200 Hz analog roll-off");

// Feedback Safety Clamp (0 - 90%)
rack.setParam('delay', 'feedback', 50);
assert(rack.getParam('delay', 'feedback') === 50, "Feedback set to 50%");
assert(Math.abs(rack.delay.feedbackGain.gain.targetValue - 0.5) < 0.01, "Feedback gain set to 0.5");

rack.setParam('delay', 'feedback', 120); // Attempt overshoot past 90%
assert(rack.getParam('delay', 'feedback') === 90, "Feedback strictly clamped to 90% max to prevent infinite runaway squeal");
assert(rack.delay.feedbackGain.gain.targetValue <= 0.90, "Feedback gain never exceeds 0.90");

// Delay Time (20ms - 1000ms)
rack.setParam('delay', 'time', 450);
assert(rack.getParam('delay', 'time') === 450, "Delay time set to 450ms");
assert(Math.abs(rack.delay.delayNode.delayTime.targetValue - 0.45) < 0.001, "DelayNode delayTime converted to 0.45s");

rack.setParam('delay', 'time', 5); // Below 20ms
assert(rack.getParam('delay', 'time') === 20, "Delay time clamped to 20ms min");
rack.setParam('delay', 'time', 2000); // Above 1000ms
assert(rack.getParam('delay', 'time') === 1000, "Delay time clamped to 1000ms max");

// Wet/Dry Mix Equal Power Crossfade
rack.setParam('delay', 'mix', 0);
assert(Math.abs(rack.delay.dryGain.gain.targetValue - 1.0) < 0.01, "Delay mix 0% has 1.0 dry gain");
assert(Math.abs(rack.delay.wetGain.gain.targetValue - 0.0) < 0.01, "Delay mix 0% has 0.0 wet gain");

rack.setParam('delay', 'mix', 100);
assert(Math.abs(rack.delay.dryGain.gain.targetValue - 0.0) < 0.01, "Delay mix 100% has 0.0 dry gain");
assert(Math.abs(rack.delay.wetGain.gain.targetValue - 1.0) < 0.01, "Delay mix 100% has 1.0 wet gain");

rack.setParam('delay', 'mix', 50);
assert(Math.abs(rack.delay.dryGain.gain.targetValue - Math.SQRT1_2) < 0.01, "Delay mix 50% equal-power dry gain ~0.707");
assert(Math.abs(rack.delay.wetGain.gain.targetValue - Math.SQRT1_2) < 0.01, "Delay mix 50% equal-power wet gain ~0.707");

console.log("\n=== 4. Testing Studio Ambient Reverb DSP Model ===");
assert(rack.reverb.convolver.normalize === false, "Convolver normalize disabled for calibrated internal normalization");
assert(rack.reverb.convolver.buffer !== null, "Convolver loaded with algorithmic synthetic IR buffer");
assert(rack.reverb.convolver.buffer.numberOfChannels === 2, "Synthetic IR buffer is stereo (2 channels)");

const irBuffer = rack.reverb.convolver.buffer;
assert(irBuffer.length === Math.floor(44100 * 2.2), `IR buffer length matches size ${irBuffer.length} samples`);

// Verify damping and size update
rack.setParam('reverb', 'size', 3.0);
assert(rack.getParam('reverb', 'size') === 3.0, "Reverb size set to 3.0s");

rack.setParam('reverb', 'damping', 80);
assert(rack.getParam('reverb', 'damping') === 80, "Reverb damping set to 80%");

rack._updateReverbImpulse(); // Direct update
assert(rack.reverb.convolver.buffer.length === Math.floor(44100 * 3.0), "Updated IR buffer length reflects new 3.0s size");

console.log("\n=== 5. Testing Master Controls, Routing & State API ===");
// Master Volume
rack.setParam('master', 'volume', 75);
assert(rack.getParam('master', 'volume') === 75, "Master volume set to 75%");
assert(Math.abs(rack.master.outputGain.gain.targetValue - 0.75) < 0.01, "Master output gain set to 0.75");

// Master Bypass
rack.setParam('master', 'bypass', true);
assert(rack.isBypassed('master') === true, "Master rack bypass is engaged");
assert(rack.master.processedInput.gain.targetValue === 0.0, "Master bypass mutes processed chain input");
assert(rack.master.masterBypassDry.gain.targetValue === 1.0, "Master bypass passes raw input directly to output");

rack.setParam('master', 'bypass', false);
assert(rack.isBypassed('master') === false, "Master rack engaged");
assert(rack.master.processedInput.gain.targetValue === 1.0, "Master engaged passes processed chain");

// State Snapshot
const state = rack.getState();
assert(typeof state === 'object', "getState() returns state snapshot");
assert(state.overdrive.drive === 80, "State snapshot contains overdrive drive 80");
assert(state.delay.feedback === 90, "State snapshot contains delay feedback 90");
assert(state.reverb.size === 3.0, "State snapshot contains reverb size 3.0");
assert(state.master.volume === 75, "State snapshot contains master volume 75");

// Aliases support
rack.setParam('tubeScreamer', 'drive', 55);
assert(rack.getParam('overdrive', 'drive') === 55, "Alias 'tubeScreamer' maps to overdrive");

rack.setParam('bbd', 'feedback', 35);
assert(rack.getParam('delay', 'feedback') === 35, "Alias 'bbd' maps to delay");

rack.setParam('spring', 'damping', 40);
assert(rack.getParam('reverb', 'damping') === 40, "Alias 'spring' maps to reverb");

console.log("\n========================================");
console.log(`Verification Complete: ${testsPassed} passed, ${testsFailed} failed.`);

if (testsFailed > 0) {
    process.exit(1);
}
