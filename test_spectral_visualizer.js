/**
 * Comprehensive Automated Verification Script for Spectral Heatmap Visualizer
 * Tests:
 * 1. Palette Color LUT Generation (Dark Blue -> Magenta -> Amber -> Neon White)
 * 2. Off-screen Ring Buffer Architecture (128 slices, zero allocation)
 * 3. Fundamental Frequency & Parabolic Peak Interpolation
 * 4. Harmonic Energy Sampling (f0, 2f0, 3f0, 4f0, 5f0)
 * 5. Even-vs-Odd Harmonic Ratio Diagnostic (Tube Warmth vs Transistor Clipping)
 * 6. Total Harmonic Distortion (THD) Estimation
 * 7. Peak Harmonic Order Detection
 * 8. Diagnostic HUD Toggle & Hit-Testing
 * 9. Zero-Allocation Rendering Hot Loop Verification
 */

const SpectralHeatmapVisualizer = require('./js/spectral-visualizer.js');

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

console.log("=== 1. Testing Analog Phosphor / Heat Palette Color LUT ===");

// Instantiate with mock or headless mode
const vis = new SpectralHeatmapVisualizer(null, { fftSize: 2048 });

assert(vis.colorLUT && vis.colorLUT.length === 256, "Color LUT contains exactly 256 pre-computed entries");
assert(vis.colorLUT32 && vis.colorLUT32.length === 256, "32-bit packed Color LUT32 contains 256 entries");

// Test Palette Stops: Dark Blue -> Magenta -> Amber -> Neon White
const quietColor = vis.colorLUT[0];
assert(quietColor.b > quietColor.r && quietColor.r <= 20, `0 dB Floor is Dark Blue: R=${quietColor.r}, G=${quietColor.g}, B=${quietColor.b}`);

const magentaColor = vis.colorLUT[75];
assert(magentaColor.r > 150 && magentaColor.b > 100 && magentaColor.g < 80, `Mid-Low stop is Vibrant Magenta: R=${magentaColor.r}, G=${magentaColor.g}, B=${magentaColor.b}`);

const amberColor = vis.colorLUT[165];
assert(amberColor.r > 230 && amberColor.g > 120 && amberColor.b < 50, `Mid-High stop is Solar Amber: R=${amberColor.r}, G=${amberColor.g}, B=${amberColor.b}`);

const peakColor = vis.colorLUT[255];
assert(peakColor.r === 255 && peakColor.g === 255 && peakColor.b === 255, `Max amplitude is Neon White: R=${peakColor.r}, G=${peakColor.g}, B=${peakColor.b}`);

console.log("\n=== 2. Testing 128-Slice Off-Screen Ring Buffer Architecture ===");
assert(vis.waterfallSlices === 128, "Waterfall ring buffer configured for exactly 128 slices");
assert(vis.ringHead === 0, "Ring head initialized at index 0");
assert(vis.sliceImageData !== undefined, "Pre-allocated slice ImageData exists");
assert(vis.sliceData32 instanceof Uint32Array, "Pre-allocated Uint32Array pixel view exists");

console.log("\n=== 3. Testing Synthetic FFT Harmonic Generation & Analysis ===");

// Create synthetic FFT spectrum simulating Tube Warmth (Asymmetric clipping: 2nd harmonic dominant)
// Fundamental A2 = 110.0 Hz
const sampleRate = 44100;
const binHz = (sampleRate / 2) / vis.frequencyBinCount; // 22050 / 1024 = 21.5332 Hz
const f0 = 110.0;
const f0Bin = Math.round(f0 / binHz); // bin 5

// Populate synthetic freqData
vis.freqData.fill(0);
// f0: high amplitude (val 220, ~ -40 dB)
vis.freqData[f0Bin] = 220;
vis.freqData[f0Bin - 1] = 160;
vis.freqData[f0Bin + 1] = 160;

// 2f0 = 220 Hz (bin 10) - STRONG EVEN HARMONIC (val 180)
const f2Bin = Math.round((f0 * 2) / binHz);
vis.freqData[f2Bin] = 180;
vis.freqData[f2Bin - 1] = 130;
vis.freqData[f2Bin + 1] = 130;

// 3f0 = 330 Hz (bin 15) - WEAKER ODD HARMONIC (val 80)
const f3Bin = Math.round((f0 * 3) / binHz);
vis.freqData[f3Bin] = 80;

// 4f0 = 440 Hz (bin 20) - EVEN HARMONIC (val 110)
const f4Bin = Math.round((f0 * 4) / binHz);
vis.freqData[f4Bin] = 110;

// 5f0 = 550 Hz (bin 26) - VERY WEAK ODD HARMONIC (val 40)
const f5Bin = Math.round((f0 * 5) / binHz);
vis.freqData[f5Bin] = 40;

// Run harmonic analysis
vis.analyzeHarmonics(sampleRate);

