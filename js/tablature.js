/**
 * Auto-Scrolling Tablature Staff & Interactive Practice Trainer (HTML5 Canvas)
 * Dynamic 6-line tablature staff (e, B, G, D, A, E) with smooth 60fps right-to-left scrolling,
 * user-configurable BPM/tempo, fixed vertical playhead, 4/4 measure grouping,
 * metronome synchronization, real-time note recording, and Practice & Play-Along Trainer.
 * 
 * Practice & Play-Along Trainer Features:
 * 1. A-B Loop Selector: Set loop start and end bar markers with visual loop highlight & boundary flags.
 * 2. Speed Trainer: Automatically increases BPM by a configurable amount (+5 BPM) after N successful loop passes.
 * 3. Visual Playhead Cursor: Follows strictly synced audioContext.currentTime with fallback clock.
 * 4. Pitch Accuracy Scorer: Real-time pitch comparison against expected fretboard notes
 *    within ±35 cent and ±100ms tolerance windows (Green = Perfect, Yellow = Slight Sharp/Flat, Red = Miss).
 */

class TablatureStaff {
    constructor(canvasId, options = {}) {
        // Support both canvas ID string, canvas element, or headless/Node options
        if (typeof canvasId === 'string' && typeof document !== 'undefined') {
            this.canvas = document.getElementById(canvasId);
        } else if (typeof canvasId === 'object' && canvasId !== null && canvasId.getContext) {
            this.canvas = canvasId;
        } else if (typeof canvasId === 'object' && canvasId !== null && !options.bpm) {
            options = canvasId;
            this.canvas = null;
        } else {
            this.canvas = null;
        }

        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.isHeadless = !this.canvas;

        // Timing & Tempo settings
        this.bpm = options.bpm || 120;
        this.beatsPerMeasure = options.beatsPerMeasure || 4; // 4/4 time signature
        this.pixelsPerBeat = options.pixelsPerBeat || 110; // Zoom / spacing
        
        // Playhead position (percentage across canvas, e.g. 0.35 = 35% from left)
        this.playheadRatio = options.playheadRatio || 0.40;

        // Playback & Recording state
        this.isPlaying = false;
        this.isRecording = (options.isRecording !== undefined) ? options.isRecording : true;
        this.currentTime = 0; // Current song time in seconds
        this.lastFrameTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.lastBeatIndex = -1;

        // AudioContext synchronization clock
        this.audioContext = options.audioContext || null;
        this.audioContextStartTime = 0;
        this.playbackStartSongTime = 0;
        this.isAudioContextSynced = false;

        // Recorded note events: array of { id, string (1-6), fret, finger, noteName, time, duration, color, midi, grade, centsDeviation }
        this.notes = [];
        this.activePluckedNotes = new Map(); // string => note object (for duration tracking)

        // Rhythm Quantizer reference
        this.quantizer = options.quantizer || null;

        // String labels & order: String 1 is high e (top), String 6 is low E (bottom)
        this.stringNames = options.stringNames || ["e", "B", "G", "D", "A", "E"];
        // Standard tuning open string MIDI notes: [E4 (64), B3 (59), G3 (55), D3 (50), A2 (45), E2 (40)]
        this.openMidi = options.openMidi || [64, 59, 55, 50, 45, 40];

        // =====================================================================
        // Interactive Practice Mode & A-B Loop Settings
        // =====================================================================
        this.practiceMode = options.practiceMode || false;
        this.isLooping = options.isLooping || false;
        this.loopStartBar = options.loopStartBar || 1; // 1-based measure index
        this.loopEndBar = options.loopEndBar || 2;     // 1-based measure index
        this.loopStartTime = 0;
        this.loopEndTime = 0;
        this.updateLoopBoundaries();

        // =====================================================================
        // Progressive Speed Trainer Settings
        // =====================================================================
        this.speedTrainer = {
            enabled: options.speedTrainerEnabled || false,
            bpmStep: options.bpmStep || 5,          // Configurable acceleration step (+5 BPM)
            loopsRequired: options.loopsRequired || 2, // N successful loop completions
            maxBpm: options.maxBpm || 240,
            minAccuracy: (options.minAccuracy !== undefined) ? options.minAccuracy : 0.75, // 75% accuracy threshold
            currentLoopCount: 0,
            totalAccelerations: 0
        };
        Object.defineProperty(this.speedTrainer, 'completedLoops', {
            get: () => this.speedTrainer.currentLoopCount,
            set: (v) => { this.speedTrainer.currentLoopCount = v; },
            configurable: true,
            enumerable: true
        });

        // =====================================================================
        // Real-Time Pitch Accuracy Scorer Settings
        // =====================================================================
        this.scoringTimeWindow = options.scoringTimeWindow || 0.100; // ±100ms tolerance window
        this.scoringCentTolerance = options.scoringCentTolerance || 35; // ±35 cents tolerance window
        this.perfectCentTolerance = options.perfectCentTolerance || 15; // ±15 cents for Perfect
        this.recentGradingFeedbacks = []; // Visual floating grading tags on the tab line
        this.practiceStats = {
            total: 0,
            perfect: 0,
            slight: 0,
            miss: 0,
            streak: 0,
            maxStreak: 0,
            accuracy: 1.0
        };

        // UI Binding Cache
        this.uiBindings = null;

        // Callback hooks
        this.onMetronomeClick = options.onMetronomeClick || null;
        this.onPlayheadPass = options.onPlayheadPass || null;
        this.onNoteGraded = options.onNoteGraded || null;
        this.onLoopCompleted = options.onLoopCompleted || null;
        this.onSpeedTrainerAccelerate = options.onSpeedTrainerAccelerate || null;
        this.onPracticeModeChange = options.onPracticeModeChange || null;

        // Styling palette
        this.colors = {
            background: '#0a0a0d',
            gutterBg: '#141418',
            staffLine: '#262632',
            measureBar: '#5a5a6c',
            beatTick: '#1a1a24',
            playhead: '#00f3ff',
            playheadGlow: 'rgba(0, 243, 255, 0.5)',
            notePillBg: '#1a1a22',
            noteBorder: '#00f3ff',
            noteText: '#ffffff',
            stringText: '#9ca3af',
            activePillBg: '#0284c7',
            // Practice Mode colors
            loopShade: 'rgba(255, 176, 32, 0.08)',
            loopBorder: '#ffb020',
            loopBorderGlow: 'rgba(255, 176, 32, 0.4)',
            gradePerfect: '#10b981', // Green = Perfect
            gradePerfectGlow: 'rgba(16, 185, 129, 0.6)',
            gradeSlight: '#ffb020',  // Yellow = Slight Sharp/Flat
            gradeSlightGlow: 'rgba(255, 176, 32, 0.6)',
            gradeMiss: '#ef4444',    // Red = Miss
            gradeMissGlow: 'rgba(239, 68, 68, 0.6)'
        };

        if (this.canvas) {
            this.initCanvasResolution();
            this.setupEvents();
            this.startRenderLoop();
            this.bindDOMIfAvailable();
        } else {
            // Default dimensions for headless calculations
            this.cssWidth = 1000;
            this.cssHeight = 180;
            this.layoutStaff();
        }
    }

