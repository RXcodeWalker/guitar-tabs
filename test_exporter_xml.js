/**
 * Verification Test Suite for MusicXML 4.0 Tablature Exporter,
 * Multi-Track MIDI Engine, and Offline Storage Vault (IndexedDB)
 */

const GuitarExporter = require('./js/exporter.js');
const { GuitarVault, STORES } = require('./js/storage.js');

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

/**
 * Basic XML Well-Formedness Checker:
 * Validates that all non-self-closing tags are properly nested and closed.
 */
function validateXmlWellFormedness(xmlString) {
    // Remove XML declaration and DOCTYPE for tag hierarchy matching
    let stripped = xmlString
        .replace(/<\?xml[^>]*\?>/gi, '')
        .replace(/<!DOCTYPE[^>]*>/gi, '')
        .trim();

    const tagRegex = /<(\/)?([a-zA-Z0-9_\-]+)([^>]*)>/g;
    const stack = [];
    let match;

    while ((match = tagRegex.exec(stripped)) !== null) {
        const isClosing = match[1] === '/';
        const tagName = match[2];
        const rawTag = match[0];
        const isSelfClosing = rawTag.endsWith('/>');

        if (isSelfClosing) {
            continue;
        }

        if (isClosing) {
            if (stack.length === 0) {
                return { valid: false, error: `Unexpected closing tag </${tagName}> without opening tag.` };
            }
            const expected = stack.pop();
            if (expected !== tagName) {
                return { valid: false, error: `Mismatched tags: expected </${expected}>, got </${tagName}>.` };
            }
        } else {
            stack.push(tagName);
        }
    }

    if (stack.length > 0) {
        return { valid: false, error: `Unclosed tag: <${stack[stack.length - 1]}>.` };
    }

    return { valid: true };
}

