/**
 * Automated Test Suite for High-Precision Strobe Tuner & Inharmonicity Analyzer
 * 
 * Verifies:
 * 1. Tuning Preset Engine (6 presets, open-string frequencies, remapping)
 * 2. Cents Deviation & Sub-Cent Precision (0.1 cent)
 * 3. Strobe Disc Rotational Dynamics (Clockwise sharp, Counter-clockwise flat, Stationary zero)
 * 4. Acoustic Physics Inharmonicity Calculation (f_n = n * f0 * sqrt(1 + B * n^2))
 * 5. String Wear & Degradation Assessment
 * 6. Parabolic Spectral Peak Interpolation
 * 7. Synthetic Stiff String Audio Pluck Generation
 */

const { StrobeTuner, TUNING_PRESETS, getCentsDeviation, midiToFreq } = require('./js/strobe-tuner.js');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failed++;
    }
}

console.log("=== 1. Testing Alternate Tuning Engine & Open-String Frequencies ===");

const tuner = new StrobeTuner(null, null, null, { a4: 440, preset: 'standard' });

// 1.1 Standard Tuning (EADGBE)
const std = tuner.getTuning();
assert(std.preset === 'standard', "Initial preset is 'standard'");
assert(std.frequencies.length === 6, "Standard preset outputs 6 open-string frequencies");
assert(Math.abs(std.frequencies[0] - 82.4069) < 0.01, `Low E (String 6) is ~82.41 Hz (got ${std.frequencies[0].toFixed(4)})`);
assert(Math.abs(std.frequencies[1] - 110.0000) < 0.01, `A (String 5) is 110.00 Hz (got ${std.frequencies[1].toFixed(4)})`);
assert(Math.abs(std.frequencies[2] - 146.8324) < 0.01, `D (String 4) is ~146.83 Hz (got ${std.frequencies[2].toFixed(4)})`);
assert(Math.abs(std.frequencies[3] - 195.9977) < 0.01, `G (String 3) is ~196.00 Hz (got ${std.frequencies[3].toFixed(4)})`);
assert(Math.abs(std.frequencies[4] - 246.9417) < 0.01, `B (String 2) is ~246.94 Hz (got ${std.frequencies[4].toFixed(4)})`);
assert(Math.abs(std.frequencies[5] - 329.6276) < 0.01, `High e (String 1) is ~329.63 Hz (got ${std.frequencies[5].toFixed(4)})`);

// 1.2 Drop D Tuning (DADGBE)
const dropD = tuner.setTuning('dropD');
assert(dropD.preset === 'dropD', "Switched to 'dropD' preset");
assert(Math.abs(dropD.frequencies[0] - 73.4162) < 0.01, `Low D (String 6) drops to ~73.42 Hz (got ${dropD.frequencies[0].toFixed(4)})`);
assert(Math.abs(dropD.frequencies[5] - 329.6276) < 0.01, `High e remains ~329.63 Hz`);

// 1.3 DADGAD Tuning
const dadgad = tuner.setTuning('dadgad');
assert(dadgad.preset === 'dadgad', "Switched to 'dadgad' preset");
assert(Math.abs(dadgad.frequencies[0] - 73.4162) < 0.01, `String 6 is D2 (73.42 Hz)`);
assert(Math.abs(dadgad.frequencies[4] - 220.0000) < 0.01, `String 2 is A3 (220.00 Hz)`);
assert(Math.abs(dadgad.frequencies[5] - 293.6648) < 0.01, `String 1 is D4 (293.66 Hz)`);

// 1.4 Open D Tuning (DADF#AD)
const openD = tuner.setTuning('openD');
assert(openD.preset === 'openD', "Switched to 'openD' preset");
assert(Math.abs(openD.frequencies[3] - 184.9972) < 0.01, `String 3 is F#3 (~185.00 Hz)`);
assert(openD.notes.includes('F#3'), "Open D includes F#3 note");

// 1.5 Open G Tuning (DGDGBD)
const openG = tuner.setTuning('openG');
assert(openG.preset === 'openG', "Switched to 'openG' preset");
assert(Math.abs(openG.frequencies[1] - 97.9989) < 0.01, `String 5 is G2 (~98.00 Hz)`);
assert(openG.notes[1] === 'G2', "Open G String 5 is G2");

// 1.6 Half-Step Down Tuning (Eb Ab Db Gb Bb Eb)
const halfStep = tuner.setTuning('halfStep');
assert(halfStep.preset === 'halfStep', "Switched to 'halfStep' preset");
assert(Math.abs(halfStep.frequencies[0] - 77.7817) < 0.01, `Low Eb (String 6) is ~77.78 Hz (got ${halfStep.frequencies[0].toFixed(4)})`);
assert(Math.abs(halfStep.frequencies[5] - 311.1270) < 0.01, `High Eb (String 1) is ~311.13 Hz (got ${halfStep.frequencies[5].toFixed(4)})`);

