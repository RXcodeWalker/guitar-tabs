/**
 * Guitar Fretboard Dynamic Programming Optimizer (Viterbi Algorithm)
 * 
 * Implements optimal fingering path selection for monophonic runs and polyphonic chords
 * on standard-tuned 6-string guitar (E2-A2-D3-G3-B3-E4, 22 frets).
 * 
 * Formulated from the dual perspective of a guitar technician and algorithms researcher.
 * 
 * @module GuitarFretboardOptimizer
 */

// ============================================================================
// 1. GUITAR PHYSICAL SPECIFICATION & FRETBOARD LOOKUP
// ============================================================================

/**
 * Standard tuning open string MIDI pitch numbers:
 * String 1 (High E): E4 (MIDI 64)
 * String 2 (B):      B3 (MIDI 59)
 * String 3 (G):      G3 (MIDI 55)
 * String 4 (D):      D3 (MIDI 50)
 * String 5 (A):      A2 (MIDI 45)
 * String 6 (Low E):  E2 (MIDI 40)
 */
const OPEN_STRINGS = {
  1: 64, // E4
  2: 59, // B3
  3: 55, // G3
  4: 50, // D3
  5: 45, // A2
  6: 40  // E2
};

const NUM_FRETS = 22;
const MIN_MIDI = 40; // E2 (String 6, Fret 0)
const MAX_MIDI = 86; // D6 (String 1, Fret 22: 64 + 22 = 86)

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Converts MIDI pitch to standard note name with octave (e.g., 60 -> "C4", 40 -> "E2").
 * @param {number} midi - MIDI pitch number [40, 86]
 * @returns {string} Note name representation
 */
