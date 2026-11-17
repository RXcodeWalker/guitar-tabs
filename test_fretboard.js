/**
 * Automated Verification Test Suite for FretDSP Fretboard Visualizer
 * Validates:
 * 1. Module exports & headless instantiation
 * 2. Musical interval calculation & color mapping logic
 * 3. CAGED system box fret boundary calculations across frets 0-22
 * 4. Left-handed (isLefty) coordinate transforms & string inversion hit-testing
 * 5. Dynamic string bend & vibrato physics animation formulas
 */

const FretboardVisualizer = require('./js/fretboard.js');

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

console.log("================================================================================");
console.log("TEST SUITE: FRETBOARD VISUALIZER PEDAGOGICAL & PHYSICS ENGINE");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// SECTION 1: Export Clean Functions & Interfaces
// -----------------------------------------------------------------------------
console.log("--- Section 1: Exported Clean Interfaces & Headless Instantiation ---");

assert(typeof FretboardVisualizer === 'function', "FretboardVisualizer class is exported");
assert(Array.isArray(FretboardVisualizer.NOTE_NAMES), "NOTE_NAMES is exported as array");
assert(FretboardVisualizer.NOTE_NAMES.length === 12, "NOTE_NAMES contains 12 chromatic pitch classes");
assert(typeof FretboardVisualizer.calculateInterval === 'function', "calculateInterval static method is exported");
assert(typeof FretboardVisualizer.getInterval === 'function', "getInterval static method is exported");
assert(typeof FretboardVisualizer.getIntervalColor === 'function', "getIntervalColor static method is exported");
assert(typeof FretboardVisualizer.calculateCagedBoxes === 'function', "calculateCagedBoxes static method is exported");

// Instantiate in headless mode
const fretboard = new FretboardVisualizer('testCanvas', { headless: true, numFrets: 22 });
assert(fretboard !== null, "FretboardVisualizer instantiates cleanly in headless environment");
assert(fretboard.numFrets === 22, "Default numFrets is 22");
assert(fretboard.numStrings === 6, "Default numStrings is 6");
assert(fretboard.isLefty === false, "Default orientation is Right-Handed (isLefty = false)");
assert(fretboard.flipStrings === false, "Default string ordering is standard (flipStrings = false)");

// -----------------------------------------------------------------------------
// SECTION 2: Musical Interval Color & Label System (Spec 1)
// -----------------------------------------------------------------------------
console.log("\n--- Section 2: Musical Interval Calculation & Pedagogical Color System ---");

// Interval calculation relative to C
assert(FretboardVisualizer.getInterval('C', 'C') === 'R', "C relative to key C is Root ('R')");
assert(FretboardVisualizer.getInterval('C#', 'C') === 'b2', "C# relative to key C is Minor 2nd ('b2')");
assert(FretboardVisualizer.getInterval('Db', 'C') === 'b2', "Db (enharmonic) relative to key C is Minor 2nd ('b2')");
assert(FretboardVisualizer.getInterval('D', 'C') === '2', "D relative to key C is Major 2nd ('2')");
assert(FretboardVisualizer.getInterval('D#', 'C') === 'b3', "D# relative to key C is Minor 3rd ('b3')");
assert(FretboardVisualizer.getInterval('Eb', 'C') === 'b3', "Eb (enharmonic) relative to key C is Minor 3rd ('b3')");
assert(FretboardVisualizer.getInterval('E', 'C') === '3', "E relative to key C is Major 3rd ('3')");
assert(FretboardVisualizer.getInterval('F', 'C') === '4', "F relative to key C is Perfect 4th ('4')");
assert(FretboardVisualizer.getInterval('F#', 'C') === 'b5', "F# relative to key C is Diminished 5th ('b5')");
assert(FretboardVisualizer.getInterval('Gb', 'C') === 'b5', "Gb (enharmonic) relative to key C is Diminished 5th ('b5')");
assert(FretboardVisualizer.getInterval('G', 'C') === '5', "G relative to key C is Perfect 5th ('5')");
assert(FretboardVisualizer.getInterval('G#', 'C') === 'b6', "G# relative to key C is Minor 6th ('b6')");
assert(FretboardVisualizer.getInterval('Ab', 'C') === 'b6', "Ab (enharmonic) relative to key C is Minor 6th ('b6')");
assert(FretboardVisualizer.getInterval('A', 'C') === '6', "A relative to key C is Major 6th ('6')");
assert(FretboardVisualizer.getInterval('A#', 'C') === 'b7', "A# relative to key C is Minor 7th ('b7')");
assert(FretboardVisualizer.getInterval('Bb', 'C') === 'b7', "Bb (enharmonic) relative to key C is Minor 7th ('b7')");
assert(FretboardVisualizer.getInterval('B', 'C') === '7', "B relative to key C is Major 7th ('7')");

