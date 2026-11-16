/**
 * Rhythm Quantization Engine
 * Handles raw timestamp capture for note-on and note-off events,
 * and quantizes note start times and durations to 16th notes, 8th notes,
 * quarter note triplets, eighth note triplets, or quarter notes based on BPM.
 */

class GuitarQuantizer {
    constructor(options = {}) {
        this.bpm = options.bpm || 120;
        this.grid = options.grid || '16th';
        this.liveQuantize = options.liveQuantize || false;
        this.timeSignature = options.timeSignature || { numerator: 4, denominator: 4 };

        // Grid unit mappings (in beats relative to quarter note = 1 beat)
        this.gridBeatMultipliers = {
            'none': 0,
            '16th': 0.25,                 // 1/4 beat
            '8th': 0.5,                   // 1/2 beat
            'quarterTriplet': 2 / 3,       // 3 notes in 2 quarter beats (quarter note triplet)
            'eighthTriplet': 1 / 3,        // 3 notes in 1 quarter beat (eighth note triplet)
            'quarter': 1.0                // 1 beat
        };
    }

    /**
     * Sets the working tempo in BPM.
     * @param {number} bpm
     */
    setBPM(bpm) {
        this.bpm = Math.max(30, Math.min(300, bpm));
    }

    /**
     * Sets the active quantization grid mode.
     * @param {string} grid - 'none' | '16th' | '8th' | 'quarterTriplet' | 'eighthTriplet' | 'quarter'
     */
    setGrid(grid) {
        if (this.gridBeatMultipliers.hasOwnProperty(grid)) {
            this.grid = grid;
        } else {
            this.grid = '16th';
        }
    }

    /**
     * Calculates the duration in seconds for a specific grid interval at a given BPM.
     * @param {string} gridType
     * @param {number} bpm
     * @returns {number} duration in seconds
     */
    getGridSeconds(gridType = this.grid, bpm = this.bpm) {
        if (gridType === 'none') return 0;
        const secondsPerBeat = 60 / bpm;
        const multiplier = this.gridBeatMultipliers[gridType] || 0.25;
        return secondsPerBeat * multiplier;
    }

    /**
     * Quantizes a raw timestamp to the nearest grid step.
     * @param {number} rawTime - time in seconds
     * @param {string} gridType
     * @param {number} bpm
     * @returns {number} quantized time in seconds
     */
    quantizeTime(rawTime, gridType = this.grid, bpm = this.bpm) {
        if (gridType === 'none' || rawTime === undefined || rawTime === null) {
            return Math.max(0, rawTime || 0);
        }
        const gridUnit = this.getGridSeconds(gridType, bpm);
        if (gridUnit <= 0) return Math.max(0, rawTime);

        const quantized = Math.round(rawTime / gridUnit) * gridUnit;
        return Math.max(0, Math.round(quantized * 10000) / 10000);
    }

    /**
     * Quantizes a note duration to the nearest grid unit (minimum 1 unit).
     * @param {number} rawDuration - duration in seconds
     * @param {string} gridType
     * @param {number} bpm
     * @returns {number} quantized duration in seconds
     */
    quantizeDuration(rawDuration, gridType = this.grid, bpm = this.bpm) {
        const gridUnit = this.getGridSeconds(gridType, bpm);
        if (gridType === 'none' || gridUnit <= 0) {
            return Math.max(0.05, rawDuration || 0.25);
        }

        const units = Math.max(1, Math.round((rawDuration || gridUnit) / gridUnit));
        return Math.round(units * gridUnit * 10000) / 10000;
    }