function midiToNoteName(midi) {
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Requirement 1: Note-to-Fretboard Mapping
 * Returns all valid (string, fret) pairs for any MIDI pitch between 40 (E2) and 86 (D6).
 * 
 * @param {number} midiPitch - MIDI pitch number [40, 86]
 * @returns {Array<{string: number, fret: number, midi: number, note: string}>}
 */
function getFretboardPositions(midiPitch) {
  if (typeof midiPitch !== 'number' || midiPitch < MIN_MIDI || midiPitch > MAX_MIDI) {
    return [];
  }

  const positions = [];
  for (let s = 1; s <= 6; s++) {
    const openPitch = OPEN_STRINGS[s];
    const fret = midiPitch - openPitch;
    if (fret >= 0 && fret <= NUM_FRETS) {
      positions.push({
        string: s,
        fret: fret,
        midi: midiPitch,
        note: midiToNoteName(midiPitch)
      });
    }
  }

  // Return positions ordered by string: lowest string (6) to highest string (1)
  return positions.sort((a, b) => b.string - a.string);
}

// ============================================================================
// 2. BIOMECHANICAL & COST FUNCTION WEIGHTS
// ============================================================================

const DEFAULT_WEIGHTS = {
  // Hand shift weights: moving the entire fretting forearm/hand along the neck
  shiftBase: 3.5,          // Base effort to lift and reposition hand position P
  shiftPerFret: 1.8,       // Penalty per fret of hand shift
  shiftExp: 1.2,           // Non-linear scaling for large leaps

  // Fret movement & within-box finger alternation
  fretDistance: 0.6,       // Cost per fret separation
  sameStringSlide: 2.5,    // Shift/slide penalty when forced outside the 4-fret hand box
  withinBoxFretMove: 0.25, // Effort of alternating fingers on the same string within the box

  // String change weights
  adjacentString: 0.3,     // Effort of crossing to adjacent string (Delta s = 1)
  stringSkipBase: 1.8,     // Penalty per skipped string (Delta s >= 2)

  // Hand box & locality
  localityDrift: 2.0,      // Penalty per fret away from designated target hand box
  stretchPenalty: 2.5,     // Cost of reaching outside [P, P+3] box (P-1 reach or P+4 extension)

  // Open string & ergonomics
  openStringBonus: -1.2,   // Open string finger-relief bonus in open/cowboy positions (P <= 3)
  openStringHighPen: 2.0,  // Penalty per position above fret 3 for open string in closed runs
  highFretPenalty: 0.3,    // Acoustic/reach difficulty for cramped frets > 12

  // Chord weights
  chordSpanLimit: 4,       // Max physical fretting span between non-open fingers
  chordBarreEffort: 1.2,   // Grip strength cost for full barre
  chordFingerEffort: 0.4,  // Cost per active finger required
  commonToneBonus: -2.0    // Anchor/pivot finger retained across consecutive steps
};

// ============================================================================
// 3. FINGER ALLOCATION ENGINE
// ============================================================================

/**
 * Assigns optimal anatomical finger number (0=open, 1=Index, 2=Middle, 3=Ring, 4=Pinky)
 * based on hand position P and fret distance.
 * 
 * @param {number} fret - Fret number
 * @param {number} handPos - Hand position P (anchor index finger fret)
 * @returns {{finger: number, isStretch: boolean}}
 */
function assignSingleNoteFinger(fret, handPos) {
  if (fret === 0) {
    return { finger: 0, isStretch: false };
  }

  const offset = fret - handPos;
  if (offset === -1) {
    return { finger: 1, isStretch: true };  // Index finger stretch backward
  } else if (offset === 0) {
    return { finger: 1, isStretch: false }; // Index finger
  } else if (offset === 1) {
    return { finger: 2, isStretch: false }; // Middle finger
  } else if (offset === 2) {
    return { finger: 3, isStretch: false }; // Ring finger
  } else if (offset === 3) {
    return { finger: 4, isStretch: false }; // Pinky finger
  } else if (offset === 4) {
    return { finger: 4, isStretch: true };  // Pinky finger extension forward
  }

  return { finger: Math.max(1, Math.min(4, offset + 1)), isStretch: true };
}

/**
 * Assigns realistic anatomical fingering for a complete chord voicing.
 * Allocates Index barre at minFret if multiple strings share minFret,
 * then maps Middle (2), Ring (3), and Pinky (4) to ascending fret/string locations.
 * 
 * @param {Array<{string: number, fret: number, midi: number}>} notes
 * @returns {Array<{string: number, fret: number, midi: number, finger: number}>}
 */
function assignChordFingers(notes) {
  const fretted = notes.filter(n => n.fret > 0);
  if (fretted.length === 0) {
    return notes.map(n => ({ ...n, finger: 0 }));
  }

  const minFret = Math.min(...fretted.map(n => n.fret));
  const notesAtMin = fretted.filter(n => n.fret === minFret);
  const notesAboveMin = fretted.filter(n => n.fret > minFret)
    .sort((a, b) => a.fret - b.fret || b.string - a.string);

  const fingerMap = new Map();

  // If multiple notes at minFret, Index finger (1) barres all of them
  if (notesAtMin.length > 1) {
    for (const n of notesAtMin) {
      fingerMap.set(`${n.string}:${n.fret}`, 1);
    }
    let nextFinger = 2;
    for (const n of notesAboveMin) {
      fingerMap.set(`${n.string}:${n.fret}`, Math.min(4, nextFinger++));
    }
  } else {
    // Single notes: assign based on relative fret order
    const sortedFretted = [...fretted].sort((a, b) => a.fret - b.fret || b.string - a.string);
    let nextFinger = 1;
    for (const n of sortedFretted) {
      fingerMap.set(`${n.string}:${n.fret}`, Math.min(4, nextFinger++));
    }
  }

  return notes.map(n => ({
    ...n,
    finger: n.fret === 0 ? 0 : (fingerMap.get(`${n.string}:${n.fret}`) || 1)
  }));
}

// ============================================================================
// 4. POLYPHONIC CHORD EXPANSION & PLAYABILITY VERIFIER
// ============================================================================

/**
 * Requirement 3: Polyphonic chord grouping within a 50ms window.
 * Groups detected incoming notes occurring within windowMs (default 50ms) into simultaneous chord events.
 * 
 * @param {Array<{pitch: number, timeMs?: number}>} detectedNotes
 * @param {number} [windowMs=50]
 * @returns {Array<{timeMs: number, pitches: number[]}>}
 */
function groupNotesIntoEvents(detectedNotes, windowMs = 50) {
  if (!detectedNotes || detectedNotes.length === 0) return [];

  const hasTimestamps = detectedNotes.every(n => typeof n.timeMs === 'number');
  if (!hasTimestamps) {
    return detectedNotes.map((n, i) => ({
      timeMs: i * 500,
      pitches: [n.pitch]
    }));
  }

  // Chronological sort
  const sorted = [...detectedNotes].sort((a, b) => a.timeMs - b.timeMs);
  const events = [];
  let currentCluster = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const note = sorted[i];
    if (note.timeMs - currentCluster[0].timeMs <= windowMs) {
      currentCluster.push(note);
    } else {
      const pitches = [...new Set(currentCluster.map(n => n.pitch))].sort((a, b) => a - b);
      events.push({
        timeMs: currentCluster[0].timeMs,
        pitches
      });
      currentCluster = [note];
    }
  }

  if (currentCluster.length > 0) {
    const pitches = [...new Set(currentCluster.map(n => n.pitch))].sort((a, b) => a - b);
    events.push({
      timeMs: currentCluster[0].timeMs,
      pitches
    });
  }

  return events;
}

/**
 * Validates whether a combination of (string, fret) assignments constitutes
 * a physically playable guitar chord shape.
 * 
 * Physical constraints enforced:
 * 1. Monophonic strings: At most ONE note per string (no string collisions).
 * 2. Fretting span: Max fret distance between lowest and highest fretted notes <= 4.
 * 3. Human finger limit: Max 4 active fretting fingers (Index, Middle, Ring, Pinky).
 * 4. Barre mechanics: Index finger can barre multiple strings at min(fret), provided
 *    open strings are not mechanically obstructed underneath the barre finger.
 * 
 * @param {Array<{string: number, fret: number, midi: number}>} assignment
 * @returns {{isValid: boolean, handPos: number, fingersNeeded: number, isBarre: boolean, reason?: string}}
 */