// Interval calculation relative to Key A
assert(FretboardVisualizer.getInterval('A', 'A') === 'R', "A relative to key A is Root ('R')");
assert(FretboardVisualizer.getInterval('C', 'A') === 'b3', "C relative to key A is Minor 3rd ('b3')");
assert(FretboardVisualizer.getInterval('C#', 'A') === '3', "C# relative to key A is Major 3rd ('3')");
assert(FretboardVisualizer.getInterval('E', 'A') === '5', "E relative to key A is Perfect 5th ('5')");
assert(FretboardVisualizer.getInterval('G', 'A') === 'b7', "G relative to key A is Minor 7th ('b7')");
assert(FretboardVisualizer.getInterval('G#', 'A') === '7', "G# relative to key A is Major 7th ('7')");

// Pedagogical Interval Color Palette Verification
// Prompt: (e.g., Root = Amber/Gold, 3rd = Forest Green, 5th = Steel Blue, 7th = Violet)
const rootInfo = FretboardVisualizer.getIntervalInfo('R');
assert(rootInfo.color === '#f59e0b', `Root interval is Amber/Gold (${rootInfo.color})`);
assert(rootInfo.isChordTone === true, "Root is marked as primary chord tone");

const maj3Info = FretboardVisualizer.getIntervalInfo('3');
assert(maj3Info.color === '#22c55e', `Major 3rd interval is Forest Green/Emerald (${maj3Info.color})`);
assert(maj3Info.isChordTone === true, "Major 3rd is marked as chord tone");

const min3Info = FretboardVisualizer.getIntervalInfo('b3');
assert(min3Info.color === '#10b981', `Minor 3rd interval is Forest Green/Mint (${min3Info.color})`);
assert(min3Info.isChordTone === true, "Minor 3rd is marked as chord tone");

const fifthInfo = FretboardVisualizer.getIntervalInfo('5');
assert(fifthInfo.color === '#3b82f6', `5th interval is Steel Blue (${fifthInfo.color})`);
assert(fifthInfo.isChordTone === true, "5th is marked as chord tone");

const min7Info = FretboardVisualizer.getIntervalInfo('b7');
assert(min7Info.color === '#8b5cf6', `Minor 7th interval is Violet (${min7Info.color})`);
assert(min7Info.isChordTone === true, "Minor 7th is marked as chord tone");

const maj7Info = FretboardVisualizer.getIntervalInfo('7');
assert(maj7Info.color === '#a855f7', `Major 7th interval is Violet (${maj7Info.color})`);
assert(maj7Info.isChordTone === true, "Major 7th is marked as chord tone");

// Display Mode Toggle
fretboard.setDisplayMode('interval');
assert(fretboard.getDisplayMode() === 'interval', "Display mode successfully toggled to 'interval'");
assert(fretboard.scaleOverlayMode === 'interval', "scaleOverlayMode property reflects 'interval' display mode");

fretboard.setDisplayMode('noteName');
assert(fretboard.getDisplayMode() === 'noteName', "Display mode successfully toggled to 'noteName'");
assert(fretboard.scaleOverlayMode === 'noteName', "scaleOverlayMode property reflects 'noteName' display mode");

// -----------------------------------------------------------------------------
// SECTION 3: CAGED System Form Overlays (Spec 2)
// -----------------------------------------------------------------------------
console.log("\n--- Section 3: CAGED System Box Fret Boundary Calculations ---");

// Calculate CAGED boxes for Root C across 22 frets
const cBoxes = FretboardVisualizer.calculateCagedBoxes('C', 22);
assert(Array.isArray(cBoxes), "calculateCagedBoxes returns an array");
assert(cBoxes.length >= 5, `Calculated ${cBoxes.length} CAGED boxes for Root C across frets 0-22`);

// Verify all 5 CAGED shapes are represented
const shapesPresent = new Set(cBoxes.map(b => b.shape));
assert(shapesPresent.has('C'), "C Form is present in CAGED boxes");
assert(shapesPresent.has('A'), "A Form is present in CAGED boxes");
assert(shapesPresent.has('G'), "G Form is present in CAGED boxes");
assert(shapesPresent.has('E'), "E Form is present in CAGED boxes");
assert(shapesPresent.has('D'), "D Form is present in CAGED boxes");