async function runTests() {
    console.log("================================================================================");
    console.log("TEST SUITE: MUSICXML 4.0 EXPORTER, MULTI-TRACK MIDI & STORAGE VAULT");
    console.log("================================================================================\n");

    // =========================================================================
    // SECTION 1: MusicXML 4.0 Tablature Structure & Standards Compliance
    // =========================================================================
    console.log("--- Section 1: MusicXML 4.0 Tablature Structure & Validation ---");

    const standardExporter = new GuitarExporter({
        title: 'Antigravity Test Suite Solo',
        artist: 'Antigravity Architect',
        bpm: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        tuning: {
            name: 'Standard',
            strings: [64, 59, 55, 50, 45, 40], // e4, B3, G3, D3, A2, E2
            names: ["e", "B", "G", "D", "A", "E"]
        }
    });

    const sampleTabNotes = [
        { string: 6, fret: 0, time: 0.0, duration: 0.5, velocity: 0.9, chord: 'E5' },
        { string: 5, fret: 2, time: 0.5, duration: 0.5, velocity: 0.8 },
        { string: 4, fret: 2, time: 1.0, duration: 0.5, velocity: 0.85 },
        { string: 3, fret: 1, time: 1.5, duration: 0.5, velocity: 0.75, chord: 'E' },
        // Chord on beat 2.0 (strings 1, 2, 3 simultaneously)
        { string: 3, fret: 1, time: 2.0, duration: 1.0, velocity: 0.9, chord: 'E' },
        { string: 2, fret: 0, time: 2.0, duration: 1.0, velocity: 0.9 },
        { string: 1, fret: 0, time: 2.0, duration: 1.0, velocity: 0.9 },
        // High lead note in measure 2
        { string: 1, fret: 12, finger: 3, time: 2.5, duration: 0.5, velocity: 1.0 }
    ];

    const xml4 = standardExporter.toMusicXML(sampleTabNotes, 120);

    // 1.1 Header & DOCTYPE
    assert(xml4.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "MusicXML starts with valid XML declaration");
    assert(xml4.includes('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"'), "MusicXML includes official MusicXML 4.0 DOCTYPE");
    assert(xml4.includes('<score-partwise version="4.0">'), "MusicXML root element specifies version 4.0");
    assert(xml4.includes('</score-partwise>'), "MusicXML properly closes score-partwise root tag");

    // 1.2 XML Well-Formedness
    const wellFormedCheck = validateXmlWellFormedness(xml4);
    assert(wellFormedCheck.valid, `MusicXML passes XML tag nesting and well-formedness: ${wellFormedCheck.error || 'OK'}`);

    // 1.3 Identification & Metadata
    assert(xml4.includes('<work-title>Antigravity Test Suite Solo</work-title>'), "Score metadata contains work title");
    assert(xml4.includes('<creator type="composer">Antigravity Architect</creator>'), "Score metadata contains composer artist");
    assert(xml4.includes('<software>GuitarVision Studio Audio Transcriber</software>'), "Score contains software identification");

    // 1.4 Clef & Staff Details
    assert(xml4.includes('<sign>TAB</sign>'), "Attributes specify TAB clef");
    assert(xml4.includes('<line>5</line>'), "Clef defines 5-line / 6-string TAB clef");
    assert(xml4.includes('<staff-lines>6</staff-lines>'), "Staff-details defines 6 guitar strings");

    // 1.5 Tuning Metadata (<staff-tuning>)
    assert(xml4.includes('<staff-tuning line="1">'), "Staff tuning includes string line 1 (High E)");
    assert(xml4.includes('<staff-tuning line="6">'), "Staff tuning includes string line 6 (Low E)");
    assert(xml4.includes('<tuning-step>E</tuning-step>') && xml4.includes('<tuning-octave>4</tuning-octave>'), "Tuning encodes E4 for high string");
    assert(xml4.includes('<tuning-step>E</tuning-step>') && xml4.includes('<tuning-octave>2</tuning-octave>'), "Tuning encodes E2 for low string");

    // 1.6 Meter & Tempo
    assert(xml4.includes('<beats>4</beats>') && xml4.includes('<beat-type>4</beat-type>'), "Time signature specifies 4/4 meter");
    assert(xml4.includes('<beat-unit>quarter</beat-unit>') && xml4.includes('<per-minute>120</per-minute>'), "Metronome direction specifies 120 BPM");
    assert(xml4.includes('<sound tempo="120"/>'), "Sound direction specifies 120 tempo");

    // 1.7 Chord Symbols (<harmony>)
    assert(xml4.includes('<harmony print-frame="no">'), "MusicXML includes <harmony> element for chord symbols");
    assert(xml4.includes('<root-step>E</root-step>'), "Chord harmony has root-step E");
    assert(xml4.includes('<kind text="5">power</kind>') || xml4.includes('<kind text="">major</kind>'), "Chord harmony encodes chord quality");

    // 1.8 Technical Tablature String & Fret Elements
    assert(xml4.includes('<notations>'), "Notes contain <notations> element");
    assert(xml4.includes('<technical>'), "Notes contain <technical> element for tablature");
    assert(xml4.includes('<string>6</string>') && xml4.includes('<fret>0</fret>'), "Low E open string encodes String 6, Fret 0");
    assert(xml4.includes('<string>1</string>') && xml4.includes('<fret>12</fret>'), "High note encodes String 1, Fret 12");
    assert(xml4.includes('<fingering>3</fingering>'), "Fingering notation encodes finger 3 for fret 12");
    assert(xml4.includes('<chord/>'), "Simultaneous chord notes contain <chord/> tag");

    // =========================================================================
    // SECTION 2: Custom Tunings & Alternate Chords in MusicXML
    // =========================================================================
    console.log("\n--- Section 2: Custom Tunings & Complex Chords ---");

    const dropDExporter = new GuitarExporter({
        title: 'Drop D Grunge Riff',
        tuning: {
            name: 'Drop D',
            strings: [64, 59, 55, 50, 45, 38], // Low string tuned to D2 (MIDI 38)
            names: ["e", "B", "G", "D", "A", "D"]
        }
    });

    const dropDNotes = [
        { string: 6, fret: 0, time: 0.0, duration: 1.0, chord: 'D5' },
        { string: 5, fret: 0, time: 0.0, duration: 1.0 },
        { string: 4, fret: 0, time: 0.0, duration: 1.0 },
        { string: 2, fret: 3, time: 1.0, duration: 0.5, chord: 'C#maj7' }
    ];

    const dropDXml = dropDExporter.toMusicXML(dropDNotes, 110, {
        chords: [{ time: 1.5, chord: 'Bb7/D' }]
    });

    assert(dropDXml.includes('<tuning-step>D</tuning-step>') && dropDXml.includes('<tuning-octave>2</tuning-octave>'), "Drop D tuning properly sets Line 6 to D2");
    assert(dropDXml.includes('<root-step>C</root-step>') && dropDXml.includes('<root-alter>1</root-alter>'), "Sharp accidental in C# chord sets root-alter to 1");
    assert(dropDXml.includes('<kind text="maj7">major-seventh</kind>'), "maj7 chord maps to major-seventh kind");
    assert(dropDXml.includes('<bass-step>D</bass-step>'), "Slash chord Bb7/D properly encodes bass-step D");

    // =========================================================================
    // SECTION 3: Pure Binary Multi-Track MIDI (Type 0 and Type 1)
    // =========================================================================
    console.log("\n--- Section 3: Standard MIDI File SMF Type 0 & Type 1 Multi-Track ---");

    const midiNotes = [
        { string: 6, fret: 0, time: 0.0, duration: 0.5, velocity: 0.95 },
        { string: 5, fret: 2, time: 0.5, duration: 0.5, velocity: 0.80 },
        { string: 4, fret: 2, time: 1.0, duration: 0.5, velocity: 0.65 },
        { string: 3, fret: 0, time: 1.5, duration: 0.5, velocity: 0.40 }
    ];

    // 3.1 Type 0 MIDI Check
    const type0Bytes = standardExporter.toMIDI(midiNotes, 120, { format: 0 });
    assert(type0Bytes instanceof Uint8Array, "Type 0 MIDI returns Uint8Array");
    const t0Format = (type0Bytes[8] << 8) | type0Bytes[9];
    const t0Tracks = (type0Bytes[10] << 8) | type0Bytes[11];
    assert(t0Format === 0, `SMF header format is Type 0 (got ${t0Format})`);
    assert(t0Tracks === 1, `Type 0 contains exactly 1 track (got ${t0Tracks})`);

    // 3.2 Type 1 Multi-Track MIDI Check
    const type1Bytes = standardExporter.toMIDI(midiNotes, 120, { format: 1 });
    assert(type1Bytes instanceof Uint8Array, "Type 1 Multi-Track MIDI returns Uint8Array");
    const t1Format = (type1Bytes[8] << 8) | type1Bytes[9];
    const t1Tracks = (type1Bytes[10] << 8) | type1Bytes[11];
    assert(t1Format === 1, `SMF header format is Type 1 Multi-Track (got ${t1Format})`);
    assert(t1Tracks >= 2, `Type 1 contains multiple tracks (conductor + instrument, got ${t1Tracks})`);

    // Check Conductor Track contains Tempo meta-event (FF 51 03)
    let hasTempoMeta = false;
    for (let i = 0; i < type1Bytes.length - 2; i++) {
        if (type1Bytes[i] === 0xFF && type1Bytes[i + 1] === 0x51 && type1Bytes[i + 2] === 0x03) {
            hasTempoMeta = true;
            break;
        }
    }
    assert(hasTempoMeta, "Type 1 Conductor Track contains Set Tempo meta-event (FF 51 03)");

    // 3.3 Dynamic Velocities Verification
    const velCheckBytes = standardExporter.toMIDI([
        { string: 1, fret: 5, time: 0.0, duration: 0.5, velocity: 0.95 }, // ~121
        { string: 1, fret: 7, time: 0.5, duration: 0.5, velocity: 0.35 }  // ~44
    ], 120);

    let velocitiesFound = [];
    for (let i = 0; i < velCheckBytes.length - 2; i++) {
        if ((velCheckBytes[i] & 0xF0) === 0x90) { // Note-On status
            velocitiesFound.push(velCheckBytes[i + 2]);
        }
    }
    assert(velocitiesFound.length >= 2, `Found at least 2 Note-On events (got ${velocitiesFound.length})`);
    assert(velocitiesFound[0] > 115, `High velocity dynamic properly encoded (got ${velocitiesFound[0]})`);
    assert(velocitiesFound[1] < 50, `Low velocity dynamic properly encoded (got ${velocitiesFound[1]})`);

    // 3.4 Multi-Track String Splitting (6 Strings -> 6 Separate Tracks)
    const splitBytes = standardExporter.toMIDI(sampleTabNotes, 120, { format: 1, splitByString: true });
    const splitTracks = (splitBytes[10] << 8) | splitBytes[11];
    assert(splitTracks === 7, `Multi-track string splitting generates 7 tracks: 1 Conductor + 6 Strings (got ${splitTracks})`);

    // =========================================================================
    // SECTION 4: Offline Preset & Take Vault (IndexedDB Wrapper)
    // =========================================================================
    console.log("\n--- Section 4: Offline Vault (IndexedDB Wrapper & Backup System) ---");

    const vault = new GuitarVault();

    // 4.1 Store 1: pedal_presets CRUD
    const preset1 = await vault.savePreset({
        name: 'Hendrix Fuzz & Reverb',
        category: 'Psychedelic Rock',
        settings: {
            overdrive: { drive: 85, tone: 45, level: 75, bypass: false },
            delay: { time: 280, feedback: 50, mix: 35, bypass: false },
            reverb: { size: 3.2, damping: 40, mix: 40, bypass: false }
        }
    });
    assert(typeof preset1.id === 'string' && preset1.id.length > 0, "Preset saved with auto-generated ID");
    assert(preset1.createdAt && preset1.updatedAt, "Preset contains timestamp metadata");

    const retrievedPreset = await vault.getPreset(preset1.id);
    assert(retrievedPreset && retrievedPreset.name === 'Hendrix Fuzz & Reverb', "Preset successfully retrieved by ID");

    // 4.2 Store 2: custom_tunings CRUD
    const tuning1 = await vault.saveTuning({
        name: 'DADGAD Celtic',
        strings: [62, 57, 55, 50, 45, 38],
        names: ["D", "A", "G", "D", "A", "D"]
    });
    assert(typeof tuning1.id === 'string', "Custom tuning saved with auto-generated ID");
    const retrievedTuning = await vault.getTuning(tuning1.id);
    assert(retrievedTuning && retrievedTuning.name === 'DADGAD Celtic', "Custom tuning successfully retrieved by ID");

    // 4.3 Store 3: recorded_sessions CRUD
    const session1 = await vault.saveSession({
        title: 'Studio Take 1 - Slash Riff',
        bpm: 125,
        timeSignature: { numerator: 4, denominator: 4 },
        tuning: { name: 'Standard', strings: [64, 59, 55, 50, 45, 40] },
        notes: sampleTabNotes,
        duration: 3.5
    });
    assert(typeof session1.id === 'string', "Recorded session take saved with auto-generated ID");
    const retrievedSession = await vault.getSession(session1.id);
    assert(retrievedSession && retrievedSession.title === 'Studio Take 1 - Slash Riff', "Recorded session successfully retrieved by ID");

    // 4.4 Vault Backup Export (Single JSON file)
    const backupJsonString = await vault.exportVault({ asString: true });
    assert(typeof backupJsonString === 'string', "Vault export produces valid JSON string");
    const backupObj = JSON.parse(backupJsonString);
    assert(backupObj.vaultFormat === 'GuitarVisionVault', "Vault export contains vaultFormat signature");
    assert(backupObj.stats.pedal_presets_count >= 1, "Backup contains pedal presets");
    assert(backupObj.stats.custom_tunings_count >= 1, "Backup contains custom tunings");
    assert(backupObj.stats.recorded_sessions_count >= 1, "Backup contains recorded sessions");

    // 4.5 Vault Backup Restore & Import
    const newVault = new GuitarVault({ dbName: 'GuitarVisionVaultTestRestore' });
    const importReport = await newVault.importVault(backupJsonString, { clearExisting: true });
    assert(importReport.success === true, "Vault backup successfully imported into new vault");
    assert(importReport.imported[STORES.PRESETS] >= 1, "Import report confirms imported pedal presets");
    assert(importReport.imported[STORES.TUNINGS] >= 1, "Import report confirms imported custom tunings");
    assert(importReport.imported[STORES.SESSIONS] >= 1, "Import report confirms imported recorded sessions");

    const restoredPreset = await newVault.getPreset(preset1.id);
    assert(restoredPreset && restoredPreset.name === 'Hendrix Fuzz & Reverb', "Restored preset verified in destination vault");

    // =========================================================================
    // Summary
    // =========================================================================
    console.log("\n================================================================================");
    console.log(`Verification Complete: ${testsPassed} passed, ${testsFailed} failed.`);
    console.log("================================================================================");

    if (testsFailed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution encountered an error:", err);
    process.exit(1);
});
