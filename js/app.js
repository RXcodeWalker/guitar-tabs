/**
 * Main Application Orchestrator
 * Integrates Audio DSP (Phase 1), Fretboard Optimizer (Phase 2),
 * Fretboard Canvas Visualizer, Auto-Scrolling Tablature Staff,
 * Rhythm Quantizer, Karplus-Strong / Polyphonic Synthesizer Playback,
 * and Multi-Format Exporter (ASCII, MusicXML, JSON, MIDI).
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Optimizer (Phase 2)
    const optimizer = new GuitarOptimizer({
        tuning: 'standard',
        mode: 'adaptive'
    });

    // 2. Initialize Rhythm Quantizer
    const quantizer = new GuitarQuantizer({
        bpm: 120,
        grid: '16th',
        liveQuantize: false
    });

    // 3. Initialize Audio DSP Engine (Phase 1)
    const dsp = new GuitarDSP({
        a4: 440,
        onPitchDetected: (data) => updatePitchUI(data),
        onPluck: (data) => handleDetectedPluck(data),
        onNoteOff: (data) => handleDetectedNoteOff(data),
        onSilence: () => handleSilenceUI(),
        onWaveformData: (buffer) => renderVUMeter(buffer)
    });

    // 4. Initialize Playback Synthesizer Engine (Karplus-Strong & PolySynth)
    const synth = new GuitarSynth({
        soundEngine: 'karplus',
        volume: 0.85
    });

    // 5. Initialize Multi-Format Exporter
    const exporter = new GuitarExporter({
        title: 'GuitarVision Studio Transcription',
        bpm: 120,
        tuning: {
            name: 'Standard',
            strings: [64, 59, 55, 50, 45, 40],
            names: ["e", "B", "G", "D", "A", "E"]
        }
    });

    // 6. Initialize Fretboard Visualizer
    const fretboard = new FretboardVisualizer('fretboardCanvas', {
        numFrets: 22,
        onFretClick: (string, fret) => handleFretboardClick(string, fret)
    });

    // 7. Initialize Auto-Scrolling Tablature Staff
    const tablature = new TablatureStaff('tablatureCanvas', {
        bpm: 120,
        pixelsPerBeat: 105,
        playheadRatio: 0.35,
        quantizer: quantizer,
        onMetronomeClick: (data) => handleMetronomeTick(data)
    });

    // 8. Initialize Tablature Playback Controller (Animated Playhead + Synth Engine)
    const playbackController = new TablaturePlaybackController({
        tablature: tablature,
        fretboard: fretboard,
        synth: synth,
        optimizer: optimizer,
        onPlaybackStateChange: ({ isPlaying }) => {
            if (btnPlayBack) {
                if (isPlaying) {
                    btnPlayBack.innerHTML = '<span class="icon">⏹</span> Stop Playback';
                    btnPlayBack.classList.add('btn-playing');
                } else {
                    btnPlayBack.innerHTML = '<span class="icon">▶️</span> Play Back';
                    btnPlayBack.classList.remove('btn-playing');
                }
            }
        },
        onNoteTrigger: (note, midi) => {
            const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
            const name = noteNames[midi % 12];
            const oct = Math.floor(midi / 12) - 1;
            updatePitchUI({
                noteName: name,
                octave: oct,
                frequency: synth.midiToFrequency(midi),
                cents: 0
            });
            if (handPosBadge) {
                optimizer.updateHandPosition(note.fret);
                handPosBadge.textContent = `Pos: Fret ${optimizer.handAnchorFret}`;
            }
        }
    });

    // State
    let isMicActive = false;
    let isMetronomeSoundOn = true;
    let tapTimes = [];
    let demoPlaybackTimer = null;
    let isDemoPlaying = false;

    // DOM Elements - Tuner HUD
    const btnMicToggle = document.getElementById('btnMicToggle');
    const micStatusIndicator = document.getElementById('micStatusIndicator');
    const noteBadge = document.getElementById('noteBadge');
    const freqDisplay = document.getElementById('freqDisplay');
    const tunerNeedle = document.getElementById('tunerNeedle');
    const centsDisplay = document.getElementById('centsDisplay');
    const handPosBadge = document.getElementById('handPosBadge');
    const vuMeterBar = document.getElementById('vuMeterBar');
    const metronomePulse = document.getElementById('metronomePulse');
    const metronomeBeatDisplay = document.getElementById('metronomeBeatDisplay');

    // Controls DOM - Playback & Synth
    const btnPlayBack = document.getElementById('btnPlayBack');
    const btnPlayPause = document.getElementById('btnPlayPause');
    const btnRewind = document.getElementById('btnRewind');
    const btnClearTab = document.getElementById('btnClearTab');
    const selectSynthSound = document.getElementById('selectSynthSound');

    // Controls DOM - Rhythm & Quantization
    const selectQuantizeGrid = document.getElementById('selectQuantizeGrid');
    const btnQuantizeNow = document.getElementById('btnQuantizeNow');
    const btnLiveQuantize = document.getElementById('btnLiveQuantize');

    // Controls DOM - Tempo & Metronome
    const bpmSlider = document.getElementById('bpmSlider');
    const bpmDisplay = document.getElementById('bpmDisplay');
    const btnBpmMinus = document.getElementById('btnBpmMinus');
    const btnBpmPlus = document.getElementById('btnBpmPlus');
    const btnTapTempo = document.getElementById('btnTapTempo');
    const btnMetronomeSound = document.getElementById('btnMetronomeSound');
    const zoomSlider = document.getElementById('zoomSlider');

    // Controls DOM - Tuning, Ergonomics, Noise Gate, Demo
    const selectTuning = document.getElementById('selectTuning');
    const selectErgoMode = document.getElementById('selectErgoMode');
    const noiseGateSlider = document.getElementById('noiseGateSlider');
    const noiseGateVal = document.getElementById('noiseGateVal');
    const selectDemoSong = document.getElementById('selectDemoSong');
    const btnPlayDemo = document.getElementById('btnPlayDemo');

    // Controls DOM - Multi-Format Exporter Modal
    const btnOpenExportModal = document.getElementById('btnOpenExportModal');
    const exportModal = document.getElementById('exportModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const exportTabBtns = document.querySelectorAll('.export-tab-btn');
    const exportPanels = {
        ascii: document.getElementById('panelAscii'),
        musicxml: document.getElementById('panelMusicXML'),
        json: document.getElementById('panelJSON'),
        midi: document.getElementById('panelMIDI')
    };

    const asciiContent = document.getElementById('asciiContent');
    const btnCopyAscii = document.getElementById('btnCopyAscii');
    const btnDownloadAscii = document.getElementById('btnDownloadAscii');

    const musicxmlContent = document.getElementById('musicxmlContent');
    const btnCopyMusicXML = document.getElementById('btnCopyMusicXML');
    const btnDownloadMusicXML = document.getElementById('btnDownloadMusicXML');

    const jsonContent = document.getElementById('jsonContent');
    const btnCopyJSON = document.getElementById('btnCopyJSON');
    const btnDownloadJSON = document.getElementById('btnDownloadJSON');

    const midiTempoDisplay = document.getElementById('midiTempoDisplay');
    const midiNotesDisplay = document.getElementById('midiNotesDisplay');
    const btnDownloadMIDI = document.getElementById('btnDownloadMIDI');

    // Start tablature auto-scroll by default
    tablature.play();

    // =========================================================================
    // Core Audio & Optimization Flow (DSP -> Optimizer -> Visualizers)
    // =========================================================================

    /**
     * Handles real-time physical guitar pluck detected by the DSP engine.
     */
    function handleDetectedPluck(data) {
        // Run Optimizer (Phase 2) to find best (string, fret) & finger assignment
        const result = optimizer.optimize(data.midi);
        if (!result) return; // Out of playable range

        // 1. Light up Fretboard Visualizer
        fretboard.lightUpNote(result.string, result.fret, result.noteName + result.octave, result.finger);

        // 2. Print onto Auto-Scrolling Tablature Staff with timestamp capture
        tablature.recordNote({
            string: result.string,
            fret: result.fret,
            finger: result.finger,
            noteName: result.noteName + result.octave,
            midi: data.midi,
            rawTime: tablature.currentTime
        });

        // 3. Update Hand Position UI indicator
        if (handPosBadge) {
            handPosBadge.textContent = `Pos: Fret ${result.handPosition}`;
        }
    }

    /**
     * Handles note-off event from DSP when signal drops below noise gate.
     */
    function handleDetectedNoteOff() {
        // Finalize active notes across ringing strings
        for (let s = 1; s <= 6; s++) {
            tablature.releaseNote(s);
        }
    }

    /**
     * Updates real-time tuner and pitch UI metrics.
     */
    function updatePitchUI(data) {
        if (noteBadge) {
            noteBadge.textContent = data.noteName + data.octave;
            noteBadge.classList.add('note-active');
        }

        if (freqDisplay) {
            freqDisplay.textContent = `${data.frequency.toFixed(1)} Hz`;
        }

        if (centsDisplay && tunerNeedle) {
            const cents = data.cents;
            centsDisplay.textContent = (cents > 0 ? `+${cents}` : `${cents}`) + '¢';
            
            // Needle rotation (-50 to +50 cents -> -45deg to +45deg)
            const angle = Math.max(-45, Math.min(45, cents * 0.9));
            tunerNeedle.style.transform = `translateX(-50%) rotate(${angle}deg)`;

            // Green in-tune badge
            if (Math.abs(cents) <= 5) {
                centsDisplay.style.color = '#10b981';
                tunerNeedle.style.backgroundColor = '#10b981';
            } else {
                centsDisplay.style.color = '#cbd5e1';
                tunerNeedle.style.backgroundColor = '#00f3ff';
            }
        }
    }

    function handleSilenceUI() {
        if (noteBadge) {
            noteBadge.classList.remove('note-active');
        }
        if (centsDisplay) {
            centsDisplay.style.color = '#64748b';
        }
    }

    function renderVUMeter(buffer) {
        if (!vuMeterBar) return;
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
            sum += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sum / buffer.length);
        const percent = Math.min(100, Math.round(rms * 400));
        vuMeterBar.style.width = `${percent}%`;
        
        if (percent > 85) {
            vuMeterBar.style.backgroundColor = '#ef4444';
        } else if (percent > 60) {
            vuMeterBar.style.backgroundColor = '#f59e0b';
        } else {
            vuMeterBar.style.backgroundColor = '#00f3ff';
        }
    }

    /**
     * Interactive Click on Fretboard:
     * User clicks any fret/string -> synthesizes sound, lights up, records tab!
     */
    async function handleFretboardClick(string, fret) {
        await dsp.initAudioContext();
        await synth.initAudioContext();

        const strIdx = string - 1;
        const openMidi = optimizer.openMidi[strIdx];
        const midi = openMidi + fret;

        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const noteName = noteNames[midi % 12];
        const octave = Math.floor(midi / 12) - 1;
        const fullNoteName = `${noteName}${octave}`;

        // Compute finger based on current hand anchor
        const finger = optimizer.assignFinger(fret, optimizer.handAnchorFret);

        // 1. Play sound via Karplus-Strong string synthesis or PolySynth
        synth.playNote(midi, 1.8, 0.85, string);

        // 2. Light up fretboard
        fretboard.lightUpNote(string, fret, fullNoteName, finger);

        // 3. Record note on scrolling tab with raw timestamp
        tablature.recordNote({
            string: string,
            fret: fret,
            finger: finger,
            noteName: fullNoteName,
            midi: midi,
            rawTime: tablature.currentTime
        });

        // 4. Update UI
        updatePitchUI({
            noteName: noteName,
            octave: octave,
            frequency: synth.midiToFrequency(midi),
            cents: 0
        });

        if (handPosBadge) {
            optimizer.updateHandPosition(fret);
            handPosBadge.textContent = `Pos: Fret ${optimizer.handAnchorFret}`;
        }
    }

    /**
     * Metronome click handler.
     */
    function handleMetronomeTick({ beat, measure, isDownbeat }) {
        if (isMetronomeSoundOn) {
            dsp.playMetronomeClick(isDownbeat);
        }

        // Visual metronome pulse LED
        if (metronomePulse) {
            metronomePulse.classList.add('flash');
            if (isDownbeat) {
                metronomePulse.classList.add('downbeat');
            }
            setTimeout(() => {
                metronomePulse.classList.remove('flash', 'downbeat');
            }, 90);
        }

        if (metronomeBeatDisplay) {
            metronomeBeatDisplay.textContent = `M${measure} : Beat ${beat}`;
        }
    }

    // =========================================================================
    // Feature 1: Rhythmic Quantization Controls
    // =========================================================================

    // Grid selector
    if (selectQuantizeGrid) {
        selectQuantizeGrid.addEventListener('change', (e) => {
            const grid = e.target.value;
            quantizer.setGrid(grid);
        });
    }

    // Quantize Now button
    if (btnQuantizeNow) {
        btnQuantizeNow.addEventListener('click', () => {
            const grid = selectQuantizeGrid ? selectQuantizeGrid.value : '16th';
            tablature.quantizeNotes(grid);
            btnQuantizeNow.innerHTML = '<span class="icon">✓</span> Quantized!';
            setTimeout(() => {
                btnQuantizeNow.innerHTML = '<span class="icon">⚡</span> Quantize Tab';
            }, 1200);
        });
    }

    // Live Quantize toggle button
    if (btnLiveQuantize) {
        btnLiveQuantize.addEventListener('click', () => {
            quantizer.liveQuantize = !quantizer.liveQuantize;
            btnLiveQuantize.classList.toggle('active', quantizer.liveQuantize);
            btnLiveQuantize.innerHTML = quantizer.liveQuantize
                ? '<span class="icon">🎯</span> Live: ON'
                : '<span class="icon">🎯</span> Live: OFF';
        });
    }

    // =========================================================================
    // Feature 2: Audio Playback (Synth Engine) & Tab Scrubbing
    // =========================================================================

    if (btnPlayBack) {
        btnPlayBack.addEventListener('click', async () => {
            // Stop demo if running
            if (isDemoPlaying) {
                clearTimeout(demoPlaybackTimer);
                isDemoPlaying = false;
                if (btnPlayDemo) btnPlayDemo.innerHTML = '<span class="icon">▶</span> Play Demo';
            }

            if (tablature.notes.length === 0) {
                alert('No notes on the tablature to play! Pluck notes on the fretboard, use keys 1-6 / A-K, or load a demo riff.');
                return;
            }

            await synth.initAudioContext();
            playbackController.togglePlayback();
        });
    }

    if (selectSynthSound) {
        selectSynthSound.addEventListener('change', (e) => {
            synth.setSoundEngine(e.target.value);
        });
    }

    // =========================================================================
    // Feature 3: Multi-Format Score Exporter (ASCII, MusicXML, JSON, MIDI)
    // =========================================================================

    function refreshExportModalContent() {
        const notes = tablature.notes;
        const bpm = tablature.bpm;

        exporter.bpm = bpm;
        exporter.tuning = {
            name: selectTuning.options[selectTuning.selectedIndex]?.text || 'Standard',
            strings: optimizer.openMidi,
            names: tablature.stringNames
        };

        // 1. ASCII Tab
        if (asciiContent) {
            asciiContent.value = exporter.toASCII(notes, bpm);
        }

        // 2. MusicXML
        if (musicxmlContent) {
            musicxmlContent.value = exporter.toMusicXML(notes, bpm);
        }

        // 3. Structured JSON
        if (jsonContent) {
            jsonContent.value = exporter.toJSON(notes, bpm);
        }

        // 4. MIDI Details
        if (midiTempoDisplay) midiTempoDisplay.textContent = `${bpm} BPM`;
        if (midiNotesDisplay) midiNotesDisplay.textContent = `${notes.length} notes`;
    }

    if (btnOpenExportModal) {
        btnOpenExportModal.addEventListener('click', () => {
            refreshExportModalContent();
            if (exportModal) exportModal.classList.add('open');
        });
    }

    // Tab switching in Export Modal
    exportTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            exportTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tabKey = btn.dataset.tab;
            Object.keys(exportPanels).forEach(key => {
                if (exportPanels[key]) {
                    exportPanels[key].classList.toggle('active', key === tabKey);
                }
            });
        });
    });

    // ASCII Actions
    if (btnCopyAscii && asciiContent) {
        btnCopyAscii.addEventListener('click', () => {
            navigator.clipboard.writeText(asciiContent.value).then(() => {
                btnCopyAscii.textContent = 'Copied!';
                setTimeout(() => btnCopyAscii.textContent = 'Copy to Clipboard', 1500);
            });
        });
    }
    if (btnDownloadAscii && asciiContent) {
        btnDownloadAscii.addEventListener('click', () => {
            exporter.downloadTextFile(asciiContent.value, 'text/plain', 'guitar_tab.txt');
        });
    }

    // MusicXML Actions
    if (btnCopyMusicXML && musicxmlContent) {
        btnCopyMusicXML.addEventListener('click', () => {
            navigator.clipboard.writeText(musicxmlContent.value).then(() => {
                btnCopyMusicXML.textContent = 'Copied!';
                setTimeout(() => btnCopyMusicXML.textContent = 'Copy XML', 1500);
            });
        });
    }
    if (btnDownloadMusicXML && musicxmlContent) {
        btnDownloadMusicXML.addEventListener('click', () => {
            exporter.downloadTextFile(musicxmlContent.value, 'application/xml', 'guitar_score.musicxml');
        });
    }

    // JSON Actions
    if (btnCopyJSON && jsonContent) {
        btnCopyJSON.addEventListener('click', () => {
            navigator.clipboard.writeText(jsonContent.value).then(() => {
                btnCopyJSON.textContent = 'Copied!';
                setTimeout(() => btnCopyJSON.textContent = 'Copy JSON', 1500);
            });
        });
    }
    if (btnDownloadJSON && jsonContent) {
        btnDownloadJSON.addEventListener('click', () => {
            exporter.downloadTextFile(jsonContent.value, 'application/json', 'guitar_score.json');
        });
    }

    // MIDI File Download
    if (btnDownloadMIDI) {
        btnDownloadMIDI.addEventListener('click', () => {
            exporter.downloadMIDI(tablature.notes, tablature.bpm, 'guitar_transcription.mid');
        });
    }

    // Modal Close
    if (btnCloseModal && exportModal) {
        btnCloseModal.addEventListener('click', () => {
            exportModal.classList.remove('open');
        });
    }
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) {
                exportModal.classList.remove('open');
            }
        });
    }

    // =========================================================================
    // General UI Controls & Interactions
    // =========================================================================

    // Microphone Toggle Button
    btnMicToggle.addEventListener('click', async () => {
        if (!isMicActive) {
            btnMicToggle.textContent = 'Connecting...';
            const res = await dsp.startMicrophone();
            if (res.success) {
                isMicActive = true;
                btnMicToggle.innerHTML = '<span class="icon">🛑</span> Stop Microphone';
                btnMicToggle.classList.add('btn-danger');
                micStatusIndicator.className = 'status-badge status-active';
                micStatusIndicator.textContent = 'Mic Active';
            } else {
                btnMicToggle.innerHTML = '<span class="icon">🎤</span> Enable Microphone';
                alert('Could not access microphone: ' + res.error);
            }
        } else {
            dsp.stopMicrophone();
            isMicActive = false;
            btnMicToggle.innerHTML = '<span class="icon">🎤</span> Enable Microphone';
            btnMicToggle.classList.remove('btn-danger');
            micStatusIndicator.className = 'status-badge status-idle';
            micStatusIndicator.textContent = 'Mic Off';
            handleSilenceUI();
        }
    });

    // Play / Pause Tab Scroll
    btnPlayPause.addEventListener('click', () => {
        if (playbackController.isPlaying) {
            playbackController.stopPlayback();
        }
        const playing = tablature.togglePlay();
        btnPlayPause.innerHTML = playing 
            ? '<span class="icon">⏸</span> Pause Scroll' 
            : '<span class="icon">▶</span> Resume Scroll';
        btnPlayPause.classList.toggle('btn-primary', !playing);
    });

    // Rewind Tab
    btnRewind.addEventListener('click', () => {
        if (playbackController.isPlaying) {
            playbackController.stopPlayback();
        }
        tablature.rewind();
    });

    // Clear Tab
    btnClearTab.addEventListener('click', () => {
        if (confirm('Clear all recorded tablature notes?')) {
            if (playbackController.isPlaying) {
                playbackController.stopPlayback();
            }
            tablature.clearNotes();
        }
    });

    // BPM / Tempo Controls
    function updateBPM(val) {
        val = Math.max(30, Math.min(300, parseInt(val, 10) || 120));
        bpmSlider.value = val;
        bpmDisplay.textContent = `${val} BPM`;
        tablature.setBPM(val);
        quantizer.setBPM(val);
        exporter.bpm = val;
    }

    bpmSlider.addEventListener('input', (e) => updateBPM(e.target.value));
    btnBpmMinus.addEventListener('click', () => updateBPM(tablature.bpm - 2));
    btnBpmPlus.addEventListener('click', () => updateBPM(tablature.bpm + 2));

    // Tap Tempo
    btnTapTempo.addEventListener('click', () => {
        const now = performance.now();
        tapTimes.push(now);
        if (tapTimes.length > 5) tapTimes.shift();

        if (tapTimes.length >= 2) {
            let intervals = [];
            for (let i = 1; i < tapTimes.length; i++) {
                intervals.push(tapTimes[i] - tapTimes[i - 1]);
            }
            intervals = intervals.filter(t => t < 2500);
            if (intervals.length > 0) {
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                const calcBpm = Math.round(60000 / avgInterval);
                updateBPM(calcBpm);
            }
        }
    });

    // Zoom Staff Spacing
    zoomSlider.addEventListener('input', (e) => {
        tablature.setZoom(parseInt(e.target.value, 10));
    });

    // Metronome Sound Toggle
    btnMetronomeSound.addEventListener('click', () => {
        isMetronomeSoundOn = !isMetronomeSoundOn;
        btnMetronomeSound.classList.toggle('active', isMetronomeSoundOn);
        btnMetronomeSound.innerHTML = isMetronomeSoundOn 
            ? '<span class="icon">🔔</span> Click ON' 
            : '<span class="icon">🔕</span> Click Muted';
    });

    // Guitar Tuning Selector
    selectTuning.addEventListener('change', (e) => {
        const val = e.target.value;
        optimizer.setTuning(val);
        const tuningLabels = {
            standard: ["e", "B", "G", "D", "A", "E"],
            dropD:    ["e", "B", "G", "D", "A", "D"],
            halfStep: ["eb", "Bb", "Gb", "Db", "Ab", "Eb"],
            dadgad:   ["D", "A", "G", "D", "A", "D"]
        };
        fretboard.stringNames = tuningLabels[val] || tuningLabels.standard;
        tablature.stringNames = tuningLabels[val] || tuningLabels.standard;
        exporter.tuning.names = tuningLabels[val] || tuningLabels.standard;
        exporter.tuning.strings = optimizer.openMidi;
    });

    // Ergonomic Mode Selector
    selectErgoMode.addEventListener('change', (e) => {
        optimizer.setMode(e.target.value);
    });

    // Noise Gate Slider
    noiseGateSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        dsp.noiseGateRMS = val;
        noiseGateVal.textContent = val.toFixed(3);
    });

    // Demo Song Player
    btnPlayDemo.addEventListener('click', () => {
        dsp.initAudioContext();
        synth.initAudioContext();
        const songKey = selectDemoSong.value;
        const song = DEMO_SONGS[songKey];
        if (!song) return;

        if (isDemoPlaying) {
            clearTimeout(demoPlaybackTimer);
            isDemoPlaying = false;
            btnPlayDemo.innerHTML = '<span class="icon">▶</span> Play Demo';
            btnPlayDemo.classList.remove('btn-danger');
            return;
        }

        if (playbackController.isPlaying) {
            playbackController.stopPlayback();
        }

        updateBPM(song.bpm);
        tablature.clearNotes();
        tablature.loadSong(song.notes, song.bpm);
        tablature.play();

        isDemoPlaying = true;
        btnPlayDemo.innerHTML = '<span class="icon">⏹</span> Stop Demo';
        btnPlayDemo.classList.add('btn-danger');

        const startTime = performance.now();
        const scheduleNote = (idx) => {
            if (!isDemoPlaying || idx >= song.notes.length) {
                isDemoPlaying = false;
                btnPlayDemo.innerHTML = '<span class="icon">▶</span> Play Demo';
                btnPlayDemo.classList.remove('btn-danger');
                return;
            }

            const n = song.notes[idx];
            const delay = Math.max(0, (n.time * 1000) - (performance.now() - startTime));

            demoPlaybackTimer = setTimeout(() => {
                if (!isDemoPlaying) return;

                const openMidi = optimizer.openMidi[n.string - 1];
                const midi = openMidi + n.fret;

                synth.playNote(midi, n.duration * 1.5, 0.85, n.string);
                fretboard.lightUpNote(n.string, n.fret, n.noteName, n.finger);

                updatePitchUI({
                    noteName: n.noteName.slice(0, -1),
                    octave: parseInt(n.noteName.slice(-1), 10) || 4,
                    frequency: synth.midiToFrequency(midi),
                    cents: 0
                });

                scheduleNote(idx + 1);
            }, delay);
        };

        scheduleNote(0);
    });

    // Computer Keyboard Shortcuts
    const keyMap = {
        '1': { string: 1, fret: 0 },
        '2': { string: 2, fret: 0 },
        '3': { string: 3, fret: 0 },
        '4': { string: 4, fret: 0 },
        '5': { string: 5, fret: 0 },
        '6': { string: 6, fret: 0 },
        // A Minor Pentatonic Box (A, S, D, F, G, H, J, K)
        'a': { string: 6, fret: 5 },
        's': { string: 6, fret: 8 },
        'd': { string: 5, fret: 5 },
        'f': { string: 5, fret: 7 },
        'g': { string: 4, fret: 5 },
        'h': { string: 4, fret: 7 },
        'j': { string: 3, fret: 5 },
        'k': { string: 3, fret: 7 },
        'l': { string: 2, fret: 5 },
        ';': { string: 2, fret: 8 }
    };

    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
            e.preventDefault();
            btnPlayPause.click();
            return;
        }

        if (e.key.toLowerCase() === 'p') {
            e.preventDefault();
            btnPlayBack.click();
            return;
        }

        if (e.key.toLowerCase() === 'q') {
            e.preventDefault();
            btnQuantizeNow.click();
            return;
        }

        if (e.key.toLowerCase() === 'r') {
            tablature.rewind();
            return;
        }

        const mapped = keyMap[e.key.toLowerCase()];
        if (mapped) {
            handleFretboardClick(mapped.string, mapped.fret);
        }
    });
});