function evaluateChordPlayability(assignment) {
  // Check 1: String uniqueness (no two notes on the same string)
  const strings = assignment.map(a => a.string);
  const stringSet = new Set(strings);
  if (stringSet.size !== strings.length) {
    return { isValid: false, reason: 'Duplicate notes on the same string' };
  }

  const fretted = assignment.filter(a => a.fret > 0);
  
  // All open strings (e.g. open drone tuning)
  if (fretted.length === 0) {
    return { isValid: true, handPos: 1, fingersNeeded: 0, isBarre: false };
  }

  const frets = fretted.map(a => a.fret);
  const minFret = Math.min(...frets);
  const maxFret = Math.max(...frets);
  const span = maxFret - minFret;

  // Check 2: Physical hand span (<= 4 frets)
  if (span > 4) {
    return { isValid: false, reason: `Excessive fret span (${span} frets > 4)` };
  }

  // Check 3: Barre mechanics and finger allocation
  const notesAtMinFret = fretted.filter(a => a.fret === minFret);
  let isBarre = false;
  let fingersNeeded = 0;

  if (notesAtMinFret.length > 1) {
    isBarre = true;
    fingersNeeded = 1; // Index finger barres at minFret

    // Barre obstruction check: barre stretches from lowest string to highest string holding minFret.
    // Open strings cannot exist within this physical segment.
    const barreStrings = notesAtMinFret.map(a => a.string);
    const minStr = Math.min(...barreStrings);
    const maxStr = Math.max(...barreStrings);

    for (const note of assignment) {
      if (note.fret === 0 && note.string >= minStr && note.string <= maxStr) {
        return { isValid: false, reason: 'Open string obstructed by barre finger' };
      }
    }

    const notesAboveMin = fretted.filter(a => a.fret > minFret);
    fingersNeeded += notesAboveMin.length;
  } else {
    fingersNeeded = fretted.length;
  }

  // Check 4: Finger count <= 4
  if (fingersNeeded > 4) {
    return { isValid: false, reason: `Requires ${fingersNeeded} fingers (max 4)` };
  }

  const handPos = Math.max(1, Math.min(19, minFret));

  return {
    isValid: true,
    handPos,
    fingersNeeded,
    isBarre
  };
}

/**
 * Generates all physically playable chord shapes for a set of simultaneous pitches.
 * 
 * @param {number[]} pitches - Array of 2 to 6 MIDI pitches
 * @returns {Array<object>} Valid chord state candidates
 */
function generateValidChordShapes(pitches) {
  if (pitches.length < 2 || pitches.length > 6) {
    return [];
  }

  const optionsPerPitch = pitches.map(p => getFretboardPositions(p));
  for (const opts of optionsPerPitch) {
    if (opts.length === 0) return [];
  }

  const validShapes = [];

  // Recursive search with branch-pruning
  function search(pitchIdx, currentAssignment, usedStrings) {
    if (pitchIdx === pitches.length) {
      const evaluation = evaluateChordPlayability(currentAssignment);
      if (evaluation.isValid) {
        const fingeredNotes = assignChordFingers(currentAssignment);
        validShapes.push({
          notes: fingeredNotes,
          handPos: evaluation.handPos,
          fingersNeeded: evaluation.fingersNeeded,
          isBarre: evaluation.isBarre,
          isChord: true
        });
      }
      return;
    }

    const candidatePositions = optionsPerPitch[pitchIdx];

    for (const pos of candidatePositions) {
      if (usedStrings.has(pos.string)) continue;

      // Incremental span pruning
      if (pos.fret > 0) {
        const frettedSoFar = currentAssignment.filter(a => a.fret > 0).map(a => a.fret);
        if (frettedSoFar.length > 0) {
          const currentMin = Math.min(...frettedSoFar, pos.fret);
          const currentMax = Math.max(...frettedSoFar, pos.fret);
          if (currentMax - currentMin > 4) continue;
        }
      }

      currentAssignment.push(pos);
      usedStrings.add(pos.string);

      search(pitchIdx + 1, currentAssignment, usedStrings);

      currentAssignment.pop();
      usedStrings.delete(pos.string);
    }
  }

  search(0, [], new Set());

  // Sort candidates by playability: fewer fingers, lower frets, compact spans
  validShapes.sort((a, b) => {
    if (a.fingersNeeded !== b.fingersNeeded) return a.fingersNeeded - b.fingersNeeded;
    return a.handPos - b.handPos;
  });

  return validShapes;
}

// ============================================================================
// 5. VITERBI TRELLIS STATE GENERATOR & COST CALCULATOR
// ============================================================================

/**
 * Builds candidate states for a single time step.
 * 
 * @param {{pitches: number[]}} event 
 * @param {object} weights 
 * @param {number|null} targetHandBox 
 * @returns {Array<object>}
 */