// Verify canonical fret positions for Root C
// Position 1: C Form starts at fret 0 (span 0-3)
const cForm0 = cBoxes.find(b => b.shape === 'C' && b.startFret === 0);
assert(cForm0 && cForm0.startFret === 0 && cForm0.endFret === 3, `Root C: C Form spans frets 0-3 (got ${cForm0 ? cForm0.startFret + '-' + cForm0.endFret : 'none'})`);

// Position 2: A Form spans frets 2-5
const aForm0 = cBoxes.find(b => b.shape === 'A' && b.startFret === 2);
assert(aForm0 && aForm0.startFret === 2 && aForm0.endFret === 5, `Root C: A Form spans frets 2-5 (got ${aForm0 ? aForm0.startFret + '-' + aForm0.endFret : 'none'})`);

// Position 3: G Form spans frets 5-8
const gForm0 = cBoxes.find(b => b.shape === 'G' && b.startFret === 5);
assert(gForm0 && gForm0.startFret === 5 && gForm0.endFret === 8, `Root C: G Form spans frets 5-8 (got ${gForm0 ? gForm0.startFret + '-' + gForm0.endFret : 'none'})`);

// Position 4: E Form spans frets 7-10
const eForm0 = cBoxes.find(b => b.shape === 'E' && b.startFret === 7);
assert(eForm0 && eForm0.startFret === 7 && eForm0.endFret === 10, `Root C: E Form spans frets 7-10 (got ${eForm0 ? eForm0.startFret + '-' + eForm0.endFret : 'none'})`);

// Position 5: D Form spans frets 10-13
const dForm0 = cBoxes.find(b => b.shape === 'D' && b.startFret === 10);
assert(dForm0 && dForm0.startFret === 10 && dForm0.endFret === 13, `Root C: D Form spans frets 10-13 (got ${dForm0 ? dForm0.startFret + '-' + dForm0.endFret : 'none'})`);

// Octave recurrence: C Form at frets 12-15
const cForm1 = cBoxes.find(b => b.shape === 'C' && b.startFret === 12);
assert(cForm1 && cForm1.startFret === 12 && cForm1.endFret === 15, `Root C: Octave C Form spans frets 12-15 (got ${cForm1 ? cForm1.startFret + '-' + cForm1.endFret : 'none'})`);

// Bounds checking: every box must strictly obey 0 <= startFret <= endFret <= 22
let allWithinBounds = true;
for (const box of cBoxes) {
    if (box.startFret < 0 || box.endFret > 22 || box.startFret > box.endFret) {
        allWithinBounds = false;
    }
}
assert(allWithinBounds, "All CAGED boxes strictly bounded within [0, 22] frets");

// Calculate CAGED boxes for Root A
const aBoxes = FretboardVisualizer.calculateCagedBoxes('A', 22);
// For A: open A shape is at fret 0 (0 to 2)
const aOpenForm = aBoxes.find(b => b.shape === 'A' && b.startFret === 0);
assert(aOpenForm && aOpenForm.startFret === 0 && aOpenForm.endFret <= 3, `Root A: Open A Form is positioned at nut frets 0-2 (got ${aOpenForm ? aOpenForm.startFret + '-' + aOpenForm.endFret : 'none'})`);

// Shape filtering
const onlyEBoxes = FretboardVisualizer.calculateCagedBoxes('C', 22, 'E');
assert(onlyEBoxes.length > 0 && onlyEBoxes.every(b => b.shape === 'E'), `Shape filter 'E' returns only E Form boxes (${onlyEBoxes.length} boxes)`);

// Visualizer instance CAGED controls
fretboard.setCagedRoot('G');
fretboard.setCagedOverlayVisible(true);
assert(fretboard.isCagedOverlayVisible() === true, "setCagedOverlayVisible(true) activates overlay");
assert(fretboard.getCagedRoot() === 'G', "getCagedRoot() returns 'G'");
const gBoxesInstance = fretboard.getCagedBoxes();
assert(gBoxesInstance.length > 0, `Instance cached ${gBoxesInstance.length} CAGED boxes for Root G`);

// -----------------------------------------------------------------------------
// SECTION 4: Left-Handed Guitarist Mode (isLefty) (Spec 3)
// -----------------------------------------------------------------------------
console.log("\n--- Section 4: Left-Handed Mode (isLefty) & Inverted Coordinates ---");

// Right-Handed orientation checks (nut on left)
fretboard.setLefty(false, false);
const rightyNutX = fretboard.getFretX(0);
const rightyFret1X = fretboard.getFretX(1);
const rightyFret22X = fretboard.getFretX(22);

