/**
 * Main Application Orchestrator for FretDSP
 * Integrates Audio DSP (Phase 1), Fretboard Optimizer (Phase 2),
 * Fretboard Canvas Visualizer, Auto-Scrolling Tablature Staff,
 * Rhythm Quantizer, Karplus-Strong / Polyphonic Synthesizer Playback,
 * Real-Time FFT Spectral Heat-Map Visualizer, and Multi-Format Exporter.
 */

document.addEventListener('DOMContentLoaded', async () => {
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
        fftSize: 8192,
        onPitchDetected: (data) => updatePitchUI(data),
        onPluck: (data) => handleDetectedPluck(data),
        onNoteOff: (data) => handleDetectedNoteOff(data),
        onSilence: () => handleSilenceUI(),
        onWaveformData: (buffer) => renderVUMeter(buffer),
        onAudioMetrics: (metrics) => renderAudioMetrics(metrics),
        onChromaData: (freqBytes, sampleRate) => handleLiveChordRecognition(freqBytes, sampleRate)
    });

    // 3.5 Initialize Polyphonic Chord Recognizer
    const chordRecognizer = (typeof ChordEngine !== 'undefined') ? 
        new ChordEngine.PolyphonicChordRecognizer({
            sampleRate: 44100,
            stabilityThreshold: 3,
            hysteresisMargin: 14
        }) : null;

    // 4. Initialize Playback Synthesizer Engine (Karplus-Strong & PolySynth)
    const synth = new GuitarSynth({
        soundEngine: 'karplus',
        volume: 0.85
    });

    // 5. Initialize Multi-Format Exporter
    const exporter = new GuitarExporter({
        title: 'FretDSP Studio Transcription',
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

    // 7. Initialize Auto-Scrolling Tablature Staff & Practice Trainer
    const tablature = new TablatureStaff('tablatureCanvas', {
        bpm: 120,
        pixelsPerBeat: 105,
        playheadRatio: 0.35,
        quantizer: quantizer,
        onMetronomeClick: (data) => handleMetronomeTick(data),
        onSpeedTrainerAccelerate: (newBpm, oldBpm) => {
            showToast(`⚡ Speed Trainer: Accelerating tempo to ${newBpm} BPM (+${newBpm - oldBpm})!`, 'info');
            if (tempoSlider) tempoSlider.value = newBpm;
            if (tempoValue) tempoValue.textContent = `${newBpm} BPM`;
        }
    });

    // 8. Initialize Tablature Playback Controller
    const playbackController = new TablaturePlaybackController({
        tablature: tablature,
        fretboard: fretboard,
        synth: synth,
        optimizer: optimizer,
        isLooping: false,
        onPlaybackStateChange: ({ isPlaying }) => {
            if (btnPlayBack) {
                if (isPlaying) {
                    btnPlayBack.innerHTML = '<span>⏹</span> Stop Playback';
                    btnPlayBack.classList.add('btn-playing');
                } else {
                    btnPlayBack.innerHTML = '<span>▶</span> Play Back';
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
            simulateSynthAudioMetrics(0.35);
        }
    });

    // 9. Initialize Lower Stage: Real-Time FFT Spectral Heat-Map Visualizer
    const spectralVisualizer = new SpectralHeatmapVisualizer('spectralCanvas', {
        dsp: dsp,
        synth: synth
    });

    // 10. Initialize High-Precision Virtual Strobe Tuner & Acoustic Inharmonicity Analyzer
    const strobeTuner = new StrobeTuner('strobeCanvas', null, null, {
        preset: 'standard',
        a4: 440,
        targetString: 0,
        onTuningChange: (tuningInfo) => {
            const presetKey = tuningInfo.preset;
            if (selectTuning && selectTuning.value !== presetKey) {
                selectTuning.value = presetKey;
            }
            if (selectStrobeTuning && selectStrobeTuning.value !== presetKey) {
                selectStrobeTuning.value = presetKey;
            }
            optimizer.setTuning(presetKey, tuningInfo.midiHighToLow);
            fretboard.stringNames = tuningInfo.stringNames;
            tablature.stringNames = tuningInfo.stringNames;
            exporter.tuning.names = tuningInfo.stringNames;
            exporter.tuning.strings = tuningInfo.midiHighToLow;
            fretboard.render();
            tablature.render();
            showToast(`Tuning preset: ${tuningInfo.name} (${tuningInfo.stringNames.join(' ')})`);
        },
        onPitchAnalysis: (data) => {
            updateStrobeAnalysisUI(data);
        },
        onInharmonicity: (data) => {
            updateInharmonicityUI(data);
        }
    });
    strobeTuner.start();

    // State
    let isMicActive = false;
    let isMetronomeSoundOn = true;
    let tapTimes = [];
    let demoPlaybackTimer = null;
    let isDemoPlaying = false;
    let clipDecayTimer = null;

    // DOM Elements - Header & Input Gain Meter
    const inputGainDb = document.getElementById('inputGainDb');
    const vuMeterBar = document.getElementById('vuMeterBar');
    const clipWarningLed = document.getElementById('clipWarningLed');
    const clipWarningText = document.getElementById('clipWarningText');
    const selectAudioInput = document.getElementById('selectAudioInput');
    const micStatusIndicator = document.getElementById('micStatusIndicator');

    // DOM Elements - Master Control Bar
    const btnMicToggle = document.getElementById('btnMicToggle');
    const btnMicLabel = document.getElementById('btnMicLabel');
    const listenLed = document.getElementById('listenLed');

    const bpmSlider = document.getElementById('bpmSlider');
    const bpmDisplay = document.getElementById('bpmDisplay');
    const btnBpmMinus = document.getElementById('btnBpmMinus');
    const btnBpmPlus = document.getElementById('btnBpmPlus');
    const btnTapTempo = document.getElementById('btnTapTempo');
    const btnMetronomeSound = document.getElementById('btnMetronomeSound');
    const metronomePulse = document.getElementById('metronomePulse');
    const metronomeBeatDisplay = document.getElementById('metronomeBeatDisplay');

    const selectQuantizeGrid = document.getElementById('selectQuantizeGrid');
    const btnLiveQuantize = document.getElementById('btnLiveQuantize');
    const btnQuantizeNow = document.getElementById('btnQuantizeNow');

    const noteBadge = document.getElementById('noteBadge');
    const freqDisplay = document.getElementById('freqDisplay');
    const tunerNeedle = document.getElementById('tunerNeedle');
    const centsDisplay = document.getElementById('centsDisplay');
    const tunerFlatArrow = document.getElementById('tunerFlatArrow');
    const tunerSharpArrow = document.getElementById('tunerSharpArrow');
    const handPosBadge = document.getElementById('handPosBadge');

    // DOM Elements - Main Stage
    const selectTuning = document.getElementById('selectTuning');
    const selectErgoMode = document.getElementById('selectErgoMode');
    const noiseGateSlider = document.getElementById('noiseGateSlider');
    const noiseGateVal = document.getElementById('noiseGateVal');

    const btnPlayBack = document.getElementById('btnPlayBack');
    const btnPlayPause = document.getElementById('btnPlayPause');
    const btnRewind = document.getElementById('btnRewind');
    const btnClearTab = document.getElementById('btnClearTab');
    const btnLoopTab = document.getElementById('btnLoopTab');
    const selectSynthSound = document.getElementById('selectSynthSound');
    const zoomSlider = document.getElementById('zoomSlider');

    // DOM Elements - Strobe Tuner & Acoustic Inharmonicity Analyzer
    const selectStrobeTuning = document.getElementById('selectStrobeTuning');
    const selectStrobeString = document.getElementById('selectStrobeString');
    const stringWearBadge = document.getElementById('stringWearBadge');
    const inharmGaugeFill = document.getElementById('inharmGaugeFill');
    const inharmBVal = document.getElementById('inharmBVal');
    const inharmR2Val = document.getElementById('inharmR2Val');
    const inharmF0Val = document.getElementById('inharmF0Val');
    const strobeCentsReadout = document.getElementById('strobeCentsReadout');
    const peaksTableBody = document.getElementById('peaksTableBody');
    const btnPluckFresh = document.getElementById('btnPluckFresh');
    const btnPluckNormal = document.getElementById('btnPluckNormal');
    const btnPluckWorn = document.getElementById('btnPluckWorn');

    // DOM Elements - Action Tray
    const btnExportAsciiQuick = document.getElementById('btnExportAsciiQuick');
    const btnDownloadMidiQuick = document.getElementById('btnDownloadMidiQuick');
    const btnShareLink = document.getElementById('btnShareLink');
    const btnOpenExportModal = document.getElementById('btnOpenExportModal');
    const selectDemoSong = document.getElementById('selectDemoSong');
    const btnPlayDemo = document.getElementById('btnPlayDemo');

    // DOM Elements - Multi-Format Exporter Modal
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

    // Toast Container
    const toastContainer = document.getElementById('toastContainer');

    function showToast(message, type = 'info') {
        if (!toastContainer) return;
        const toast = document.createElement('div');
        toast.className = 'toast';
        const icon = type === 'success' ? '✓' : (type === 'warn' ? '⚠️' : '⚡');
        toast.innerHTML = `<span style="color: var(--led-cyan); font-weight: 800;">${icon}</span> <span>${message}</span>`;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-fadeout');
            setTimeout(() => toast.remove(), 260);
        }, 3200);
    }

    // Start tablature auto-scroll by default
    tablature.play();

    // -------------------------------------------------------------------------
    // Polyphonic Chord Recognition & Live Scale Overlay Wiring
    // -------------------------------------------------------------------------
    const detectedChordBadge = document.getElementById('detectedChordBadge');
    const chordConfidenceBadge = document.getElementById('chordConfidenceBadge');
    const chordRootBadge = document.getElementById('chordRootBadge');
    const recommendedScaleBadge = document.getElementById('recommendedScaleBadge');
    const selectTestChord = document.getElementById('selectTestChord');
    const btnToggleScaleOverlay = document.getElementById('btnToggleScaleOverlay');
    const selectOverlayMode = document.getElementById('selectOverlayMode');
    const btnToggleAvoidNotes = document.getElementById('btnToggleAvoidNotes');

    // Initialize with Am7 Scale Overlay (A Minor Pentatonic / A Dorian)
    if (typeof ChordEngine !== 'undefined') {
        const initialOverlay = ChordEngine.getScaleOverlay('Am7');
        fretboard.setScaleOverlay(initialOverlay);
    }

    if (selectTestChord) {
        selectTestChord.addEventListener('change', () => {
            const chord = selectTestChord.value;
            if (typeof ChordEngine !== 'undefined') {
                const overlay = ChordEngine.getScaleOverlay(chord);
                if (detectedChordBadge) detectedChordBadge.textContent = chord;
                if (chordRootBadge) chordRootBadge.textContent = `Root: ${overlay.root || '--'}`;
                if (chordConfidenceBadge) chordConfidenceBadge.textContent = '100% Sim';
                if (recommendedScaleBadge) recommendedScaleBadge.textContent = overlay.scaleName;
                fretboard.setScaleOverlay(overlay);
                showToast(`Scale Overlay: ${overlay.scaleName}`);
            }
        });
    }

    if (btnToggleScaleOverlay) {
        btnToggleScaleOverlay.addEventListener('click', () => {
            fretboard.scaleOverlayVisible = !fretboard.scaleOverlayVisible;
            btnToggleScaleOverlay.classList.toggle('active', fretboard.scaleOverlayVisible);
            btnToggleScaleOverlay.innerHTML = `<span class="jewel-led ${fretboard.scaleOverlayVisible ? 'jewel-cyan' : ''}"></span> Overlay: ${fretboard.scaleOverlayVisible ? 'ON' : 'OFF'}`;
        });
    }

    if (selectOverlayMode) {
        selectOverlayMode.addEventListener('change', () => {
            fretboard.scaleOverlayMode = selectOverlayMode.value;
        });
    }

    if (btnToggleAvoidNotes) {
        btnToggleAvoidNotes.addEventListener('click', () => {
            fretboard.scaleOverlayShowAvoid = !fretboard.scaleOverlayShowAvoid;
            btnToggleAvoidNotes.classList.toggle('active', fretboard.scaleOverlayShowAvoid);
            btnToggleAvoidNotes.textContent = `Avoid: ${fretboard.scaleOverlayShowAvoid ? 'SHOW' : 'HIDE'}`;
        });
    }

    let lastChordUpdateTime = 0;
    function handleLiveChordRecognition(freqBytes, sampleRate) {
        if (!chordRecognizer) return;
        const now = performance.now();
        if (now - lastChordUpdateTime < 60) return; // Cap UI refresh rate at ~16 Hz
        lastChordUpdateTime = now;

        const res = chordRecognizer.processFrame(freqBytes, sampleRate);
        if (res.chord && res.chord !== 'None' && res.confidence >= 40) {
            if (detectedChordBadge) detectedChordBadge.textContent = res.chord;
            if (chordConfidenceBadge) chordConfidenceBadge.textContent = `${res.confidence}% Conf`;
            if (chordRootBadge) chordRootBadge.textContent = res.root ? `Root: ${res.root}` : `Root: --`;

            const overlay = ChordEngine.getScaleOverlay(res.chord);
            if (recommendedScaleBadge) recommendedScaleBadge.textContent = overlay.scaleName;
            fretboard.setScaleOverlay(overlay);
        } else if (res.confidence < 25) {
            if (chordConfidenceBadge) chordConfidenceBadge.textContent = `${res.confidence}% Conf`;
        }
    }

    // Populate microphone device dropdown
    async function populateAudioDevices() {
        if (!selectAudioInput) return;
        const devices = await dsp.getAudioInputDevices();
        if (devices && devices.length > 0) {
            selectAudioInput.innerHTML = '';
            devices.forEach((dev, idx) => {
                const opt = document.createElement('option');
                opt.value = dev.deviceId;
                opt.textContent = dev.label || `Audio Input ${idx + 1}`;
                selectAudioInput.appendChild(opt);
            });
        }
    }
    populateAudioDevices();

    // =========================================================================
    // Core Audio & Optimization Flow (DSP -> Optimizer -> Visualizers)
    // =========================================================================

    function handleDetectedPluck(data) {
        const result = optimizer.optimize(data.midi);
        if (!result) return;

        fretboard.lightUpNote(result.string, result.fret, result.noteName + result.octave, result.finger);

        tablature.recordNote({
            string: result.string,
            fret: result.fret,
            finger: result.finger,
            noteName: result.noteName + result.octave,
            midi: data.midi,
            rawTime: tablature.currentTime
        });

        if (handPosBadge) {
            handPosBadge.textContent = `Pos: Fret ${result.handPosition}`;
        }
    }

    function handleDetectedNoteOff() {
        for (let s = 1; s <= 6; s++) {
            tablature.releaseNote(s);
        }
    }

    function updatePitchUI(data) {
        // Read-only consumption of live pitch for real-time note accuracy grading
        if (tablature && tablature.scoreLivePitch && data) {
            tablature.scoreLivePitch(data);
        }

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

            const angle = Math.max(-45, Math.min(45, cents * 0.9));
            tunerNeedle.style.transform = `translateX(-50%) rotate(${angle}deg)`;

            // Visual in-tune / flat / sharp indicators
            const absCents = Math.abs(cents);
            if (absCents <= 3) {
                centsDisplay.style.color = '#10b981';
                tunerNeedle.style.backgroundColor = '#10b981';
                if (tunerFlatArrow) tunerFlatArrow.style.color = 'var(--text-dim)';
                if (tunerSharpArrow) tunerSharpArrow.style.color = 'var(--text-dim)';
            } else if (cents < -3) {
                centsDisplay.style.color = 'var(--led-amber)';
                tunerNeedle.style.backgroundColor = 'var(--led-amber)';
                if (tunerFlatArrow) tunerFlatArrow.style.color = 'var(--led-amber)';
                if (tunerSharpArrow) tunerSharpArrow.style.color = 'var(--text-dim)';
            } else {
                centsDisplay.style.color = 'var(--led-cyan)';
                tunerNeedle.style.backgroundColor = 'var(--led-cyan)';
                if (tunerFlatArrow) tunerFlatArrow.style.color = 'var(--text-dim)';
                if (tunerSharpArrow) tunerSharpArrow.style.color = 'var(--led-cyan)';
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
        if (tunerFlatArrow) tunerFlatArrow.style.color = 'var(--text-dim)';
        if (tunerSharpArrow) tunerSharpArrow.style.color = 'var(--text-dim)';
        if (inputGainDb) inputGainDb.textContent = '-inf dBFS';
        if (vuMeterBar) vuMeterBar.style.width = '0%';
    }

    function updateStrobeAnalysisUI(data) {
        if (!data) return;
        if (strobeCentsReadout) {
            const sign = data.cents >= 0 ? '+' : '';
            strobeCentsReadout.textContent = `${sign}${data.cents.toFixed(1)} ¢`;
            strobeCentsReadout.style.color = Math.abs(data.cents) <= 0.5 ? '#10b981' : Math.abs(data.cents) <= 3 ? '#00f3ff' : data.cents > 0 ? '#f59e0b' : '#38bdf8';
        }
        if (inharmF0Val) {
            inharmF0Val.textContent = `${data.frequency.toFixed(1)} Hz`;
        }
    }

    function updateInharmonicityUI(data) {
        if (!data) return;
        if (inharmBVal) {
            inharmBVal.textContent = `${(data.B * 1000).toFixed(2)} × 10⁻³`;
        }
        if (inharmR2Val) {
            inharmR2Val.textContent = `${(data.rSquared * 100).toFixed(1)}%`;
        }
        if (inharmF0Val) {
            inharmF0Val.textContent = `${data.f0.toFixed(1)} Hz`;
        }
        if (stringWearBadge) {
            stringWearBadge.className = `wear-badge wear-${data.stringWear.toLowerCase()}`;
            const wearTextMap = {
                Fresh: 'Fresh String (Studio Quality)',
                Good: 'Good Condition (Playable)',
                Aged: 'Aged String (Intonation Drift)',
                Worn: 'Worn String (High Inharmonicity)'
            };
            stringWearBadge.textContent = wearTextMap[data.stringWear] || data.stringWear;
        }
        if (inharmGaugeFill) {
            const pct = Math.max(5, Math.min(100, Math.round(data.wearSeverity * 100)));
            inharmGaugeFill.style.width = `${pct}%`;
        }
        if (peaksTableBody && Array.isArray(data.partials) && data.partials.length > 0) {
            peaksTableBody.innerHTML = '';
            data.partials.forEach(p => {
                const tr = document.createElement('tr');
                const deltaSign = p.deltaHz >= 0 ? '+' : '';
                const centsSign = p.centsShift >= 0 ? '+' : '';
                tr.innerHTML = `
                    <td><strong>${p.n}</strong> (f<sub>${p.n}</sub>)</td>
                    <td>${p.pureHarmonic.toFixed(2)} Hz</td>
                    <td><strong style="color: var(--led-cyan);">${p.freq.toFixed(2)} Hz</strong></td>
                    <td>${deltaSign}${p.deltaHz.toFixed(2)} Hz</td>
                    <td style="color: ${Math.abs(p.centsShift) < 1.0 ? '#10b981' : '#f59e0b'}; font-weight: 700;">${centsSign}${p.centsShift.toFixed(1)} ¢</td>
                `;
                peaksTableBody.appendChild(tr);
            });
        }
    }

    function renderAudioMetrics(metrics) {
        if (inputGainDb) {
            if (metrics.rmsDb > -58) {
                inputGainDb.textContent = `${metrics.rmsDb.toFixed(1)} dBFS`;
            } else {
                inputGainDb.textContent = '-inf dBFS';
            }
        }

        if (vuMeterBar) {
            // Map -50dB..0dB to 0%..100%
            const clampedDb = Math.max(-50, Math.min(0, metrics.rmsDb));
            const pct = Math.round(((clampedDb + 50) / 50) * 100);
            vuMeterBar.style.width = `${pct}%`;
        }

        if (metrics.isClipping) {
            triggerClipWarning();
        }
    }

    function triggerClipWarning() {
        if (!clipWarningLed || !clipWarningText) return;
        clipWarningLed.classList.add('active');
        clipWarningText.classList.add('active');

        if (clipDecayTimer) clearTimeout(clipDecayTimer);
        clipDecayTimer = setTimeout(() => {
            clipWarningLed.classList.remove('active');
            clipWarningText.classList.remove('active');
        }, 480);
    }

    function simulateSynthAudioMetrics(level = 0.25) {
        if (isMicActive) return;
        const db = 20 * Math.log10(level / 0.707);
        renderAudioMetrics({
            rms: level,
            peakSample: level * 1.4,
            rmsDb: db,
            isClipping: level > 0.85
        });
        setTimeout(() => {
            if (!isMicActive) handleSilenceUI();
        }, 350);
    }

    function renderVUMeter(buffer) {
        // Fallback waveform listener
        if (!vuMeterBar) return;
    }

    // =========================================================================
    // Interactive Click on Fretboard (Synthesize + Tabulate)
    // =========================================================================
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

        const finger = optimizer.assignFinger(fret, optimizer.handAnchorFret);

        synth.playNote(midi, 1.8, 0.85, string);
        fretboard.lightUpNote(string, fret, fullNoteName, finger);

        tablature.recordNote({
            string: string,
            fret: fret,
            finger: finger,
            noteName: fullNoteName,
            midi: midi,
            rawTime: tablature.currentTime
        });

        updatePitchUI({
            noteName: noteName,
            octave: octave,
            frequency: synth.midiToFrequency(midi),
            cents: 0
        });

        simulateSynthAudioMetrics(0.4);
    }

    // =========================================================================
    // Metronome Beat Callback (Click + Visual Flash)
    // =========================================================================
    function handleMetronomeTick(data) {
        if (metronomePulse) {
            metronomePulse.classList.remove('flash', 'downbeat');
            void metronomePulse.offsetWidth; // Trigger reflow
            metronomePulse.classList.add('flash');
            if (data.isDownbeat) {
                metronomePulse.classList.add('downbeat');
            }
        }

        if (metronomeBeatDisplay) {
            metronomeBeatDisplay.textContent = `M${data.measure} : Beat ${data.beat}`;
        }

        if (isMetronomeSoundOn) {
            synth.initAudioContext().then(() => {
                synth.playMetronomeClick(data.isDownbeat);
            });
        }
    }

    // =========================================================================
    // Master Control Bar Handlers
    // =========================================================================

    // 1. Microphone Start/Pause Listening Footswitch
    if (btnMicToggle) {
        btnMicToggle.addEventListener('click', async () => {
            if (!isMicActive) {
                if (btnMicLabel) btnMicLabel.textContent = 'Engaging...';
                const selectedDevId = selectAudioInput ? selectAudioInput.value : null;
                const rack = await ensureEffectsRack();
                const res = await dsp.startMicrophone(selectedDevId === 'default' ? null : selectedDevId);

                if (res.success) {
                    isMicActive = true;
                    if (rack && dsp.sourceNode) {
                        rack.setSourceNode(dsp.sourceNode);
                    }
                    if (dsp.audioCtx && dsp.analyser) {
                        strobeTuner.connectAudio(dsp.audioCtx, dsp.analyser);
                    }
                    btnMicToggle.classList.add('listening-active');
                    if (listenLed) listenLed.classList.add('active');
                    if (btnMicLabel) btnMicLabel.textContent = 'Stop Listening';
                    if (micStatusIndicator) {
                        micStatusIndicator.className = 'toggle-switch-btn active';
                        micStatusIndicator.innerHTML = '<span class="jewel-led active" style="width: 8px; height: 8px;"></span> Live Listening';
                    }
                    showToast('Microphone pitch DSP engine engaged with effects rack tap.', 'success');
                    populateAudioDevices();
                } else {
                    if (btnMicLabel) btnMicLabel.textContent = 'Start Listening';
                    showToast('Could not access microphone: ' + res.error, 'warn');
                }
            } else {
                dsp.stopMicrophone();
                if (effectsRack) {
                    effectsRack.setSourceNode(null);
                }
                isMicActive = false;
                btnMicToggle.classList.remove('listening-active');
                if (listenLed) listenLed.classList.remove('active');
                if (btnMicLabel) btnMicLabel.textContent = 'Start Listening';
                if (micStatusIndicator) {
                    micStatusIndicator.className = 'toggle-switch-btn';
                    micStatusIndicator.innerHTML = '<span class="jewel-led" style="width: 8px; height: 8px;"></span> Standby';
                }
                handleSilenceUI();
                showToast('Microphone listening paused.');
            }
        });
    }

    // Microphone device selector change
    if (selectAudioInput) {
        selectAudioInput.addEventListener('change', async () => {
            if (isMicActive) {
                dsp.stopMicrophone();
                const devId = selectAudioInput.value;
                await dsp.startMicrophone(devId === 'default' ? null : devId);
                if (dsp.audioCtx && dsp.analyser) {
                    strobeTuner.connectAudio(dsp.audioCtx, dsp.analyser);
                }
                showToast('Switched audio input interface.');
            }
        });
    }

    // 2. Metronome BPM Controls
    function updateBPM(val) {
        val = Math.max(40, Math.min(240, parseInt(val, 10) || 120));
        if (bpmSlider) bpmSlider.value = val;
        if (bpmDisplay) bpmDisplay.textContent = `${val} BPM`;
        tablature.setBPM(val);
        quantizer.setBPM(val);
        exporter.bpm = val;
    }

    if (bpmSlider) bpmSlider.addEventListener('input', (e) => updateBPM(e.target.value));
    if (btnBpmMinus) btnBpmMinus.addEventListener('click', () => updateBPM(tablature.bpm - 2));
    if (btnBpmPlus) btnBpmPlus.addEventListener('click', () => updateBPM(tablature.bpm + 2));

    // Tap Tempo
    if (btnTapTempo) {
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
    }

    // Metronome Sound Toggle
    if (btnMetronomeSound) {
        btnMetronomeSound.addEventListener('click', () => {
            isMetronomeSoundOn = !isMetronomeSoundOn;
            btnMetronomeSound.classList.toggle('active', isMetronomeSoundOn);
            btnMetronomeSound.innerHTML = isMetronomeSoundOn 
                ? '<span class="icon">🔔</span> Click ON' 
                : '<span class="icon">🔕</span> Click Muted';
        });
    }

    // 3. Quantize Controls
    if (selectQuantizeGrid) {
        selectQuantizeGrid.addEventListener('change', (e) => {
            quantizer.setGrid(e.target.value);
            showToast(`Quantize grid set to ${e.target.value}.`);
        });
    }

    if (btnLiveQuantize) {
        btnLiveQuantize.addEventListener('click', () => {
            quantizer.liveQuantize = !quantizer.liveQuantize;
            btnLiveQuantize.classList.toggle('active', quantizer.liveQuantize);
            btnLiveQuantize.innerHTML = quantizer.liveQuantize
                ? '<span>🎯</span> Live: ON'
                : '<span>🎯</span> Live: OFF';
            showToast(quantizer.liveQuantize ? 'Real-time quantization enabled.' : 'Raw timestamps mode.');
        });
    }

    if (btnQuantizeNow) {
        btnQuantizeNow.addEventListener('click', () => {
            tablature.quantizeRecordedNotes();
            showToast('Quantized all recorded tablature notes to active grid.', 'success');
        });
    }

    // =========================================================================
    // Tablature Transport Controls (Play, Pause, Clear, Loop)
    // =========================================================================

    // Playback Button
    if (btnPlayBack) {
        btnPlayBack.addEventListener('click', async () => {
            if (isDemoPlaying) {
                clearTimeout(demoPlaybackTimer);
                isDemoPlaying = false;
                if (btnPlayDemo) btnPlayDemo.innerHTML = '<span>▶</span> Play Demo';
            }

            if (tablature.notes.length === 0) {
                showToast('No notes on the tablature to play! Click the fretboard or load a demo riff.', 'warn');
                return;
            }

            await synth.initAudioContext();
            if (synth.audioCtx) tablature.setAudioContext(synth.audioCtx);
            playbackController.togglePlayback();
        });
    }

    // Play/Pause Scrolling Staff
    if (btnPlayPause) {
        btnPlayPause.addEventListener('click', () => {
            if (playbackController.isPlaying) {
                playbackController.stopPlayback();
            }
            const playing = tablature.togglePlay();
            btnPlayPause.innerHTML = playing 
                ? '<span>⏸</span> Pause Scroll' 
                : '<span>▶</span> Resume Scroll';
            btnPlayPause.classList.toggle('active', !playing);
        });
    }

    // Rewind Tab
    if (btnRewind) {
        btnRewind.addEventListener('click', () => {
            if (playbackController.isPlaying) {
                playbackController.stopPlayback();
            }
            tablature.rewind();
            showToast('Rewound timeline to Measure 1.');
        });
    }

    // Clear Tab
    if (btnClearTab) {
        btnClearTab.addEventListener('click', () => {
            if (confirm('Clear all recorded tablature notes?')) {
                if (playbackController.isPlaying) {
                    playbackController.stopPlayback();
                }
                tablature.clearNotes();
                showToast('Staff cleared.');
            }
        });
    }

    // Loop Toggle Button
    if (btnLoopTab) {
        btnLoopTab.addEventListener('click', () => {
            const looping = playbackController.toggleLoop();
            btnLoopTab.classList.toggle('active', looping);
            btnLoopTab.innerHTML = looping 
                ? '<span>🔁</span> Loop: ON' 
                : '<span>🔁</span> Loop: OFF';
            showToast(looping ? 'Continuous loop playback enabled.' : 'Loop playback disabled.');
        });
    }

    if (selectSynthSound) {
        selectSynthSound.addEventListener('change', (e) => {
            synth.setSoundEngine(e.target.value);
            showToast(`Synthesizer model: ${e.target.value === 'karplus' ? 'Karplus-Strong String' : 'Poly Clean'}`);
        });
    }

    if (zoomSlider) {
        zoomSlider.addEventListener('input', (e) => {
            tablature.setZoom(parseInt(e.target.value, 10));
        });
    }

    // Tuning Preset Selectors (Synced between Main Stage & Virtual Strobe Tuner)
    if (selectTuning) {
        selectTuning.addEventListener('change', (e) => {
            strobeTuner.setTuning(e.target.value);
        });
    }

    if (selectStrobeTuning) {
        selectStrobeTuning.addEventListener('change', (e) => {
            strobeTuner.setTuning(e.target.value);
        });
    }

    if (selectStrobeString) {
        selectStrobeString.addEventListener('change', (e) => {
            strobeTuner.setTargetString(parseInt(e.target.value, 10));
        });
    }

    // Interactive Synthetic Pluck Buttons for Instant Physics & Inharmonicity Demo
    if (btnPluckFresh) {
        btnPluckFresh.addEventListener('click', async () => {
            await dsp.initAudioContext();
            strobeTuner.connectAudio(dsp.audioCtx, dsp.analyser);
            const targetF = strobeTuner.targetFreq || 82.41;
            strobeTuner.simulatePluck(targetF, 0.00015, 2.0);
            showToast(`Simulated Fresh String Pluck at ${targetF.toFixed(1)} Hz (B = 1.5×10⁻⁴)`);
        });
    }

    if (btnPluckNormal) {
        btnPluckNormal.addEventListener('click', async () => {
            await dsp.initAudioContext();
            strobeTuner.connectAudio(dsp.audioCtx, dsp.analyser);
            const targetF = strobeTuner.targetFreq || 82.41;
            strobeTuner.simulatePluck(targetF, 0.00035, 2.0);
            showToast(`Simulated Good String Pluck at ${targetF.toFixed(1)} Hz (B = 3.5×10⁻⁴)`);
        });
    }

    if (btnPluckWorn) {
        btnPluckWorn.addEventListener('click', async () => {
            await dsp.initAudioContext();
            strobeTuner.connectAudio(dsp.audioCtx, dsp.analyser);
            const targetF = strobeTuner.targetFreq || 82.41;
            strobeTuner.simulatePluck(targetF, 0.00120, 2.0);
            showToast(`Simulated Worn String Pluck at ${targetF.toFixed(1)} Hz (B = 1.2×10⁻³)`);
        });
    }

    if (selectErgoMode) {
        selectErgoMode.addEventListener('change', (e) => {
            optimizer.setMode(e.target.value);
            showToast(`Ergonomic mode: ${e.target.value}`);
        });
    }

    if (noiseGateSlider && noiseGateVal) {
        noiseGateSlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            dsp.noiseGateRMS = val;
            noiseGateVal.textContent = val.toFixed(3);
        });
    }

    // =========================================================================
    // Action Tray Handlers (Export ASCII, Download MIDI, Copy Link, Demo Riffs)
    // =========================================================================

    // 1. Quick Export ASCII Tab
    if (btnExportAsciiQuick) {
        btnExportAsciiQuick.addEventListener('click', () => {
            const notes = tablature.notes;
            const bpm = tablature.bpm;
            exporter.bpm = bpm;
            exporter.tuning = {
                name: selectTuning.options[selectTuning.selectedIndex]?.text || 'Standard',
                strings: optimizer.openMidi,
                names: tablature.stringNames
            };
            const ascii = exporter.toASCII(notes, bpm);

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(ascii).then(() => {
                    showToast('ASCII Tab copied to clipboard!', 'success');
                });
            }

            // Also open modal preview
            refreshExportModalContent();
            if (exportModal) {
                exportModal.classList.add('open');
                const asciiTabBtn = document.querySelector('.export-tab-btn[data-tab="ascii"]');
                if (asciiTabBtn) asciiTabBtn.click();
            }
        });
    }

    // 2. Quick Download MIDI File
    if (btnDownloadMidiQuick) {
        btnDownloadMidiQuick.addEventListener('click', () => {
            if (tablature.notes.length === 0) {
                showToast('No notes to export to MIDI! Pluck strings or play a demo first.', 'warn');
                return;
            }
            exporter.downloadMIDI(tablature.notes, tablature.bpm, 'fret_transcription.mid');
            showToast('Downloaded Standard MIDI File (.mid)!', 'success');
        });
    }

    // 3. Quick Copy Shareable Link (Serializes Riff into URL Hash)
    if (btnShareLink) {
        btnShareLink.addEventListener('click', () => {
            if (tablature.notes.length === 0) {
                showToast('Tablature is empty. Add notes to create a shareable link.', 'warn');
                return;
            }

            try {
                const riffData = {
                    bpm: tablature.bpm,
                    tuning: selectTuning.value,
                    notes: tablature.notes.map(n => ({
                        s: n.string,
                        f: n.fret,
                        t: parseFloat(n.time.toFixed(3)),
                        d: parseFloat((n.duration || 0.4).toFixed(3)),
                        n: n.noteName,
                        m: n.midi
                    }))
                };
                const jsonStr = JSON.stringify(riffData);
                const b64 = btoa(encodeURIComponent(jsonStr));
                const shareUrl = `${window.location.origin}${window.location.pathname}#riff=${b64}`;

                window.history.replaceState(null, '', `#riff=${b64}`);

                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                        showToast('Shareable link copied to clipboard!', 'success');
                    });
                } else {
                    prompt('Copy this shareable link:', shareUrl);
                }
            } catch (err) {
                console.error("Link serialization error:", err);
                showToast('Could not serialize shareable link.', 'warn');
            }
        });
    }

    // 4. Restore Shared Riff from URL Hash on boot
    function checkUrlForSharedRiff() {
        const hash = window.location.hash;
        if (hash && hash.startsWith('#riff=')) {
            try {
                const b64 = hash.replace('#riff=', '');
                const jsonStr = decodeURIComponent(atob(b64));
                const data = JSON.parse(jsonStr);

                if (data && Array.isArray(data.notes)) {
                    if (data.bpm) updateBPM(data.bpm);
                    if (data.tuning && selectTuning) {
                        selectTuning.value = data.tuning;
                        selectTuning.dispatchEvent(new Event('change'));
                    }
                    const reconstructedNotes = data.notes.map(n => ({
                        string: n.s,
                        fret: n.f,
                        time: n.t,
                        duration: n.d,
                        noteName: n.n,
                        midi: n.m,
                        finger: optimizer.assignFinger(n.f, optimizer.handAnchorFret)
                    }));
                    tablature.clearNotes();
                    tablature.loadSong(reconstructedNotes, data.bpm || 120);
                    showToast('Loaded shared guitar score from link!', 'success');
                }
            } catch (e) {
                console.warn("Could not parse shared riff from URL hash:", e);
            }
        }
    }
    checkUrlForSharedRiff();

    // 5. Demo Song Playback
    if (btnPlayDemo) {
        btnPlayDemo.addEventListener('click', () => {
            dsp.initAudioContext();
            synth.initAudioContext();
            const songKey = selectDemoSong ? selectDemoSong.value : 'sweetChild';
            const song = DEMO_SONGS[songKey];
            if (!song) return;

            if (isDemoPlaying) {
                clearTimeout(demoPlaybackTimer);
                isDemoPlaying = false;
                btnPlayDemo.innerHTML = '<span>▶</span> Play Demo';
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
            btnPlayDemo.innerHTML = '<span>⏹</span> Stop Demo';
            btnPlayDemo.classList.add('btn-danger');

            const startTime = performance.now();
            const scheduleNote = (idx) => {
                if (!isDemoPlaying || idx >= song.notes.length) {
                    isDemoPlaying = false;
                    btnPlayDemo.innerHTML = '<span>▶</span> Play Demo';
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

                    simulateSynthAudioMetrics(0.38);
                    scheduleNote(idx + 1);
                }, delay);
            };

            scheduleNote(0);
        });
    }

    // =========================================================================
    // Multi-Format Exporter Modal Management
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

        if (asciiContent) asciiContent.value = exporter.toASCII(notes, bpm);
        if (musicxmlContent) musicxmlContent.value = exporter.toMusicXML(notes, bpm);
        if (jsonContent) jsonContent.value = exporter.toJSON(notes, bpm);
        if (midiTempoDisplay) midiTempoDisplay.textContent = `${bpm} BPM`;
        if (midiNotesDisplay) midiNotesDisplay.textContent = `${notes.length} notes`;
    }

    if (btnOpenExportModal) {
        btnOpenExportModal.addEventListener('click', () => {
            refreshExportModalContent();
            if (exportModal) exportModal.classList.add('open');
        });
    }

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

    if (btnCopyAscii && asciiContent) {
        btnCopyAscii.addEventListener('click', () => {
            navigator.clipboard.writeText(asciiContent.value).then(() => {
                showToast('ASCII Tab copied to clipboard!', 'success');
            });
        });
    }
    if (btnDownloadAscii && asciiContent) {
        btnDownloadAscii.addEventListener('click', () => {
            exporter.downloadTextFile(asciiContent.value, 'text/plain', 'guitar_tab.txt');
            showToast('Downloaded guitar_tab.txt');
        });
    }

    if (btnCopyMusicXML && musicxmlContent) {
        btnCopyMusicXML.addEventListener('click', () => {
            navigator.clipboard.writeText(musicxmlContent.value).then(() => {
                showToast('MusicXML copied to clipboard!', 'success');
            });
        });
    }
    if (btnDownloadMusicXML && musicxmlContent) {
        btnDownloadMusicXML.addEventListener('click', () => {
            exporter.downloadTextFile(musicxmlContent.value, 'application/xml', 'guitar_score.musicxml');
            showToast('Downloaded guitar_score.musicxml');
        });
    }

    if (btnCopyJSON && jsonContent) {
        btnCopyJSON.addEventListener('click', () => {
            navigator.clipboard.writeText(jsonContent.value).then(() => {
                showToast('JSON score copied to clipboard!', 'success');
            });
        });
    }
    if (btnDownloadJSON && jsonContent) {
        btnDownloadJSON.addEventListener('click', () => {
            exporter.downloadTextFile(jsonContent.value, 'application/json', 'guitar_score.json');
            showToast('Downloaded guitar_score.json');
        });
    }

    if (btnDownloadMIDI) {
        btnDownloadMIDI.addEventListener('click', () => {
            exporter.downloadMIDI(tablature.notes, tablature.bpm, 'guitar_transcription.mid');
            showToast('Downloaded Standard MIDI File (.mid)!', 'success');
        });
    }

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
    // Guitar Effects Rack (Stompbox Chain) Orchestration & UI Handlers
    // =========================================================================
    let effectsRack = null;
    let isSynthRoutedToFx = true;

    async function ensureEffectsRack() {
        if (effectsRack) return effectsRack;

        // Ensure audio context is ready
        await synth.initAudioContext();
        const audioCtx = synth.audioCtx || (dsp.audioCtx ? dsp.audioCtx : new (window.AudioContext || window.webkitAudioContext)());

        effectsRack = new GuitarEffectsRack(audioCtx, null, {
            destination: audioCtx.destination
        });

        if (dsp) {
            dsp.effectsRack = effectsRack;
        }

        if (synth && isSynthRoutedToFx) {
            synth.routeThroughEffectsRack(effectsRack);
        }

        return effectsRack;
    }

    // --- 1. Tube Screamer / Overdrive Controls ---
    const odDriveSlider = document.getElementById('odDriveSlider');
    const odDriveVal = document.getElementById('odDriveVal');
    const odToneSlider = document.getElementById('odToneSlider');
    const odToneVal = document.getElementById('odToneVal');
    const odLevelSlider = document.getElementById('odLevelSlider');
    const odLevelVal = document.getElementById('odLevelVal');
    const btnOdStomp = document.getElementById('btnOdStomp');
    const odLed = document.getElementById('odLed');
    const odBypassStatus = document.getElementById('odBypassStatus');

    if (odDriveSlider) {
        odDriveSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('overdrive', 'drive', val);
            if (odDriveVal) odDriveVal.textContent = val;
        });
    }

    if (odToneSlider) {
        odToneSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('overdrive', 'tone', val);
            if (odToneVal) {
                const freq = Math.round(rack.od.toneFilter.frequency.targetValue || 2280);
                odToneVal.textContent = `${freq} Hz`;
            }
        });
    }

    if (odLevelSlider) {
        odLevelSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('overdrive', 'level', val);
            if (odLevelVal) odLevelVal.textContent = `${val}%`;
        });
    }

    if (btnOdStomp) {
        btnOdStomp.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            const bypassed = rack.setBypass('overdrive');
            if (odLed) odLed.classList.toggle('active', !bypassed);
            if (odBypassStatus) {
                odBypassStatus.textContent = bypassed ? 'BYPASSED' : 'ENGAGED';
                odBypassStatus.classList.toggle('active', !bypassed);
            }
            showToast(bypassed ? 'Tube Screamer True-Bypass engaged (Dry).' : 'Tube Screamer engaged (Warm Triode Saturation)!', 'success');
        });
    }

    // --- 1.5. Cabinet & Microphone Simulator Controls ---
    const cabProfileSelect = document.getElementById('cabProfileSelect');
    const cabPosSlider = document.getElementById('cabPosSlider');
    const cabPosVal = document.getElementById('cabPosVal');
    const cabDistSlider = document.getElementById('cabDistSlider');
    const cabDistVal = document.getElementById('cabDistVal');
    const btnCabStomp = document.getElementById('btnCabStomp');
    const cabLed = document.getElementById('cabLed');
    const cabBypassStatus = document.getElementById('cabBypassStatus');

    if (cabProfileSelect) {
        cabProfileSelect.addEventListener('change', async (e) => {
            const rack = await ensureEffectsRack();
            const prof = e.target.value;
            rack.setParam('cabinet', 'profile', prof);
            showToast(`Cabinet Profile: ${prof}`, 'info');
        });
    }

    if (cabPosSlider) {
        cabPosSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('cabinet', 'position', val);
            if (cabPosVal) {
                const label = val <= 33 ? 'Center' : (val >= 67 ? 'Edge' : 'Cone');
                cabPosVal.textContent = `${label} ${val}%`;
            }
        });
    }

    if (cabDistSlider) {
        cabDistSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('cabinet', 'distance', val);
            if (cabDistVal) {
                const label = val <= 33 ? 'Near' : (val >= 67 ? 'Far' : 'Mid');
                cabDistVal.textContent = `${label} ${val}%`;
            }
        });
    }

    if (btnCabStomp) {
        btnCabStomp.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            const bypassed = rack.setBypass('cabinet');
            if (cabLed) cabLed.classList.toggle('active', !bypassed);
            if (cabBypassStatus) {
                cabBypassStatus.textContent = bypassed ? 'BYPASSED' : 'ENGAGED';
                cabBypassStatus.classList.toggle('active', !bypassed);
            }
            showToast(bypassed ? 'Cabinet Simulator Bypassed (Raw Fizz).' : 'Cabinet Simulator Engaged (Speaker Resonance)!', 'success');
        });
    }

    // --- 2. Analog BBD Delay Controls ---
    const delayTimeSlider = document.getElementById('delayTimeSlider');
    const delayTimeVal = document.getElementById('delayTimeVal');
    const delayFeedbackSlider = document.getElementById('delayFeedbackSlider');
    const delayFeedbackVal = document.getElementById('delayFeedbackVal');
    const delayMixSlider = document.getElementById('delayMixSlider');
    const delayMixVal = document.getElementById('delayMixVal');
    const btnDelayStomp = document.getElementById('btnDelayStomp');
    const delayLed = document.getElementById('delayLed');
    const delayBypassStatus = document.getElementById('delayBypassStatus');

    if (delayTimeSlider) {
        delayTimeSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('delay', 'time', val);
            if (delayTimeVal) delayTimeVal.textContent = `${val} ms`;
        });
    }

    if (delayFeedbackSlider) {
        delayFeedbackSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('delay', 'feedback', val);
            if (delayFeedbackVal) delayFeedbackVal.textContent = `${val}%`;
        });
    }

    if (delayMixSlider) {
        delayMixSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('delay', 'mix', val);
            if (delayMixVal) delayMixVal.textContent = `${val}%`;
        });
    }

    if (btnDelayStomp) {
        btnDelayStomp.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            const bypassed = rack.setBypass('delay');
            if (delayLed) delayLed.classList.toggle('active', !bypassed);
            if (delayBypassStatus) {
                delayBypassStatus.textContent = bypassed ? 'BYPASSED' : 'ENGAGED';
                delayBypassStatus.classList.toggle('active', !bypassed);
            }
            showToast(bypassed ? 'BBD Delay True-Bypass engaged.' : 'Analog BBD Delay engaged (2200Hz Roll-off)!', 'success');
        });
    }

    // --- 3. Studio Ambient Reverb Controls ---
    const reverbSizeSlider = document.getElementById('reverbSizeSlider');
    const reverbSizeVal = document.getElementById('reverbSizeVal');
    const reverbDampingSlider = document.getElementById('reverbDampingSlider');
    const reverbDampingVal = document.getElementById('reverbDampingVal');
    const reverbMixSlider = document.getElementById('reverbMixSlider');
    const reverbMixVal = document.getElementById('reverbMixVal');
    const btnReverbStomp = document.getElementById('btnReverbStomp');
    const reverbLed = document.getElementById('reverbLed');
    const reverbBypassStatus = document.getElementById('reverbBypassStatus');

    if (reverbSizeSlider) {
        reverbSizeSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('reverb', 'size', val);
            if (reverbSizeVal) reverbSizeVal.textContent = `${val.toFixed(1)}s`;
        });
    }

    if (reverbDampingSlider) {
        reverbDampingSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('reverb', 'damping', val);
            if (reverbDampingVal) reverbDampingVal.textContent = `${val}%`;
        });
    }

    if (reverbMixSlider) {
        reverbMixSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('reverb', 'mix', val);
            if (reverbMixVal) reverbMixVal.textContent = `${val}%`;
        });
    }

    if (btnReverbStomp) {
        btnReverbStomp.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            const bypassed = rack.setBypass('reverb');
            if (reverbLed) reverbLed.classList.toggle('active', !bypassed);
            if (reverbBypassStatus) {
                reverbBypassStatus.textContent = bypassed ? 'BYPASSED' : 'ENGAGED';
                reverbBypassStatus.classList.toggle('active', !bypassed);
            }
            showToast(bypassed ? 'Ambient Reverb True-Bypass engaged.' : 'Studio Ambient Reverb engaged (Convolver Tank)!', 'success');
        });
    }

    // --- 4. Master Control & Routing Bay ---
    const masterVolumeSlider = document.getElementById('masterVolumeSlider');
    const masterVolumeVal = document.getElementById('masterVolumeVal');
    const btnMasterStomp = document.getElementById('btnMasterStomp');
    const masterLed = document.getElementById('masterLed');
    const masterBypassStatus = document.getElementById('masterBypassStatus');
    const btnMonitorSpeakers = document.getElementById('btnMonitorSpeakers');
    const monitorStatusText = document.getElementById('monitorStatusText');
    const btnRouteSynthToFx = document.getElementById('btnRouteSynthToFx');
    const synthFxStatusText = document.getElementById('synthFxStatusText');

    if (masterVolumeSlider) {
        masterVolumeSlider.addEventListener('input', async (e) => {
            const rack = await ensureEffectsRack();
            const val = Number(e.target.value);
            rack.setParam('master', 'volume', val);
            if (masterVolumeVal) masterVolumeVal.textContent = `${val}%`;
        });
    }

    if (btnMasterStomp) {
        btnMasterStomp.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            const bypassed = rack.setBypass('master');
            if (masterLed) masterLed.classList.toggle('active', !bypassed);
            if (masterBypassStatus) {
                masterBypassStatus.textContent = bypassed ? 'ALL BYPASSED' : 'RACK ENGAGED';
                masterBypassStatus.classList.toggle('active', !bypassed);
            }
            showToast(bypassed ? 'Master Rack True-Bypass engaged (Dry Passthrough).' : 'Master Rack engaged!', 'info');
        });
    }

    if (btnMonitorSpeakers) {
        btnMonitorSpeakers.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            const isMonitoring = !rack.state.master.monitorSpeakers;
            rack.setParam('master', 'monitorspeakers', isMonitoring);
            btnMonitorSpeakers.classList.toggle('active', isMonitoring);
            if (monitorStatusText) {
                monitorStatusText.textContent = isMonitoring ? 'ON' : 'OFF';
                monitorStatusText.style.color = isMonitoring ? '#10b981' : '';
            }
            if (isMonitoring) {
                showToast('Speaker Monitoring ON. Use headphones to prevent microphone feedback loop!', 'warn');
            } else {
                showToast('Speaker Monitoring muted.');
            }
        });
    }

    if (btnRouteSynthToFx) {
        btnRouteSynthToFx.addEventListener('click', async () => {
            const rack = await ensureEffectsRack();
            isSynthRoutedToFx = !isSynthRoutedToFx;
            synth.routeThroughEffectsRack(isSynthRoutedToFx ? rack : null);
            btnRouteSynthToFx.classList.toggle('active', isSynthRoutedToFx);
            if (synthFxStatusText) {
                synthFxStatusText.textContent = isSynthRoutedToFx ? 'ON' : 'OFF';
                synthFxStatusText.style.color = isSynthRoutedToFx ? 'var(--led-cyan)' : '';
            }
            showToast(isSynthRoutedToFx ? 'Synthesizer & demo riffs routed through FX Rack.' : 'Synthesizer routed direct to output.');
        });
    }

    // =========================================================================
    // Keyboard Hotkeys
    // =========================================================================
    const keyMap = {
        '1': { string: 1, fret: 0 },
        '2': { string: 2, fret: 0 },
        '3': { string: 3, fret: 0 },
        '4': { string: 4, fret: 0 },
        '5': { string: 5, fret: 0 },
        '6': { string: 6, fret: 0 },
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

        if (e.key.toLowerCase() === 'l') {
            e.preventDefault();
            btnLoopTab.click();
            return;
        }

        if (e.key.toLowerCase() === 'q') {
            e.preventDefault();
            btnQuantizeNow.click();
            return;
        }

        if (e.key.toLowerCase() === 'r') {
            tablature.rewind();
            showToast('Rewound timeline.');
            return;
        }

        const mapped = keyMap[e.key.toLowerCase()];
        if (mapped) {
            handleFretboardClick(mapped.string, mapped.fret);
        }
    });
});