    // =========================================================================
    // Canvas Layout & High-DPI Resolution
    // =========================================================================

    initCanvasResolution() {
        if (!this.canvas) return;
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
        const rect = this.canvas.getBoundingClientRect();

        const width = rect.width || (this.canvas.parentElement && this.canvas.parentElement.clientWidth) || 1000;
        const height = rect.height || 180;

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);

        if (this.ctx) {
            this.ctx.resetTransform();
            this.ctx.scale(dpr, dpr);
        }

        this.cssWidth = width;
        this.cssHeight = height;

        this.layoutStaff();
    }

    layoutStaff() {
        this.gutterWidth = 56;
        this.staffTop = 32;
        this.staffBottom = this.cssHeight - 24;
        this.staffHeight = this.staffBottom - this.staffTop;
        this.stringSpacing = this.staffHeight / 5;

        // 6 string horizontal lines
        this.stringY = [];
        for (let i = 0; i < 6; i++) {
            this.stringY[i] = this.staffTop + i * this.stringSpacing;
        }

        this.playheadX = this.gutterWidth + (this.cssWidth - this.gutterWidth) * this.playheadRatio;
    }

    setupEvents() {
        if (typeof window === 'undefined' || !this.canvas) return;
        window.addEventListener('resize', () => {
            this.initCanvasResolution();
        });

        // Interactive click on measure numbers to set A-B loop points
        this.canvas.addEventListener('click', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            // Click near top measure header region (y < staffTop)
            if (clickY <= this.staffTop && clickX > this.gutterWidth) {
                const secondsPerBeat = 60 / this.bpm;
                const pixelsPerSecond = this.pixelsPerBeat / secondsPerBeat;
                const clickedTime = this.currentTime + (clickX - this.playheadX) / pixelsPerSecond;
                const clickedMeasure = Math.max(1, Math.floor(clickedTime / (secondsPerBeat * this.beatsPerMeasure)) + 1);

                if (e.shiftKey) {
                    // Shift + Click sets Loop End Bar
                    this.setLoopEndBar(clickedMeasure);
                } else if (e.altKey) {
                    // Alt + Click sets Loop Start Bar
                    this.setLoopStartBar(clickedMeasure);
                } else {
                    // Normal click cycles loop range
                    if (!this.isPracticeLoopEnabled()) {
                        this.setLoopRange(clickedMeasure, clickedMeasure + 1);
                        this.togglePracticeMode(true);
                    } else if (clickedMeasure <= this.loopStartBar) {
                        this.setLoopStartBar(clickedMeasure);
                    } else {
                        this.setLoopEndBar(clickedMeasure);
                    }
                }
            }
        });
    }

    // =========================================================================
    // Timing, Clock & AudioContext Synchronization
    // =========================================================================

    setBPM(newBpm) {
        const validatedBpm = Math.max(30, Math.min(300, newBpm));
        this.bpm = validatedBpm;
        this.updateLoopBoundaries();
        this.renderUIState();
    }

    setZoom(pixels) {
        this.pixelsPerBeat = Math.max(50, Math.min(250, pixels));
    }

    /**
     * Connects an active Web Audio AudioContext to achieve sample-accurate playhead tracking.
     */
    setAudioContext(audioCtx) {
        this.audioContext = audioCtx;
        this.syncAudioClock(this.currentTime);
    }

    /**
     * Synchronizes internal playhead clock with AudioContext hardware time.
     */
    syncAudioClock(targetSongTime) {
        if (this.audioContext && this.audioContext.state === 'running') {
            this.audioContextStartTime = this.audioContext.currentTime;
            this.playbackStartSongTime = (targetSongTime !== undefined) ? targetSongTime : this.currentTime;
            this.isAudioContextSynced = true;
        } else {
            this.isAudioContextSynced = false;
        }
    }

    play() {
        this.isPlaying = true;
        this.lastFrameTime = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        this.syncAudioClock(this.currentTime);
    }

    pause() {
        this.isPlaying = false;
        this.isAudioContextSynced = false;
    }

    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
        return this.isPlaying;
    }

    rewind() {
        const target = this.isPracticeLoopEnabled() ? this.loopStartTime : 0;
        this.seekTo(target);
        this.lastBeatIndex = -1;
    }

    seekTo(targetTime) {
        this.currentTime = Math.max(0, targetTime);
        this.syncAudioClock(this.currentTime);
        const secondsPerBeat = 60 / this.bpm;
        this.lastBeatIndex = Math.floor(this.currentTime / secondsPerBeat) - 1;
    }

    clearNotes() {
        this.notes = [];
        this.activePluckedNotes.clear();
        this.currentTime = 0;
        this.lastBeatIndex = -1;
        this.recentGradingFeedbacks = [];
        this.resetPracticeStats();
    }

    getSongEndTime() {
        if (!this.notes || this.notes.length === 0) return 8.0;
        let maxTime = 0;
        for (const n of this.notes) {
            const end = (n.time || 0) + (n.duration || 0.4);
            if (end > maxTime) maxTime = end;
        }
        return maxTime + 0.5;
    }

    // =========================================================================
    // A-B Loop Region Management
    // =========================================================================

    /**
     * Recalculates exact second timestamps for start and end bars at the current BPM.
     */
    updateLoopBoundaries() {
        const secondsPerBeat = 60 / this.bpm;
        const secondsPerMeasure = secondsPerBeat * this.beatsPerMeasure;
        this.loopStartTime = (this.loopStartBar - 1) * secondsPerMeasure;
        this.loopEndTime = this.loopEndBar * secondsPerMeasure;
    }

    /**
     * Sets A-B loop bar markers (1-based measure numbers).
     * @param {number} startBar - 1-based start measure index
     * @param {number} endBar - 1-based end measure index
     */
    setLoopRange(startBar, endBar) {
        const s = Math.max(1, Math.min(startBar, endBar));
        const e = Math.max(s, Math.max(startBar, endBar));
        this.loopStartBar = s;
        this.loopEndBar = e;
        this.isLooping = true;
        this.updateLoopBoundaries();

        // If playhead is outside loop region, position at loop start
        if (this.currentTime < this.loopStartTime || this.currentTime >= this.loopEndTime) {
            this.seekTo(this.loopStartTime);
        }

        this.renderUIState();
        return this.getLoopRange();
    }

    setLoopStartBar(bar) {
        const newStart = Math.max(1, bar);
        const newEnd = Math.max(newStart, this.loopEndBar);
        return this.setLoopRange(newStart, newEnd);
    }

    setLoopEndBar(bar) {
        const newEnd = Math.max(1, bar);
        const newStart = Math.min(this.loopStartBar, newEnd);
        return this.setLoopRange(newStart, newEnd);
    }

    toggleLoop(enable) {
        this.isLooping = (enable !== undefined) ? !!enable : !this.isLooping;
        this.renderUIState();
        return this.isLooping;
    }

    togglePracticeMode(enable) {
        this.practiceMode = (enable !== undefined) ? !!enable : !this.practiceMode;
        if (this.practiceMode) {
            this.isLooping = true;
        }
        this.renderUIState();
        if (this.onPracticeModeChange) {
            this.onPracticeModeChange(this.practiceMode);
        }
        return this.practiceMode;
    }

    isPracticeLoopEnabled() {
        return this.isLooping || this.practiceMode;
    }

    getLoopRange() {
        return {
            startBar: this.loopStartBar,
            endBar: this.loopEndBar,
            startTime: this.loopStartTime,
            endTime: this.loopEndTime
        };
    }

    // =========================================================================
    // Progressive Speed Trainer
    // =========================================================================

    /**
     * Configures the automatic tempo acceleration speed trainer.
     * @param {Object} config - { enabled, bpmStep, loopsRequired, maxBpm, minAccuracy }
     */
    setSpeedTrainerConfig(config = {}) {
        if (typeof config.enabled === 'boolean') this.speedTrainer.enabled = config.enabled;
        if (typeof config.bpmStep === 'number') this.speedTrainer.bpmStep = config.bpmStep;
        if (typeof config.loopsRequired === 'number') this.speedTrainer.loopsRequired = config.loopsRequired;
        if (typeof config.maxBpm === 'number') this.speedTrainer.maxBpm = config.maxBpm;
        if (typeof config.minAccuracy === 'number') this.speedTrainer.minAccuracy = config.minAccuracy;
        this.speedTrainer.currentLoopCount = 0;
        this.renderUIState();
        return { ...this.speedTrainer };
    }

    enableSpeedTrainer(config = {}) {
        this.speedTrainer.enabled = true;
        this.setSpeedTrainerConfig(config);
        return this.speedTrainer;
    }

    disableSpeedTrainer() {
        this.speedTrainer.enabled = false;
        this.renderUIState();
        return this.speedTrainer;
    }

    toggleSpeedTrainer(enable) {
        this.speedTrainer.enabled = (enable !== undefined) ? !!enable : !this.speedTrainer.enabled;
        this.renderUIState();
        return this.speedTrainer.enabled;
    }

    /**
     * Handles loop completion event, computes loop accuracy, and triggers tempo acceleration if eligible.
     */
    handleLoopCompletion() {
        const isLoop = this.isPracticeLoopEnabled();
        const startT = isLoop ? this.loopStartTime : 0;
        const endT = isLoop ? this.loopEndTime : this.getSongEndTime();

        // Notes situated in this loop iteration
        const loopNotes = this.notes.filter(n => n.time >= startT - 0.05 && n.time < endT);
        let loopAccuracy = 1.0;

        if (loopNotes.length > 0) {
            let earned = 0;
            for (const n of loopNotes) {
                if (n.grade === 'perfect') earned += 1.0;
                else if (n.grade === 'slight') earned += 0.7;
                // 'miss' contributes 0
            }
            loopAccuracy = earned / loopNotes.length;
        }

        const isSuccessful = loopAccuracy >= this.speedTrainer.minAccuracy;
        let accelerated = false;
        const oldBpm = this.bpm;
        let newBpm = this.bpm;

        if (isSuccessful) {
            this.speedTrainer.currentLoopCount++;
            if (this.speedTrainer.enabled && this.speedTrainer.currentLoopCount >= this.speedTrainer.loopsRequired) {
                newBpm = Math.min(this.speedTrainer.maxBpm, this.bpm + this.speedTrainer.bpmStep);
                this.setBPM(newBpm);
                this.speedTrainer.currentLoopCount = 0;
                this.speedTrainer.totalAccelerations++;
                accelerated = true;

                // Visual acceleration banner
                this.addGradingFeedback({
                    string: 1,
                    fret: 0,
                    time: this.currentTime,
                    grade: 'perfect',
                    color: '#00f3ff',
                    text: `TEMPO UP +${this.speedTrainer.bpmStep} BPM (${newBpm})`,
                    timestamp: (typeof performance !== 'undefined' ? performance.now() : Date.now())
                });

                if (this.onSpeedTrainerAccelerate) {
                    this.onSpeedTrainerAccelerate(newBpm, oldBpm);
                }
            }
        } else {
            // Reset consecutive loop counter on poor accuracy
            this.speedTrainer.currentLoopCount = 0;
        }

        if (this.onLoopCompleted) {
            this.onLoopCompleted({
                accuracy: loopAccuracy,
                isSuccessful: isSuccessful,
                completedLoops: this.speedTrainer.currentLoopCount,
                loopsRequired: this.speedTrainer.loopsRequired,
                bpm: this.bpm,
                accelerated: accelerated
            });
        }

        // Reset note grades for notes in this loop region so they can be re-scored in the next pass
        for (const n of loopNotes) {
            n.grade = null;
            n.centsDeviation = null;
            n.timingError = null;
            n.gradedAt = null;
        }

        this.renderUIState();
        return { loopAccuracy, isSuccessful, accelerated, bpm: this.bpm };
    }

    // =========================================================================
    // Pitch Accuracy Scorer (±35 cents, ±100ms tolerance)
    // =========================================================================

    /**
     * Resolves expected MIDI pitch for a note object based on string and fret.
     */
    getNoteMidi(note) {
        if (typeof note.midi === 'number') return note.midi;
        const strIdx = (note.string || 1) - 1;
        const open = (this.openMidi && this.openMidi[strIdx] !== undefined)
            ? this.openMidi[strIdx]
            : [64, 59, 55, 50, 45, 40][strIdx];
        return open + (note.fret || 0);
    }

    /**
     * Compares live pitch reported by DSP against the expected active note in the tablature.
     * Tolerance window: ±100ms timing, ±35 cents pitch (Green = Perfect, Yellow = Slight, Red = Miss).
     * @param {Object} pitchData - { frequency, midi, midiExact, cents, time, isPluck }
     * @returns {Object|null} Grading result { note, grade, cents, timingError }
     */
    scoreLivePitch(pitchData) {
        if (!pitchData) return null;
        const curTime = this.currentTime;
        const tolTime = this.scoringTimeWindow; // 0.100s

        // 1. Find candidate un-graded expected note closest to curTime within ±100ms
        let candidate = null;
        let minDt = Infinity;

        for (const note of this.notes) {
            if (note.grade) continue; // Already scored
            const dt = Math.abs(curTime - note.time);
            if (dt <= tolTime && dt < minDt) {
                minDt = dt;
                candidate = note;
            }
        }

        // Secondary search: within note active duration ±100ms
        if (!candidate) {
            for (const note of this.notes) {
                if (note.grade) continue;
                const dur = note.duration || 0.3;
                if (curTime >= note.time - tolTime && curTime <= note.time + dur + tolTime) {
                    candidate = note;
                    break;
                }
            }
        }

        if (!candidate) return null;

        // 2. Resolve expected MIDI & detected pitch
        const expectedMidi = this.getNoteMidi(candidate);

        let detectedMidiExact;
        if (typeof pitchData.midiExact === 'number') {
            detectedMidiExact = pitchData.midiExact;
        } else if (typeof pitchData.frequency === 'number' && pitchData.frequency > 0) {
            detectedMidiExact = 69 + 12 * Math.log2(pitchData.frequency / 440);
        } else if (typeof pitchData.midi === 'number') {
            detectedMidiExact = pitchData.midi + ((pitchData.cents || 0) / 100);
        } else {
            return null;
        }

        // Cents deviation from target note
        const centsDeviation = (detectedMidiExact - expectedMidi) * 100;
        const absCents = Math.abs(centsDeviation);

        // 3. Grade Note Accuracy:
        // Green = Perfect (within ±15 cents)
        // Yellow = Slight Sharp/Flat (between 15 and 35 cents, within ±35 cents)
        // Red = Miss (deviation > 35 cents or wrong note)
        let grade;
        let color;
        let feedbackText;

        if (absCents <= this.perfectCentTolerance) {
            grade = 'perfect';
            color = this.colors.gradePerfect; // Green
            feedbackText = 'PERFECT';
            this.practiceStats.perfect++;
            this.practiceStats.streak++;
        } else if (absCents <= this.scoringCentTolerance) {
            grade = 'slight';
            color = this.colors.gradeSlight; // Yellow
            const sign = centsDeviation > 0 ? '+' : '';
            feedbackText = `${sign}${Math.round(centsDeviation)}¢ ${centsDeviation > 0 ? 'SHARP' : 'FLAT'}`;
            this.practiceStats.slight++;
            this.practiceStats.streak++;
        } else {
            grade = 'miss';
            color = this.colors.gradeMiss; // Red
            feedbackText = 'MISS';
            this.practiceStats.miss++;
            this.practiceStats.streak = 0;
        }

        this.practiceStats.total++;
        if (this.practiceStats.streak > this.practiceStats.maxStreak) {
            this.practiceStats.maxStreak = this.practiceStats.streak;
        }
        const earned = this.practiceStats.perfect * 1.0 + this.practiceStats.slight * 0.7;
        this.practiceStats.accuracy = earned / Math.max(1, this.practiceStats.total);

        // Store grade details on note
        candidate.grade = grade;
        candidate.centsDeviation = centsDeviation;
        candidate.timingError = curTime - candidate.time;
        candidate.gradedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        // Emit immediate visual feedback floater along the tab line
        this.addGradingFeedback({
            string: candidate.string,
            fret: candidate.fret,
            time: candidate.time,
            grade: grade,
            cents: centsDeviation,
            color: color,
            text: feedbackText,
            timestamp: candidate.gradedAt
        });

        if (this.onNoteGraded) {
            this.onNoteGraded({
                note: candidate,
                grade: grade,
                cents: centsDeviation,
                accuracy: this.practiceStats.accuracy,
                streak: this.practiceStats.streak
            });
        }

        this.renderUIState();
        return {
            note: candidate,
            grade: grade,
            cents: centsDeviation,
            timingError: candidate.timingError
        };
    }

    addGradingFeedback(feedback) {
        this.recentGradingFeedbacks.push(feedback);
        // Keep feedback array bounded
        if (this.recentGradingFeedbacks.length > 20) {
            this.recentGradingFeedbacks.shift();
        }
    }

    resetPracticeStats() {
        this.practiceStats = {
            total: 0,
            perfect: 0,
            slight: 0,
            miss: 0,
            streak: 0,
            maxStreak: 0,
            accuracy: 1.0
        };
        for (const n of this.notes) {
            n.grade = null;
            n.centsDeviation = null;
            n.timingError = null;
            n.gradedAt = null;
        }
        this.renderUIState();
    }

    // =========================================================================
    // Note Recording & Quantization
    // =========================================================================

    recordNote(noteData) {
        const { string, fret, finger, noteName, color, midi } = noteData;
        const nowTime = this.currentTime;
        const rawTime = (typeof noteData.rawTime === 'number') ? noteData.rawTime : nowTime;

        // Finalize previous note on this string
        if (this.activePluckedNotes.has(string)) {
            const prev = this.activePluckedNotes.get(string);
            prev.rawEndTime = rawTime;
            prev.rawDuration = Math.max(0.06, rawTime - prev.rawTime);
            if (this.quantizer && this.quantizer.liveQuantize && this.quantizer.grid !== 'none') {
                prev.duration = this.quantizer.quantizeDuration(prev.rawDuration, this.quantizer.grid, this.bpm);
            } else {
                prev.duration = prev.rawDuration;
            }
        }

        let calculatedTime = rawTime;
        let calculatedDur = 0.35;
        if (this.quantizer && this.quantizer.liveQuantize && this.quantizer.grid !== 'none') {
            calculatedTime = this.quantizer.quantizeTime(rawTime, this.quantizer.grid, this.bpm);
            calculatedDur = this.quantizer.quantizeDuration(0.35, this.quantizer.grid, this.bpm);
        }

        const newNote = {
            id: 'note_' + Math.random().toString(36).substr(2, 9),
            string: string,
            fret: fret,
            finger: finger || 0,
            noteName: noteName || '',
            midi: midi !== undefined ? midi : this.getNoteMidi({ string, fret }),
            rawTime: rawTime,
            rawDuration: calculatedDur,
            rawEndTime: rawTime + calculatedDur,
            time: calculatedTime,
            duration: calculatedDur,
            color: color || '#38bdf8',
            grade: null,
            centsDeviation: null
        };

        this.notes.push(newNote);
        this.activePluckedNotes.set(string, newNote);
        return newNote;
    }

    releaseNote(string) {
        if (this.activePluckedNotes.has(string)) {
            const note = this.activePluckedNotes.get(string);
            note.rawEndTime = this.currentTime;
            note.rawDuration = Math.max(0.06, this.currentTime - note.rawTime);
            if (this.quantizer && this.quantizer.liveQuantize && this.quantizer.grid !== 'none') {
                note.duration = this.quantizer.quantizeDuration(note.rawDuration, this.quantizer.grid, this.bpm);
            } else {
                note.duration = note.rawDuration;
            }
            this.activePluckedNotes.delete(string);
        }
    }

    quantizeNotes(gridType = '16th') {
        if (this.quantizer) {
            this.quantizer.quantizeNotes(this.notes, gridType, this.bpm);
        }
    }

    loadSong(songNotes, bpm = null) {
        if (bpm) this.setBPM(bpm);
        this.notes = songNotes.map(n => ({
            ...n,
            midi: (typeof n.midi === 'number') ? n.midi : this.getNoteMidi(n),
            grade: null,
            centsDeviation: null
        }));
        this.resetPracticeStats();
        this.rewind();
    }

    // =========================================================================
    // Continuous 60fps Render & Timeline Update Loop
    // =========================================================================

    startRenderLoop() {
        if (typeof window === 'undefined' || !this.canvas) return;
        const render = (timestamp) => {
            const dt = (timestamp - this.lastFrameTime) / 1000;
            this.lastFrameTime = timestamp;

            if (this.isPlaying) {
                this.updateTimeline(dt);
            }

            this.draw();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    updateTimeline(dt) {
        // Strict AudioContext clock synchronization if active
        if (this.isAudioContextSynced && this.audioContext && this.audioContext.state === 'running') {
            const elapsedAudio = this.audioContext.currentTime - this.audioContextStartTime;
            this.currentTime = this.playbackStartSongTime + elapsedAudio;
        } else {
            this.currentTime += dt;
        }

        // A-B Loop Wrapping & Speed Trainer Triggering
        const loopActive = this.isPracticeLoopEnabled();
        const loopEnd = (loopActive && this.loopEndTime > 0) ? this.loopEndTime : this.getSongEndTime();
        const loopStart = loopActive ? this.loopStartTime : 0;

        if (this.currentTime >= loopEnd) {
            this.handleLoopCompletion();
            this.currentTime = loopStart;
            this.syncAudioClock(loopStart);
            const secondsPerBeat = 60 / this.bpm;
            this.lastBeatIndex = Math.floor(this.currentTime / secondsPerBeat) - 1;
        }

        // Metronome sync
        const secondsPerBeat = 60 / this.bpm;
        const currentBeatIndex = Math.floor(this.currentTime / secondsPerBeat);

        if (currentBeatIndex > this.lastBeatIndex) {
            this.lastBeatIndex = currentBeatIndex;
            const beatInMeasure = (currentBeatIndex % this.beatsPerMeasure) + 1;
            const measureNumber = Math.floor(currentBeatIndex / this.beatsPerMeasure) + 1;
            const isDownbeat = (beatInMeasure === 1);

            if (this.onMetronomeClick) {
                this.onMetronomeClick({
                    beat: beatInMeasure,
                    measure: measureNumber,
                    isDownbeat: isDownbeat,
                    time: this.currentTime
                });
            }
        }

        // Real-Time Note Accuracy: Automatically grade unplayed notes that fell past the +100ms tolerance window
        const missCutoff = this.scoringTimeWindow;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        for (const note of this.notes) {
            if (!note.grade && this.currentTime > note.time + missCutoff) {
                note.grade = 'miss';
                note.centsDeviation = null;
                note.timingError = null;
                note.gradedAt = now;

                this.practiceStats.total++;
                this.practiceStats.miss++;
                this.practiceStats.streak = 0;
                const earned = this.practiceStats.perfect * 1.0 + this.practiceStats.slight * 0.7;
                this.practiceStats.accuracy = earned / Math.max(1, this.practiceStats.total);

                this.addGradingFeedback({
                    string: note.string,
                    fret: note.fret,
                    time: note.time,
                    grade: 'miss',
                    cents: null,
                    color: this.colors.gradeMiss,
                    text: 'MISS',
                    timestamp: now
                });

                if (this.onNoteGraded) {
                    this.onNoteGraded({
                        note: note,
                        grade: 'miss',
                        cents: null,
                        accuracy: this.practiceStats.accuracy,
                        streak: 0
                    });
                }
            }
        }
    }

    // =========================================================================
    // Canvas Drawing Methods
    // =========================================================================

    draw() {
        if (!this.ctx) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

        // 1. Background
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        // 2. Draw A-B Loop Shaded Region
        this.drawLoopRegion(ctx);

        // 3. Draw Grid: Measure Lines & Beat Subdivisions
        this.drawMeasureGrid(ctx);

        // 4. Draw 6 Staff Lines (e, B, G, D, A, E)
        this.drawStaffLines(ctx);

        // 5. Draw Tablature Notes, Sustain Ties & Note Accuracy Pills
        this.drawNotes(ctx);

        // 6. Draw Immediate Floating Grading Feedback on Tab Lines
        this.drawGradingFeedbacks(ctx);

        // 7. Draw Left Gutter (String Labels & TAB header)
        this.drawGutter(ctx);

        // 8. Draw Audio-Synced Glowing Playhead Line
        this.drawPlayhead(ctx);

        // 9. Draw Sleek Practice Mode HUD Overlay
        this.drawPracticeHUD(ctx);
    }

    drawStaffLines(ctx) {
        ctx.save();
        ctx.strokeStyle = this.colors.staffLine;
        ctx.lineWidth = 1.2;

        for (let i = 0; i < 6; i++) {
            const y = this.stringY[i];
            ctx.beginPath();
            ctx.moveTo(this.gutterWidth, y);
            ctx.lineTo(this.cssWidth, y);
            ctx.stroke();
        }

        ctx.restore();
    }

    drawLoopRegion(ctx) {
        if (!this.isPracticeLoopEnabled()) return;
        ctx.save();

        const secondsPerBeat = 60 / this.bpm;
        const pixelsPerSecond = this.pixelsPerBeat / secondsPerBeat;

        const xA = this.playheadX + (this.loopStartTime - this.currentTime) * pixelsPerSecond;
        const xB = this.playheadX + (this.loopEndTime - this.currentTime) * pixelsPerSecond;

        // Cull loop region if completely out of view
        if (xB >= this.gutterWidth && xA <= this.cssWidth) {
            const drawLeft = Math.max(this.gutterWidth, xA);
            const drawRight = Math.min(this.cssWidth, xB);
            const drawWidth = Math.max(0, drawRight - drawLeft);

            // Shaded Loop Background Glow
            ctx.fillStyle = this.colors.loopShade;
            ctx.fillRect(drawLeft, this.staffTop - 6, drawWidth, this.staffHeight + 12);

            // Start Marker [A (Bar X)
            if (xA >= this.gutterWidth && xA <= this.cssWidth) {
                ctx.strokeStyle = this.colors.loopBorder;
                ctx.lineWidth = 2.0;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(xA, this.staffTop - 8);
                ctx.lineTo(xA, this.staffBottom + 8);
                ctx.stroke();
                ctx.setLineDash([]);

                // Flag A Badge
                ctx.fillStyle = this.colors.loopBorder;
                ctx.fillRect(xA, this.staffTop - 22, 44, 14);
                ctx.fillStyle = '#0a0a0d';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`[A: M${this.loopStartBar}`, xA + 22, this.staffTop - 12);
            }

            // End Marker B (Bar Y)]
            if (xB >= this.gutterWidth && xB <= this.cssWidth) {
                ctx.strokeStyle = this.colors.loopBorder;
                ctx.lineWidth = 2.0;
                ctx.setLineDash([4, 3]);
                ctx.beginPath();
                ctx.moveTo(xB, this.staffTop - 8);
                ctx.lineTo(xB, this.staffBottom + 8);
                ctx.stroke();
                ctx.setLineDash([]);

                // Flag B Badge
                ctx.fillStyle = this.colors.loopBorder;
                ctx.fillRect(xB - 44, this.staffTop - 22, 44, 14);
                ctx.fillStyle = '#0a0a0d';
                ctx.font = 'bold 9px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`B: M${this.loopEndBar}]`, xB - 22, this.staffTop - 12);
            }
        }

        ctx.restore();
    }

    drawMeasureGrid(ctx) {
        ctx.save();
        const secondsPerBeat = 60 / this.bpm;
        const pixelsPerSecond = this.pixelsPerBeat / secondsPerBeat;

        // Calculate visible time window
        const timeAtPlayhead = this.currentTime;
        const startTime = timeAtPlayhead - (this.playheadX - this.gutterWidth) / pixelsPerSecond;
        const endTime = timeAtPlayhead + (this.cssWidth - this.playheadX) / pixelsPerSecond;

        // Find starting beat
        const startBeat = Math.floor(Math.max(0, startTime) / secondsPerBeat);
        const endBeat = Math.ceil(endTime / secondsPerBeat);

        for (let b = startBeat; b <= endBeat; b++) {
            const beatTime = b * secondsPerBeat;
            const x = this.playheadX + (beatTime - this.currentTime) * pixelsPerSecond;

            if (x < this.gutterWidth || x > this.cssWidth) continue;

            const isMeasureStart = (b % this.beatsPerMeasure === 0);
            const measureNum = Math.floor(b / this.beatsPerMeasure) + 1;

            if (isMeasureStart) {
                // Measure bar line (prominent vertical line through all 6 strings)
                ctx.strokeStyle = this.colors.measureBar;
                ctx.lineWidth = 2.0;
                ctx.beginPath();
                ctx.moveTo(x, this.staffTop - 4);
                ctx.lineTo(x, this.staffBottom + 4);
                ctx.stroke();

                // Measure number header button
                const isLoopActive = this.isPracticeLoopEnabled() && measureNum >= this.loopStartBar && measureNum <= this.loopEndBar;
                ctx.fillStyle = isLoopActive ? '#ffb020' : '#cbd5e1';
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`M${measureNum}`, x, this.staffTop - 12);
            } else {
                // Beat tick line (subtle dashed tick)
                ctx.strokeStyle = this.colors.beatTick;
                ctx.lineWidth = 1.0;
                ctx.setLineDash([3, 4]);
                ctx.beginPath();
                ctx.moveTo(x, this.staffTop);
                ctx.lineTo(x, this.staffBottom);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        ctx.restore();
    }

    drawNotes(ctx) {
        ctx.save();
        const secondsPerBeat = 60 / this.bpm;
        const pixelsPerSecond = this.pixelsPerBeat / secondsPerBeat;

        for (const note of this.notes) {
            // Note X position based on time delta from current playhead time
            const noteX = this.playheadX + (note.time - this.currentTime) * pixelsPerSecond;

            // Cull notes outside visible viewport
            if (noteX < this.gutterWidth - 25 || noteX > this.cssWidth + 25) {
                continue;
            }

            const strIdx = (note.string || 1) - 1;
            const noteY = this.stringY[strIdx];

            // Is this note right at the playhead?
            const distFromPlayhead = Math.abs(noteX - this.playheadX);
            const isAtPlayhead = distFromPlayhead < 6;

            // Draw sustain tie trail if duration > 0.2s
            const sustainWidth = (note.duration || 0.35) * pixelsPerSecond;
            if (sustainWidth > 18) {
                let tieColor = isAtPlayhead ? 'rgba(0, 243, 255, 0.65)' : 'rgba(56, 189, 248, 0.35)';
                if (note.grade === 'perfect') tieColor = 'rgba(16, 185, 129, 0.5)';
                else if (note.grade === 'slight') tieColor = 'rgba(255, 176, 32, 0.5)';
                else if (note.grade === 'miss') tieColor = 'rgba(239, 68, 68, 0.3)';

                ctx.strokeStyle = tieColor;
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(noteX + 11, noteY);
                ctx.lineTo(noteX + Math.min(sustainWidth, 180), noteY);
                ctx.stroke();
            }

            // Draw Fret Number Pill Cutout with Real-Time Accuracy Grading
            this.drawNotePill(ctx, noteX, noteY, note.fret.toString(), isAtPlayhead, note.finger, note.grade, note.centsDeviation);
        }

        ctx.restore();
    }

    drawNotePill(ctx, x, y, fretStr, isHot = false, finger = 0, grade = null, cents = null) {
        const radius = 10;
        ctx.save();

        // Visual Note Accuracy Grading:
        // Green = Perfect, Yellow = Slight Sharp/Flat, Red = Miss
        if (grade === 'perfect') {
            ctx.shadowColor = this.colors.gradePerfect;
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#064e3b';
            ctx.strokeStyle = this.colors.gradePerfect;
            ctx.lineWidth = 2.2;
        } else if (grade === 'slight') {
            ctx.shadowColor = this.colors.gradeSlight;
            ctx.shadowBlur = 12;
            ctx.fillStyle = '#78350f';
            ctx.strokeStyle = this.colors.gradeSlight;
            ctx.lineWidth = 2.2;
        } else if (grade === 'miss') {
            ctx.shadowColor = this.colors.gradeMiss;
            ctx.shadowBlur = 10;
            ctx.fillStyle = '#450a0a';
            ctx.strokeStyle = this.colors.gradeMiss;
            ctx.lineWidth = 2.0;
        } else if (isHot) {
            // Hot glowing playhead hit
            ctx.shadowColor = '#00f3ff';
            ctx.shadowBlur = 14;
            ctx.fillStyle = '#0284c7';
            ctx.strokeStyle = '#00f3ff';
            ctx.lineWidth = 2.2;
        } else {
            ctx.fillStyle = this.colors.notePillBg;
            ctx.strokeStyle = this.colors.noteBorder;
            ctx.lineWidth = 1.4;
        }

        // Circular background pill to mask staff line cleanly
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;

        // Fret Number text
        ctx.fillStyle = this.colors.noteText;
        ctx.font = 'bold 11.5px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fretStr, x, y + 0.5);

        // Grade Badge tag (Top Right of Note Pill)
        if (grade === 'perfect') {
            ctx.fillStyle = this.colors.gradePerfect;
            ctx.font = 'bold 9px monospace';
            ctx.fillText('✓', x + 11, y - 7);
        } else if (grade === 'slight') {
            ctx.fillStyle = this.colors.gradeSlight;
            ctx.font = 'bold 8px monospace';
            const sign = (typeof cents === 'number' && cents > 0) ? '♯' : '♭';
            ctx.fillText(sign, x + 11, y - 7);
        } else if (grade === 'miss') {
            ctx.fillStyle = this.colors.gradeMiss;
            ctx.font = 'bold 9px monospace';
            ctx.fillText('✗', x + 11, y - 7);
        }

        // Finger indicator tag on top
        if (finger && finger > 0 && !grade) {
            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 8px monospace';
            ctx.fillText(`f${finger}`, x, y - radius - 3);
        }

        ctx.restore();
    }

    drawGradingFeedbacks(ctx) {
        if (!this.recentGradingFeedbacks || this.recentGradingFeedbacks.length === 0) return;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const secondsPerBeat = 60 / this.bpm;
        const pixelsPerSecond = this.pixelsPerBeat / secondsPerBeat;

        ctx.save();
        for (let i = this.recentGradingFeedbacks.length - 1; i >= 0; i--) {
            const fb = this.recentGradingFeedbacks[i];
            const ageMs = now - fb.timestamp;

            if (ageMs > 1200) {
                this.recentGradingFeedbacks.splice(i, 1);
                continue;
            }

            const alpha = Math.max(0, 1 - (ageMs / 1200));
            const yOffset = (ageMs / 1200) * 16; // Floats gently upward
            const strIdx = (fb.string || 1) - 1;
            const y = this.stringY[strIdx] - 14 - yOffset;
            const x = this.playheadX + (fb.time - this.currentTime) * pixelsPerSecond;

            if (x < this.gutterWidth || x > this.cssWidth) continue;

            ctx.globalAlpha = alpha;
            ctx.fillStyle = fb.color || '#10b981';
            ctx.font = 'bold 10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.shadowColor = fb.color || '#10b981';
            ctx.shadowBlur = 8;
            ctx.fillText(fb.text, x, y);
        }
        ctx.restore();
    }

    drawGutter(ctx) {
        ctx.save();

        // Gutter background
        ctx.fillStyle = this.colors.gutterBg;
        ctx.fillRect(0, 0, this.gutterWidth, this.cssHeight);

        // Divider line
        ctx.strokeStyle = '#30363d';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(this.gutterWidth, 0);
        ctx.lineTo(this.gutterWidth, this.cssHeight);
        ctx.stroke();

        // "TAB" Clef Logo Header
        ctx.fillStyle = '#64748b';
        ctx.font = '900 13px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('T', 18, this.staffTop + this.staffHeight * 0.25);
        ctx.fillText('A', 18, this.staffTop + this.staffHeight * 0.50);
        ctx.fillText('B', 18, this.staffTop + this.staffHeight * 0.75);

        // String Names (e, B, G, D, A, E)
        ctx.font = 'bold 12px "Inter", sans-serif';
        for (let i = 0; i < 6; i++) {
            const y = this.stringY[i];
            ctx.fillStyle = (i === 0 || i === 5) ? '#38bdf8' : '#94a3b8';
            ctx.fillText(this.stringNames[i], 40, y);
        }

        ctx.restore();
    }

    drawPlayhead(ctx) {
        ctx.save();
        const px = this.playheadX;

        // Outer glow
        const glowColor = this.isPracticeLoopEnabled() ? '#ffb020' : this.colors.playhead;
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = 14;

        // Vertical Playhead Line
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(px, this.staffTop - 10);
        ctx.lineTo(px, this.staffBottom + 10);
        ctx.stroke();

        // Top Precision Triangle Cap
        ctx.fillStyle = glowColor;
        ctx.beginPath();
        ctx.moveTo(px - 7, this.staffTop - 14);
        ctx.lineTo(px + 7, this.staffTop - 14);
        ctx.lineTo(px, this.staffTop - 3);
        ctx.closePath();
        ctx.fill();

        // Bottom Precision Triangle Cap
        ctx.beginPath();
        ctx.moveTo(px - 7, this.staffBottom + 14);
        ctx.lineTo(px + 7, this.staffBottom + 14);
        ctx.lineTo(px, this.staffBottom + 3);
        ctx.closePath();
        ctx.fill();

        // AudioContext Hardware Clock Sync Pill Tag
        if (this.isAudioContextSynced) {
            ctx.fillStyle = '#0284c7';
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('⚡ SYNC', px, this.staffBottom + 22);
        }

        ctx.restore();
    }

    drawPracticeHUD(ctx) {
        if (!this.practiceMode && !this.isLooping && !this.speedTrainer.enabled) return;
        ctx.save();

        const hudX = this.cssWidth - 14;
        const hudY = 16;
        ctx.textAlign = 'right';
        ctx.font = 'bold 10.5px "JetBrains Mono", monospace';

        const accPct = Math.round(this.practiceStats.accuracy * 100);
        const streak = this.practiceStats.streak;
        const loopStr = `M${this.loopStartBar}–M${this.loopEndBar}`;
        const speedStr = `${this.bpm} BPM${this.speedTrainer.enabled ? ' (⚡ ' + this.speedTrainer.completedLoops + '/' + this.speedTrainer.loopsRequired + ')' : ''}`;

        // Shaded HUD Backdrop
        ctx.fillStyle = 'rgba(18, 18, 20, 0.85)';
        ctx.strokeStyle = 'rgba(255, 176, 32, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(this.cssWidth - 360, 4, 350, 24, 4);
        ctx.fill();
        ctx.stroke();

        // Text Items
        ctx.fillStyle = '#ffb020';
        ctx.fillText(`🎯 LOOP: ${loopStr}`, this.cssWidth - 250, hudY);

        ctx.fillStyle = '#00f3ff';
        ctx.fillText(speedStr, this.cssWidth - 140, hudY);

        ctx.fillStyle = accPct >= 80 ? '#10b981' : (accPct >= 60 ? '#ffb020' : '#ef4444');
        ctx.fillText(`${accPct}% (x${streak})`, hudX, hudY);

        ctx.restore();
    }

    // =========================================================================
    // DOM Controls Binding
    // =========================================================================

    bindDOMIfAvailable() {
        if (typeof document === 'undefined') return;
        this.bindPracticeUI({
            btnPracticeMode: document.getElementById('btnPracticeMode'),
            inputLoopStartBar: document.getElementById('inputLoopStartBar'),
            inputLoopEndBar: document.getElementById('inputLoopEndBar'),
            btnSetLoopRange: document.getElementById('btnSetLoopRange'),
            btnToggleSpeedTrainer: document.getElementById('btnToggleSpeedTrainer'),
            selectBpmStep: document.getElementById('selectBpmStep'),
            selectLoopTarget: document.getElementById('selectLoopTarget'),
            practiceAccuracyDisplay: document.getElementById('practiceAccuracyDisplay'),
            practiceStreakDisplay: document.getElementById('practiceStreakDisplay'),
            practiceGradeBadge: document.getElementById('practiceGradeBadge'),
            practiceModeStatus: document.getElementById('practiceModeStatus'),
            speedTrainerStatus: document.getElementById('speedTrainerStatus')
        });
    }

    bindPracticeUI(elements = {}) {
        this.uiBindings = elements;

        if (elements.btnPracticeMode) {
            elements.btnPracticeMode.addEventListener('click', () => {
                this.togglePracticeMode();
            });
        }

        if (elements.btnSetLoopRange) {
            elements.btnSetLoopRange.addEventListener('click', () => {
                const s = elements.inputLoopStartBar ? parseInt(elements.inputLoopStartBar.value, 10) : 1;
                const e = elements.inputLoopEndBar ? parseInt(elements.inputLoopEndBar.value, 10) : 2;
                this.setLoopRange(s, e);
            });
        }

        if (elements.inputLoopStartBar) {
            elements.inputLoopStartBar.addEventListener('change', () => {
                const s = parseInt(elements.inputLoopStartBar.value, 10) || 1;
                this.setLoopStartBar(s);
            });
        }

        if (elements.inputLoopEndBar) {
            elements.inputLoopEndBar.addEventListener('change', () => {
                const e = parseInt(elements.inputLoopEndBar.value, 10) || 2;
                this.setLoopEndBar(e);
            });
        }

        if (elements.btnToggleSpeedTrainer) {
            elements.btnToggleSpeedTrainer.addEventListener('click', () => {
                this.toggleSpeedTrainer();
            });
        }

        if (elements.selectBpmStep) {
            elements.selectBpmStep.addEventListener('change', () => {
                const step = parseInt(elements.selectBpmStep.value, 10) || 5;
                this.speedTrainer.bpmStep = step;
            });
        }

        if (elements.selectLoopTarget) {
            elements.selectLoopTarget.addEventListener('change', () => {
                const loops = parseInt(elements.selectLoopTarget.value, 10) || 2;
                this.speedTrainer.loopsRequired = loops;
            });
        }

        this.renderUIState();
    }

    renderUIState() {
        if (!this.uiBindings) return;
        const b = this.uiBindings;

        if (b.btnPracticeMode && b.practiceModeStatus) {
            b.practiceModeStatus.textContent = this.practiceMode ? 'ON' : 'OFF';
            if (this.practiceMode) {
                b.btnPracticeMode.classList.add('active');
            } else {
                b.btnPracticeMode.classList.remove('active');
            }
        }

        if (b.inputLoopStartBar && document.activeElement !== b.inputLoopStartBar) {
            b.inputLoopStartBar.value = this.loopStartBar;
        }

        if (b.inputLoopEndBar && document.activeElement !== b.inputLoopEndBar) {
            b.inputLoopEndBar.value = this.loopEndBar;
        }

        if (b.btnToggleSpeedTrainer && b.speedTrainerStatus) {
            b.speedTrainerStatus.textContent = this.speedTrainer.enabled ? 'ON' : 'OFF';
            if (this.speedTrainer.enabled) {
                b.btnToggleSpeedTrainer.classList.add('active');
            } else {
                b.btnToggleSpeedTrainer.classList.remove('active');
            }
        }

        if (b.practiceAccuracyDisplay) {
            const acc = Math.round(this.practiceStats.accuracy * 100);
            b.practiceAccuracyDisplay.textContent = `ACCURACY: ${acc}%`;
            b.practiceAccuracyDisplay.style.color = acc >= 80 ? '#10b981' : (acc >= 60 ? '#ffb020' : '#ef4444');
        }

        if (b.practiceStreakDisplay) {
            b.practiceStreakDisplay.textContent = `STREAK: ${this.practiceStats.streak}`;
        }

        if (b.practiceGradeBadge) {
            const last = this.recentGradingFeedbacks[this.recentGradingFeedbacks.length - 1];
            if (last) {
                b.practiceGradeBadge.textContent = last.text;
                b.practiceGradeBadge.style.color = last.color;
                b.practiceGradeBadge.style.borderColor = last.color;
            } else {
                b.practiceGradeBadge.textContent = 'STANDBY';
                b.practiceGradeBadge.style.color = '#9ca3af';
                b.practiceGradeBadge.style.borderColor = '#33333e';
            }
        }
    }

    // =========================================================================
    // Exporter Bridge
    // =========================================================================

    exportASCII() {
        const ExporterClass = (typeof GuitarExporter !== 'undefined')
            ? GuitarExporter
            : (typeof require !== 'undefined' ? require('./exporter.js') : null);

        if (ExporterClass) {
            const exp = new ExporterClass({
                bpm: this.bpm,
                tuning: {
                    name: 'Current Tuning',
                    strings: this.openMidi,
                    names: this.stringNames
                }
            });
            return exp.toASCII(this.notes, this.bpm);
        }

        const secondsPerBeat = 60 / this.bpm;
        const totalDuration = this.notes.length > 0 
            ? Math.max(...this.notes.map(n => (n.time || 0) + (n.duration || 0.4))) + 1
            : 8;
        
        const totalSixteenths = Math.ceil(totalDuration / (secondsPerBeat / 4));
        const grid = Array.from({ length: 6 }, () => Array(totalSixteenths).fill('-'));

        for (const note of this.notes) {
            const sixteenthIndex = Math.round((note.time || 0) / (secondsPerBeat / 4));
            if (sixteenthIndex < totalSixteenths) {
                const strIdx = (note.string || 1) - 1;
                const fretStr = String(note.fret !== undefined ? note.fret : 0);
                grid[strIdx][sixteenthIndex] = fretStr;
            }
        }

        let output = `================================================================================\n`;
        output += `GUITAR TABLATURE (BPM: ${this.bpm}, Time: 4/4)\n`;
        output += `================================================================================\n\n`;
        const chunkSize = 76;

        for (let start = 0; start < totalSixteenths; start += chunkSize) {
            const end = Math.min(start + chunkSize, totalSixteenths);
            for (let s = 0; s < 6; s++) {
                const line = grid[s].slice(start, end).join('').padEnd(chunkSize, '-');
                output += `${this.stringNames[s]}|${line}|\n`;
            }
            output += '\n';
        }

        return output;
    }
}

if (typeof module !== 'undefined') {
    module.exports = TablatureStaff;
}