// 1.7 Callback dispatch verification
let callbackFired = false;
tuner.onTuningChange = (info) => {
    callbackFired = true;
    assert(info.frequencies.length === 6, "onTuningChange callback provides 6 base frequencies");
};
tuner.setTuning('standard');
assert(callbackFired, "onTuningChange callback successfully fired on preset switch");

console.log("\n=== 2. Testing Cents Deviation & Precision ===");

// Exact pitch
const zeroCents = getCentsDeviation(440, 440);
assert(Math.abs(zeroCents) < 1e-9, `In tune frequency gives 0.0 cents (got ${zeroCents})`);

// 0.1 cent precision test
const sharp01Freq = 440 * Math.pow(2, 0.1 / 1200);
const calc01Cents = getCentsDeviation(sharp01Freq, 440);
assert(Math.abs(calc01Cents - 0.1) < 0.001, `0.1 cent frequency deviation resolves to 0.1¢ (got ${calc01Cents.toFixed(4)})`);

// Sharp deviation (+10 cents)
const sharp10Freq = 440 * Math.pow(2, 10 / 1200);
const centsSharp = getCentsDeviation(sharp10Freq, 440);
assert(Math.abs(centsSharp - 10.0) < 0.01, `+10 cents sharp deviation is accurately calculated (got ${centsSharp.toFixed(2)})`);

// Flat deviation (-15 cents)
const flat15Freq = 440 * Math.pow(2, -15 / 1200);
const centsFlat = getCentsDeviation(flat15Freq, 440);
assert(Math.abs(centsFlat - (-15.0)) < 0.01, `-15 cents flat deviation is accurately calculated (got ${centsFlat.toFixed(2)})`);

console.log("\n=== 3. Testing Virtual Strobe Disc Rotational Dynamics ===");

// 3.1 Stationary condition at 0.0 cents
tuner.cents = 0.0;
tuner.hasSignal = true;
tuner.outerAngle = 1.0;
tuner.lastFrameTime = 1000;
tuner.update(1016); // ~16ms frame
assert(Math.abs(tuner.outerAngle - 1.0) < 1e-5, "At 0 cents deviation, strobe disc remains stationary (no drift)");

// 3.2 Sharp note: rotates clockwise (omega > 0)
tuner.cents = 5.0; // +5.0 cents sharp
tuner.outerAngle = 0.0;
tuner.lastFrameTime = 1000;
tuner.update(1050); // 50ms
assert(tuner.outerAngle > 0, `Sharp note (+5¢) rotates clockwise: angle increased to ${tuner.outerAngle.toFixed(4)} rad`);

// 3.3 Flat note: rotates counter-clockwise (omega < 0)
tuner.cents = -5.0; // -5.0 cents flat
tuner.outerAngle = 1.0;
tuner.lastFrameTime = 1000;
tuner.update(1050); // 50ms
assert(tuner.outerAngle < 1.0, `Flat note (-5¢) rotates counter-clockwise: angle decreased to ${tuner.outerAngle.toFixed(4)} rad`);

// 3.4 Speed proportionality test
tuner.cents = 2.0;
tuner.outerAngle = 0.0;
tuner.lastFrameTime = 1000;
tuner.update(1100);
const deltaAngle2 = tuner.outerAngle;

tuner.cents = 4.0;
tuner.outerAngle = 0.0;
tuner.lastFrameTime = 1000;
tuner.update(1100);
const deltaAngle4 = tuner.outerAngle;

const speedRatio = deltaAngle4 / deltaAngle2;
assert(Math.abs(speedRatio - 2.0) < 0.05, `Rotation speed is directly proportional to cents: ratio is ${speedRatio.toFixed(2)} (expected 2.0)`);

console.log("\n=== 4. Testing Acoustic Inharmonicity (String Stiffness Model) ===");

// Test Case 4.1: Ideal flexurally limp string (B = 0)
// f_n = n * f0
const idealPeaks = [
    { n: 1, freq: 110.0 },
    { n: 2, freq: 220.0 },
    { n: 3, freq: 330.0 },
    { n: 4, freq: 440.0 }
];
const inharmZero = tuner.calculateInharmonicity(idealPeaks);
assert(Math.abs(inharmZero.B) < 1e-6, `Ideal string returns B ≈ 0.0 (got ${inharmZero.B})`);
assert(Math.abs(inharmZero.f0 - 110.0) < 0.01, `Fundamental f0 recovered as 110.0 Hz (got ${inharmZero.f0.toFixed(2)})`);
assert(inharmZero.stringWear === 'Fresh', "Zero stiffness string classified as 'Fresh'");

// Test Case 4.2: Real acoustic guitar string with known stiffness B = 0.00035
// Model: f_n = n * f0 * sqrt(1 + B * n^2)
const f0_real = 82.4069; // Low E
const B_target = 0.00035;
const stiffPeaks = [];
for (let n = 1; n <= 4; n++) {
    stiffPeaks.push({
        n: n,
        freq: n * f0_real * Math.sqrt(1 + B_target * n * n)
    });
}

