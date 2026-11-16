/**
 * Comprehensive Verification Test Suite: GuitarOptimizer V2
 *
 * Verifies:
 * 1. Physical Hand Cost Matrix:
 *    - Span Penalty (quadratic growth, neck spacing scaling, 4-fret span zero cost)
 *    - Hand Position Shift Penalty (proportional distance, time/speed scaling)
 *    - String Crossing Penalty (adjacent string preference vs multi-string skip)
 *    - Inversion & Backward Finger Crossing Penalty (anatomical ordering, same-finger hop)
 *    - Open String Bonus (acoustic open string preference, pivot shift)
 * 2. Scale Box Constraints:
 *    - CAGED box shapes (C, A, G, E, D forms)
 *    - 3-Notes-Per-String (3NPS) modal shapes (Patterns 1-7)
 * 3. Viterbi Trellis Optimization Solver:
 *    - Monophonic passage optimization & output schema
 *    - Major scale run assigned to a single ergonomic hand position (hand shift <= 1)
 *    - Wide interval leaps choose adjacent strings rather than extreme 10-fret single-string jumps
 *    - Polymorphic input handling (pitch, midi, note names, single notes)
 * 4. Backward Compatibility with FretDSP Phase 2
 */

const GuitarOptimizer = require('./js/optimizer.js');

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✓ ${message}`);
        passedCount++;
    } else {
        console.error(`  ✗ FAIL: ${message}`);
        failedCount++;
    }
}

console.log("=================================================================");
console.log(" FretDSP Biomechanical Optimizer V2 Verification Test Suite");
console.log("=================================================================\n");

const opt = new GuitarOptimizer();

// =============================================================================
// 1. PHYSICAL HAND COST MATRIX
// =============================================================================
console.log("=== 1. Physical Hand Cost Matrix ===");

// 1.1 Span Penalty
console.log("--- 1.1 Span Penalty ---");
const zeroSpan1 = opt.calculateSpanPenalty(5, 5); // Fret 5 with anchor 5 (reach = 1)
const zeroSpan4 = opt.calculateSpanPenalty(8, 5); // Fret 8 with anchor 5 (reach = 4)
assert(zeroSpan1 === 0, "Span penalty within anchor (reach 1) is strictly 0");
assert(zeroSpan4 === 0, "Span penalty for 4-fret reach [anchor, anchor+3] is strictly 0");

const spanExcess1 = opt.calculateSpanPenalty(9, 5);  // Reach 5, excess = 1 at anchor 5
const spanExcess2 = opt.calculateSpanPenalty(10, 5); // Reach 6, excess = 2 at anchor 5
assert(spanExcess1 > 0, `Span penalty for 5 frets (excess 1) is positive (${spanExcess1.toFixed(2)})`);
assert(spanExcess2 > spanExcess1, `Span penalty grows with excess span (${spanExcess2.toFixed(2)} > ${spanExcess1.toFixed(2)})`);

// Verify quadratic relationship: (2^2) / (1^2) = 4.0
const ratio = spanExcess2 / spanExcess1;
assert(Math.abs(ratio - 4.0) < 0.001, `Span penalty grows quadratically with excess reach (ratio: ${ratio.toFixed(2)} == 4.0)`);

// Verify neck fret spacing factor: at fret 13 (fret spacing is 2^(-12/12) = 0.5 of fret 1)
const spanNut = opt.calculateSpanPenalty(5, 1);   // Reach 5 at nut (anchor 1), spacing factor = 1.0
const spanHigh = opt.calculateSpanPenalty(17, 13); // Reach 5 at fret 13, spacing factor = 0.5
assert(spanHigh < spanNut, `Stretch at 13th fret is physically less taxing than at 1st fret (${spanHigh.toFixed(2)} < ${spanNut.toFixed(2)})`);
assert(Math.abs(spanHigh / spanNut - 0.5) < 0.01, `Physical spacing factor halves stretch cost at 13th fret (ratio: ${(spanHigh/spanNut).toFixed(2)})`);

// Open string span penalty
assert(opt.calculateSpanPenalty(0, 5) === 0, "Open string (fret 0) has 0 span penalty");

// 1.2 Hand Position Shift Penalty
console.log("\n--- 1.2 Hand Position Shift Penalty ---");
assert(opt.calculateShiftPenalty(5, 5) === 0, "Zero shift penalty when hand anchor does not move (ΔA = 0)");
const shift1 = opt.calculateShiftPenalty(5, 6);   // 1 fret shift
const shift5 = opt.calculateShiftPenalty(5, 10);  // 5 fret shift
const shift10 = opt.calculateShiftPenalty(5, 15); // 10 fret shift
assert(shift1 > 0, `1-fret shift incurs cost (${shift1})`);
assert(shift5 > shift1, `5-fret shift costs more than 1-fret shift (${shift5} > ${shift1})`);
assert(shift10 > shift5, `10-fret shift costs more than 5-fret shift (${shift10} > ${shift5})`);

// Proportionality check: (shift10 - base) should equal 2 * (shift5 - base)
const baseCost = opt.weights.shiftBase;
const linearSlope5 = (shift5 - baseCost) / 5;
const linearSlope10 = (shift10 - baseCost) / 10;
assert(Math.abs(linearSlope5 - linearSlope10) < 0.001, `Hand shift cost is strictly proportional to distance shifted (slope: ${linearSlope5})`);

// Speed / tempo scaling for rapid shifts
const slowShift = opt.calculateShiftPenalty(5, 10, 0.5); // 500ms
const fastShift = opt.calculateShiftPenalty(5, 10, 0.05); // 50ms rapid jump
assert(fastShift > slowShift, `Rapid shift under time pressure incurs higher biomechanical cost (${fastShift.toFixed(1)} > ${slowShift.toFixed(1)})`);

// 1.3 String Crossing Penalty
console.log("\n--- 1.3 String Crossing Penalty ---");
assert(opt.calculateStringCrossingPenalty(3, 3) === 0, "Same string consecutive notes incur 0 crossing penalty");
const adjString = opt.calculateStringCrossingPenalty(3, 2);
const skip1String = opt.calculateStringCrossingPenalty(3, 1);
const skip4Strings = opt.calculateStringCrossingPenalty(6, 1);
assert(adjString > 0 && adjString < 3.0, `Adjacent string crossing is very low cost (${adjString})`);
assert(skip1String > adjString, `Skipping 1 string is penalized higher than adjacent string (${skip1String.toFixed(1)} > ${adjString})`);
assert(skip4Strings > skip1String * 3, `Skipping 4 strings (e.g. low E to high e) incurs heavy penalty (${skip4Strings.toFixed(1)})`);

// 1.4 Inversion & Backward Finger Crossing Penalty
console.log("\n--- 1.4 Inversion & Backward Finger Crossing Penalty ---");
// Natural order: Finger 1 on fret 5 -> Finger 3 on fret 7 (ascending frets with ascending fingers)
const naturalCrossing = opt.calculateInversionPenalty(
    { string: 3, fret: 5, finger: 1, anchor: 5 },
    { string: 2, fret: 7, finger: 3, anchor: 5 }
);
assert(naturalCrossing === 0, "Natural finger progression (fret 5 finger 1 -> fret 7 finger 3) has 0 inversion penalty");

// Inverted ascending: Finger 3 on fret 5 -> Finger 1 on fret 7 (backward reach!)
const invertedAscending = opt.calculateInversionPenalty(
    { string: 3, fret: 5, finger: 3, anchor: 5 },
    { string: 2, fret: 7, finger: 1, anchor: 5 }
);
assert(invertedAscending >= 40.0, `Inverted ascending finger crossing incurs heavy penalty (${invertedAscending})`);

// Inverted descending: Finger 1 on fret 7 -> Finger 4 on fret 5 (pinky reaching behind index!)
const invertedDescending = opt.calculateInversionPenalty(
    { string: 2, fret: 7, finger: 1, anchor: 5 },
    { string: 3, fret: 5, finger: 4, anchor: 5 }
);
assert(invertedDescending >= 40.0, `Inverted descending finger crossing incurs heavy penalty (${invertedDescending})`);

// Same finger hop across strings to different frets
const sameFingerHop = opt.calculateInversionPenalty(
    { string: 3, fret: 5, finger: 1, anchor: 5 },
    { string: 2, fret: 7, finger: 1, anchor: 5 }
);
assert(sameFingerHop >= 20.0, `Same-finger jump to different fret across strings is penalized (${sameFingerHop})`);

// Same finger barre across strings at identical fret
const sameFingerBarre = opt.calculateInversionPenalty(
    { string: 3, fret: 5, finger: 1, anchor: 5 },
    { string: 2, fret: 5, finger: 1, anchor: 5 }
);
assert(sameFingerBarre <= 2.0, `Same-finger barre at same fret is effortless and comfortable (${sameFingerBarre})`);

// 1.5 Open String Bonus
console.log("\n--- 1.5 Open String Bonus ---");
const normalOpenBonus = opt.calculateOpenStringBonus(true, {});
const acousticOpenBonus = opt.calculateOpenStringBonus(true, { preferOpenStrings: true });
assert(normalOpenBonus < 0, `Open string returns negative cost (bonus) (${normalOpenBonus})`);
assert(acousticOpenBonus < normalOpenBonus, `preferOpenStrings boosts open string bonus (${acousticOpenBonus} < ${normalOpenBonus})`);
assert(opt.calculateOpenStringBonus(false, { preferOpenStrings: true }) === 0, "Fretted note receives no open string bonus");


// =============================================================================
// 2. SCALE BOX CONSTRAINTS (CAGED & 3NPS)
// =============================================================================
console.log("\n=== 2. Scale Box Constraints ===");

// 2.1 CAGED Boxes
console.log("--- 2.1 CAGED Box Shapes ---");
const cagedE_G = GuitarOptimizer.getCAGEDBox('E', 'G');
assert(cagedE_G.form === 'E', "Form is E");
assert(cagedE_G.minFret === 2 && cagedE_G.maxFret === 6, `CAGED E-form for G covers frets 2-6 (got ${cagedE_G.minFret}-${cagedE_G.maxFret})`);

const cagedE_C = GuitarOptimizer.getCAGEDBox('E', 'C');
assert(cagedE_C.minFret === 7 && cagedE_C.maxFret === 11, `CAGED E-form for C covers frets 7-11 (got ${cagedE_C.minFret}-${cagedE_C.maxFret})`);

const cagedC_C = GuitarOptimizer.getCAGEDBox('C', 'C');
assert(cagedC_C.minFret === 0 && cagedC_C.maxFret === 4, `CAGED C-form for C covers frets 0-4 (got ${cagedC_C.minFret}-${cagedC_C.maxFret})`);

const cagedA_C = GuitarOptimizer.getCAGEDBox('A', 'C');
assert(cagedA_C.minFret === 2 && cagedA_C.maxFret === 6, `CAGED A-form for C covers frets 2-6 (got ${cagedA_C.minFret}-${cagedA_C.maxFret})`);

const cagedD_C = GuitarOptimizer.getCAGEDBox('D', 'C');
assert(cagedD_C.minFret === 9 && cagedD_C.maxFret === 13, `CAGED D-form for C covers frets 9-13 (got ${cagedD_C.minFret}-${cagedD_C.maxFret})`);

// Constraint enforcement: test note locking in CAGED E-form for C Major
const cMajorMelody = [
    { pitch: 60, time: 0.0, duration: 0.25 }, // C4
    { pitch: 62, time: 0.25, duration: 0.25 }, // D4
    { pitch: 64, time: 0.50, duration: 0.25 }, // E4
    { pitch: 65, time: 0.75, duration: 0.25 }, // F4
    { pitch: 67, time: 1.00, duration: 0.25 }, // G4
    { pitch: 69, time: 1.25, duration: 0.25 }, // A4
    { pitch: 71, time: 1.50, duration: 0.25 }, // B4
    { pitch: 72, time: 1.75, duration: 0.25 }  // C5
];

const lockedCAGED = opt.optimizePassage(cMajorMelody, { caged: 'E', root: 'C' });
const fretsCAGED = lockedCAGED.map(n => n.fret);
const minCAGED = Math.min(...fretsCAGED);
const maxCAGED = Math.max(...fretsCAGED);
assert(minCAGED >= cagedE_C.minFret && maxCAGED <= cagedE_C.maxFret, `All notes locked within CAGED E box frets 7-11 (actual frets: ${minCAGED}-${maxCAGED})`);

// 2.2 3-Notes-Per-String (3NPS) Modal Shapes
console.log("\n--- 2.2 3-Notes-Per-String (3NPS) Shapes ---");
const p1_G = GuitarOptimizer.get3NPSPattern(1, 'G');
assert(p1_G.system === '3NPS', "3NPS pattern recognized");
assert(p1_G.pattern === 1, "Pattern 1");
assert(JSON.stringify(p1_G.strings[6]) === JSON.stringify([3, 5, 7]), `String 6 has frets [3, 5, 7] (got ${JSON.stringify(p1_G.strings[6])})`);
assert(JSON.stringify(p1_G.strings[5]) === JSON.stringify([3, 5, 7]), `String 5 has frets [3, 5, 7] (got ${JSON.stringify(p1_G.strings[5])})`);
assert(JSON.stringify(p1_G.strings[4]) === JSON.stringify([4, 5, 7]), `String 4 has frets [4, 5, 7] (got ${JSON.stringify(p1_G.strings[4])})`);
assert(JSON.stringify(p1_G.strings[3]) === JSON.stringify([4, 5, 7]), `String 3 has frets [4, 5, 7] (got ${JSON.stringify(p1_G.strings[3])})`);
assert(JSON.stringify(p1_G.strings[2]) === JSON.stringify([5, 7, 8]), `String 2 has frets [5, 7, 8] (got ${JSON.stringify(p1_G.strings[2])})`);
assert(JSON.stringify(p1_G.strings[1]) === JSON.stringify([5, 7, 8]), `String 1 has frets [5, 7, 8] (got ${JSON.stringify(p1_G.strings[1])})`);

// 3NPS 18-note scale run locking across all 6 strings
const gMajor3NpsNotes = [
    { pitch: 43 }, { pitch: 45 }, { pitch: 47 }, // String 6: G2, A2, B2
    { pitch: 48 }, { pitch: 50 }, { pitch: 52 }, // String 5: C3, D3, E3
    { pitch: 54 }, { pitch: 55 }, { pitch: 57 }, // String 4: F#3, G3, A3
    { pitch: 59 }, { pitch: 60 }, { pitch: 62 }, // String 3: B3, C4, D4
    { pitch: 64 }, { pitch: 66 }, { pitch: 67 }, // String 2: E4, F#4, G4
    { pitch: 69 }, { pitch: 71 }, { pitch: 72 }  // String 1: A4, B4, C5
];

const locked3NPS = opt.optimizePassage(gMajor3NpsNotes, { threeNps: 1, root: 'G' });
const assignedStrings = locked3NPS.map(n => n.string);
const expectedStrings = [6,6,6, 5,5,5, 4,4,4, 3,3,3, 2,2,2, 1,1,1];
assert(JSON.stringify(assignedStrings) === JSON.stringify(expectedStrings), "3NPS run strictly assigns exactly 3 notes per string from string 6 to string 1");

const assignedFrets = locked3NPS.map(n => n.fret);
const expectedFrets = [3,5,7, 3,5,7, 4,5,7, 4,5,7, 5,7,8, 5,7,8];
assert(JSON.stringify(assignedFrets) === JSON.stringify(expectedFrets), "3NPS run strictly assigns correct frets [3,5,7, 3,5,7, 4,5,7, 4,5,7, 5,7,8, 5,7,8]");


// =============================================================================
// 3. VITERBI TRELLIS OPTIMIZATION SOLVER
// =============================================================================
console.log("\n=== 3. Viterbi Trellis Optimization Solver ===");

// 3.1 Major Scale Run Ergonomics (Task 4 Core Requirement)
console.log("--- 3.1 Major Scale Run Ergonomic Positioning ---");
// Test C Major Scale Run
const cMajorRun = [
    { pitch: 60, time: 0.0, duration: 0.25 }, // C4
    { pitch: 62, time: 0.25, duration: 0.25 }, // D4
    { pitch: 64, time: 0.50, duration: 0.25 }, // E4
    { pitch: 65, time: 0.75, duration: 0.25 }, // F4
    { pitch: 67, time: 1.00, duration: 0.25 }, // G4
    { pitch: 69, time: 1.25, duration: 0.25 }, // A4
    { pitch: 71, time: 1.50, duration: 0.25 }, // B4
    { pitch: 72, time: 1.75, duration: 0.25 }  // C5
];

// Optimize in 7th position or adaptive
const optMajor = opt.optimizePassage(cMajorRun, { initialPosition: 7 });
let frettedShifts = 0;
for (let i = 1; i < optMajor.length; i++) {
    if (!optMajor[i].isOpen && !optMajor[i-1].isOpen && optMajor[i].handPosition !== optMajor[i-1].handPosition) {
        frettedShifts++;
    }
}
assert(frettedShifts <= 1, `C Major scale run has hand shift <= 1 (actual shifts: ${frettedShifts})`);
assert(optMajor.every(n => n.string >= 1 && n.string <= 6), "All scale notes have valid strings 1-6");
assert(optMajor.every(n => n.fret >= 0 && n.fret <= 22), "All scale notes have valid frets 0-22");
assert(optMajor.every(n => [0, 1, 2, 3, 4, 'T'].includes(n.finger)), "All scale notes have valid fingers (0-4/T)");

// Test G Major Scale Run
const gMajorRun = [
    { pitch: 55, time: 0.0, duration: 0.25 }, // G3
    { pitch: 57, time: 0.25, duration: 0.25 }, // A3
    { pitch: 59, time: 0.50, duration: 0.25 }, // B3
    { pitch: 60, time: 0.75, duration: 0.25 }, // C4
    { pitch: 62, time: 1.00, duration: 0.25 }, // D4
    { pitch: 64, time: 1.25, duration: 0.25 }, // E4
    { pitch: 66, time: 1.50, duration: 0.25 }, // F#4
    { pitch: 67, time: 1.75, duration: 0.25 }  // G4
];

const optGMajor = opt.optimizePassage(gMajorRun);
let gShifts = 0;
for (let i = 1; i < optGMajor.length; i++) {
    if (!optGMajor[i].isOpen && !optGMajor[i-1].isOpen && optGMajor[i].handPosition !== optGMajor[i-1].handPosition) {
        gShifts++;
    }
}
assert(gShifts <= 1, `G Major scale run has hand shift <= 1 (actual shifts: ${gShifts})`);

// 3.2 Wide Interval Leaps (Task 4 Core Requirement)
console.log("\n--- 3.2 Wide Interval Leaps Avoid Single-String Jumps ---");
// Scenario: D4 (MIDI 62, String 3 Fret 7) followed by C5 (MIDI 72)
// On String 3, C5 requires Fret 17 (a 10-fret single-string jump!)
// On String 2, C5 is Fret 13 (adjacent string).
// On String 1, C5 is Fret 8 (nearby string, matching 7th position).
const wideLeapPassage = [
    { pitch: 62, time: 0.0, duration: 0.5 }, // D4
    { pitch: 72, time: 0.5, duration: 0.5 }  // C5 (leap of a minor 7th)
];

const optLeap = opt.optimizePassage(wideLeapPassage, { initialPosition: 7 });
assert(optLeap[0].string === 3 && optLeap[0].fret === 7, `Note 1 is String 3 Fret 7 (got String ${optLeap[0].string} Fret ${optLeap[0].fret})`);
assert(optLeap[1].string !== 3, `Note 2 rejects 10-fret single-string jump on String 3 (assigned to String ${optLeap[1].string} Fret ${optLeap[1].fret})`);
assert(optLeap[1].string === 2 || optLeap[1].string === 1, `Note 2 chooses adjacent/nearby string (String ${optLeap[1].string})`);

// Scenario 2: E3 (MIDI 52, String 5 Fret 7) followed by D4 (MIDI 62)
// On String 5, D4 is Fret 17 (10-fret single-string jump).
// On String 4, D4 is Fret 12 (adjacent string).
// On String 3, D4 is Fret 7 (fret 7, exact same fret!).
const wideLeapPassage2 = [
    { pitch: 52, time: 0.0, duration: 0.5 }, // E3
    { pitch: 62, time: 0.5, duration: 0.5 }  // D4
];
const optLeap2 = opt.optimizePassage(wideLeapPassage2, { initialPosition: 7 });
assert(optLeap2[0].string === 5 && optLeap2[0].fret === 7, `Leap 2 Note 1 is String 5 Fret 7`);
assert(optLeap2[1].string !== 5, `Leap 2 rejects 10-fret single-string jump on String 5 (assigned to String ${optLeap2[1].string} Fret ${optLeap2[1].fret})`);
assert(optLeap2[1].string === 4 || optLeap2[1].string === 3, `Leap 2 chooses adjacent/nearby string (String ${optLeap2[1].string})`);

// 3.3 Open String Pivot Shifts
console.log("\n--- 3.3 Open String Pivot Advantage ---");
// Passage shifting from low position to high position with an open string in between
const pivotPassage = [
    { pitch: 48, time: 0.0, duration: 0.5 }, // C3 (String 5 Fret 3, Pos 3)
    { pitch: 64, time: 0.5, duration: 0.5 }, // E4 (String 1 Fret 0, Open pivot!)
    { pitch: 74, time: 1.0, duration: 0.5 }  // D5 (String 1 Fret 10, Pos 10)
];
const optPivot = opt.optimizePassage(pivotPassage, { preferOpenStrings: true });
assert(optPivot[1].isOpen === true && optPivot[1].fret === 0, "Middle transition note is assigned open string");
assert(optPivot[2].string === 1 && optPivot[2].fret === 10, "Destination high note lands smoothly on String 1 Fret 10");

// 3.4 Polymorphic Input Handling
console.log("\n--- 3.4 Polymorphic Input Formats ---");
// Note names input
const nameNotes = [
    { pitch: "C4", time: 0.0, duration: 0.25 },
    { pitch: "E4", time: 0.25, duration: 0.25 },
    { pitch: "G4", time: 0.50, duration: 0.25 }
];
const resNames = opt.optimize(nameNotes);
assert(Array.isArray(resNames) && resNames.length === 3, "optimize() accepts array of note objects with pitch names ('C4', 'E4', 'G4')");
assert(resNames[0].midi === 60 && resNames[1].midi === 64 && resNames[2].midi === 67, "Parsed MIDI numbers accurately from note name strings");

// Direct pitch numbers
const midiNotes = [
    { midi: 60, time: 0 },
    { midi: 64, time: 1 },
    { midi: 67, time: 2 }
];
const resMidi = opt.optimize(midiNotes);
assert(Array.isArray(resMidi) && resMidi.length === 3, "optimize() accepts notes with midi property");

// Output schema verification
const noteOut = resNames[0];
assert(typeof noteOut.string === 'number', "Output has numeric string property");
assert(typeof noteOut.fret === 'number', "Output has numeric fret property");
assert(noteOut.finger !== undefined, "Output has finger property");
assert(typeof noteOut.cost === 'number', "Output has numeric cost property");
assert(typeof noteOut.cumulativeCost === 'number', "Output has cumulativeCost property");
assert(typeof noteOut.handPosition === 'number', "Output has handPosition property");


// =============================================================================
// 4. BACKWARD COMPATIBILITY VERIFICATION
// =============================================================================
console.log("\n=== 4. Backward Compatibility Verification ===");

// Single-note optimize(midi)
const single69 = opt.optimize(69);
assert(typeof single69 === 'object' && !Array.isArray(single69), "Single note call returns single object, not array");
assert(single69.midi === 69, "Single note MIDI is 69");
assert(single69.noteName === 'A', "Single note name is 'A'");
assert(single69.octave === 4, "Single note octave is 4");
assert(single69.string >= 1 && single69.string <= 6, "Single note has valid string");
assert(single69.fret >= 0 && single69.fret <= 22, "Single note has valid fret");
assert(Array.isArray(single69.allCandidates) && single69.allCandidates.length >= 4, "Single note maintains allCandidates array");

// Open string and tuning checks
assert(opt.openMidi[0] === 64, "High E open string is 64");
assert(opt.openMidi[5] === 40, "Low E open string is 40");

opt.setTuning('dropD');
assert(opt.openMidi[5] === 38, "setTuning('dropD') tunes string 6 down to MIDI 38");
opt.setTuning('standard');

// Finger assignment helper
assert(opt.assignFinger(5, 5) === 1, "assignFinger(5, 5) returns 1 (Index)");
assert(opt.assignFinger(6, 5) === 2, "assignFinger(6, 5) returns 2 (Middle)");
assert(opt.assignFinger(7, 5) === 3, "assignFinger(7, 5) returns 3 (Ring)");
assert(opt.assignFinger(8, 5) === 4, "assignFinger(8, 5) returns 4 (Pinky)");
assert(opt.assignFinger(0, 5) === 0, "assignFinger(0, 5) returns 0 (Open)");

console.log("\n=================================================================");
console.log(` Test Suite Complete: ${passedCount} passed, ${failedCount} failed.`);
console.log("=================================================================");

if (failedCount > 0) {
    process.exit(1);
}