function generateStatesForEvent(event, weights, targetHandBox = null) {
  if (event.pitches.length === 1) {
    const pitch = event.pitches[0];
    const positions = getFretboardPositions(pitch);
    const states = [];

    for (const pos of positions) {
      if (pos.fret === 0) {
        const candidatePositions = targetHandBox ? [targetHandBox, 1] : [1, 5, 7, 9, 12];
        for (const hp of candidatePositions) {
          states.push({
            isChord: false,
            string: pos.string,
            fret: 0,
            handPos: hp,
            finger: 0,
            midi: pitch,
            note: pos.note
          });
        }
      } else {
        const minP = Math.max(1, pos.fret - 4);
        const maxP = Math.min(19, pos.fret + 1);

        for (let p = minP; p <= maxP; p++) {
          const { finger } = assignSingleNoteFinger(pos.fret, p);
          states.push({
            isChord: false,
            string: pos.string,
            fret: pos.fret,
            handPos: p,
            finger,
            midi: pitch,
            note: pos.note
          });
        }
      }
    }
    return states;
  } else {
    return generateValidChordShapes(event.pitches);
  }
}

/**
 * Computes state emission cost C_state(S).
 * Requirement 2:
 * - Hand position locality: penalizes drifting away from established 4-fret hand box
 * - Open string preference vs. barre position rules
 * - High fret access difficulty
 * 
 * @param {object} state 
 * @param {object} weights 
 * @param {number|null} targetHandBox 
 * @returns {number}
 */
function computeStateCost(state, weights, targetHandBox) {
  let cost = 0;

  // Hand position locality to an established box (e.g. Box at fret 5)
  if (targetHandBox !== null && typeof targetHandBox === 'number') {
    cost += Math.abs(state.handPos - targetHandBox) * weights.localityDrift;
  }

  if (!state.isChord) {
    if (state.fret === 0) {
      // Open string: natural in open cowboy positions (P <= 3),
      // but penalized when anchored higher up the neck (P >= 4) in closed scalar runs.
      if (state.handPos <= 3) {
        cost += weights.openStringBonus;
      } else {
        cost += (state.handPos - 2) * weights.openStringHighPen;
      }
    } else {
      // Fretted note: reach check within 4-fret box [P, P+3]
      if (state.fret < state.handPos || state.fret > state.handPos + 3) {
        cost += weights.stretchPenalty;
      }

      // High fret neck joint / cutaway access for frets > 12
      if (state.fret > 12) {
        cost += (state.fret - 12) * weights.highFretPenalty;
      }
    }
  } else {
    // Chord state
    cost += state.fingersNeeded * weights.chordFingerEffort;
    if (state.isBarre) {
      cost += weights.chordBarreEffort;
    }
    if (state.handPos > 12) {
      cost += (state.handPos - 12) * weights.highFretPenalty;
    }
  }

  return cost;
}

/**
 * Computes transition cost C_trans(S_{t-1}, S_t) between consecutive states.
 * Requirement 2:
 * - Fret distance penalty: |current_fret - previous_fret|
 * - String change penalty: small penalty for adjacent, higher for non-adjacent skips
 * - Hand shift penalty: |current_handPos - previous_handPos|
 * - Common-tone anchor retention bonus for chords
 * 
 * @param {object} prev 
 * @param {object} curr 
 * @param {object} weights 
 * @returns {number}
 */
function computeTransitionCost(prev, curr, weights) {
  let cost = 0;

  // Hand Shift Penalty |P_t - P_{t-1}|
  const isCurrOpen = (!curr.isChord && curr.fret === 0);
  const isPrevOpen = (!prev.isChord && prev.fret === 0);
  const deltaP = (isCurrOpen || isPrevOpen) ? 0 : Math.abs(curr.handPos - prev.handPos);

  if (deltaP > 0) {
    cost += weights.shiftBase + weights.shiftPerFret * Math.pow(deltaP, weights.shiftExp);
  }

  // --- Single-Note to Single-Note Transitions ---
  if (!prev.isChord && !curr.isChord) {
    if (prev.fret > 0 && curr.fret > 0) {
      const deltaFret = Math.abs(curr.fret - prev.fret);

      if (curr.string === prev.string) {
        // Same string: if within the 4-fret hand box, different fingers alternate comfortably
        if (deltaFret > 4 || deltaP > 0) {
          cost += weights.sameStringSlide * (deltaFret > 3 ? 1.5 : 1.0);
        } else {
          cost += deltaFret * weights.withinBoxFretMove;
        }
      } else {
        // Cross-string transition within the box
        cost += deltaFret * (weights.fretDistance * 0.5);
      }
    } else if (prev.fret > 0 || curr.fret > 0) {
      const frettedNote = prev.fret > 0 ? prev : curr;
      if (frettedNote.handPos >= 4) {
        cost += (frettedNote.handPos - 2) * 0.5;
      }
    }

    // String change penalty: adjacent strings are very smooth; non-adjacent skips are penalized
    const deltaString = Math.abs(curr.string - prev.string);
    if (deltaString === 1) {
      cost += weights.adjacentString;
    } else if (deltaString > 1) {
      cost += weights.adjacentString + weights.stringSkipBase * (deltaString - 1);
    }
  }

  // --- Polyphonic Chord Transitions ---
  if (prev.isChord && curr.isChord) {
    let commonFingers = 0;
    for (const pn of prev.notes) {
      if (pn.fret > 0 && curr.notes.some(cn => cn.string === pn.string && cn.fret === pn.fret)) {
        commonFingers++;
      }
    }
    cost += commonFingers * weights.commonToneBonus;

    const prevCenter = prev.notes.reduce((acc, n) => acc + n.fret, 0) / prev.notes.length;
    const currCenter = curr.notes.reduce((acc, n) => acc + n.fret, 0) / curr.notes.length;
    cost += Math.abs(currCenter - prevCenter) * weights.fretDistance;
  }

  // --- Mixed Monophonic / Polyphonic Transitions ---
  if ((prev.isChord && !curr.isChord) || (!prev.isChord && curr.isChord)) {
    const chord = prev.isChord ? prev : curr;
    const single = prev.isChord ? curr : prev;

    if (single.fret > 0) {
      const nearestFretDist = Math.min(...chord.notes.map(n => Math.abs(n.fret - single.fret)));
      cost += nearestFretDist * weights.fretDistance;
    }
  }

  return cost;
}