const inharmCalc = tuner.calculateInharmonicity(stiffPeaks);
assert(Math.abs(inharmCalc.B - B_target) < 1e-6, `Calculated B (${inharmCalc.B.toFixed(6)}) matches target B (${B_target}) to 6 decimal places`);
assert(Math.abs(inharmCalc.f0 - f0_real) < 0.05, `Calculated fundamental f0 (${inharmCalc.f0.toFixed(4)} Hz) matches nominal ${f0_real}`);
assert(inharmCalc.rSquared > 0.9999, `Linear regression goodness R^2 is near 1.0 (got ${inharmCalc.rSquared.toFixed(5)})`);
assert(inharmCalc.stringWear === 'Good', `String with B = 0.00035 classified as 'Good' condition (got ${inharmCalc.stringWear})`);

// Test Case 4.3: Aged string with wear B = 0.00075
const agedPeaks = [];
for (let n = 1; n <= 4; n++) {
    agedPeaks.push({
        n: n,
        freq: n * 110.0 * Math.sqrt(1 + 0.00075 * n * n)
    });
}
const inharmAged = tuner.calculateInharmonicity(agedPeaks);
assert(Math.abs(inharmAged.B - 0.00075) < 1e-6, `Aged string B matches 0.00075 (got ${inharmAged.B.toFixed(6)})`);
assert(inharmAged.stringWear === 'Aged', `Aged string classified as 'Aged' (got ${inharmAged.stringWear})`);

// Test Case 4.4: Heavily degraded/worn string B = 0.00130
const wornPeaks = [];
for (let n = 1; n <= 4; n++) {
    wornPeaks.push({
        n: n,
        freq: n * 110.0 * Math.sqrt(1 + 0.00130 * n * n)
    });
}
const inharmWorn = tuner.calculateInharmonicity(wornPeaks);
assert(Math.abs(inharmWorn.B - 0.00130) < 1e-6, `Worn string B matches 0.00130 (got ${inharmWorn.B.toFixed(6)})`);
assert(inharmWorn.stringWear === 'Worn', `Worn string classified as 'Worn' (got ${inharmWorn.stringWear})`);

console.log("\n=== 5. Testing Parabolic Spectral Peak Interpolation ===");

// Create synthetic FFT magnitude buffer
// 4096 bins, sampleRate = 44100 -> binWidth = 22050 / 4096 ≈ 5.3833 Hz
const testBinCount = 4096;
const testSR = 44100;
const testBinWidth = (testSR / 2) / testBinCount;
const synthFreqBuffer = new Float32Array(testBinCount).fill(-100); // -100 dB noise floor

// Put a peak at exactly 220.35 Hz (fractional bin: 220.35 / 5.3833 = 40.932)
const targetExactFreq = 220.35;
const targetBinFloat = targetExactFreq / testBinWidth;
const centerBin = Math.round(targetBinFloat);

// Simulate parabolic response around center bin
for (let b = centerBin - 4; b <= centerBin + 4; b++) {
    const dist = (b - targetBinFloat);
    synthFreqBuffer[b] = -10 - 2.5 * dist * dist; // Parabolic peak in dB
}

// Also add 2nd, 3rd, and 4th partials
for (let n = 2; n <= 4; n++) {
    const partFreq = n * targetExactFreq * Math.sqrt(1 + 0.0003 * n * n);
    const pBinFloat = partFreq / testBinWidth;
    const pCenter = Math.round(pBinFloat);
    for (let b = pCenter - 3; b <= pCenter + 3; b++) {
        const dist = (b - pBinFloat);
        synthFreqBuffer[b] = -15 - 3.0 * dist * dist;
    }
}

const detectedPeaks = tuner.detectSpectralPeaks(synthFreqBuffer, targetExactFreq, testSR);
assert(detectedPeaks.length === 4, `Extracted all 4 spectral peaks (found ${detectedPeaks.length})`);
assert(Math.abs(detectedPeaks[0].freq - targetExactFreq) < 0.2, `Fundamental peak refined to within 0.2 Hz of true frequency (got ${detectedPeaks[0].freq.toFixed(2)} Hz vs ${targetExactFreq} Hz)`);

console.log("\n=== 6. Testing Synthetic Physical Pluck Simulation ===");

const pluck = tuner.simulatePluck(82.41, 0.00035, 0.5);
assert(pluck instanceof Float32Array, "simulatePluck returns Float32Array time-domain audio samples");
assert(pluck.length === Math.floor(44100 * 0.5), `Pluck buffer length matches duration (got ${pluck.length} samples)`);

let maxAmp = 0;
for (let i = 0; i < pluck.length; i++) {
    if (Math.abs(pluck[i]) > maxAmp) maxAmp = Math.abs(pluck[i]);
}
assert(maxAmp > 0.5 && maxAmp <= 1.0, `Synthetic pluck has realistic peak amplitude (got ${maxAmp.toFixed(3)})`);

console.log("\n========================================");
console.log(`Strobe Tuner Verification: ${passed} passed, ${failed} failed.`);

if (failed > 0) {
    process.exit(1);
}
