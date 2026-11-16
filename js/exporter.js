/**
 * Guitar Score Multi-Format Exporter
 * 
 * Generates:
 * 1. ASCII Tab: Standard formatted plaintext guitar tablature (strictly 80 chars wide per block with bar lines).
 * 2. Structured JSON: Full score metadata, measures, beats, and notes.
 * 3. MusicXML 4.0: Professional W3C MusicXML 4.0 score-partwise XML with guitar TAB clef,
 *    tuning metadata (<staff-tuning>), meter, tempo, chord symbols (<harmony>), and technical string/fret notations.
 * 4. Multi-Track MIDI File: Pure client-side binary Standard MIDI File (SMF Type 0 and Type 1)
 *    encoder with dynamic velocity, tempo meta-events, and multi-track conductor/instrument separation.
 */

class GuitarExporter {
    constructor(options = {}) {
        this.title = options.title || 'GuitarVision Studio Transcription';
        this.artist = options.artist || 'GuitarVision Studio';
        this.tuning = options.tuning || {
            name: 'Standard',
            strings: [64, 59, 55, 50, 45, 40], // E4, B3, G3, D3, A2, E2 (strings 1 to 6)
            names: ["e", "B", "G", "D", "A", "E"]
        };
        this.bpm = options.bpm || 120;
        this.timeSignature = options.timeSignature || { numerator: 4, denominator: 4 };
        this.ppq = options.ppq || 480; // Pulses per quarter note for MIDI
        this.musicXMLVersion = options.musicXMLVersion || '4.0';
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

    /**
     * Resolves note dynamic velocity (clamped 1-127).
     * Supports both normalized float (0.0 - 1.0) and raw integer (1 - 127).
     */
    resolveVelocity(note) {
        if (typeof note.velocity === 'number' && !isNaN(note.velocity)) {
            if (note.velocity <= 1.0 && note.velocity > 0) {
                return Math.max(1, Math.min(127, Math.round(note.velocity * 127)));
            }
            return Math.max(1, Math.min(127, Math.round(note.velocity)));
        }
        return 100; // Default standard dynamic velocity (mezzo-forte)
    }

    // =========================================================================
    // 1. ASCII Guitar Tablature (Strictly 80 Characters Wide Per Block)
    // =========================================================================

    /**
     * Generates standard plaintext guitar tablature.
     * Each block is strictly formatted to 80 characters width per line with bar lines.
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
     */
    buildAsciiMeasureGrid(measureNotes, measureStartTime, sixteenthDuration) {
        const grid = Array.from({ length: 6 }, () => Array(16).fill('--'));

        for (const note of measureNotes) {
            const relTime = Math.max(0, (note.time || 0) - measureStartTime);
            const slot = Math.min(15, Math.max(0, Math.round(relTime / sixteenthDuration)));
            const strIdx = (note.string || 1) - 1;
            const fretStr = String(note.fret !== undefined ? note.fret : 0);

            if (strIdx >= 0 && strIdx < 6) {
                if (fretStr.length === 1) {
                    grid[strIdx][slot] = `${fretStr}-`;
                } else {
                    grid[strIdx][slot] = fretStr.slice(0, 2);
                }
            }
        }

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
                    velocity: this.resolveVelocity(n) / 127
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
                duration: Math.round((n.duration || 0.35) * 1000) / 1000,
                velocity: this.resolveVelocity(n) / 127
            }))
        };

        return JSON.stringify(score, null, 2);
    }

    // =========================================================================
    // 3. MusicXML 4.0 Guitar Tablature Export
    // =========================================================================

    /**
     * Parses standard chord name strings into MusicXML <harmony> structure.
     * Examples: 'C', 'Am', 'G7', 'Fmaj7', 'Am7', 'Dsus2', 'Bdim', 'E/G#', 'Bb7'
     * @param {string} chordName
     * @returns {Object}
     */
    parseChordSymbol(chordName) {
        if (!chordName || typeof chordName !== 'string') return null;

        const str = chordName.trim();
        // Regex: (Root note A-G)(Accidental #|b)?(Quality)?(Slash bass)?
        const match = str.match(/^([A-G])([#b])?(.*?)(?:\/([A-G])([#b])?)?$/);
        if (!match) {
            return {
                rootStep: 'C',
                rootAlter: 0,
                kind: 'major',
                text: str
            };
        }

        const [, rootStep, rootAcc, rawQuality, bassStep, bassAcc] = match;
        const rootAlter = rootAcc === '#' ? 1 : rootAcc === 'b' ? -1 : 0;
        const bassAlter = bassAcc === '#' ? 1 : bassAcc === 'b' ? -1 : 0;
        const quality = (rawQuality || '').trim();

        let kind = 'major';
        let text = quality;

        if (quality === '' || quality === 'maj' || quality === 'M') {
            kind = 'major';
            text = '';
        } else if (quality === 'm' || quality === 'min') {
            kind = 'minor';
            text = 'm';
        } else if (quality === '7' || quality === 'dom7') {
            kind = 'dominant';
            text = '7';
        } else if (quality === 'maj7' || quality === 'M7') {
            kind = 'major-seventh';
            text = 'maj7';
        } else if (quality === 'm7' || quality === 'min7') {
            kind = 'minor-seventh';
            text = 'm7';
        } else if (quality === 'sus2') {
            kind = 'suspended-second';
            text = 'sus2';
        } else if (quality === 'sus4' || quality === 'sus') {
            kind = 'suspended-fourth';
            text = 'sus4';
        } else if (quality === 'dim' || quality === 'o') {
            kind = 'diminished';
            text = 'dim';
        } else if (quality === 'dim7' || quality === 'o7') {
            kind = 'diminished-seventh';
            text = 'dim7';
        } else if (quality === 'm7b5' || quality === 'half-dim') {
            kind = 'half-diminished';
            text = 'm7b5';
        } else if (quality === 'aug' || quality === '+') {
            kind = 'augmented';
            text = 'aug';
        } else if (quality === '5') {
            kind = 'power';
            text = '5';
        } else {
            kind = 'other';
            text = quality;
        }

        return {
            rootStep,
            rootAlter,
            kind,
            text,
            bassStep: bassStep || null,
            bassAlter: bassStep ? bassAlter : 0
        };
    }

    /**
     * Formats MusicXML <harmony> element for chord symbols.
     */
    formatHarmonyXML(chordInfo, indent = '      ') {
        if (!chordInfo) return '';
        let xml = `${indent}<harmony print-frame="no">\n`;
        xml += `${indent}  <root>\n`;
        xml += `${indent}    <root-step>${chordInfo.rootStep}</root-step>\n`;
        if (chordInfo.rootAlter !== 0) {
            xml += `${indent}    <root-alter>${chordInfo.rootAlter}</root-alter>\n`;
        }
        xml += `${indent}  </root>\n`;
        xml += `${indent}  <kind text="${this.escapeXML(chordInfo.text)}">${chordInfo.kind}</kind>\n`;

        if (chordInfo.bassStep) {
            xml += `${indent}  <bass>\n`;
            xml += `${indent}    <bass-step>${chordInfo.bassStep}</bass-step>\n`;
            if (chordInfo.bassAlter !== 0) {
                xml += `${indent}    <bass-alter>${chordInfo.bassAlter}</bass-alter>\n`;
            }
            xml += `${indent}  </bass>\n`;
        }
        xml += `${indent}</harmony>\n`;
        return xml;
    }

    /**
     * Generates a fully compliant MusicXML 4.0 Partwise XML document.
     * Includes guitar TAB clef, tuning metadata (<staff-tuning>), meter, tempo, chord symbols (<harmony>),
     * and technical <string> and <fret> elements for every note.
     * 
     * @param {Array<Object>} notes Captured tablature notes
     * @param {number} bpm Tempo in BPM
     * @param {Object} options Configuration overrides (e.g. version, chords)
     * @returns {string} XML string
     */
    toMusicXML(notes = [], bpm = this.bpm, options = {}) {
        const xmlVersion = options.version || this.musicXMLVersion || '4.0';
        const secondsPerBeat = 60 / bpm;
        const secondsPerMeasure = secondsPerBeat * this.timeSignature.numerator;
        const divisions = options.divisions || 4; // 4 divisions per quarter note (16th note resolution)

        const sortedNotes = [...notes].sort((a, b) => {
            if (Math.abs((a.time || 0) - (b.time || 0)) > 0.001) {
                return (a.time || 0) - (b.time || 0);
            }
            return (a.string || 1) - (b.string || 1);
        });

        const maxTime = sortedNotes.length > 0 
            ? Math.max(...sortedNotes.map(n => (n.time || 0) + (n.duration || 0.2))) 
            : secondsPerMeasure;
        const totalMeasures = Math.max(1, Math.ceil(maxTime / secondsPerMeasure));
        const currentDate = new Date().toISOString().slice(0, 10);

        // MusicXML DOCTYPE header
        let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
        if (xmlVersion === '3.1') {
            xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`;
            xml += `<score-partwise version="3.1">\n`;
        } else {
            xml += `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n`;
            xml += `<score-partwise version="4.0">\n`;
        }

        // Work metadata
        xml += `  <work>\n`;
        xml += `    <work-title>${this.escapeXML(this.title)}</work-title>\n`;
        xml += `  </work>\n`;

        // Identification & encoding
        xml += `  <identification>\n`;
        xml += `    <creator type="composer">${this.escapeXML(this.artist)}</creator>\n`;
        xml += `    <encoding>\n`;
        xml += `      <software>GuitarVision Studio Audio Transcriber</software>\n`;
        xml += `      <encoding-date>${currentDate}</encoding-date>\n`;
        xml += `      <supports element="accidental" type="yes"/>\n`;
        xml += `      <supports element="beam" type="yes"/>\n`;
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

        // Part Body
        xml += `  <part id="P1">\n`;

        // Collect custom chord annotations if passed via options
        const chordsList = Array.isArray(options.chords) ? options.chords : [];

        for (let m = 0; m < totalMeasures; m++) {
            const mNumber = m + 1;
            const mStart = m * secondsPerMeasure;
            const mEnd = (m + 1) * secondsPerMeasure;
            const mNotes = sortedNotes.filter(n => (n.time || 0) >= mStart && (n.time || 0) < mEnd);

            xml += `    <measure number="${mNumber}">\n`;

            // Attributes block (Measure 1)
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
                xml += `          <staff-lines>${this.tuning.strings.length || 6}</staff-lines>\n`;

                // Standard and custom tuning metadata (<staff-tuning>)
                // String 1 is highest pitch (line 1), string 6 is lowest pitch (line 6)
                for (let i = 0; i < this.tuning.strings.length; i++) {
                    const stringMidi = this.tuning.strings[i];
                    const pitchInfo = this.midiToMusicXMLPitch(stringMidi);
                    xml += `          <staff-tuning line="${i + 1}">\n`;
                    xml += `            <tuning-step>${pitchInfo.step}</tuning-step>\n`;
                    if (pitchInfo.alter !== 0) {
                        xml += `            <tuning-alter>${pitchInfo.alter}</tuning-alter>\n`;
                    }
                    xml += `            <tuning-octave>${pitchInfo.octave}</tuning-octave>\n`;
                    xml += `          </staff-tuning>\n`;
                }
                xml += `        </staff-details>\n`;
                xml += `      </attributes>\n`;

                // Metronome and Tempo direction
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

            // Check if measure has measure-level chord from options
            const measureChords = chordsList.filter(c => {
                if (c.measure === mNumber) return true;
                if (typeof c.time === 'number') {
                    return c.time >= mStart && c.time < mEnd;
                }
                return false;
            });

            // Pending chords for this measure sorted by time
            const pendingChords = [...measureChords].sort((a, b) => {
                const ta = typeof a.time === 'number' ? a.time : mStart;
                const tb = typeof b.time === 'number' ? b.time : mStart;
                return ta - tb;
            });

            const emitPendingChordsBefore = (targetTime) => {
                let chordXml = '';
                while (pendingChords.length > 0) {
                    const nextChord = pendingChords[0];
                    const chordTime = typeof nextChord.time === 'number' ? nextChord.time : mStart;
                    if (chordTime <= targetTime + 0.02) {
                        pendingChords.shift();
                        const parsedChord = this.parseChordSymbol(nextChord.chord || nextChord.name);
                        if (parsedChord) {
                            chordXml += this.formatHarmonyXML(parsedChord, '      ');
                        }
                    } else {
                        break;
                    }
                }
                return chordXml;
            };

            // If empty measure -> whole measure rest
            if (mNotes.length === 0) {
                // Render any chord symbols on empty measure
                xml += emitPendingChordsBefore(mEnd);
                xml += `      <note>\n`;
                xml += `        <rest measure="yes"/>\n`;
                xml += `        <duration>${divisions * this.timeSignature.numerator}</duration>\n`;
                xml += `        <voice>1</voice>\n`;
                xml += `      </note>\n`;
            } else {
                let currentMeasureDiv = 0;
                const totalMeasureDivisions = divisions * this.timeSignature.numerator;
                let lastNoteTime = -1;

                for (let nIdx = 0; nIdx < mNotes.length; nIdx++) {
                    const note = mNotes[nIdx];
                    const noteTime = note.time !== undefined ? note.time : mStart;
                    const relTime = Math.max(0, noteTime - mStart);
                    const noteDiv = Math.min(totalMeasureDivisions - 1, Math.round((relTime / secondsPerBeat) * divisions));
                    const isSimultaneousChordNote = Math.abs(relTime - lastNoteTime) < 0.015 && lastNoteTime >= 0;

                    // Emit any scheduled chords whose time has arrived
                    xml += emitPendingChordsBefore(noteTime);

                    // Also emit chord directly attached to note if not already emitted
                    if (note.chord && !isSimultaneousChordNote) {
                        const parsedChord = this.parseChordSymbol(note.chord);
                        xml += this.formatHarmonyXML(parsedChord, '      ');
                    }

                    // Fill rest if there is a gap before a new note
                    if (!isSimultaneousChordNote && noteDiv > currentMeasureDiv) {
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
                    if (isSimultaneousChordNote) {
                        xml += `        <chord/>\n`;
                    }
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

                    if (!isSimultaneousChordNote) {
                        currentMeasureDiv += actualDuration;
                        lastNoteTime = relTime;
                    }
                }

                // Emit any remaining pending chords before trailing rest
                xml += emitPendingChordsBefore(mEnd);

                // Fill trailing rest if measure has leftover divisions
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
    // 4. MIDI File Encoder (Standard MIDI File SMF Type 0 & Type 1 Multi-Track)
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
     * Builds raw chronological Note-On and Note-Off events from note list.
     */
    buildNoteEvents(notes, ticksPerSecond, channel = 0) {
        const rawEvents = [];

        for (const note of notes) {
            const midi = Math.max(0, Math.min(127, this.resolveMidi(note)));
            const startTick = Math.max(0, Math.round((note.time || 0) * ticksPerSecond));
            const durationTicks = Math.max(1, Math.round((note.duration || 0.25) * ticksPerSecond));
            const endTick = startTick + durationTicks;
            const velocity = this.resolveVelocity(note);

            // Note On
            rawEvents.push({
                tick: startTick,
                status: 0x90 | (channel & 0x0F),
                data: [midi, velocity],
                order: 2 // On same tick, Note-Off takes precedence
            });

            // Note Off
            rawEvents.push({
                tick: endTick,
                status: 0x80 | (channel & 0x0F),
                data: [midi, 0x00],
                order: 1
            });
        }

        rawEvents.sort((a, b) => {
            if (a.tick !== b.tick) return a.tick - b.tick;
            return a.order - b.order;
        });

        return rawEvents;
    }

    /**
     * Assembles a single MTrk byte payload from an array of delta-encoded events.
     */
    buildTrackChunk(trackData) {
        const chunk = [];
        // Chunk ID 'MTrk'
        chunk.push(0x4D, 0x54, 0x72, 0x6B);
        // Chunk length
        chunk.push(...this.uint32ToBytes(trackData.length));
        // Track events
        chunk.push(...trackData);
        return chunk;
    }

    /**
     * Builds the Tempo and Time Signature meta events track chunk (for Type 1 Conductor Track).
     */
    buildConductorTrack(bpm, ticksPerSecond, tempoEvents = []) {
        const trackData = [];

        // 1. Time Signature meta-event (delta 0)
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x58, 0x04, this.timeSignature.numerator, 0x02, 0x18, 0x08);

        // 2. Track Name meta-event: "Conductor / Tempo Track"
        const trackName = `${this.title} (Tempo)`;
        const nameBytes = Array.from(trackName).map(c => c.charCodeAt(0));
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x03, nameBytes.length, ...nameBytes);

        // 3. Tempo events
        if (tempoEvents.length > 0) {
            let lastTick = 0;
            const sortedTempos = [...tempoEvents].sort((a, b) => (a.time || 0) - (b.time || 0));
            for (const t of sortedTempos) {
                const tick = Math.max(0, Math.round((t.time || 0) * ticksPerSecond));
                const delta = Math.max(0, tick - lastTick);
                const targetBpm = t.bpm || bpm;
                const usPerQuarter = Math.round(60000000 / targetBpm);
                trackData.push(...this.encodeVLQ(delta));
                trackData.push(
                    0xFF, 0x51, 0x03,
                    (usPerQuarter >> 16) & 0xFF,
                    (usPerQuarter >> 8) & 0xFF,
                    usPerQuarter & 0xFF
                );
                lastTick = tick;
            }
        } else {
            // Initial tempo event
            const usPerQuarter = Math.round(60000000 / bpm);
            trackData.push(...this.encodeVLQ(0));
            trackData.push(
                0xFF, 0x51, 0x03,
                (usPerQuarter >> 16) & 0xFF,
                (usPerQuarter >> 8) & 0xFF,
                usPerQuarter & 0xFF
            );
        }

        // 4. End of Track meta-event (FF 2F 00)
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x2F, 0x00);

        return trackData;
    }

    /**
     * Builds an instrument track chunk with track name, program change, and note events.
     */
    buildInstrumentTrack(trackName, program, channel, notes, ticksPerSecond) {
        const trackData = [];

        // 1. Track Name meta-event
        const nameBytes = Array.from(trackName).map(c => c.charCodeAt(0));
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x03, nameBytes.length, ...nameBytes);

        // 2. Program Change event (0xC0 | channel, program)
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xC0 | (channel & 0x0F), program & 0x7F);

        // 3. Note events with delta times and dynamic velocities
        const rawEvents = this.buildNoteEvents(notes, ticksPerSecond, channel);
        let lastTick = 0;
        for (const ev of rawEvents) {
            const deltaTicks = Math.max(0, ev.tick - lastTick);
            trackData.push(...this.encodeVLQ(deltaTicks));
            trackData.push(ev.status, ...ev.data);
            lastTick = ev.tick;
        }

        // 4. End of Track meta-event
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x2F, 0x00);

        return trackData;
    }

    /**
     * Encodes recorded notes into a pure binary Standard MIDI File (SMF Type 0 or Type 1).
     * 
     * @param {Array<Object>} notes Tablature notes
     * @param {number} bpm Tempo in BPM
     * @param {Object} options Configuration options:
     *   - format: 0 (Type 0 single-track) or 1 (Type 1 multi-track). Default: 0.
     *   - splitByString: If true in Type 1, splits 6 guitar strings into 6 separate tracks.
     *   - tempos: Array of dynamic tempo changes [{ time: seconds, bpm: number }]
     *   - trackName: Custom track name
     *   - program: MIDI program number (default: 25 for Acoustic Guitar Steel)
     * @returns {Uint8Array} binary MIDI file bytes
     */
    toMIDI(notes = [], bpm = this.bpm, options = {}) {
        const ppq = this.ppq; // 480 ticks per beat
        const secondsPerBeat = 60 / bpm;
        const ticksPerSecond = ppq / secondsPerBeat;
        const isType1 = options.format === 1 || options.multiTrack === true;
        const program = typeof options.program === 'number' ? options.program : 25; // 25 = Acoustic Guitar (Steel)

        // =====================================================================
        // SMF Type 1: Multi-Track Mode
        // =====================================================================
        if (isType1) {
            const trackPayloads = [];

            // Track 0: Conductor Track (Tempo & Meter)
            const conductorData = this.buildConductorTrack(bpm, ticksPerSecond, options.tempos || []);
            trackPayloads.push(conductorData);

            if (options.splitByString) {
                // Separate track per guitar string (Strings 1 to 6)
                for (let s = 1; s <= 6; s++) {
                    const stringNotes = notes.filter(n => (n.string || 1) === s);
                    const stringName = this.tuning.names[s - 1] || `Str ${s}`;
                    const strTrackData = this.buildInstrumentTrack(
                        `String ${s} (${stringName})`,
                        program,
                        s - 1, // Channel per string (0..5)
                        stringNotes,
                        ticksPerSecond
                    );
                    trackPayloads.push(strTrackData);
                }
            } else if (Array.isArray(options.tracks) && options.tracks.length > 0) {
                // User provided explicit track definitions
                for (let tIdx = 0; tIdx < options.tracks.length; tIdx++) {
                    const t = options.tracks[tIdx];
                    const tNotes = t.notes || [];
                    const tName = t.name || `Track ${tIdx + 1}`;
                    const tProg = typeof t.program === 'number' ? t.program : program;
                    const tChan = typeof t.channel === 'number' ? t.channel : (tIdx % 16);
                    trackPayloads.push(this.buildInstrumentTrack(tName, tProg, tChan, tNotes, ticksPerSecond));
                }
            } else {
                // Standard Type 1 with Guitar Track
                const guitarTrackData = this.buildInstrumentTrack(
                    options.trackName || "Guitar Tablature",
                    program,
                    0,
                    notes,
                    ticksPerSecond
                );
                trackPayloads.push(guitarTrackData);
            }

            // Assemble Full Type 1 MIDI File
            const fileBytes = [];
            // Header Chunk 'MThd'
            fileBytes.push(0x4D, 0x54, 0x68, 0x64);
            fileBytes.push(...this.uint32ToBytes(6)); // Header length
            fileBytes.push(...this.uint16ToBytes(1)); // Format 1 (Multi-Track)
            fileBytes.push(...this.uint16ToBytes(trackPayloads.length)); // Track count
            fileBytes.push(...this.uint16ToBytes(ppq)); // Division

            // Append each track chunk
            for (const tData of trackPayloads) {
                fileBytes.push(...this.buildTrackChunk(tData));
            }

            return new Uint8Array(fileBytes);
        }

        // =====================================================================
        // SMF Type 0: Single Track Multi-Channel Mode
        // =====================================================================
        const trackData = [];

        // 1. Meta Event: Time Signature
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x58, 0x04, this.timeSignature.numerator, 0x02, 0x18, 0x08);

        // 2. Meta Event: Set Tempo
        const usPerQuarter = Math.round(60000000 / bpm);
        trackData.push(...this.encodeVLQ(0));
        trackData.push(
            0xFF, 0x51, 0x03,
            (usPerQuarter >> 16) & 0xFF,
            (usPerQuarter >> 8) & 0xFF,
            usPerQuarter & 0xFF
        );

        // Dynamic tempo changes if provided
        if (Array.isArray(options.tempos) && options.tempos.length > 0) {
            let lastTempoTick = 0;
            for (const t of options.tempos) {
                const tick = Math.max(0, Math.round((t.time || 0) * ticksPerSecond));
                if (tick > 0) {
                    const delta = tick - lastTempoTick;
                    const tempoUs = Math.round(60000000 / (t.bpm || bpm));
                    trackData.push(...this.encodeVLQ(delta));
                    trackData.push(
                        0xFF, 0x51, 0x03,
                        (tempoUs >> 16) & 0xFF,
                        (tempoUs >> 8) & 0xFF,
                        tempoUs & 0xFF
                    );
                    lastTempoTick = tick;
                }
            }
        }

        // 3. Meta Event: Track Name
        const trackName = options.trackName || "GuitarVision Tablature";
        const nameBytes = Array.from(trackName).map(c => c.charCodeAt(0));
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x03, nameBytes.length, ...nameBytes);

        // 4. Program Change: Acoustic Guitar (Steel = Program 25)
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xC0, program & 0x7F);

        // 5. Append Note Events with delta times and dynamic velocities
        const rawEvents = this.buildNoteEvents(notes, ticksPerSecond, 0);
        let lastTick = 0;
        for (const ev of rawEvents) {
            const deltaTicks = Math.max(0, ev.tick - lastTick);
            trackData.push(...this.encodeVLQ(deltaTicks));
            trackData.push(ev.status, ...ev.data);
            lastTick = ev.tick;
        }

        // 6. Meta Event: End of Track
        trackData.push(...this.encodeVLQ(0));
        trackData.push(0xFF, 0x2F, 0x00);

        // Assemble Full MIDI File (MThd + MTrk)
        const fileBytes = [];
        fileBytes.push(0x4D, 0x54, 0x68, 0x64);
        fileBytes.push(...this.uint32ToBytes(6));
        fileBytes.push(...this.uint16ToBytes(0)); // Format 0
        fileBytes.push(...this.uint16ToBytes(1)); // 1 track
        fileBytes.push(...this.uint16ToBytes(ppq));

        fileBytes.push(...this.buildTrackChunk(trackData));

        return new Uint8Array(fileBytes);
    }

    /**
     * Dedicated convenience method to generate multi-track Type 1 MIDI files.
     */
    toMultiTrackMIDI(notes = [], bpm = this.bpm, options = {}) {
        return this.toMIDI(notes, bpm, { ...options, format: 1 });
    }

    /**
     * Browser helper to trigger download of MIDI file.
     */
    downloadMIDI(notes, bpm = this.bpm, filename = 'guitar_transcription.mid', options = {}) {
        const midiBytes = this.toMIDI(notes, bpm, options);
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