// ============================================================================
// 6. DYNAMIC PROGRAMMING (VITERBI) SOLVER
// ============================================================================

/**
 * Solves for the globally optimal fingering path through incoming detected pitches.
 * 
 * @param {Array<{pitch: number, timeMs?: number}>} detectedNotes - Detected pitches
 * @param {object} [options]
 * @param {number} [options.windowMs=50] - Polyphonic grouping window in ms
 * @param {number|null} [options.targetHandBox=null] - Anchor 4-fret hand box (e.g. 5)
 * @param {object} [options.customWeights={}] - Optional custom cost weights
 * @returns {{
 *   path: Array<object>,
 *   totalCost: number,
 *   events: Array<object>,
 *   tablature: string
 * }}
 */
function findOptimalFingering(detectedNotes, options = {}) {
  const {
    windowMs = 50,
    targetHandBox = null,
    customWeights = {}
  } = options;

  const weights = { ...DEFAULT_WEIGHTS, ...customWeights };

  // 1. Group notes into events (monophonic or polyphonic chords within 50ms)
  const events = groupNotesIntoEvents(detectedNotes, windowMs);
  if (events.length === 0) {
    return { path: [], totalCost: 0, events: [], tablature: '' };
  }

  // 2. Generate candidate states per event
  const stageStates = events.map(ev => generateStatesForEvent(ev, weights, targetHandBox));

  for (let t = 0; t < stageStates.length; t++) {
    if (stageStates[t].length === 0) {
      throw new Error(`Unplayable pitch event at ${events[t].timeMs}ms: [${events[t].pitches.join(', ')}]`);
    }
  }

  const T = stageStates.length;
  const V = []; // Minimum cumulative path cost to state i at time step t
  const B = []; // Backpointer to predecessor state j at time step t-1

  // --- Step 3a: Initialize t = 0 ---
  V[0] = [];
  B[0] = [];
  for (let i = 0; i < stageStates[0].length; i++) {
    const state = stageStates[0][i];
    V[0][i] = computeStateCost(state, weights, targetHandBox);
    B[0][i] = -1;
  }

  // --- Step 3b: Forward Trellis Induction ---
  for (let t = 1; t < T; t++) {
    V[t] = [];
    B[t] = [];

    const currStates = stageStates[t];
    const prevStates = stageStates[t - 1];

    for (let i = 0; i < currStates.length; i++) {
      const currState = currStates[i];
      const emissionCost = computeStateCost(currState, weights, targetHandBox);

      let minCost = Infinity;
      let bestPrevIdx = -1;

      for (let j = 0; j < prevStates.length; j++) {
        const prevState = prevStates[j];
        const transitionCost = computeTransitionCost(prevState, currState, weights);
        const totalCandidateCost = V[t - 1][j] + transitionCost + emissionCost;

        if (totalCandidateCost < minCost) {
          minCost = totalCandidateCost;
          bestPrevIdx = j;
        }
      }

      V[t][i] = minCost;
      B[t][i] = bestPrevIdx;
    }
  }

  // --- Step 3c: Find optimal terminal state ---
  let minFinalCost = Infinity;
  let bestFinalIdx = -1;
  for (let i = 0; i < stageStates[T - 1].length; i++) {
    if (V[T - 1][i] < minFinalCost) {
      minFinalCost = V[T - 1][i];
      bestFinalIdx = i;
    }
  }

  // --- Step 3d: Backtrack optimal path ---
  const optimalPath = new Array(T);
  let currIdx = bestFinalIdx;

  for (let t = T - 1; t >= 0; t--) {
    optimalPath[t] = stageStates[t][currIdx];
    currIdx = B[t][currIdx];
  }

  const tablature = renderTablature(optimalPath);

  return {
    path: optimalPath,
    totalCost: minFinalCost,
    events,
    tablature
  };
}