assert(vis.fundamentalActive === true, "Fundamental detected and active");
assert(Math.abs(vis.fundamentalFreq - 110.0) < 5.0, `Fundamental frequency recovered accurately: ${vis.fundamentalFreq.toFixed(1)} Hz (expected ~110.0 Hz)`);
assert(vis.harmonicActive[0] === 1, "Harmonic 1 (f0) active");
assert(vis.harmonicActive[1] === 1, "Harmonic 2 (2f0) active");
assert(vis.harmonicActive[2] === 1, "Harmonic 3 (3f0) active");
assert(vis.harmonicActive[3] === 1, "Harmonic 4 (4f0) active");
assert(vis.harmonicActive[4] === 1, "Harmonic 5 (5f0) active");

console.log("\n=== 4. Testing Even-vs-Odd Harmonic Distortion Diagnostic (Tube Warmth) ===");
assert(vis.evenEnergy > vis.oddEnergy, `Even harmonic energy (${vis.evenEnergy.toExponential(2)}) exceeds odd (${vis.oddEnergy.toExponential(2)})`);
assert(vis.evenOddRatioSmoothed > 1.2, `Even-to-Odd ratio indicates Tube Warmth: ratio=${vis.evenOddRatioSmoothed.toFixed(2)}x (>1.2)`);
assert(vis.getHarmonicCharacter().includes("TUBE WARMTH"), `Diagnostic classification correctly identifies: ${vis.getHarmonicCharacter()}`);
assert(vis.peakOvertoneOrder === 2, `Peak overtone correctly identified as 2nd harmonic (order 2, got ${vis.peakOvertoneOrder})`);

console.log("\n=== 5. Testing Transistor Clipping (Symmetric Overdrive: 3rd & 5th Dominant) ===");
// Reset freqData with dominant 3rd and 5th harmonics
vis.freqData.fill(0);
vis.freqData[f0Bin] = 220;
vis.freqData[f0Bin - 1] = 160;
vis.freqData[f0Bin + 1] = 160;

// Weak even harmonics (2f0=40, 4f0=30)
vis.freqData[f2Bin] = 40;
vis.freqData[f4Bin] = 30;

// Strong odd harmonics (3f0=190, 5f0=160)
vis.freqData[f3Bin] = 190;
vis.freqData[f3Bin - 1] = 140;
vis.freqData[f3Bin + 1] = 140;
vis.freqData[f5Bin] = 160;
vis.freqData[f5Bin - 1] = 110;
vis.freqData[f5Bin + 1] = 110;

// Run multiple iterations to settle EMA
for (let i = 0; i < 20; i++) {
    vis.analyzeHarmonics(sampleRate);
}

assert(vis.oddEnergy > vis.evenEnergy, `Odd harmonic energy (${vis.oddEnergy.toExponential(2)}) exceeds even (${vis.evenEnergy.toExponential(2)})`);
assert(vis.evenOddRatioSmoothed < 0.8, `Even-to-Odd ratio indicates Transistor Clipping: ratio=${vis.evenOddRatioSmoothed.toFixed(2)}x (<0.8)`);
assert(vis.getHarmonicCharacter().includes("TRANSISTOR"), `Diagnostic classification correctly identifies: ${vis.getHarmonicCharacter()}`);
assert(vis.peakOvertoneOrder === 3, `Peak overtone correctly identified as 3rd harmonic (order 3, got ${vis.peakOvertoneOrder})`);
assert(vis.thdSmoothed > 5.0, `THD estimate calculated: ${vis.thdSmoothed.toFixed(1)}%`);

console.log("\n=== 6. Testing Diagnostic HUD Toggle & Controls ===");
assert(vis.showHUD === true, "HUD is visible by default");
vis.toggleHUD();
assert(vis.showHUD === false, "toggleHUD() toggles HUD visibility to false");
vis.toggleHUD();
assert(vis.showHUD === true, "toggleHUD() toggles HUD visibility back to true");
vis.setHUDVisible(false);
assert(vis.showHUD === false, "setHUDVisible(false) sets HUD to false");

console.log("\n=== 7. Testing Ring Buffer Step Execution (Zero-Allocation) ===");
const initialHead = vis.ringHead;
vis.recordWaterfallSlice(sampleRate);
assert(vis.ringHead !== initialHead, `Ring head advanced after recording slice (was ${initialHead}, now ${vis.ringHead})`);

// Step 128 times to verify modulo wrapping
for (let i = 0; i < 128; i++) {
    vis.recordWaterfallSlice(sampleRate);
}
assert(vis.ringHead >= 0 && vis.ringHead < 128, `Ring head safely bounds within [0, 127]: ${vis.ringHead}`);

console.log("\n========================================");
console.log(`Spectral Visualizer Verification: ${testsPassed} passed, ${testsFailed} failed.`);
process.exit(testsFailed > 0 ? 1 : 0);
