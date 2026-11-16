/**
 * Guitar Score Multi-Format Exporter
 * 
 * Generates:
 * 1. ASCII Tab: Standard formatted plaintext guitar tablature (strictly 80 chars wide per block with bar lines).
 * 2. Structured JSON: Full score metadata, measures, beats, and notes.
 * 3. MusicXML: Professional score-partwise XML with guitar TAB clef, tuning, and technical string/fret notations (compatible with Guitar Pro, MuseScore, TuxGuitar).
 * 4. MIDI File: Pure client-side binary Standard MIDI File (SMF Type 0) encoder with download triggering.
 */

class GuitarExporter {
    constructor(options = {}) {
        this.title = options.title || 'GuitarVision Studio Transcription';
        this.artist = options.artist || 'GuitarVision Studio';
        this.tuning = options.tuning || {
            name: 'Standard',
            strings: [64, 59, 55, 50, 45, 40], // E4, B3, G3, D3, A2, E2
            names: ["e", "B", "G", "D", "A", "E"]
        };
        this.bpm = options.bpm || 120;
        this.timeSignature = options.timeSignature || { numerator: 4, denominator: 4 };
        this.ppq = 480; // Pulses per quarter note for MIDI
    }

    /**
     * Resolves MIDI pitch for a note object.
     */
    resolveMidi(note) {
        if (typeof note.midi === 'number' && !isNaN(note.midi)) {
            return note.midi;
        }
        const strIdx = (note.string || 1) - 1;
        const openMidi = this.tuning.strings[strIdx] || 64;
        return openMidi + (note.fret || 0);
    }

    /**
     * Converts MIDI note number to MusicXML pitch information.
     */
    midiToMusicXMLPitch(midi) {
        const stepNames = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
        const alters =    [ 0,   1,   0,   1,   0,   0,   1,   0,   1,   0,   1,   0 ];

        const normalizedMidi = Math.max(0, Math.min(127, Math.round(midi)));
        const pitchClass = normalizedMidi % 12;
        const step = stepNames[pitchClass];
        const alter = alters[pitchClass];
        const octave = Math.floor(normalizedMidi / 12) - 1;

        return { step, alter, octave };
    }

    // =========================================================================
    // 1. ASCII Guitar Tablature (Strictly 80 Characters Wide Per Block)
    // =========================================================================