// ============================================================================
// 7. TABLATURE & CHORD DIAGRAM VISUALIZERS
// ============================================================================

/**
 * Renders an array of resolved states into an authentic 6-line ASCII guitar tablature.
 * 
 * @param {Array<object>} path 
 * @returns {string}
 */
function renderTablature(path) {
  const stringNames = ['e', 'B', 'G', 'D', 'A', 'E'];
  const lines = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };

  for (const step of path) {
    const colFrets = { 1: '-', 2: '-', 3: '-', 4: '-', 5: '-', 6: '-' };

    if (!step.isChord) {
      colFrets[step.string] = String(step.fret);
    } else {
      for (const n of step.notes) {
        colFrets[n.string] = String(n.fret);
      }
    }

    let maxWidth = 1;
    for (let s = 1; s <= 6; s++) {
      if (colFrets[s].length > maxWidth) maxWidth = colFrets[s].length;
    }

    for (let s = 1; s <= 6; s++) {
      const val = colFrets[s];
      const padded = val === '-' ? '-'.repeat(maxWidth + 2) : `-${val}-`.padEnd(maxWidth + 2, '-');
      lines[s].push(padded);
    }
  }

  let tab = '';
  for (let s = 1; s <= 6; s++) {
    tab += `${stringNames[s - 1]}|${lines[s].join('')}|\n`;
  }
  return tab;
}

/**
 * Renders a chord voicing into an ASCII guitar fretboard chord grid diagram.
 * 
 * @param {object} chordState 
 * @param {string} [name='Chord']
 * @returns {string}
 */
function renderChordDiagram(chordState, name = 'Chord') {
  if (!chordState.isChord) return '';

  const notesByString = {};
  for (const n of chordState.notes) {
    notesByString[n.string] = n;
  }

  const fretted = chordState.notes.filter(n => n.fret > 0);
  const minFret = fretted.length > 0 ? Math.min(...fretted.map(n => n.fret)) : 1;
  const startFret = minFret <= 2 ? 1 : minFret;
  const numGridFrets = 4;

  let diagram = `${name} [Hand Position ${chordState.handPos}${chordState.isBarre ? ' (Barre)' : ''}]:\n`;

  // Top header: open (O), muted (X), or fretted finger
  let header = '  ';
  for (let s = 6; s >= 1; s--) {
    if (!notesByString[s]) {
      header += ' x ';
    } else if (notesByString[s].fret === 0) {
      header += ' o ';
    } else {
      header += ` ${notesByString[s].finger || '•'} `;
    }
  }
  diagram += header + '\n';
  diagram += '  ' + (startFret === 1 ? '===============' : '---------------') + '\n';

  for (let f = startFret; f < startFret + numGridFrets; f++) {
    let row = `${String(f).padStart(2, ' ')}|`;
    for (let s = 6; s >= 1; s--) {
      const note = notesByString[s];
      if (note && note.fret === f) {
        row += `-${note.finger || '•'}-|`;
      } else {
        row += '---|';
      }
    }
    diagram += row + '\n';
  }

  return diagram;
}

// ============================================================================
// 8. UNIT TESTS & DEMONSTRATION SUITE
// ============================================================================