    /**
     * Quantizes an individual note object while preserving all raw event timestamps.
     * @param {Object} note
     * @param {string} gridType
     * @param {number} bpm
     * @returns {Object} the modified note
     */
    quantizeNote(note, gridType = this.grid, bpm = this.bpm) {
        // Guarantee raw properties exist
        if (typeof note.rawTime !== 'number') {
            note.rawTime = typeof note.time === 'number' ? note.time : 0;
        }
        if (typeof note.rawDuration !== 'number') {
            note.rawDuration = typeof note.duration === 'number' ? note.duration : 0.35;
        }
        if (typeof note.rawEndTime !== 'number') {
            note.rawEndTime = note.rawTime + note.rawDuration;
        }

        if (gridType === 'none') {
            note.time = note.rawTime;
            note.duration = note.rawDuration;
        } else {
            note.time = this.quantizeTime(note.rawTime, gridType, bpm);
            note.duration = this.quantizeDuration(note.rawDuration, gridType, bpm);
        }

        note.quantizedGrid = gridType;
        return note;
    }

    /**
     * Quantizes an array of notes in-place or returns a newly quantized copy.
     * @param {Array<Object>} notes
     * @param {string} gridType
     * @param {number} bpm
     * @returns {Array<Object>}
     */
    quantizeNotes(notes, gridType = this.grid, bpm = this.bpm) {
        if (!Array.isArray(notes)) return [];

        for (const note of notes) {
            this.quantizeNote(note, gridType, bpm);
        }

        // Sort chronologically by quantized time, then by string
        notes.sort((a, b) => {
            if (Math.abs(a.time - b.time) < 0.001) {
                return a.string - b.string;
            }
            return a.time - b.time;
        });

        return notes;
    }

    /**
     * Captures a note-on event and handles prior note-off on the same string.
     * @param {Map<number, Object>} activeNotesMap - string => activeNote
     * @param {number} string - string index (1-6)
     * @param {Object} noteData - { fret, finger, noteName, midi, ... }
     * @param {number} currentTime - current raw audio timestamp in seconds
     * @returns {Object} the newly created note
     */
    captureNoteOn(activeNotesMap, string, noteData, currentTime) {
        // 1. If string is already ringing, close previous note
        if (activeNotesMap.has(string)) {
            const prev = activeNotesMap.get(string);
            prev.rawEndTime = currentTime;
            prev.rawDuration = Math.max(0.06, currentTime - prev.rawTime);
            if (this.liveQuantize && this.grid !== 'none') {
                prev.duration = this.quantizeDuration(prev.rawDuration, this.grid, this.bpm);
            } else {
                prev.duration = prev.rawDuration;
            }
            activeNotesMap.delete(string);
        }

        // 2. Create new note
        const rawTime = Math.max(0, currentTime);
        const defaultDur = this.getGridSeconds(this.grid, this.bpm) || 0.35;

        const newNote = {
            id: 'note_' + Math.random().toString(36).substr(2, 9),
            string: noteData.string || string,
            fret: noteData.fret,
            finger: noteData.finger || 0,
            noteName: noteData.noteName || '',
            midi: noteData.midi,
            rawTime: rawTime,
            rawDuration: defaultDur,
            rawEndTime: rawTime + defaultDur,
            time: (this.liveQuantize && this.grid !== 'none')
                ? this.quantizeTime(rawTime, this.grid, this.bpm)
                : rawTime,
            duration: (this.liveQuantize && this.grid !== 'none')
                ? this.quantizeDuration(defaultDur, this.grid, this.bpm)
                : defaultDur,
            color: noteData.color || '#38bdf8'
        };

        activeNotesMap.set(string, newNote);
        return newNote;
    }

    /**
     * Captures a note-off event on a given string.
     * @param {Map<number, Object>} activeNotesMap
     * @param {number} string
     * @param {number} currentTime
     * @returns {Object|null} finalized note or null
     */
    captureNoteOff(activeNotesMap, string, currentTime) {
        if (!activeNotesMap.has(string)) return null;

        const note = activeNotesMap.get(string);
        note.rawEndTime = currentTime;
        note.rawDuration = Math.max(0.06, currentTime - note.rawTime);

        if (this.liveQuantize && this.grid !== 'none') {
            note.duration = this.quantizeDuration(note.rawDuration, this.grid, this.bpm);
        } else {
            note.duration = note.rawDuration;
        }

        activeNotesMap.delete(string);
        return note;
    }
}

if (typeof module !== 'undefined') {
    module.exports = GuitarQuantizer;
}