    /**
     * Generates standard plaintext guitar tablature.
     * Each block is strictly formatted to 80 characters width per line with bar lines.
     * 
     * Block layout:
     * Line width: exactly 80 characters.
     * e|-------------------------------------|-------------------------------------|
     * Prefix: 2 chars ("e|")
     * Measure 1: 38 chars
     * Bar line: 1 char ("|")
     * Measure 2: 38 chars
     * Closing bar: 1 char ("|")
     * Total = 2 + 38 + 1 + 38 + 1 = 80 chars!
     */
    toASCII(notes = [], bpm = this.bpm) {
        const secondsPerBeat = 60 / bpm;
        const secondsPerMeasure = secondsPerBeat * this.timeSignature.numerator;
        const secondsPerSixteenth = secondsPerBeat / 4;

        const maxNoteTime = notes.length > 0 
            ? Math.max(...notes.map(n => (n.time || 0) + (n.duration || 0.2))) 
            : secondsPerMeasure * 2;
        const totalMeasures = Math.max(2, Math.ceil(maxNoteTime / secondsPerMeasure));

        // Group notes by measure
        const measureNotes = Array.from({ length: totalMeasures }, () => []);
        for (const note of notes) {
            const time = Math.max(0, note.time || 0);
            const mIdx = Math.floor(time / secondsPerMeasure);
            if (mIdx < totalMeasures) {
                measureNotes[mIdx].push(note);
            }
        }

        let output = '';
        output += '================================================================================\n';
        output += `GUITARVISION STUDIO TABLATURE EXPORT`.padEnd(80, ' ') + '\n';
        const metaLine = `Tuning: ${this.tuning.name} (${this.tuning.names.join(' ')}) | Tempo: ${bpm} BPM | Time: ${this.timeSignature.numerator}/${this.timeSignature.denominator}`;
        output += metaLine.padEnd(80, ' ') + '\n';
        output += '================================================================================\n\n';

        // 2 measures per block
        for (let m = 0; m < totalMeasures; m += 2) {
            const m1 = m;
            const m2 = m + 1 < totalMeasures ? m + 1 : null;

            // Render Measure Header (80 characters)
            const m1Title = `M${m1 + 1} (1 . . . 2 . . . 3 . . . 4 . . . )`;
            const m2Title = m2 !== null ? `M${m2 + 1} (1 . . . 2 . . . 3 . . . 4 . . . )` : '';

            // Measure 1 header (38 chars)
            const m1HeaderContent = m1Title.padEnd(38, ' ');
            // Measure 2 header (38 chars)
            const m2HeaderContent = (m2 !== null ? m2Title : '').padEnd(38, ' ');
            
            const headerLine = `  |${m1HeaderContent}|${m2HeaderContent}|`;
            output += headerLine.slice(0, 80).padEnd(80, ' ') + '\n';

            // Generate measure 1 string lines (38 chars each)
            const m1Grid = this.buildAsciiMeasureGrid(measureNotes[m1] || [], m1 * secondsPerMeasure, secondsPerSixteenth);
            // Generate measure 2 string lines (38 chars each)
            const m2Grid = m2 !== null 
                ? this.buildAsciiMeasureGrid(measureNotes[m2] || [], m2 * secondsPerMeasure, secondsPerSixteenth)
                : Array(6).fill('--------------------------------------');

            // Construct 6 string lines for this block
            for (let s = 0; s < 6; s++) {
                const strPrefix = `${this.tuning.names[s]}|`; // 2 chars
                const seg1 = m1Grid[s]; // 38 chars
                const seg2 = m2Grid[s]; // 38 chars
                const fullLine = `${strPrefix}${seg1}|${seg2}|`; // 2 + 38 + 1 + 38 + 1 = 80 chars
                output += fullLine + '\n';
            }

            output += '\n';
        }

        return output;
    }

    /**
     * Builds a single measure grid of 6 strings, exactly 38 characters wide each.
     * Contains 16 sixteenth steps (2 chars each = 32 chars) + 6 padding chars = 38 chars.
     */
    buildAsciiMeasureGrid(measureNotes, measureStartTime, sixteenthDuration) {
        // 16 sixteenth slots per string, each slot is 2 chars: '--'
        const grid = Array.from({ length: 6 }, () => Array(16).fill('--'));

        for (const note of measureNotes) {
            const relTime = Math.max(0, (note.time || 0) - measureStartTime);
            const slot = Math.min(15, Math.max(0, Math.round(relTime / sixteenthDuration)));
            const strIdx = (note.string || 1) - 1;
            const fretStr = String(note.fret !== undefined ? note.fret : 0);

            if (fretStr.length === 1) {
                grid[strIdx][slot] = `${fretStr}-`;
            } else {
                grid[strIdx][slot] = fretStr.slice(0, 2);
            }
        }

        // Combine into 38-char strings:
        // Leading '--' (2 chars) + 16 slots * 2 chars (32 chars) + trailing '----' (4 chars) = 38 chars
        return grid.map(slots => `--${slots.join('')}----`);
    }

    // =========================================================================
    // 2. Structured JSON Score Export
    // =========================================================================