assert(rightyNutX === fretboard.neckMarginLeft, `Righty: Nut is positioned at left margin (${rightyNutX}px)`);
assert(rightyFret1X > rightyNutX, `Righty: Fret 1 (${rightyFret1X.toFixed(1)}px) is to the right of Nut (${rightyNutX}px)`);
assert(rightyFret22X > rightyFret1X, `Righty: Fret 22 (${rightyFret22X.toFixed(1)}px) is at the far right of the neck`);

// Open string badge is left of the nut in right-handed mode
const rightyOpenCenter = fretboard.getFretCenter(0);
assert(rightyOpenCenter < rightyNutX, `Righty: Open string badge center (${rightyOpenCenter.toFixed(1)}px) is to the left of the nut`);

// Switch to Left-Handed orientation (nut on right)
fretboard.setLefty(true, false);
const leftyNutX = fretboard.getFretX(0);
const leftyFret1X = fretboard.getFretX(1);
const leftyFret22X = fretboard.getFretX(22);

assert(leftyNutX === fretboard.neckMarginLeft + fretboard.neckWidth, `Lefty: Nut is horizontally flipped to the right edge (${leftyNutX}px)`);
assert(leftyFret1X < leftyNutX, `Lefty: Fret 1 (${leftyFret1X.toFixed(1)}px) is to the left of Nut (${leftyNutX}px)`);
assert(leftyFret22X < leftyFret1X, `Lefty: Fret 22 (${leftyFret22X.toFixed(1)}px) is at the far left edge (${fretboard.neckMarginLeft}px)`);

// Open string badge is right of the nut in left-handed mode
const leftyOpenCenter = fretboard.getFretCenter(0);
assert(leftyOpenCenter > leftyNutX, `Lefty: Open string badge center (${leftyOpenCenter.toFixed(1)}px) is to the right of the nut`);

// Fret widths must be geometrically invariant between righty and lefty
let widthsMatch = true;
for (let f = 1; f <= 22; f++) {
    fretboard.setLefty(false);
    const rw = fretboard.getFretWidth(f);
    fretboard.setLefty(true);
    const lw = fretboard.getFretWidth(f);
    if (Math.abs(rw - lw) > 0.001) {
        widthsMatch = false;
        break;
    }
}
assert(widthsMatch, "Physical fret widths are identical in both Right-Handed and Left-Handed modes");

// Hit Testing (getFretAtCoordinates) in Right-Handed mode
fretboard.setLefty(false);
const rightyHitNut = fretboard.getFretAtCoordinates(fretboard.getFretX(0) - 10, fretboard.getStringY(0));
assert(rightyHitNut && rightyHitNut.fret === 0, `Righty: Click to left of nut correctly maps to open string fret 0 (got fret ${rightyHitNut ? rightyHitNut.fret : 'null'})`);

const rightyFret1Mid = (fretboard.getFretX(0) + fretboard.getFretX(1)) / 2;
const rightyHitFret1 = fretboard.getFretAtCoordinates(rightyFret1Mid, fretboard.getStringY(0));
assert(rightyHitFret1 && rightyHitFret1.fret === 1, `Righty: Click between nut and fret 1 wire maps to fret 1 (got fret ${rightyHitFret1 ? rightyHitFret1.fret : 'null'})`);

// Hit Testing in Left-Handed mode
fretboard.setLefty(true);
const leftyHitNut = fretboard.getFretAtCoordinates(fretboard.getFretX(0) + 10, fretboard.getStringY(0));
assert(leftyHitNut && leftyHitNut.fret === 0, `Lefty: Click to right of nut correctly maps to open string fret 0 (got fret ${leftyHitNut ? leftyHitNut.fret : 'null'})`);

const leftyFret1Mid = (fretboard.getFretX(0) + fretboard.getFretX(1)) / 2;
const leftyHitFret1 = fretboard.getFretAtCoordinates(leftyFret1Mid, fretboard.getStringY(0));
assert(leftyHitFret1 && leftyHitFret1.fret === 1, `Lefty: Click between nut and fret 1 wire maps to fret 1 (got fret ${leftyHitFret1 ? leftyHitFret1.fret : 'null'})`);

// Vertical String Inversion (flipStrings)
fretboard.setLefty(false, false);
const normalStr1Y = fretboard.getStringY(0); // string 1 (high e)
const normalStr6Y = fretboard.getStringY(5); // string 6 (low E)
assert(normalStr1Y < normalStr6Y, `Normal ordering: String 1 (${normalStr1Y}px) is above String 6 (${normalStr6Y}px)`);

