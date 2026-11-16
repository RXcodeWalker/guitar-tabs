/**
 * Pre-configured Iconic Guitar Riffs & Exercises for instant demo and verification.
 */

const DEMO_SONGS = {
    sweetChild: {
        title: "Sweet Child O' Mine (Slash Intro Riff)",
        bpm: 125,
        timeSignature: "4/4",
        notes: [
            // Measure 1
            { string: 4, fret: 12, finger: 1, noteName: "D4", time: 0.00, duration: 0.24 },
            { string: 2, fret: 15, finger: 4, noteName: "D5", time: 0.24, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 0.48, duration: 0.24 },
            { string: 3, fret: 12, finger: 1, noteName: "G4", time: 0.72, duration: 0.24 },
            { string: 1, fret: 15, finger: 4, noteName: "G5", time: 0.96, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 1.20, duration: 0.24 },
            { string: 1, fret: 14, finger: 3, noteName: "F#5", time: 1.44, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 1.68, duration: 0.24 },
            // Repeat phrase 2
            { string: 4, fret: 12, finger: 1, noteName: "D4", time: 1.92, duration: 0.24 },
            { string: 2, fret: 15, finger: 4, noteName: "D5", time: 2.16, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 2.40, duration: 0.24 },
            { string: 3, fret: 12, finger: 1, noteName: "G4", time: 2.64, duration: 0.24 },
            { string: 1, fret: 15, finger: 4, noteName: "G5", time: 2.88, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 3.12, duration: 0.24 },
            { string: 1, fret: 14, finger: 3, noteName: "F#5", time: 3.36, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 3.60, duration: 0.24 },
            // Phrase 3 (Shift bass to fret 14)
            { string: 4, fret: 14, finger: 3, noteName: "E4", time: 3.84, duration: 0.24 },
            { string: 2, fret: 15, finger: 4, noteName: "D5", time: 4.08, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 4.32, duration: 0.24 },
            { string: 3, fret: 12, finger: 1, noteName: "G4", time: 4.56, duration: 0.24 },
            { string: 1, fret: 15, finger: 4, noteName: "G5", time: 4.80, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 5.04, duration: 0.24 },
            { string: 1, fret: 14, finger: 3, noteName: "F#5", time: 5.28, duration: 0.24 },
            { string: 3, fret: 14, finger: 3, noteName: "A4", time: 5.52, duration: 0.24 }
        ]
    },

    smokeOnWater: {
        title: "Smoke On The Water (Deep Purple Riff)",
        bpm: 112,
        timeSignature: "4/4",
        notes: [
            // Bar 1: 0 - 3 - 5
            { string: 4, fret: 0, finger: 0, noteName: "D3", time: 0.00, duration: 0.50 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 0.00, duration: 0.50 },

            { string: 4, fret: 3, finger: 1, noteName: "F3", time: 0.53, duration: 0.50 },
            { string: 3, fret: 3, finger: 1, noteName: "Bb3", time: 0.53, duration: 0.50 },

            { string: 4, fret: 5, finger: 3, noteName: "G3", time: 1.07, duration: 0.70 },
            { string: 3, fret: 5, finger: 3, noteName: "C4", time: 1.07, duration: 0.70 },

            // Bar 2: 0 - 3 - 6 - 5
            { string: 4, fret: 0, finger: 0, noteName: "D3", time: 2.14, duration: 0.50 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 2.14, duration: 0.50 },

            { string: 4, fret: 3, finger: 1, noteName: "F3", time: 2.68, duration: 0.50 },
            { string: 3, fret: 3, finger: 1, noteName: "Bb3", time: 2.68, duration: 0.50 },

            { string: 4, fret: 6, finger: 4, noteName: "Ab3", time: 3.21, duration: 0.35 },
            { string: 3, fret: 6, finger: 4, noteName: "Db4", time: 3.21, duration: 0.35 },

            { string: 4, fret: 5, finger: 3, noteName: "G3", time: 3.57, duration: 0.80 },
            { string: 3, fret: 5, finger: 3, noteName: "C4", time: 3.57, duration: 0.80 },

            // Bar 3: 0 - 3 - 5 - 3 - 0
            { string: 4, fret: 0, finger: 0, noteName: "D3", time: 4.82, duration: 0.50 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 4.82, duration: 0.50 },

            { string: 4, fret: 3, finger: 1, noteName: "F3", time: 5.35, duration: 0.50 },
            { string: 3, fret: 3, finger: 1, noteName: "Bb3", time: 5.35, duration: 0.50 },

            { string: 4, fret: 5, finger: 3, noteName: "G3", time: 5.89, duration: 0.60 },
            { string: 3, fret: 5, finger: 3, noteName: "C4", time: 5.89, duration: 0.60 },

            { string: 4, fret: 3, finger: 1, noteName: "F3", time: 6.42, duration: 0.50 },
            { string: 3, fret: 3, finger: 1, noteName: "Bb3", time: 6.42, duration: 0.50 },

            { string: 4, fret: 0, finger: 0, noteName: "D3", time: 6.96, duration: 1.20 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 6.96, duration: 1.20 }
        ]
    },

    pentatonicRun: {
        title: "A Minor Pentatonic Box (Frets 5-8)",
        bpm: 140,
        timeSignature: "4/4",
        notes: [
            // Ascending through Box 1 (Root at fret 5)
            { string: 6, fret: 5, finger: 1, noteName: "A2", time: 0.00, duration: 0.21 },
            { string: 6, fret: 8, finger: 4, noteName: "C3", time: 0.21, duration: 0.21 },
            { string: 5, fret: 5, finger: 1, noteName: "D3", time: 0.42, duration: 0.21 },
            { string: 5, fret: 7, finger: 3, noteName: "E3", time: 0.63, duration: 0.21 },
            { string: 4, fret: 5, finger: 1, noteName: "G3", time: 0.84, duration: 0.21 },
            { string: 4, fret: 7, finger: 3, noteName: "A3", time: 1.05, duration: 0.21 },
            { string: 3, fret: 5, finger: 1, noteName: "C4", time: 1.26, duration: 0.21 },
            { string: 3, fret: 7, finger: 3, noteName: "D4", time: 1.47, duration: 0.21 },
            { string: 2, fret: 5, finger: 1, noteName: "E4", time: 1.68, duration: 0.21 },
            { string: 2, fret: 8, finger: 4, noteName: "G4", time: 1.89, duration: 0.21 },
            { string: 1, fret: 5, finger: 1, noteName: "A4", time: 2.10, duration: 0.21 },
            { string: 1, fret: 8, finger: 4, noteName: "C5", time: 2.31, duration: 0.45 },
            // Descending
            { string: 1, fret: 5, finger: 1, noteName: "A4", time: 2.76, duration: 0.21 },
            { string: 2, fret: 8, finger: 4, noteName: "G4", time: 2.97, duration: 0.21 },
            { string: 2, fret: 5, finger: 1, noteName: "E4", time: 3.18, duration: 0.21 },
            { string: 3, fret: 7, finger: 3, noteName: "D4", time: 3.39, duration: 0.21 },
            { string: 3, fret: 5, finger: 1, noteName: "C4", time: 3.60, duration: 0.21 },
            { string: 4, fret: 7, finger: 3, noteName: "A3", time: 3.81, duration: 0.21 },
            { string: 4, fret: 5, finger: 1, noteName: "G3", time: 4.02, duration: 0.21 },
            { string: 5, fret: 7, finger: 3, noteName: "E3", time: 4.23, duration: 0.21 },
            { string: 5, fret: 5, finger: 1, noteName: "D3", time: 4.44, duration: 0.21 },
            { string: 6, fret: 8, finger: 4, noteName: "C3", time: 4.65, duration: 0.21 },
            { string: 6, fret: 5, finger: 1, noteName: "A2", time: 4.86, duration: 0.80 }
        ]
    },

    nothingElseMatters: {
        title: "Nothing Else Matters (Acoustic Open Arpeggio)",
        bpm: 96,
        timeSignature: "6/8",
        notes: [
            { string: 6, fret: 0, finger: 0, noteName: "E2", time: 0.00, duration: 0.50 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 0.31, duration: 0.30 },
            { string: 2, fret: 0, finger: 0, noteName: "B3", time: 0.62, duration: 0.30 },
            { string: 1, fret: 0, finger: 0, noteName: "E4", time: 0.93, duration: 0.60 },
            { string: 2, fret: 0, finger: 0, noteName: "B3", time: 1.55, duration: 0.30 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 1.86, duration: 0.30 },

            { string: 6, fret: 0, finger: 0, noteName: "E2", time: 2.17, duration: 0.50 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 2.48, duration: 0.30 },
            { string: 2, fret: 0, finger: 0, noteName: "B3", time: 2.79, duration: 0.30 },
            { string: 1, fret: 0, finger: 0, noteName: "E4", time: 3.10, duration: 0.60 },
            { string: 2, fret: 0, finger: 0, noteName: "B3", time: 3.72, duration: 0.30 },
            { string: 3, fret: 0, finger: 0, noteName: "G3", time: 4.03, duration: 0.30 }
        ]
    }
};

if (typeof module !== 'undefined') {
    module.exports = DEMO_SONGS;
}