    /**
     * Exports structured score data with measures, beats, and notes.
     */
    toJSON(notes = [], bpm = this.bpm) {
        const secondsPerBeat = 60 / bpm;
        const secondsPerMeasure = secondsPerBeat * this.timeSignature.numerator;

        const sortedNotes = [...notes].sort((a, b) => (a.time || 0) - (b.time || 0));
        const maxTime = sortedNotes.length > 0 
            ? Math.max(...sortedNotes.map(n => (n.time || 0) + (n.duration || 0.35))) 
            : secondsPerMeasure;
        const numMeasures = Math.max(1, Math.ceil(maxTime / secondsPerMeasure));

        const measures = [];
        for (let m = 0; m < numMeasures; m++) {
            const mStart = m * secondsPerMeasure;
            const mEnd = (m + 1) * secondsPerMeasure;
            const mNotes = sortedNotes.filter(n => (n.time || 0) >= mStart && (n.time || 0) < mEnd);

            measures.push({
                measureNumber: m + 1,
                startTime: Math.round(mStart * 1000) / 1000,
                endTime: Math.round(mEnd * 1000) / 1000,
                notes: mNotes.map(n => ({
                    id: n.id,
                    string: n.string,
                    fret: n.fret,
                    finger: n.finger || 0,
                    midi: this.resolveMidi(n),
                    noteName: n.noteName,
                    time: Math.round((n.time || 0) * 1000) / 1000,
                    duration: Math.round((n.duration || 0.35) * 1000) / 1000,
                    velocity: n.velocity || 0.85
                }))
            });
        }

        const score = {
            generator: 'GuitarVision Studio',
            version: '2.0',
            exportedAt: new Date().toISOString(),
            metadata: {
                title: this.title,
                artist: this.artist,
                tempo: bpm,
                timeSignature: this.timeSignature,
                tuning: this.tuning
            },
            totalMeasures: numMeasures,
            totalNotes: sortedNotes.length,
            measures: measures,
            notes: sortedNotes.map(n => ({
                id: n.id,
                string: n.string,
                fret: n.fret,
                finger: n.finger || 0,
                midi: this.resolveMidi(n),
                noteName: n.noteName,
                time: Math.round((n.time || 0) * 1000) / 1000,
                duration: Math.round((n.duration || 0.35) * 1000) / 1000
            }))
        };

        return JSON.stringify(score, null, 2);
    }

    // =========================================================================
    // 3. MusicXML Export (Compatible with Guitar Pro, MuseScore, TuxGuitar)
    // =========================================================================

