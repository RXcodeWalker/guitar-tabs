/**
 * Auto-Scrolling Tablature Staff (HTML5 Canvas)
 * Dynamic 6-line tablature staff (e, B, G, D, A, E) with smooth 60fps right-to-left scrolling,
 * user-configurable BPM/tempo, fixed vertical playhead, 4/4 measure grouping,
 * metronome synchronization, and real-time note recording.
 */

class TablatureStaff {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas with id "${canvasId}" not found.`);
        }
        this.ctx = this.canvas.getContext('2d');

        // Timing & Tempo settings
        this.bpm = options.bpm || 120;
        this.beatsPerMeasure = options.beatsPerMeasure || 4; // 4/4 time signature
        this.pixelsPerBeat = options.pixelsPerBeat || 110; // Zoom / spacing
        
        // Playhead position (percentage across canvas, e.g. 0.35 = 35% from left)
        this.playheadRatio = options.playheadRatio || 0.40;

        // Playback & Recording state
        this.isPlaying = false;
        this.isRecording = true;
        this.currentTime = 0; // Current song time in seconds
        this.lastFrameTime = performance.now();
        this.lastBeatIndex = -1;

        // Recorded note events: array of { id, string (1-6), fret, finger, noteName, time, duration, color }
        this.notes = [];
        this.activePluckedNotes = new Map(); // string => note object (for duration tracking)

        // Rhythm Quantizer reference
        this.quantizer = options.quantizer || null;

        // String labels & order: String 1 is high e (top), String 6 is low E (bottom)
        this.stringNames = ["e", "B", "G", "D", "A", "E"];

        // Callback hooks
        this.onMetronomeClick = options.onMetronomeClick || null;
        this.onPlayheadPass = options.onPlayheadPass || null;

        // Styling
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
            activePillBg: '#0284c7'
        };

        this.initCanvasResolution();
        this.setupEvents();
        this.startRenderLoop();
    }

    /**
     * Initializes high-DPI canvas buffer.
     */
    initCanvasResolution() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();

        const width = rect.width || this.canvas.parentElement.clientWidth || 1000;
        const height = rect.height || 180;

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);

        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

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
        window.addEventListener('resize', () => {
            this.initCanvasResolution();
        });
    }

    /**
     * Sets tempo in BPM (Beats Per Minute)
     */
    setBPM(newBpm) {
        this.bpm = Math.max(30, Math.min(300, newBpm));
    }

    /**
     * Sets horizontal zoom level (pixels per beat)
     */
    setZoom(pixels) {
        this.pixelsPerBeat = Math.max(50, Math.min(250, pixels));
    }

    /**
     * Starts or resumes scrolling.
     */
    play() {
        this.isPlaying = true;
        this.lastFrameTime = performance.now();
    }

    /**
     * Pauses scrolling.
     */
    pause() {
        this.isPlaying = false;
    }

    /**
     * Toggles play/pause.
     */
    togglePlay() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
        return this.isPlaying;
    }

    /**
     * Resets timeline to zero.
     */
    rewind() {
        this.currentTime = 0;
        this.lastBeatIndex = -1;
    }

    /**
     * Clears all recorded notes.
     */
    clearNotes() {
        this.notes = [];
        this.activePluckedNotes.clear();
        this.currentTime = 0;
        this.lastBeatIndex = -1;
    }

    /**
     * Records a note event at the current timeline position, capturing raw timestamps.
     * @param {Object} noteData - { string (1-6), fret, finger, noteName, midi, rawTime, rawDuration }
     */
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
            midi: midi,
            rawTime: rawTime,
            rawDuration: calculatedDur,
            rawEndTime: rawTime + calculatedDur,
            time: calculatedTime,
            duration: calculatedDur,
            color: color || '#38bdf8'
        };

        this.notes.push(newNote);
        this.activePluckedNotes.set(string, newNote);
        return newNote;
    }

    /**
     * Releases active note to finalize its raw duration and end time.
     */
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

    /**
     * Quantizes all notes currently recorded on the staff.
     */
    quantizeNotes(gridType = '16th') {
        if (this.quantizer) {
            this.quantizer.quantizeNotes(this.notes, gridType, this.bpm);
        }
    }

    /**
     * Loads a pre-built tab song.
     */
    loadSong(songNotes, bpm = null) {
        if (bpm) this.setBPM(bpm);
        this.notes = [...songNotes];
        this.rewind();
    }

    /**
     * Continuous 60fps render loop.
     */
    startRenderLoop() {
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

    /**
     * Advances timeline and triggers metronome pulses.
     */
    updateTimeline(dt) {
        this.currentTime += dt;

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
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

        // Background
        ctx.fillStyle = this.colors.background;
        ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        // 1. Draw Grid: Measure Lines & Beat Subdivisions
        this.drawMeasureGrid(ctx);

        // 2. Draw 6 Staff Lines (e, B, G, D, A, E)
        this.drawStaffLines(ctx);

        // 3. Draw Tablature Notes & Sustain Ties
        this.drawNotes(ctx);

        // 4. Draw Left Gutter (String Labels & TAB header)
        this.drawGutter(ctx);

        // 5. Draw Glowing Playhead Line
        this.drawPlayhead(ctx);
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

    drawMeasureGrid(ctx) {
        ctx.save();
        const secondsPerBeat = 60 / this.bpm;
        const pixelsPerSecond = this.pixelsPerBeat / secondsPerBeat;

        // Calculate visible time window
        const visibleWidth = this.cssWidth - this.gutterWidth;
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

                // Measure number header
                ctx.fillStyle = '#cbd5e1';
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
                ctx.setLineDash([]); // Reset
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

            const strIdx = note.string - 1;
            const noteY = this.stringY[strIdx];

            // Is this note right at the playhead?
            const distFromPlayhead = Math.abs(noteX - this.playheadX);
            const isAtPlayhead = distFromPlayhead < 6;

            // Draw sustain tie trail if duration > 0.2s
            const sustainWidth = note.duration * pixelsPerSecond;
            if (sustainWidth > 18) {
                ctx.strokeStyle = isAtPlayhead ? 'rgba(0, 243, 255, 0.65)' : 'rgba(56, 189, 248, 0.35)';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.moveTo(noteX + 11, noteY);
                ctx.lineTo(noteX + Math.min(sustainWidth, 180), noteY);
                ctx.stroke();
            }

            // Draw Fret Number Pill Cutout
            this.drawNotePill(ctx, noteX, noteY, note.fret.toString(), isAtPlayhead, note.finger);
        }

        ctx.restore();
    }

    drawNotePill(ctx, x, y, fretStr, isHot = false, finger = 0) {
        const radius = 10;
        ctx.save();

        if (isHot) {
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

        // Tiny finger indicator tag on top
        if (finger && finger > 0) {
            ctx.fillStyle = '#f59e0b';
            ctx.font = 'bold 8px monospace';
            ctx.fillText(`f${finger}`, x, y - radius - 3);
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
        ctx.shadowColor = this.colors.playhead;
        ctx.shadowBlur = 12;

        // Vertical Playhead Line
        ctx.strokeStyle = this.colors.playhead;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(px, this.staffTop - 10);
        ctx.lineTo(px, this.staffBottom + 10);
        ctx.stroke();

        // Top Triangle Cap
        ctx.fillStyle = this.colors.playhead;
        ctx.beginPath();
        ctx.moveTo(px - 6, this.staffTop - 12);
        ctx.lineTo(px + 6, this.staffTop - 12);
        ctx.lineTo(px, this.staffTop - 3);
        ctx.closePath();
        ctx.fill();

        // Bottom Triangle Cap
        ctx.beginPath();
        ctx.moveTo(px - 6, this.staffBottom + 12);
        ctx.lineTo(px + 6, this.staffBottom + 12);
        ctx.lineTo(px, this.staffBottom + 3);
        ctx.closePath();
        ctx.fill();

        ctx.restore();
    }

    /**
     * Exports recorded notes as standard ASCII guitar tablature text (80 chars wide per block).
     */
    exportASCII() {
        const ExporterClass = (typeof GuitarExporter !== 'undefined')
            ? GuitarExporter
            : (typeof require !== 'undefined' ? require('./exporter.js') : null);

        if (ExporterClass) {
            const exp = new ExporterClass({
                bpm: this.bpm,
                tuning: {
                    name: 'Current Tuning',
                    strings: [64, 59, 55, 50, 45, 40],
                    names: this.stringNames
                }
            });
            return exp.toASCII(this.notes, this.bpm);
        }

        // Fallback 80-character wide formatter
        const secondsPerBeat = 60 / this.bpm;
        const totalDuration = this.notes.length > 0 
            ? Math.max(...this.notes.map(n => n.time + n.duration)) + 1
            : 8;
        
        const totalSixteenths = Math.ceil(totalDuration / (secondsPerBeat / 4));
        const grid = Array.from({ length: 6 }, () => Array(totalSixteenths).fill('-'));

        for (const note of this.notes) {
            const sixteenthIndex = Math.round(note.time / (secondsPerBeat / 4));
            if (sixteenthIndex < totalSixteenths) {
                const strIdx = note.string - 1;
                const fretStr = note.fret.toString();
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