fretboard.setLefty(false, true); // flipStrings = true
const flippedStr1Y = fretboard.getStringY(0);
const flippedStr6Y = fretboard.getStringY(5);
assert(flippedStr1Y > flippedStr6Y, `Flipped ordering: String 1 (${flippedStr1Y}px) is below String 6 (${flippedStr6Y}px)`);
assert(flippedStr1Y === normalStr6Y && flippedStr6Y === normalStr1Y, "Flipped strings exactly invert vertical positions");

// -----------------------------------------------------------------------------
// SECTION 5: Dynamic String Bend & Vibrato Physics (Spec 4)
// -----------------------------------------------------------------------------
console.log("\n--- Section 5: Real-Time String Bend & Vibrato Physics Animation ---");

// Reset to standard orientation
fretboard.setLefty(false, false);

// Fret deflection scaling: half-step (100 cents) = 1 fret deflection, full step (200 cents) = 2 fret deflection
const fret12Width = fretboard.getFretWidth(12);
assert(fret12Width > 15, `Fret 12 physical width is ${fret12Width.toFixed(2)}px`);

// Apply half-step bend (100 cents) to String 1 at Fret 12
fretboard.setPitchBend(1, 100, 12);
const bendState = fretboard.getPitchBend(1);
assert(bendState !== null, "getPitchBend(1) returns bend state object");
assert(bendState.targetCents === 100, `String 1 target cents set to 100 (got ${bendState.targetCents})`);
assert(bendState.fret === 12, `String 1 bend anchor set to fret 12`);

// Run physics step to animate spring deflection
fretboard.updatePhysics();
assert(bendState.cents > 0, `Physics step animated cents toward target (cents: ${bendState.cents.toFixed(2)})`);

// Converge physics to target to test full deflection
for (let i = 0; i < 60; i++) {
    fretboard.updatePhysics();
}
assert(Math.abs(bendState.cents - 100) < 0.1, `String 1 cents stabilized at 100 cents (got ${bendState.cents.toFixed(2)})`);

// Verify exact deflection formula: half-step (100 cents) = 1 fret width deflection
const expectedHalfStepDeflection = -1.0 * fret12Width; // negative Y for upward deflection on string 1
assert(Math.abs(bendState.deflectionPixels - expectedHalfStepDeflection) < 0.5, 
    `100 cents (half-step) produces exactly 1 fret deflection (${bendState.deflectionPixels.toFixed(2)}px vs expected ${expectedHalfStepDeflection.toFixed(2)}px)`);

// Apply full step bend (200 cents)
fretboard.setPitchBend(1, 200, 12);
for (let i = 0; i < 60; i++) {
    fretboard.updatePhysics();
}
const expectedFullStepDeflection = -2.0 * fret12Width;
assert(Math.abs(bendState.deflectionPixels - expectedFullStepDeflection) < 0.5, 
    `200 cents (full step) produces exactly 2 fret deflection (${bendState.deflectionPixels.toFixed(2)}px vs expected ${expectedFullStepDeflection.toFixed(2)}px)`);

// Apply quarter tone bend (50 cents)
fretboard.setPitchBend(1, 50, 12);
for (let i = 0; i < 60; i++) {
    fretboard.updatePhysics();
}
const expectedQuarterToneDeflection = -0.5 * fret12Width;
assert(Math.abs(bendState.deflectionPixels - expectedQuarterToneDeflection) < 0.5, 
    `50 cents (quarter tone) produces exactly 0.5 fret deflection (${bendState.deflectionPixels.toFixed(2)}px vs expected ${expectedQuarterToneDeflection.toFixed(2)}px)`);

// Clear pitch bend
fretboard.clearPitchBend(1);
assert(bendState.targetCents === 0, "clearPitchBend resets target cents to 0");
for (let i = 0; i < 60; i++) {
    fretboard.updatePhysics();
}
assert(Math.abs(bendState.cents) < 0.1 && Math.abs(bendState.deflectionPixels) < 0.1, 
    `String released: deflection returned smoothly to resting position (cents: ${bendState.cents.toFixed(2)}, px: ${bendState.deflectionPixels.toFixed(2)})`);

// Vibrato oscillation physics test
fretboard.stringVibrations[0].amplitude = 4.0;
const initialPhase = fretboard.stringVibrations[0].phase;
fretboard.updatePhysics();
assert(fretboard.stringVibrations[0].phase > initialPhase, "Vibrato phase advances continuously");
assert(fretboard.stringVibrations[0].amplitude < 4.0, "Vibrato amplitude decays exponentially");

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log("\n================================================================================");
console.log(`TOTAL TEST RESULTS: ${passed} passed, ${failed} failed.`);
console.log("================================================================================");

if (failed > 0) {
    process.exit(1);
}
