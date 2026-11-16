/**
 * Main Application Orchestrator
 * Integrates Audio DSP (Phase 1), Fretboard Optimizer (Phase 2),
 * Fretboard Canvas Visualizer, and Auto-Scrolling Tablature Staff.
 */

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Optimizer
    const optimizer = new GuitarOptimizer({
        tuning: 'standard',
        mode: 'adaptive'
    });

    // 2. Initialize Audio DSP Engine
    const dsp = new GuitarDSP({
        a4: 440,
        onPitchDetected: (data) => updatePitchUI(data),
        onPluck: (data) => handleDetectedPluck(data),
        onSilence: () => handleSilenceUI(),
        onWaveformData: (buffer) => renderVUMeter(buffer)
    });

    // 3. Initialize Fretboard Visualizer
    const fretboard = new FretboardVisualizer('fretboardCanvas', {
        numFrets: 22,
        onFretClick: (string, fret) => handleFretboardClick(string, fret)
    });

    // 4. Initialize Auto-Scrolling Tablature Staff
    const tablature = new TablatureStaff('tablatureCanvas', {
        bpm: 120,
        pixelsPerBeat: 105,
        playheadRatio: 0.35,
        onMetronomeClick: (data) => handleMetronomeTick(data)
    });

    // State
    let isMicActive = false;
    let isMetronomeSoundOn = true;
    let tapTimes = [];
    let demoPlaybackTimer = null;
    let isDemoPlaying = false;

    // DOM Elements
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

    // Controls DOM
    const bpmSlider = document.getElementById('bpmSlider');
    const bpmDisplay = document.getElementById('bpmDisplay');
    const btnBpmMinus = document.getElementById('btnBpmMinus');
    const btnBpmPlus = document.getElementById('btnBpmPlus');
    const btnTapTempo = document.getElementById('btnTapTempo');
    const zoomSlider = document.getElementById('zoomSlider');
    const btnPlayPause = document.getElementById('btnPlayPause');
    const btnRewind = document.getElementById('btnRewind');
    const btnClearTab = document.getElementById('btnClearTab');
    const btnMetronomeSound = document.getElementById('btnMetronomeSound');
    const selectTuning = document.getElementById('selectTuning');
    const selectErgoMode = document.getElementById('selectErgoMode');
    const selectDemoSong = document.getElementById('selectDemoSong');
    const btnPlayDemo = document.getElementById('btnPlayDemo');
    const btnExportASCII = document.getElementById('btnExportASCII');
    const noiseGateSlider = document.getElementById('noiseGateSlider');
    const noiseGateVal = document.getElementById('noiseGateVal');
    const asciiModal = document.getElementById('asciiModal');
    const asciiContent = document.getElementById('asciiContent');
    const btnCopyAscii = document.getElementById('btnCopyAscii');
    const btnCloseModal = document.getElementById('btnCloseModal');

    // Start tablature auto-scroll by default
    tablature.play();

    // =========================================================================
    // Core Audio & Optimization Flow (Phases 1, 2, 3)
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

        // 2. Print onto Auto-Scrolling Tablature Staff
        tablature.recordNote({
            string: result.string,
            fret: result.fret,
            finger: result.finger,
            noteName: result.noteName + result.octave
        });

        // 3. Update Hand Position UI indicator
        if (handPosBadge) {
            handPosBadge.textContent = `Pos: Fret ${result.handPosition}`;
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
            
            // Tuner needle rotation (-50 to +50 cents maps to -45deg to +45deg)
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
    function handleFretboardClick(string, fret) {
        // Initialize Web Audio if needed
        dsp.initAudioContext();

        const strIdx = string - 1;
        const openMidi = optimizer.openMidi[strIdx];
        const midi = openMidi + fret;

        const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
        const noteName = noteNames[midi % 12];
        const octave = Math.floor(midi / 12) - 1;
        const fullNoteName = `${noteName}${octave}`;

        // Compute finger based on current hand anchor
        const finger = optimizer.assignFinger(fret, optimizer.handAnchorFret);

        // 1. Play realistic physical Karplus-Strong string synthesis
        dsp.playGuitarPluck(midi, 1.8, 0.85);

        // 2. Light up fretboard
        fretboard.lightUpNote(string, fret, fullNoteName, finger);

        // 3. Record note on scrolling tab
        tablature.recordNote({
            string: string,
            fret: fret,
            finger: finger,
            noteName: fullNoteName
        });

        // 4. Update UI
        updatePitchUI({
            noteName: noteName,
            octave: octave,
            frequency: dsp.midiToFrequency(midi),
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
    // UI Event Handlers & Control Binding
    // =========================================================================

    // 1. Microphone Toggle Button
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

    // 2. Play / Pause Tab Scroll
    btnPlayPause.addEventListener('click', () => {
        const playing = tablature.togglePlay();
        btnPlayPause.innerHTML = playing 
            ? '<span class="icon">⏸</span> Pause' 
            : '<span class="icon">▶</span> Play';
        btnPlayPause.classList.toggle('btn-primary', !playing);
    });

    // 3. Rewind Tab
    btnRewind.addEventListener('click', () => {
        tablature.rewind();
    });

    // 4. Clear Tab
    btnClearTab.addEventListener('click', () => {
        if (confirm('Clear all recorded tablature notes?')) {
            tablature.clearNotes();
        }
    });

    // 5. BPM / Tempo Controls
    function updateBPM(val) {
        val = Math.max(30, Math.min(300, parseInt(val, 10) || 120));
        bpmSlider.value = val;
        bpmDisplay.textContent = `${val} BPM`;
        tablature.setBPM(val);
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
            // Filter out taps spaced more than 2.5s apart
            intervals = intervals.filter(t => t < 2500);
            if (intervals.length > 0) {
                const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
                const calcBpm = Math.round(60000 / avgInterval);
                updateBPM(calcBpm);
            }
        }
    });

    // 6. Zoom Staff Spacing
    zoomSlider.addEventListener('input', (e) => {
        tablature.setZoom(parseInt(e.target.value, 10));
    });

    // 7. Metronome Sound Toggle
    btnMetronomeSound.addEventListener('click', () => {
        isMetronomeSoundOn = !isMetronomeSoundOn;
        btnMetronomeSound.classList.toggle('active', isMetronomeSoundOn);
        btnMetronomeSound.innerHTML = isMetronomeSoundOn 
            ? '<span class="icon">🔔</span> Click ON' 
            : '<span class="icon">🔕</span> Click Muted';
    });

    // 8. Guitar Tuning Selector
    selectTuning.addEventListener('change', (e) => {
        const val = e.target.value;
        optimizer.setTuning(val);
        // Update fretboard string tuning labels
        const tuningLabels = {
            standard: ["e", "B", "G", "D", "A", "E"],
            dropD:    ["e", "B", "G", "D", "A", "D"],
            halfStep: ["eb", "Bb", "Gb", "Db", "Ab", "Eb"],
            dadgad:   ["D", "A", "G", "D", "A", "D"]
        };
        fretboard.stringNames = tuningLabels[val] || tuningLabels.standard;
        tablature.stringNames = tuningLabels[val] || tuningLabels.standard;
    });

    // 9. Ergonomic Mode Selector
    selectErgoMode.addEventListener('change', (e) => {
        optimizer.setMode(e.target.value);
    });

    // 10. Noise Gate Slider
    noiseGateSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        dsp.noiseGateRMS = val;
        noiseGateVal.textContent = val.toFixed(3);
    });

    // 11. Demo Song Player
    btnPlayDemo.addEventListener('click', () => {
        dsp.initAudioContext();
        const songKey = selectDemoSong.value;
        const song = DEMO_SONGS[songKey];
        if (!song) return;

        // If currently playing, stop
        if (isDemoPlaying) {
            clearTimeout(demoPlaybackTimer);
            isDemoPlaying = false;
            btnPlayDemo.innerHTML = '<span class="icon">▶</span> Play Demo Riff';
            btnPlayDemo.classList.remove('btn-danger');
            return;
        }

        // Set tempo and load notes to tablature staff
        updateBPM(song.bpm);
        tablature.clearNotes();
        tablature.loadSong(song.notes, song.bpm);
        tablature.play();

        isDemoPlaying = true;
        btnPlayDemo.innerHTML = '<span class="icon">⏹</span> Stop Demo';
        btnPlayDemo.classList.add('btn-danger');

        // Play each note with acoustic synthesis and fretboard lighting!
        const startTime = performance.now();
        const scheduleNote = (idx) => {
            if (!isDemoPlaying || idx >= song.notes.length) {
                isDemoPlaying = false;
                btnPlayDemo.innerHTML = '<span class="icon">▶</span> Play Demo Riff';
                btnPlayDemo.classList.remove('btn-danger');
                return;
            }

            const n = song.notes[idx];
            const delay = Math.max(0, (n.time * 1000) - (performance.now() - startTime));

            demoPlaybackTimer = setTimeout(() => {
                if (!isDemoPlaying) return;

                const openMidi = optimizer.openMidi[n.string - 1];
                const midi = openMidi + n.fret;

                dsp.playGuitarPluck(midi, n.duration * 1.5, 0.85);
                fretboard.lightUpNote(n.string, n.fret, n.noteName, n.finger);

                updatePitchUI({
                    noteName: n.noteName.slice(0, -1),
                    octave: parseInt(n.noteName.slice(-1), 10) || 4,
                    frequency: dsp.midiToFrequency(midi),
                    cents: 0
                });

                scheduleNote(idx + 1);
            }, delay);
        };

        scheduleNote(0);
    });

    // 12. Export ASCII Tablature Modal
    btnExportASCII.addEventListener('click', () => {
        const ascii = tablature.exportASCII();
        asciiContent.value = ascii;
        asciiModal.classList.add('open');
    });

    btnCopyAscii.addEventListener('click', () => {
        asciiContent.select();
        navigator.clipboard.writeText(asciiContent.value).then(() => {
            btnCopyAscii.textContent = 'Copied to Clipboard!';
            setTimeout(() => {
                btnCopyAscii.textContent = 'Copy to Clipboard';
            }, 1800);
        });
    });

    btnCloseModal.addEventListener('click', () => {
        asciiModal.classList.remove('open');
    });

    // Close modal on background click
    asciiModal.addEventListener('click', (e) => {
        if (e.target === asciiModal) {
            asciiModal.classList.remove('open');
        }
    });

    // 13. Computer Keyboard Controls
    // Strings 1-6 open notes on keys 1-6
    // Musical keys on keyboard for testing without guitar or mouse!
    const keyMap = {
        '1': { string: 1, fret: 0 },
        '2': { string: 2, fret: 0 },
        '3': { string: 3, fret: 0 },
        '4': { string: 4, fret: 0 },
        '5': { string: 5, fret: 0 },
        '6': { string: 6, fret: 0 },
        // A Minor Pentatonic Box keys (A, S, D, F, G, H, J, K)
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
        // Ignore if user is inside an input/textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        if (e.code === 'Space') {
            e.preventDefault();
            btnPlayPause.click();
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