    /**
     * Generates a fully compliant MusicXML 3.1 Partwise XML document.
     */
    toMusicXML(notes = [], bpm = this.bpm) {
        const secondsPerBeat = 60 / bpm;
        const secondsPerMeasure = secondsPerBeat * this.timeSignature.numerator;
        const divisions = 4; // 4 divisions per quarter note (1 division = 16th note)

        const sortedNotes = [...notes].sort((a, b) => (a.time || 0) - (b.time || 0));
        const maxTime = sortedNotes.length > 0 
            ? Math.max(...sortedNotes.map(n => (n.time || 0) + (n.duration || 0.2))) 
            : secondsPerMeasure;
        const totalMeasures = Math.max(1, Math.ceil(maxTime / secondsPerMeasure));

        const currentDate = new Date().toISOString().slice(0, 10);

        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`;
        xml += `<score-partwise version="3.1">\n`;
        xml += `  <work>\n`;
        xml += `    <work-title>${this.escapeXML(this.title)}</work-title>\n`;
        xml += `  </work>\n`;
        xml += `  <identification>\n`;
        xml += `    <creator type="composer">${this.escapeXML(this.artist)}</creator>\n`;
        xml += `    <encoding>\n`;
        xml += `      <software>GuitarVision Studio Audio Transcriber</software>\n`;
        xml += `      <encoding-date>${currentDate}</encoding-date>\n`;
        xml += `    </encoding>\n`;
        xml += `  </identification>\n`;

        // Part List
        xml += `  <part-list>\n`;
        xml += `    <score-part id="P1">\n`;
        xml += `      <part-name>Guitar</part-name>\n`;
        xml += `      <part-abbreviation>Gtr.</part-abbreviation>\n`;
        xml += `      <score-instrument id="P1-I1">\n`;
        xml += `        <instrument-name>Acoustic Guitar (Steel)</instrument-name>\n`;
        xml += `      </score-instrument>\n`;
        xml += `      <midi-device id="P1-I1" port="1"></midi-device>\n`;
        xml += `      <midi-instrument id="P1-I1">\n`;
        xml += `        <midi-channel>1</midi-channel>\n`;
        xml += `        <midi-program>26</midi-program>\n`;
        xml += `      </midi-instrument>\n`;
        xml += `    </score-part>\n`;
        xml += `  </part-list>\n`;

        // Part details
        xml += `  <part id="P1">\n`;

        for (let m = 0; m < totalMeasures; m++) {
            const mNumber = m + 1;
            const mStart = m * secondsPerMeasure;
            const mEnd = (m + 1) * secondsPerMeasure;
            const mNotes = sortedNotes.filter(n => (n.time || 0) >= mStart && (n.time || 0) < mEnd);

            xml += `    <measure number="${mNumber}">\n`;

            // Attributes on first measure
            if (m === 0) {
                xml += `      <attributes>\n`;
                xml += `        <divisions>${divisions}</divisions>\n`;
                xml += `        <key>\n`;
                xml += `          <fifths>0</fifths>\n`;
                xml += `        </key>\n`;
                xml += `        <time>\n`;
                xml += `          <beats>${this.timeSignature.numerator}</beats>\n`;
                xml += `          <beat-type>${this.timeSignature.denominator}</beat-type>\n`;
                xml += `        </time>\n`;
                xml += `        <clef>\n`;
                xml += `          <sign>TAB</sign>\n`;
                xml += `          <line>5</line>\n`;
                xml += `        </clef>\n`;
                xml += `        <staff-details>\n`;
                xml += `          <staff-lines>6</staff-lines>\n`;
                
                // Guitar 6 strings tuning (1 is high e, 6 is low E)
                const tuningSteps = ["E", "B", "G", "D", "A", "E"];
                const tuningOctaves = [4, 3, 3, 3, 2, 2];
                for (let i = 0; i < 6; i++) {
                    xml += `          <staff-tuning line="${i + 1}">\n`;
                    xml += `            <tuning-step>${tuningSteps[i]}</tuning-step>\n`;
                    xml += `            <tuning-octave>${tuningOctaves[i]}</tuning-octave>\n`;
                    xml += `          </staff-tuning>\n`;
                }
                xml += `        </staff-details>\n`;
                xml += `      </attributes>\n`;

                // Metronome / Direction
                xml += `      <direction placement="above">\n`;
                xml += `        <direction-type>\n`;
                xml += `          <metronome>\n`;
                xml += `            <beat-unit>quarter</beat-unit>\n`;
                xml += `            <per-minute>${bpm}</per-minute>\n`;
                xml += `          </metronome>\n`;
                xml += `        </direction-type>\n`;
                xml += `        <sound tempo="${bpm}"/>\n`;
                xml += `      </direction>\n`;
            }

            if (mNotes.length === 0) {
                // Whole measure rest
                xml += `      <note>\n`;
                xml += `        <rest measure="yes"/>\n`;
                xml += `        <duration>${divisions * this.timeSignature.numerator}</duration>\n`;
                xml += `        <voice>1</voice>\n`;
                xml += `      </note>\n`;
            } else {
                // Render measure notes with technical tab notation
                let currentMeasureDiv = 0;
                const totalMeasureDivisions = divisions * this.timeSignature.numerator;

                for (let nIdx = 0; nIdx < mNotes.length; nIdx++) {
                    const note = mNotes[nIdx];
                    const relTime = Math.max(0, (note.time || 0) - mStart);
                    const noteDiv = Math.min(totalMeasureDivisions - 1, Math.round((relTime / secondsPerBeat) * divisions));

                    // Fill rest if there is a gap
                    if (noteDiv > currentMeasureDiv) {
                        const restDuration = noteDiv - currentMeasureDiv;
                        xml += `      <note>\n`;
                        xml += `        <rest/>\n`;
                        xml += `        <duration>${restDuration}</duration>\n`;
                        xml += `        <voice>1</voice>\n`;
                        xml += `      </note>\n`;
                        currentMeasureDiv = noteDiv;
                    }

                    const midi = this.resolveMidi(note);
                    const pitchInfo = this.midiToMusicXMLPitch(midi);
                    
                    const noteDurationDivs = Math.max(1, Math.round(((note.duration || 0.25) / secondsPerBeat) * divisions));
                    const actualDuration = Math.min(noteDurationDivs, totalMeasureDivisions - currentMeasureDiv);

                    xml += `      <note>\n`;
                    xml += `        <pitch>\n`;
                    xml += `          <step>${pitchInfo.step}</step>\n`;
                    if (pitchInfo.alter !== 0) {
                        xml += `          <alter>${pitchInfo.alter}</alter>\n`;
                    }
                    xml += `          <octave>${pitchInfo.octave}</octave>\n`;
                    xml += `        </pitch>\n`;
                    xml += `        <duration>${actualDuration}</duration>\n`;
                    xml += `        <voice>1</voice>\n`;
                    xml += `        <type>${this.durationToNoteType(actualDuration, divisions)}</type>\n`;
                    xml += `        <notations>\n`;
                    xml += `          <technical>\n`;
                    xml += `            <string>${note.string || 1}</string>\n`;
                    xml += `            <fret>${note.fret !== undefined ? note.fret : 0}</fret>\n`;
                    if (note.finger && note.finger > 0) {
                        xml += `            <fingering>${note.finger}</fingering>\n`;
                    }
                    xml += `          </technical>\n`;
                    xml += `        </notations>\n`;
                    xml += `      </note>\n`;

                    currentMeasureDiv += actualDuration;
                }

                // Fill trailing rest if measure has leftover space
                if (currentMeasureDiv < totalMeasureDivisions) {
                    const leftover = totalMeasureDivisions - currentMeasureDiv;
                    xml += `      <note>\n`;
                    xml += `        <rest/>\n`;
                    xml += `        <duration>${leftover}</duration>\n`;
                    xml += `        <voice>1</voice>\n`;
                    xml += `      </note>\n`;
                }
            }

            xml += `    </measure>\n`;
        }

        xml += `  </part>\n`;
        xml += `</score-partwise>\n`;
        return xml;
    }

    durationToNoteType(durDivisions, divisions) {
        const ratio = durDivisions / divisions;
        if (ratio >= 4.0) return 'whole';
        if (ratio >= 2.0) return 'half';
        if (ratio >= 1.0) return 'quarter';
        if (ratio >= 0.5) return 'eighth';
        return '16th';
    }

    escapeXML(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // =========================================================================
    // 4. MIDI File Encoder (Pure Client-Side Standard MIDI File Format 0)
    // =========================================================================

    /**
     * Encodes variable-length quantity (VLQ) for MIDI delta times.
     */
    encodeVLQ(value) {
        let val = Math.max(0, Math.round(value));
        const bytes = [val & 0x7F];
        while ((val >>= 7)) {
            bytes.unshift((val & 0x7F) | 0x80);
        }
        return bytes;
    }

    /**
     * Converts a 32-bit integer to 4 big-endian bytes.
     */
    uint32ToBytes(num) {
        return [
            (num >> 24) & 0xFF,
            (num >> 16) & 0xFF,
            (num >> 8) & 0xFF,
            num & 0xFF
        ];
    }

    /**
     * Converts a 16-bit integer to 2 big-endian bytes.
     */
    uint16ToBytes(num) {
        return [
            (num >> 8) & 0xFF,
            num & 0xFF
        ];
    }

    /**
     * Encodes recorded notes into a pure binary Standard MIDI File (SMF Type 0).
     * @param {Array<Object>} notes
     * @param {number} bpm
     * @returns {Uint8Array} binary MIDI file bytes
     */
    toMIDI(notes = [], bpm = this.bpm) {
        const ppq = this.ppq; // 480 ticks per beat
        const secondsPerBeat = 60 / bpm;
        const ticksPerSecond = ppq / secondsPerBeat;

        // Build list of MIDI events: Note-On and Note-Off with absolute tick timestamps
        const rawEvents = [];

        for (const note of notes) {
            const midi = Math.max(0, Math.min(127, this.resolveMidi(note)));
            const startTick = Math.max(0, Math.round((note.time || 0) * ticksPerSecond));
            const durationTicks = Math.max(1, Math.round((note.duration || 0.25) * ticksPerSecond));
            const endTick = startTick + durationTicks;
            const velocity = Math.max(1, Math.min(127, Math.round((note.velocity || 0.85) * 127)));

            // Note On
            rawEvents.push({
                tick: startTick,
                type: 0x90, // Note On
                data: [midi, velocity],
                order: 2 // If simultaneous, Note Off happens before Note On
            });

            // Note Off
            rawEvents.push({
                tick: endTick,
                type: 0x80, // Note Off
                data: [midi, 0x00],
                order: 1
            });
        }

        // Sort events chronologically, with Note-Off prioritized before Note-On on same tick
        rawEvents.sort((a, b) => {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return a.order - b.order;
        });

        // Construct Track Chunk (MTrk) payload
        const trackData = [];

        // 1. Meta Event: Time Signature (4/4) -> Delta: 0
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x58, 0x04, this.timeSignature.numerator, 0x02, 0x18, 0x08);

        // 2. Meta Event: Set Tempo -> Delta: 0
        // Microseconds per quarter note = 60,000,000 / BPM
        const usPerQuarter = Math.round(60000000 / bpm);
        trackData.push(...this.encodeVLQ(0));
        trackData.push(
            0xFF, 0x51, 0x03,
            (usPerQuarter >> 16) & 0xFF,
            (usPerQuarter >> 8) & 0xFF,
            usPerQuarter & 0xFF
        );

        // 3. Meta Event: Track Name -> Delta: 0
        const trackName = "GuitarVision Tablature";
        const nameBytes = Array.from(trackName).map(c => c.charCodeAt(0));
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x03, nameBytes.length, ...nameBytes);

        // 4. Program Change: Acoustic Guitar (Steel = Program 25, 0-indexed: 25)
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xC0, 25);

        // 5. Append Note Events with delta times
        let lastTick = 0;
        for (const ev of rawEvents) {
            const deltaTicks = Math.max(0, ev.tick - lastTick);
            trackData.push(...this.encodeVLQ(deltaTicks));
            trackData.push(ev.type, ...ev.data);
            lastTick = ev.tick;
        }

        // 6. Meta Event: End of Track -> Delta: 0
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x2F, 0x00);

        // =====================================================================
        // Assemble Full MIDI File (MThd + MTrk)
        // =====================================================================
        const fileBytes = [];

        // Header Chunk: 'MThd' (4 bytes)
        fileBytes.push(0x4D, 0x54, 0x68, 0x64);
        // Header Length: 6 (4 bytes)
        fileBytes.push(...this.uint32ToBytes(6));
        // Format: 0 (single track multi-channel) (2 bytes)
        fileBytes.push(...this.uint16ToBytes(0));
        // Tracks: 1 (2 bytes)
        fileBytes.push(...this.uint16ToBytes(1));
        // Division: 480 PPQ (2 bytes)
        fileBytes.push(...this.uint16ToBytes(ppq));

        // Track Chunk: 'MTrk' (4 bytes)
        fileBytes.push(0x4D, 0x54, 0x72, 0x6B);
        // Track Length (4 bytes)
        fileBytes.push(...this.uint32ToBytes(trackData.length));
        // Track Events
        fileBytes.push(...trackData);

        return new Uint8Array(fileBytes);
    }

    /**
     * Browser helper to trigger download of MIDI file.
     */
    downloadMIDI(notes, bpm = this.bpm, filename = 'guitar_transcription.mid') {
        const midiBytes = this.toMIDI(notes, bpm);
        const blob = new Blob([midiBytes], { type: 'audio/midi' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    /**
     * Browser helper to trigger text/xml/json download.
     */
    downloadTextFile(content, mimeType, filename) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
}

if (typeof module !== 'undefined') {
    module.exports = GuitarExporter;
}