function runUnitTests() {
  console.log('='.repeat(80));
  console.log('GUITAR FRETBOARD OPTIMIZER (VITERBI ALGORITHM) - TEST SUITE');
  console.log('='.repeat(80));

  let passed = 0;
  let total = 0;

  function assert(condition, testName) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}`);
    }
  }

  // --------------------------------------------------------------------------
  // TEST 1: Note-to-Fretboard Mapping (Requirement 1)
  // --------------------------------------------------------------------------
  console.log('\n--- 1. Testing Note-to-Fretboard Mapping (E2 to D6) ---');
  
  // Test lowest note: E2 (MIDI 40)
  const e2Positions = getFretboardPositions(40);
  assert(e2Positions.length === 1 && e2Positions[0].string === 6 && e2Positions[0].fret === 0,
    'MIDI 40 (E2) should map solely to String 6 Fret 0');

  // Test highest note: D6 (MIDI 86)
  const d6Positions = getFretboardPositions(86);
  assert(d6Positions.length === 1 && d6Positions[0].string === 1 && d6Positions[0].fret === 22,
    'MIDI 86 (D6) should map solely to String 1 Fret 22');

  // Test pitch existing across multiple strings: E4 (MIDI 64)
  const e4Positions = getFretboardPositions(64);
  assert(e4Positions.length === 5,
    `MIDI 64 (E4) exists across 5 strings (Found: ${e4Positions.length})`);
  
  const e4Expected = [
    { string: 5, fret: 19 },
    { string: 4, fret: 14 },
    { string: 3, fret: 9 },
    { string: 2, fret: 5 },
    { string: 1, fret: 0 }
  ];
  const e4Matches = e4Expected.every(exp => 
    e4Positions.some(p => p.string === exp.string && p.fret === exp.fret)
  );
  assert(e4Matches, 'MIDI 64 maps correctly to strings 5, 4, 3, 2, 1 at frets 19, 14, 9, 5, 0');

  // Out-of-range bounds checks
  assert(getFretboardPositions(39).length === 0, 'MIDI 39 (below E2) returns empty array');
  assert(getFretboardPositions(87).length === 0, 'MIDI 87 (above 22nd fret D6) returns empty array');

  // --------------------------------------------------------------------------
  // TEST 2: Common Guitar Riff: A Minor Pentatonic Run in Box 1 (Requirement 2 & 4)
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Testing Monophonic Riff: A Minor Pentatonic (Frets 5-8 Box) ---');
  // Classic Box 1 run:
  // A3 (57) -> C4 (60) -> D4 (62) -> E4 (64) -> G4 (67) -> A4 (69)
  const aMinorPentatonicNotes = [
    { pitch: 57, timeMs: 0 },   // A3: String 4, Fret 7
    { pitch: 60, timeMs: 200 }, // C4: String 3, Fret 5
    { pitch: 62, timeMs: 400 }, // D4: String 3, Fret 7
    { pitch: 64, timeMs: 600 }, // E4: String 2, Fret 5
    { pitch: 67, timeMs: 800 }, // G4: String 2, Fret 8
    { pitch: 69, timeMs: 1000 } // A4: String 1, Fret 5
  ];

  const pentatonicResult = findOptimalFingering(aMinorPentatonicNotes, {
    targetHandBox: 5
  });

  console.log('Optimal Pentatonic Tablature:');
  console.log(pentatonicResult.tablature);

  const pentatonicSteps = pentatonicResult.path;
  const expectedFrets = [7, 5, 7, 5, 8, 5];
  const expectedStrings = [4, 3, 3, 2, 2, 1];
  const expectedFingers = [3, 1, 3, 1, 4, 1]; // Ring, Index, Ring, Index, Pinky, Index

  let pentatonicCorrect = true;
  let fingersCorrect = true;
  for (let i = 0; i < pentatonicSteps.length; i++) {
    const step = pentatonicSteps[i];
    console.log(`  Step ${i + 1} (${step.note}): String ${step.string}, Fret ${step.fret}, Finger ${step.finger}, Hand Position ${step.handPos}`);
    if (step.fret !== expectedFrets[i] || step.string !== expectedStrings[i]) {
      pentatonicCorrect = false;
    }
    if (step.finger !== expectedFingers[i]) {
      fingersCorrect = false;
    }
  }

  assert(pentatonicCorrect,
    'Viterbi converges to the canonical 5th-fret Box 1 pentatonic fingering with zero hand shifts!');
  assert(fingersCorrect,
    'Anatomical fingers correctly assigned: [3, 1, 3, 1, 4, 1] (Ring, Index, Ring, Index, Pinky, Index)');
  assert(pentatonicSteps.every(s => s.handPos === 5),
    'Hand position locality maintained strictly at fret 5');

  // --------------------------------------------------------------------------
  // TEST 3: Polyphonic Chord Progression: C Major -> G Major (Requirement 3 & 4)
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Testing Polyphonic Chord Expansion: C Major to G Major ---');
  // 50ms window test: simultaneous notes detected with slight jitter
  // C Major: C3(48), E3(52), G3(55), C4(60), E4(64)
  // G Major: G2(43), B2(47), D3(50), G3(55), B3(59), G4(67)
  const chordProgressionNotes = [
    // C Major cluster within 30ms (< 50ms window)
    { pitch: 48, timeMs: 0 },
    { pitch: 52, timeMs: 10 },
    { pitch: 55, timeMs: 15 },
    { pitch: 60, timeMs: 25 },
    { pitch: 64, timeMs: 30 },

    // G Major cluster at 1000ms
    { pitch: 43, timeMs: 1000 },
    { pitch: 47, timeMs: 1010 },
    { pitch: 50, timeMs: 1015 },
    { pitch: 55, timeMs: 1020 },
    { pitch: 59, timeMs: 1030 },
    { pitch: 67, timeMs: 1040 }
  ];

  const chordResult = findOptimalFingering(chordProgressionNotes, {
    windowMs: 50,
    targetHandBox: 1
  });

  console.log('Optimal Chord Progression Tablature:');
  console.log(chordResult.tablature);

  assert(chordResult.events.length === 2, 'Clustered into exactly 2 polyphonic chord events within 50ms window');

  // Verify C Major shape
  const cChord = chordResult.path[0];
  console.log(renderChordDiagram(cChord, 'C Major'));

  const cNotesByString = {};
  cChord.notes.forEach(n => { cNotesByString[n.string] = n.fret; });
  const isStandardC = (
    cNotesByString[5] === 3 &&
    cNotesByString[4] === 2 &&
    cNotesByString[3] === 0 &&
    cNotesByString[2] === 1 &&
    cNotesByString[1] === 0
  );
  assert(isStandardC, 'C Major resolves to standard x-3-2-0-1-0 open chord voicing');

  // Verify G Major shape
  const gChord = chordResult.path[1];
  console.log(renderChordDiagram(gChord, 'G Major'));

  const gNotesByString = {};
  gChord.notes.forEach(n => { gNotesByString[n.string] = n.fret; });
  const isStandardG = (
    gNotesByString[6] === 3 &&
    gNotesByString[5] === 2 &&
    gNotesByString[4] === 0 &&
    gNotesByString[3] === 0 &&
    gNotesByString[2] === 0 &&
    gNotesByString[1] === 3
  );
  assert(isStandardG, 'G Major resolves to standard 3-2-0-0-0-3 open chord voicing');

  // --------------------------------------------------------------------------
  // TEST 4: Barre Chord Recognition & Span Validation
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Testing Barre Chord Recognition & Span Validation ---');
  // F Major Barre chord: F2(41), C3(48), F3(53), A3(57), C4(60), F4(65)
  const fBarrePitches = [41, 48, 53, 57, 60, 65];
  const fBarreShapes = generateValidChordShapes(fBarrePitches);
  
  assert(fBarreShapes.length > 0, `Generated ${fBarreShapes.length} valid shape(s) for F Major`);
  const topF = fBarreShapes[0];
  console.log(renderChordDiagram(topF, 'F Major Barre'));

  const fNotesByString = {};
  topF.notes.forEach(n => { fNotesByString[n.string] = n.fret; });
  const isStandardFBarre = (
    fNotesByString[6] === 1 &&
    fNotesByString[5] === 3 &&
    fNotesByString[4] === 3 &&
    fNotesByString[3] === 2 &&
    fNotesByString[2] === 1 &&
    fNotesByString[1] === 1
  );
  assert(isStandardFBarre, 'F Major resolves to 1-3-3-2-1-1 full barre shape');
  assert(topF.isBarre === true, 'Detected barre flag is correctly set to true');
  assert(topF.fingersNeeded <= 4, `Fingers needed (${topF.fingersNeeded}) is physically <= 4`);

  // Test physical impossibility: Hand span > 4 frets rejected
  const unplayableSpanChord = [
    { string: 6, fret: 1, midi: 41 },
    { string: 5, fret: 9, midi: 54 }
  ];
  const spanEvaluation = evaluateChordPlayability(unplayableSpanChord);
  assert(spanEvaluation.isValid === false, 'Rejects unplayable hand span (> 4 frets)');

  // Test physical impossibility: Duplicate notes on same string rejected
  const stringClashChord = [
    { string: 3, fret: 5, midi: 60 },
    { string: 3, fret: 7, midi: 62 }
  ];
  const clashEvaluation = evaluateChordPlayability(stringClashChord);
  assert(clashEvaluation.isValid === false, 'Rejects string collisions (multiple notes on same string)');

  // --------------------------------------------------------------------------
  // TEST 5: Mixed Monophonic Lead into Polyphonic Chord
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Testing Mixed Lead Riff Transitioning into Chord ---');
  const mixedRun = [
    { pitch: 48, timeMs: 0 },   // C3 single note
    { pitch: 52, timeMs: 250 }, // E3 single note
    { pitch: 55, timeMs: 500 }, // G3 single note
    // Followed by C Major chord strum: C3, E3, G3, C4, E4
    { pitch: 48, timeMs: 800 },
    { pitch: 52, timeMs: 805 },
    { pitch: 55, timeMs: 810 },
    { pitch: 60, timeMs: 815 },
    { pitch: 64, timeMs: 820 }
  ];
  const mixedResult = findOptimalFingering(mixedRun, { windowMs: 50, targetHandBox: 1 });
  console.log('Mixed Run Tablature:');
  console.log(mixedResult.tablature);
  assert(mixedResult.path.length === 4, 'Resolved 3 single notes followed by 1 polyphonic chord');

  console.log('\n' + '='.repeat(80));
  console.log(`TEST RESULTS: ${passed} / ${total} tests passed (${Math.round((passed / total) * 100)}%)`);
  console.log('='.repeat(80));

  return passed === total;
}

// Execute tests if run directly
if (typeof require !== 'undefined' && require.main === module) {
  runUnitTests();
}

module.exports = {
  OPEN_STRINGS,
  NUM_FRETS,
  MIN_MIDI,
  MAX_MIDI,
  DEFAULT_WEIGHTS,
  midiToNoteName,
  getFretboardPositions,
  assignSingleNoteFinger,
  assignChordFingers,
  groupNotesIntoEvents,
  evaluateChordPlayability,
  generateValidChordShapes,
  computeStateCost,
  computeTransitionCost,
  findOptimalFingering,
  renderTablature,
  renderChordDiagram,
  runUnitTests
};
