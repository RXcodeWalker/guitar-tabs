/**
 * Fretboard Visualizer (HTML5 Canvas)
 * Renders a 22-fret horizontal guitar neck with physically proportional frets,
 * realistic string gauges (string 6 thickest to string 1 thinnest),
 * standard mother-of-pearl inlays, dynamic string vibration & bend physics,
 * CAGED system position boxes, left-handed guitarist mode,
 * and glowing neon badges showing note names or color-coded musical intervals.
 */

// =========================================================================
// 1. MUSIC THEORY CONSTANTS & INTERVAL COLOR SYSTEM
// =========================================================================

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const ENHARMONICS = {
    "Db": "C#", "Eb": "D#", "Fb": "E", "Gb": "F#", "Ab": "G#", "Bb": "A#", "Cb": "B",
    "B#": "C", "E#": "F"
};

const SEMITONE_TO_INTERVAL = [
    "R",   // 0: Root
    "b2",  // 1: Minor 2nd / b9
    "2",   // 2: Major 2nd / 9
    "b3",  // 3: Minor 3rd
    "3",   // 4: Major 3rd
    "4",   // 5: Perfect 4th / 11
    "b5",  // 6: Diminished 5th / Tritone / #4 / #11
    "5",   // 7: Perfect 5th
    "b6",  // 8: Minor 6th / b13
    "6",   // 9: Major 6th / 13
    "b7",  // 10: Minor 7th
    "7"    // 11: Major 7th
];

const INTERVAL_ALIASES = {
    "1": "R",
    "ROOT": "R",
    "b9": "b2",
    "9": "2",
    "#9": "b3",
    "11": "4",
    "#11": "b5",
    "b13": "b6",
    "13": "6"
};

/**
 * Pedagogical Interval Color Palette:
 * - Root = Amber/Gold (#f59e0b)
 * - 3rd (b3, 3) = Forest Green (#10b981 / #22c55e)
 * - 5th = Steel Blue (#3b82f6)
 * - 7th (b7, 7) = Violet (#8b5cf6 / #a855f7)
 */
const INTERVAL_DATA = {
    "R": {
        name: "Root",
        semitones: 0,
        color: "#f59e0b", // Amber/Gold
        borderColor: "#fbbf24",
        fillColor: "rgba(245, 158, 11, 0.28)",
        textColor: "#fffbeb",
        glowColor: "rgba(245, 158, 11, 0.85)",
        isChordTone: true
    },
    "b2": {
        name: "Minor 2nd",
        semitones: 1,
        color: "#f97316", // Coral / Orange
        borderColor: "#fb923c",
        fillColor: "rgba(249, 115, 22, 0.20)",
        textColor: "#fff7ed",
        glowColor: "rgba(249, 115, 22, 0.50)",
        isChordTone: false
    },
    "2": {
        name: "Major 2nd",
        semitones: 2,
        color: "#06b6d4", // Teal / Sky
        borderColor: "#22d3ee",
        fillColor: "rgba(6, 182, 212, 0.20)",
        textColor: "#ecfeff",
        glowColor: "rgba(6, 182, 212, 0.55)",
        isChordTone: false
    },
    "b3": {
        name: "Minor 3rd",
        semitones: 3,
        color: "#10b981", // Forest Green / Mint
        borderColor: "#34d399",
        fillColor: "rgba(16, 185, 129, 0.26)",
        textColor: "#ecfdf5",
        glowColor: "rgba(16, 185, 129, 0.80)",
        isChordTone: true
    },
    "3": {
        name: "Major 3rd",
        semitones: 4,
        color: "#22c55e", // Forest Green / Emerald
        borderColor: "#4ade80",
        fillColor: "rgba(34, 197, 94, 0.26)",
        textColor: "#f0fdf4",
        glowColor: "rgba(34, 197, 94, 0.80)",
        isChordTone: true
    },
    "4": {
        name: "Perfect 4th",
        semitones: 5,
        color: "#14b8a6", // Seafoam
        borderColor: "#2dd4bf",
        fillColor: "rgba(20, 184, 166, 0.20)",
        textColor: "#f0fdfa",
        glowColor: "rgba(20, 184, 166, 0.55)",
        isChordTone: false
    },
    "b5": {
        name: "Diminished 5th",
        semitones: 6,
        color: "#f43f5e", // Crimson / Rose
        borderColor: "#fb7185",
        fillColor: "rgba(244, 63, 94, 0.26)",
        textColor: "#fff1f2",
        glowColor: "rgba(244, 63, 94, 0.80)",
        isChordTone: true
    },
    "5": {
        name: "Perfect 5th",
        semitones: 7,
        color: "#3b82f6", // Steel Blue
        borderColor: "#60a5fa",
        fillColor: "rgba(59, 130, 246, 0.26)",
        textColor: "#eff6ff",
        glowColor: "rgba(59, 130, 246, 0.80)",
        isChordTone: true
    },
    "b6": {
        name: "Minor 6th",
        semitones: 8,
        color: "#ec4899", // Pink / Rose
        borderColor: "#f472b6",
        fillColor: "rgba(236, 72, 153, 0.20)",
        textColor: "#fdf2f8",
        glowColor: "rgba(236, 72, 153, 0.55)",
        isChordTone: false
    },
    "6": {
        name: "Major 6th",
        semitones: 9,
        color: "#d946ef", // Fuchsia / Orchid
        borderColor: "#e879f9",
        fillColor: "rgba(217, 70, 239, 0.20)",
        textColor: "#fdf4ff",
        glowColor: "rgba(217, 70, 239, 0.55)",
        isChordTone: false
    },
    "b7": {
        name: "Minor 7th",
        semitones: 10,
        color: "#8b5cf6", // Violet / Purple
        borderColor: "#a78bfa",
        fillColor: "rgba(139, 92, 246, 0.26)",
        textColor: "#f5f3ff",
        glowColor: "rgba(139, 92, 246, 0.80)",
        isChordTone: true
    },
    "7": {
        name: "Major 7th",
        semitones: 11,
        color: "#a855f7", // Violet / Purple
        borderColor: "#c084fc",
        fillColor: "rgba(168, 85, 247, 0.26)",
        textColor: "#faf5ff",
        glowColor: "rgba(168, 85, 247, 0.80)",
        isChordTone: true
    }
};

/**
 * Base CAGED pattern offsets relative to Root C (0):
 * C Form: Frets 0-3 (String 5 root)
 * A Form: Frets 2-5 (String 5 root)
 * G Form: Frets 5-8 (String 6 root)
 * E Form: Frets 7-10 (String 6 root)
 * D Form: Frets 10-13 (String 4 root)
 */
const CAGED_BASE_PATTERNS = [
    { shape: 'C', baseStart: 0, baseEnd: 3, rootString: 5, color: '#f59e0b', label: 'C Form' },
    { shape: 'A', baseStart: 2, baseEnd: 5, rootString: 5, color: '#10b981', label: 'A Form' },
    { shape: 'G', baseStart: 5, baseEnd: 8, rootString: 6, color: '#06b6d4', label: 'G Form' },
    { shape: 'E', baseStart: 7, baseEnd: 10, rootString: 6, color: '#3b82f6', label: 'E Form' },
    { shape: 'D', baseStart: 10, baseEnd: 13, rootString: 4, color: '#8b5cf6', label: 'D Form' }
];


// =========================================================================
// 2. MAIN FRETBOARD VISUALIZER CLASS
// =========================================================================

class FretboardVisualizer {
    constructor(canvasId, options = {}) {
        // Support browser DOM and headless test environment
        if (typeof document !== 'undefined') {
            this.canvas = (typeof canvasId === 'string') ? document.getElementById(canvasId) : canvasId;
        }
        
        if (!this.canvas) {
            if (options.mockCanvas) {
                this.canvas = options.mockCanvas;
            } else if (typeof document === 'undefined') {
                this.canvas = this.createHeadlessCanvas();
            } else {
                throw new Error(`Canvas with id "${canvasId}" not found.`);
            }
        }

        this.ctx = this.canvas.getContext('2d');
        this.numFrets = options.numFrets || 22;
        this.numStrings = 6;

        // Display Mode: 'noteName' or 'interval'
        this._displayMode = options.displayMode || options.scaleOverlayMode || 'noteName';
        this.activeKey = options.activeKey || 'C';

        // Left-Handed Guitarist Mode
        this.isLefty = !!options.isLefty;
        this.flipStrings = !!(options.flipStrings || options.invertStrings);

        // CAGED System Overlay State
        this.cagedOverlayVisible = !!options.cagedOverlayVisible;
        this.cagedRoot = options.cagedRoot || this.activeKey || 'C';
        this.cagedShape = options.cagedShape || 'all'; // 'all', 'C', 'A', 'G', 'E', 'D'
        this._cachedCagedBoxes = [];

        // Active lit notes: Map of `${string}-${fret}` => { noteName, finger, timestamp, intensity, color, interval }
        this.activeNotes = new Map();

        // Scale Overlay State (Target, Passing, and Avoid notes)
        this.scaleOverlayNotes = [];
        this.scaleOverlayVisible = (options.scaleOverlayVisible !== undefined) ? options.scaleOverlayVisible : true;
        this.scaleOverlayShowAvoid = (options.scaleOverlayShowAvoid !== undefined) ? options.scaleOverlayShowAvoid : false;

        // String vibration physics: array of { amplitude, frequency, phase, decay }
        this.stringVibrations = Array.from({ length: 6 }, () => ({
            amplitude: 0,
            frequency: 12,
            phase: 0,
            decay: 0.94
        }));

        // String bend physics animation:
        // Half-step (100 cents) = 1 fret deflection, Full step (200 cents) = 2 fret deflection
        this.stringBends = Array.from({ length: 6 }, (_, s) => ({
            cents: 0.0,
            targetCents: 0.0,
            fret: 12,
            direction: (s < 3) ? -1 : 1, // strings 1,2,3 bend upward (-Y), 4,5,6 downward (+Y)
            springVelocity: 0.0,
            deflectionPixels: 0.0
        }));

        // String Gauges (in relative pixels at base scale)
        // String 1 is high e (thin), String 6 is low E (thick)
        this.stringGauges = [1.2, 1.8, 2.4, 3.2, 4.0, 5.0];
        this.stringNames = ["e", "B", "G", "D", "A", "E"];

        // Standard inlay fret markers (12 is double dot)
        this.markerFrets = [3, 5, 7, 9, 12, 15, 17, 19, 21];

        // Click interaction callback: (string, fret) => void
        this.onFretClick = options.onFretClick || null;

        // Theme colors
        this.colors = {
            neckWoodDark: '#161311',
            neckWoodLight: '#241e1a',
            fretMetal: '#b0b8c2',
            fretCrown: '#f3f6fa',
            fretShadow: '#09090b',
            nut: '#e2d8c3',
            markerPearl: '#d4dcdd',
            markerGlow: 'rgba(255, 255, 255, 0.4)',
            stringSteel: '#cfd8dc',
            stringBronze: '#bcaaa4',
            neonCyan: '#00f3ff',
            neonAmber: '#ffaa00',
            neonPink: '#ff007f',
            neonLime: '#00ff66'
        };

        // Cached canvas gradients to eliminate GC in the 60fps render loop
        this._cachedNeckGrad = null;
        this._cachedNutGrad = null;
        this._cachedWoundStringGrad = null;
        this._cachedPlainStringGrad = null;
        this._cachedDotGrad = null;

        this.initCanvasResolution();
        this.updateCagedBoxesCache();
        this.setupEvents();

        if (!options.headless && typeof requestAnimationFrame !== 'undefined') {
            this.startRenderLoop();
        }
    }

    /**
     * Fallback mock canvas for headless Node.js testing.
     */
    createHeadlessCanvas() {
        return {
            getContext: () => ({
                resetTransform: () => {},
                scale: () => {},
                clearRect: () => {},
                beginPath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                stroke: () => {},
                fill: () => {},
                arc: () => {},
                quadraticCurveTo: () => {},
                rect: () => {},
                roundRect: () => {},
                save: () => {},
                restore: () => {},
                fillText: () => {},
                strokeRect: () => {},
                fillRect: () => {},
                setLineDash: () => {},
                createLinearGradient: () => ({ addColorStop: () => {} }),
                createRadialGradient: () => ({ addColorStop: () => {} })
            }),
            getBoundingClientRect: () => ({ width: 1000, height: 220, top: 0, left: 0 }),
            addEventListener: () => {}
        };
    }

    // -------------------------------------------------------------------------
    // DISPLAY MODE & KEY TOGGLE INTERFACES
    // -------------------------------------------------------------------------

    get displayMode() {
        return this._displayMode;
    }

    set displayMode(mode) {
        this.setDisplayMode(mode);
    }

    // Compatibility getter/setter for scaleOverlayMode
    get scaleOverlayMode() {
        return this._displayMode;
    }

    set scaleOverlayMode(mode) {
        this.setDisplayMode(mode);
    }

    /**
     * Sets display mode: 'noteName' (C, D#) or 'interval' (R, b3, 3, 5, b7)
     */
    setDisplayMode(mode) {
        if (mode === 'interval' || mode === 'noteName') {
            this._displayMode = mode;
        }
    }

    getDisplayMode() {
        return this._displayMode;
    }

    /**
     * Sets active musical key root (e.g., 'C', 'A', 'G', etc.)
     */
    setActiveKey(key) {
        if (typeof key === 'string') {
            this.activeKey = key;
            if (!this.cagedRoot || this.cagedRoot === 'C') {
                this.cagedRoot = key;
            }
            this.updateCagedBoxesCache();
        }
    }

    getActiveKey() {
        return this.activeKey;
    }

    // -------------------------------------------------------------------------
    // LEFT-HANDED ORIENTATION & STRING INVERSION INTERFACES
    // -------------------------------------------------------------------------

    /**
     * Toggles or sets Left-Handed orientation and optional string inversion.
     */
    setLefty(isLefty, flipStrings = false) {
        this.isLefty = !!isLefty;
        this.flipStrings = !!flipStrings;
        this.calculateFretPositions();
        this.rebuildGradients();
        this.updateCagedBoxesCache();
    }

    isLeftHanded() {
        return this.isLefty;
    }

    areStringsFlipped() {
        return this.flipStrings;
    }

    toggleLefty() {
        this.setLefty(!this.isLefty, this.flipStrings);
    }

    toggleFlipStrings() {
        this.setLefty(this.isLefty, !this.flipStrings);
    }

    // -------------------------------------------------------------------------
    // CAGED SYSTEM OVERLAY INTERFACES
    // -------------------------------------------------------------------------

    setCagedOverlayVisible(visible) {
        this.cagedOverlayVisible = !!visible;
    }

    isCagedOverlayVisible() {
        return this.cagedOverlayVisible;
    }

    toggleCagedOverlay() {
        this.cagedOverlayVisible = !this.cagedOverlayVisible;
    }

    setCagedRoot(root) {
        if (typeof root === 'string') {
            this.cagedRoot = root;
            this.updateCagedBoxesCache();
        }
    }

    getCagedRoot() {
        return this.cagedRoot;
    }

    setCagedShape(shape) {
        this.cagedShape = shape || 'all';
        this.updateCagedBoxesCache();
    }

    getCagedShape() {
        return this.cagedShape;
    }

    getCagedBoxes() {
        return this._cachedCagedBoxes;
    }

    updateCagedBoxesCache() {
        this._cachedCagedBoxes = FretboardVisualizer.calculateCagedBoxes(
            this.cagedRoot || this.activeKey || 'C',
            this.numFrets,
            this.cagedShape
        );
    }

    // -------------------------------------------------------------------------
    // STRING BEND & VIBRATO REAL-TIME PHYSICS INTERFACES
    // -------------------------------------------------------------------------

    /**
     * Applies real-time pitch deviation (in cents) to a string.
     * Deflection scaling: half-step (100 cents) = 1 fret deflection, full step (200 cents) = 2 fret deflection.
     * @param {number} string - String index 1 to 6 (1 = high e, 6 = low E)
     * @param {number} cents - Deviation in cents (e.g. +100 = half step, +200 = full step)
     * @param {number|null} fret - Target fret being fretted (default 12)
     * @param {number|null} direction - -1 (deflect upward), +1 (deflect downward)
     */
    setPitchBend(string, cents, fret = null, direction = null) {
        const sIdx = string - 1;
        if (sIdx < 0 || sIdx >= this.numStrings) return;

        const bend = this.stringBends[sIdx];
        bend.targetCents = Number(cents) || 0;
        if (fret !== null && fret !== undefined) {
            bend.fret = Math.max(0, Math.min(this.numFrets, fret));
        }

        if (direction !== null && direction !== undefined) {
            bend.direction = (direction < 0) ? -1 : 1;
        } else {
            // Default pedagogical convention: high strings (1, 2, 3) bend upward (-Y towards low strings),
            // low strings (5, 6) bend downward (+Y towards high strings), string 4 bends upward
            bend.direction = (sIdx < 3) ? -1 : 1;
        }
    }

    setPitchDeviation(string, cents, fret = null) {
        this.setPitchBend(string, cents, fret);
    }

    getPitchBend(string) {
        const sIdx = string - 1;
        if (sIdx < 0 || sIdx >= this.numStrings) return null;
        return this.stringBends[sIdx];
    }

    clearPitchBend(string = null) {
        if (string !== null && string !== undefined) {
            const sIdx = string - 1;
            if (sIdx >= 0 && sIdx < this.numStrings) {
                this.stringBends[sIdx].targetCents = 0;
            }
        } else {
            for (let s = 0; s < this.numStrings; s++) {
                this.stringBends[s].targetCents = 0;
            }
        }
    }

    // -------------------------------------------------------------------------
    // CANVAS RESOLUTION & COORDINATE CALCULATIONS
    // -------------------------------------------------------------------------

    initCanvasResolution() {
        const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1;
        const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 1000, height: 220 };
        
        const parentWidth = (this.canvas.parentElement && this.canvas.parentElement.clientWidth) ? this.canvas.parentElement.clientWidth : 1000;
        const width = rect.width || parentWidth || 1000;
        const height = rect.height || 220;

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);

        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        this.cssWidth = width;
        this.cssHeight = height;

        this.calculateFretPositions();
        this.rebuildGradients();
    }

    calculateFretPositions() {
        this.fretPositions = [];
        this.fretPositionsLefty = [];
        this.fretWidths = [];
        this.fretCenters = [];
        this.fretCentersLefty = [];

        // Neck dimensions
        this.neckMarginLeft = 46; // Room for nut and open string indicators
        this.neckMarginRight = 24;
        this.neckMarginY = 24;
        this.neckWidth = Math.max(100, this.cssWidth - this.neckMarginLeft - this.neckMarginRight);
        this.neckHeight = Math.max(80, this.cssHeight - this.neckMarginY * 2);

        const totalRatio = 1 - Math.pow(2, -this.numFrets / 12);

        // Righty: Nut (fret 0) is at left
        this.fretPositions[0] = this.neckMarginLeft;

        // Lefty: Nut (fret 0) is at right
        this.fretPositionsLefty[0] = this.neckMarginLeft + this.neckWidth;

        this.fretWidths[0] = 0;
        this.fretCenters[0] = this.neckMarginLeft - 26;
        this.fretCentersLefty[0] = this.neckMarginLeft + this.neckWidth + 26;

        for (let i = 1; i <= this.numFrets; i++) {
            const ratio = (1 - Math.pow(2, -i / 12)) / totalRatio;
            
            // Standard Right-Handed coordinates
            this.fretPositions[i] = this.neckMarginLeft + ratio * this.neckWidth;
            this.fretWidths[i] = this.fretPositions[i] - this.fretPositions[i - 1];
            this.fretCenters[i] = (this.fretPositions[i - 1] + this.fretPositions[i]) / 2;

            // Left-Handed coordinates (horizontally inverted, nut on right)
            this.fretPositionsLefty[i] = this.neckMarginLeft + (1 - ratio) * this.neckWidth;
            this.fretCentersLefty[i] = (this.fretPositionsLefty[i - 1] + this.fretPositionsLefty[i]) / 2;
        }

        // Standard String Y positions (string 1 at top, string 6 at bottom)
        this.stringY = [];
        const stringSpacing = this.neckHeight / (this.numStrings - 1);
        for (let s = 0; s < this.numStrings; s++) {
            this.stringY[s] = this.neckMarginY + s * stringSpacing;
        }
    }

    /**
     * Rebuilds and caches Canvas gradients to prevent allocation inside the 60fps draw loop.
     */
    rebuildGradients() {
        const ctx = this.ctx;
        if (!ctx || !ctx.createLinearGradient) return;

        const x = this.neckMarginLeft;
        const y = this.neckMarginY;
        const h = this.neckHeight;

        // 1. Neck Wood Grain Gradient
        const neckGrad = ctx.createLinearGradient(x, y, x, y + h);
        neckGrad.addColorStop(0.0, '#1c1613');
        neckGrad.addColorStop(0.2, '#29211c');
        neckGrad.addColorStop(0.5, '#1e1815');
        neckGrad.addColorStop(0.8, '#261f1a');
        neckGrad.addColorStop(1.0, '#14100e');
        this._cachedNeckGrad = neckGrad;

        // 2. Nut Gradient
        const nutX = this.isLefty ? this.fretPositionsLefty[0] : this.fretPositions[0];
        const nutGrad = ctx.createLinearGradient(nutX - 8, y, nutX + 8, y);
        nutGrad.addColorStop(0.0, '#d1c4b2');
        nutGrad.addColorStop(0.5, '#f5efe6');
        nutGrad.addColorStop(1.0, '#b0a390');
        this._cachedNutGrad = nutGrad;

        // 3. Wound String Gradient (strings 4, 5, 6)
        const woundGrad = ctx.createLinearGradient(0, -3, 0, 3);
        woundGrad.addColorStop(0.0, '#8c7b70');
        woundGrad.addColorStop(0.5, '#e4d5cb');
        woundGrad.addColorStop(1.0, '#5c4e45');
        this._cachedWoundStringGrad = woundGrad;

        // 4. Plain Steel String Gradient (strings 1, 2, 3)
        const plainGrad = ctx.createLinearGradient(0, -3, 0, 3);
        plainGrad.addColorStop(0.0, '#78909c');
        plainGrad.addColorStop(0.4, '#ffffff');
        plainGrad.addColorStop(1.0, '#546e7a');
        this._cachedPlainStringGrad = plainGrad;

        // 5. Pearloid Inlay Radial Gradient (normalized center 0, 0)
        const dotGrad = ctx.createRadialGradient(-1.5, -1.5, 0.5, 0, 0, 5.0);
        dotGrad.addColorStop(0.0, '#ffffff');
        dotGrad.addColorStop(0.4, '#e3e8ea');
        dotGrad.addColorStop(0.8, '#b8c2c5');
        dotGrad.addColorStop(1.0, '#758085');
        this._cachedDotGrad = dotGrad;
    }

    /**
     * Gets fret wire X coordinate (respecting isLefty).
     */
    getFretX(fret) {
        const f = Math.max(0, Math.min(this.numFrets, fret));
        return this.isLefty ? this.fretPositionsLefty[f] : this.fretPositions[f];
    }

    /**
     * Gets fret center X coordinate (midpoint for note badges).
     */
    getFretCenter(fret) {
        const f = Math.max(0, Math.min(this.numFrets, fret));
        return this.isLefty ? this.fretCentersLefty[f] : this.fretCenters[f];
    }

    /**
     * Gets physical fret width in pixels.
     */
    getFretWidth(fret) {
        const f = Math.max(0, Math.min(this.numFrets, fret));
        return this.fretWidths[f] || (this.neckWidth / this.numFrets);
    }

    /**
     * Gets string Y coordinate (respecting flipStrings).
     * @param {number} s - 0-indexed string (0 = string 1, 5 = string 6)
     */
    getStringY(s) {
        const sIdx = this.flipStrings ? (this.numStrings - 1 - s) : s;
        return this.stringY[sIdx];
    }

    getStringGauge(s) {
        const sIdx = this.flipStrings ? (this.numStrings - 1 - s) : s;
        return this.stringGauges[sIdx];
    }

    getStringName(s) {
        const sIdx = this.flipStrings ? (this.numStrings - 1 - s) : s;
        return this.stringNames[sIdx];
    }

    setupEvents() {
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', () => {
                this.initCanvasResolution();
            });
        }

        const handlePointer = (e) => {
            if (!this.canvas.getBoundingClientRect) return;
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            const target = this.getFretAtCoordinates(clickX, clickY);
            if (target && this.onFretClick) {
                this.onFretClick(target.string, target.fret);
            }
        };

        if (this.canvas.addEventListener) {
            this.canvas.addEventListener('mousedown', handlePointer);
            this.canvas.addEventListener('touchstart', (e) => {
                if (e.touches && e.touches.length > 0) {
                    handlePointer(e.touches[0]);
                    e.preventDefault();
                }
            }, { passive: false });
        }
    }

    /**
     * Maps mouse/touch (x, y) coordinates to (string, fret) with full lefty & flipped strings support.
     */
    getFretAtCoordinates(x, y) {
        // Find closest string
        let closestString = 1;
        let minDistY = Infinity;
        for (let s = 0; s < this.numStrings; s++) {
            const strY = this.getStringY(s);
            const dist = Math.abs(y - strY);
            if (dist < minDistY) {
                minDistY = dist;
                closestString = s + 1; // 1-based string
            }
        }

        // Vertical boundary check
        const maxStringDist = this.neckHeight / (this.numStrings - 1);
        if (minDistY > maxStringDist) {
            return null;
        }

        // Horizontal fret hit test
        if (!this.isLefty) {
            // Right-Handed: Nut on left
            const nutX = this.fretPositions[0];
            if (x < nutX + 8) {
                return { string: closestString, fret: 0 };
            }
            for (let f = 1; f <= this.numFrets; f++) {
                const fretX = this.fretPositions[f];
                const prevFretX = this.fretPositions[f - 1];
                if (x >= prevFretX && x <= fretX) {
                    return { string: closestString, fret: f };
                }
            }
        } else {
            // Left-Handed: Nut on right
            const nutX = this.fretPositionsLefty[0];
            if (x > nutX - 8) {
                return { string: closestString, fret: 0 };
            }
            for (let f = 1; f <= this.numFrets; f++) {
                const prevFretX = this.fretPositionsLefty[f - 1]; // larger X (right)
                const currFretX = this.fretPositionsLefty[f];     // smaller X (left)
                if (x >= currFretX && x <= prevFretX) {
                    return { string: closestString, fret: f };
                }
            }
        }

        return null;
    }

    // -------------------------------------------------------------------------
    // ACTIVE NOTES & SCALE OVERLAYS
    // -------------------------------------------------------------------------

    /**
     * Activates a glowing neon badge at (string, fret).
     */
    lightUpNote(string, fret, noteName = '', finger = 0, color = null) {
        const key = `${string}-${fret}`;
        
        let chosenColor = color;
        const interval = noteName ? FretboardVisualizer.getInterval(noteName, this.activeKey) : 'R';

        if (!chosenColor) {
            if (this._displayMode === 'interval') {
                const info = FretboardVisualizer.getIntervalInfo(interval);
                chosenColor = info.color;
            } else {
                const neonColors = [this.colors.neonCyan, this.colors.neonAmber, this.colors.neonPink, this.colors.neonLime];
                chosenColor = neonColors[(string - 1) % neonColors.length];
            }
        }

        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        this.activeNotes.set(key, {
            string: string,
            fret: fret,
            noteName: noteName,
            finger: finger,
            timestamp: now,
            intensity: 1.0,
            color: chosenColor,
            interval: interval
        });

        // Trigger string vibration
        const strIdx = string - 1;
        if (this.stringVibrations[strIdx]) {
            this.stringVibrations[strIdx].amplitude = 4.2;
            this.stringVibrations[strIdx].phase = 0;
        }

        // Anchor string bend location
        if (this.stringBends[strIdx]) {
            this.stringBends[strIdx].fret = fret;
        }
    }

    clearActiveNotes() {
        this.activeNotes.clear();
    }

    setScaleOverlay(notes, options = {}) {
        this.scaleOverlayNotes = notes || [];
        if (options.visible !== undefined) this.scaleOverlayVisible = options.visible;
        if (options.mode !== undefined) this.setDisplayMode(options.mode);
        if (options.showAvoid !== undefined) this.scaleOverlayShowAvoid = options.showAvoid;
    }

    clearScaleOverlay() {
        this.scaleOverlayNotes = [];
    }

    // -------------------------------------------------------------------------
    // RENDER LOOP & CANVAS DRAWING
    // -------------------------------------------------------------------------

    startRenderLoop() {
        const render = () => {
            this.draw();
            if (typeof requestAnimationFrame !== 'undefined') {
                requestAnimationFrame(render);
            }
        };
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(render);
        }
    }

    render() {
        this.draw();
    }

    draw() {
        const ctx = this.ctx;
        if (!ctx) return;

        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

        // 1. Draw Guitar Neck Wood Background
        this.drawNeckWood(ctx);

        // 2. Draw Inlay Fret Markers
        this.drawFretMarkers(ctx);

        // 3. Draw Frets & Nut
        this.drawFretsAndNut(ctx);

        // 3.5 Draw CAGED System Position Boxes
        if (this.cagedOverlayVisible && this._cachedCagedBoxes.length > 0) {
            this.drawCagedBoxes(ctx);
        }

        // 4. Draw Strings with Dynamic Bend & Vibrato Physics
        this.drawStrings(ctx);

        // 5. Draw Open String & Tuning Labels
        this.drawStringLabels(ctx);

        // 5.5 Draw Live Scale Overlay Badges (Target, Passing, Avoid)
        if (this.scaleOverlayVisible && this.scaleOverlayNotes && this.scaleOverlayNotes.length > 0) {
            this.drawScaleOverlay(ctx);
        }

        // 6. Draw Glowing Neon Active Note Badges
        this.drawActiveBadges(ctx);

        // 7. Update physics decays
        this.updatePhysics();
    }

    drawNeckWood(ctx) {
        const x = this.neckMarginLeft;
        const y = this.neckMarginY;
        const w = this.neckWidth;
        const h = this.neckHeight;

        ctx.save();
        ctx.fillStyle = this._cachedNeckGrad || '#1e1815';
        ctx.fillRect(x, y, w, h);

        // Subtle fretboard edge binding
        ctx.strokeStyle = '#3d332a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, w, h);

        // Top edge highlight
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
        ctx.stroke();

        ctx.restore();
    }

    drawFretMarkers(ctx) {
        const centerY = this.neckMarginY + this.neckHeight / 2;

        ctx.save();

        for (let i = 0; i < this.markerFrets.length; i++) {
            const fret = this.markerFrets[i];
            if (fret > this.numFrets) continue;

            const midX = this.getFretCenter(fret);

            if (fret === 12) {
                // 12th Fret Double Dot Inlay
                const offset = this.neckHeight * 0.22;
                this.drawPearlDot(ctx, midX, centerY - offset, 4.5);
                this.drawPearlDot(ctx, midX, centerY + offset, 4.5);
            } else {
                // Standard single dot inlay
                this.drawPearlDot(ctx, midX, centerY, 5.0);
            }

            // Top side dot marker (tiny white dot on upper binding)
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.beginPath();
            ctx.arc(midX, this.neckMarginY - 3, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    drawPearlDot(ctx, x, y, radius) {
        ctx.save();
        ctx.translate(x, y);

        if (this._cachedDotGrad) {
            ctx.fillStyle = this._cachedDotGrad;
        } else {
            ctx.fillStyle = '#b8c2c5';
        }

        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner luster ring
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        ctx.restore();
    }

    drawFretsAndNut(ctx) {
        ctx.save();

        // 1. Draw Nut
        const nutX = this.getFretX(0);
        const nutY = this.neckMarginY - 2;
        const nutW = 7;
        const nutH = this.neckHeight + 4;

        ctx.fillStyle = this._cachedNutGrad || '#d1c4b2';
        if (!this.isLefty) {
            ctx.fillRect(nutX - nutW, nutY, nutW, nutH);
            ctx.strokeStyle = '#4a3d31';
            ctx.lineWidth = 1;
            ctx.strokeRect(nutX - nutW, nutY, nutW, nutH);
        } else {
            ctx.fillRect(nutX, nutY, nutW, nutH);
            ctx.strokeStyle = '#4a3d31';
            ctx.lineWidth = 1;
            ctx.strokeRect(nutX, nutY, nutW, nutH);
        }

        // 2. Draw Metallic Nickel-Silver Frets (1 to numFrets)
        const topY = this.neckMarginY;
        const bottomY = topY + this.neckHeight;
        const shadowOffset = this.isLefty ? -1.2 : 1.2;

        for (let f = 1; f <= this.numFrets; f++) {
            const fx = this.getFretX(f);

            // Fret shadow (3D bevel depth)
            ctx.strokeStyle = this.colors.fretShadow;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.moveTo(fx + shadowOffset, topY);
            ctx.lineTo(fx + shadowOffset, bottomY);
            ctx.stroke();

            // Nickel fret crown
            ctx.strokeStyle = this.colors.fretCrown;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(fx, topY);
            ctx.lineTo(fx, bottomY);
            ctx.stroke();

            // Fret number label below neck
            ctx.fillStyle = (f === 3 || f === 5 || f === 7 || f === 9 || f === 12 || f === 15 || f === 17 || f === 19 || f === 21)
                ? '#ffd166'
                : '#6c757d';
            ctx.font = '10px "Inter", "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(f.toString(), this.getFretCenter(f), bottomY + 16);
        }

        ctx.restore();
    }

    /**
     * Renders semi-transparent, rounded highlight bounding boxes around the 5 classic CAGED box positions.
     */
    drawCagedBoxes(ctx) {
        if (!this._cachedCagedBoxes || this._cachedCagedBoxes.length === 0) return;

        ctx.save();
        for (let i = 0; i < this._cachedCagedBoxes.length; i++) {
            const box = this._cachedCagedBoxes[i];
            this.renderCagedBox(ctx, box);
        }
        ctx.restore();
    }

    renderCagedBox(ctx, box) {
        // Calculate box X bounds
        let x1, x2;
        if (!this.isLefty) {
            x1 = (box.startFret === 0) ? (this.getFretX(0) - 20) : this.getFretX(box.startFret - 1);
            x2 = this.getFretX(box.endFret);
        } else {
            x1 = (box.startFret === 0) ? (this.getFretX(0) + 20) : this.getFretX(box.startFret - 1);
            x2 = this.getFretX(box.endFret);
        }

        const boxX = Math.min(x1, x2);
        const boxW = Math.max(12, Math.abs(x2 - x1));
        const boxY = this.neckMarginY - 6;
        const boxH = this.neckHeight + 12;
        const cornerRadius = 8;

        // 1. Semi-transparent background fill
        ctx.fillStyle = box.fillColor || 'rgba(245, 158, 11, 0.12)';
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, cornerRadius);
        ctx.fill();

        // 2. Dashed accent border
        ctx.strokeStyle = box.color;
        ctx.lineWidth = 1.6;
        if (ctx.setLineDash) {
            ctx.setLineDash([5, 4]);
        }
        this.drawRoundedRect(ctx, boxX, boxY, boxW, boxH, cornerRadius);
        ctx.stroke();
        if (ctx.setLineDash) {
            ctx.setLineDash([]);
        }

        // 3. Form Label Pill Badge above the neck
        const centerX = boxX + boxW / 2;
        const badgeY = boxY - 2;

        ctx.fillStyle = box.color;
        this.drawRoundedRect(ctx, centerX - 30, badgeY - 14, 60, 15, 7.5);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 9px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(box.label, centerX, badgeY - 6.5);
    }

    /**
     * Draws guitar strings with real-time dynamic pitch bend (quadratic bezier curve) and vibration physics.
     */
    drawStrings(ctx) {
        ctx.save();

        let startX, endX;
        if (!this.isLefty) {
            startX = this.neckMarginLeft - 6;
            endX = this.neckMarginLeft + this.neckWidth;
        } else {
            startX = this.neckMarginLeft + this.neckWidth + 6;
            endX = this.neckMarginLeft;
        }

        for (let s = 0; s < this.numStrings; s++) {
            const baseY = this.getStringY(s);
            const gauge = this.getStringGauge(s);
            const vib = this.stringVibrations[s];
            const bend = this.stringBends[s];

            // Animated wave deflection from vibration
            const waveOffset = vib.amplitude * Math.sin(vib.phase);
            // Pitch bend deflection in pixels (half-step = 1 fret deflection, full step = 2 fret deflection)
            const bendOffset = bend.deflectionPixels;

            const hasDeflection = (Math.abs(bendOffset) > 0.4 || Math.abs(waveOffset) > 0.05);

            // Peak of the bend deflection occurs around bend.fret
            const bendFretX = this.getFretCenter(bend.fret || 12);
            const controlX = hasDeflection ? bendFretX : (startX + endX) / 2;
            
            // For a quadratic bezier curve with endpoints at baseY, peak height at center is:
            // Y(0.5) = baseY + (controlY - baseY) * 0.5
            // Therefore, controlY = baseY + (bendOffset * 2.0) + waveOffset
            const controlY = baseY + (bendOffset * 2.0) + waveOffset;

            // 1. Shadow under string
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.lineWidth = gauge + 1.0;
            ctx.beginPath();
            if (hasDeflection) {
                ctx.moveTo(startX, baseY + 1.5);
                ctx.quadraticCurveTo(controlX, controlY + 1.5, endX, baseY + 1.5);
            } else {
                ctx.moveTo(startX, baseY + 1.5);
                ctx.lineTo(endX, baseY + 1.5);
            }
            ctx.stroke();

            // 2. String body (strings 4, 5, 6 wound, 1, 2, 3 plain steel)
            ctx.save();
            ctx.translate(0, baseY);
            ctx.strokeStyle = (s >= 3) ? (this._cachedWoundStringGrad || '#a89f91') : (this._cachedPlainStringGrad || '#cfd8dc');
            ctx.lineWidth = gauge;
            ctx.beginPath();
            if (hasDeflection) {
                ctx.moveTo(startX, 0);
                ctx.quadraticCurveTo(controlX, controlY - baseY, endX, 0);
            } else {
                ctx.moveTo(startX, 0);
                ctx.lineTo(endX, 0);
            }
            ctx.stroke();
            ctx.restore();
        }

        ctx.restore();
    }

    drawStringLabels(ctx) {
        ctx.save();
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px "Inter", "Segoe UI", sans-serif';

        if (!this.isLefty) {
            // Right-Handed: Tuning labels on the left of the nut
            ctx.textAlign = 'right';
            for (let s = 0; s < this.numStrings; s++) {
                const y = this.getStringY(s);
                const name = this.getStringName(s);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(name, this.neckMarginLeft - 14, y);
            }

            ctx.textAlign = 'center';
            ctx.fillStyle = '#64748b';
            ctx.font = '10px monospace';
            ctx.fillText('NUT', this.neckMarginLeft - 22, this.neckMarginY - 8);
        } else {
            // Left-Handed: Tuning labels on the right of the nut
            ctx.textAlign = 'left';
            const nutX = this.getFretX(0);
            for (let s = 0; s < this.numStrings; s++) {
                const y = this.getStringY(s);
                const name = this.getStringName(s);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(name, nutX + 14, y);
            }

            ctx.textAlign = 'center';
            ctx.fillStyle = '#64748b';
            ctx.font = '10px monospace';
            ctx.fillText('NUT', nutX + 22, this.neckMarginY - 8);
        }

        ctx.restore();
    }

    drawActiveBadges(ctx) {
        const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

        this.activeNotes.forEach((note, key) => {
            const age = (now - note.timestamp) / 1000;
            // Decay intensity over 1.8 seconds
            if (age > 1.8) {
                this.activeNotes.delete(key);
                return;
            }

            const alpha = Math.max(0, 1 - age / 1.8);
            const strIdx = note.string - 1;
            const baseY = this.getStringY(strIdx);
            const badgeX = this.getFretCenter(note.fret);

            // Follow string deflection if target string is being bent
            const bend = this.stringBends[strIdx];
            const defOffsetY = bend ? (bend.deflectionPixels * 0.9) : 0;
            const badgeY = baseY + defOffsetY;

            const interval = note.interval || FretboardVisualizer.getInterval(note.noteName, this.activeKey);
            const displayLabel = (this._displayMode === 'interval') ? interval : note.noteName;

            this.renderNeonBadge(ctx, badgeX, badgeY, displayLabel, note.finger, note.color, alpha, interval);
        });
    }

    renderNeonBadge(ctx, x, y, label, finger, colorHex, alpha, interval = null) {
        const radius = 13.5;

        ctx.save();
        ctx.globalAlpha = alpha;

        const intervalInfo = interval ? FretboardVisualizer.getIntervalInfo(interval) : null;
        const mainColor = (this._displayMode === 'interval' && intervalInfo) ? intervalInfo.color : (colorHex || '#00f3ff');

        // 1. Intense Outer Bloom Glow
        ctx.shadowColor = mainColor;
        ctx.shadowBlur = 18;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // 2. Translucent Circular Background
        ctx.fillStyle = 'rgba(10, 15, 24, 0.88)';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 3. Glowing Neon Border
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.shadowBlur = 0;

        // 4. Label in Center (Note Name or Interval Degree)
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label || '', x, y - (finger > 0 ? 1 : 0));

        // 5. Finger Number Badge (small glowing pill at upper right)
        if (finger && finger > 0) {
            const fX = x + 10;
            const fY = y - 10;
            const fRadius = 6.5;

            ctx.fillStyle = mainColor;
            ctx.beginPath();
            ctx.arc(fX, fY, fRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 8.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(finger.toString(), fX, fY);
        } else if (finger === 0 && label) {
            // Open string indicator
            const fX = x + 10;
            const fY = y - 10;
            const fRadius = 6.0;

            ctx.fillStyle = '#475569';
            ctx.beginPath();
            ctx.arc(fX, fY, fRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 7.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('0', fX, fY);
        }

        ctx.restore();
    }

    drawScaleOverlay(ctx) {
        if (!this.scaleOverlayNotes || this.scaleOverlayNotes.length === 0) return;

        ctx.save();
        for (let i = 0; i < this.scaleOverlayNotes.length; i++) {
            const item = this.scaleOverlayNotes[i];
            if (item.noteType === 'avoid' && !this.scaleOverlayShowAvoid) {
                continue;
            }

            const strIdx = item.string - 1;
            if (strIdx < 0 || strIdx >= this.numStrings) continue;

            const baseY = this.getStringY(strIdx);
            const badgeX = this.getFretCenter(item.fret);

            // Compute interval if not present
            const interval = item.interval || FretboardVisualizer.getInterval(item.noteName, this.activeKey);
            const label = (this._displayMode === 'interval') ? interval : item.noteName;

            this.renderScaleOverlayBadge(ctx, badgeX, baseY, label, item.noteType, interval);
        }
        ctx.restore();
    }

    renderScaleOverlayBadge(ctx, x, y, label, noteType, interval) {
        ctx.save();

        const intervalInfo = FretboardVisualizer.getIntervalInfo(interval);
        const isRoot = (interval === 'R' || interval === '1');

        if (noteType === 'target') {
            const radius = isRoot ? 12.0 : 10.5;
            const accentColor = intervalInfo ? intervalInfo.color : (isRoot ? '#ffd166' : '#00f3ff');
            const fillColor = intervalInfo ? intervalInfo.fillColor : 'rgba(10, 24, 38, 0.88)';
            const textColor = intervalInfo ? intervalInfo.textColor : '#ffffff';

            // Outer Bloom
            ctx.shadowColor = accentColor;
            ctx.shadowBlur = isRoot ? 12 : 8;

            // Background fill
            ctx.fillStyle = fillColor;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = accentColor;
            ctx.lineWidth = isRoot ? 2.4 : 1.8;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Label
            ctx.shadowBlur = 0;
            ctx.fillStyle = textColor;
            ctx.font = isRoot ? 'bold 10.5px "Inter", sans-serif' : 'bold 9.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label || '', x, y);

        } else if (noteType === 'passing') {
            const radius = 8.5;
            const accentColor = intervalInfo ? intervalInfo.color : '#10b981';

            ctx.shadowColor = accentColor;
            ctx.shadowBlur = 4;

            ctx.fillStyle = intervalInfo ? intervalInfo.fillColor : 'rgba(6, 32, 22, 0.85)';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = accentColor;
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.fillStyle = intervalInfo ? intervalInfo.textColor : '#6ee7b7';
            ctx.font = 'bold 8.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label || '', x, y);

        } else if (noteType === 'avoid') {
            const radius = 7.0;

            ctx.fillStyle = 'rgba(40, 10, 15, 0.80)';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.fillStyle = '#fca5a5';
            ctx.font = '7.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label || '', x, y);
        }

        ctx.restore();
    }

    /**
     * Efficient zero-allocation rounded rectangle path helper.
     */
    drawRoundedRect(ctx, x, y, width, height, radius) {
        if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(x, y, width, height, radius);
            return;
        }

        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + width - radius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        ctx.lineTo(x + width, y + height - radius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        ctx.lineTo(x + radius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
    }

    updatePhysics() {
        // 1. Dampen string vibration waves
        for (let s = 0; s < this.numStrings; s++) {
            const vib = this.stringVibrations[s];
            if (vib.amplitude > 0.01) {
                vib.amplitude *= vib.decay;
                vib.phase += 0.85;
            } else {
                vib.amplitude = 0;
            }
        }

        // 2. Animate pitch bend spring physics
        for (let s = 0; s < this.numStrings; s++) {
            const bend = this.stringBends[s];
            const diff = bend.targetCents - bend.cents;

            if (Math.abs(diff) > 0.1 || Math.abs(bend.springVelocity) > 0.05) {
                bend.springVelocity = (bend.springVelocity + diff * 0.22) * 0.72;
                bend.cents += bend.springVelocity;
            } else {
                bend.cents = bend.targetCents;
                bend.springVelocity = 0;
            }

            // Deflection scaling: half-step (100 cents) = 1 fret deflection, full step (200 cents) = 2 fret deflection
            const fretW = this.getFretWidth(bend.fret || 12);
            const fretDeflectionUnit = fretW > 0 ? fretW : (this.neckWidth / this.numFrets);
            bend.deflectionPixels = (bend.cents / 100) * fretDeflectionUnit * bend.direction;
        }
    }

    // -------------------------------------------------------------------------
    // STATIC MUSIC PEDAGOGY UTILITIES
    // -------------------------------------------------------------------------

    static get NOTE_NAMES() { return NOTE_NAMES; }
    static get ENHARMONICS() { return ENHARMONICS; }
    static get SEMITONE_TO_INTERVAL() { return SEMITONE_TO_INTERVAL; }
    static get INTERVAL_ALIASES() { return INTERVAL_ALIASES; }
    static get INTERVAL_DATA() { return INTERVAL_DATA; }
    static get CAGED_BASE_PATTERNS() { return CAGED_BASE_PATTERNS; }

    /**
     * Parses note string into clean pitch class 0 to 11.
     */
    static parseNote(noteStr) {
        if (typeof noteStr !== 'string') return 0;
        const clean = noteStr.replace(/\d+$/, '').trim();
        if (ENHARMONICS[clean]) {
            return NOTE_NAMES.indexOf(ENHARMONICS[clean]);
        }
        const idx = NOTE_NAMES.indexOf(clean);
        return idx !== -1 ? idx : 0;
    }

    /**
     * Calculates interval degree relative to active root key.
     */
    static calculateInterval(noteOrPitchClass, rootKey) {
        const noteIdx = (typeof noteOrPitchClass === 'number')
            ? ((noteOrPitchClass % 12 + 12) % 12)
            : FretboardVisualizer.parseNote(noteOrPitchClass);

        const rootIdx = (typeof rootKey === 'number')
            ? ((rootKey % 12 + 12) % 12)
            : FretboardVisualizer.parseNote(rootKey || 'C');

        const semitones = (noteIdx - rootIdx + 12) % 12;
        return SEMITONE_TO_INTERVAL[semitones];
    }

    static getInterval(noteName, rootKey) {
        return FretboardVisualizer.calculateInterval(noteName, rootKey);
    }

    static getIntervalInfo(interval) {
        if (!interval) return INTERVAL_DATA["R"];
        const normalized = INTERVAL_ALIASES[interval] || interval;
        return INTERVAL_DATA[normalized] || INTERVAL_DATA["R"];
    }

    static getIntervalColor(interval) {
        return FretboardVisualizer.getIntervalInfo(interval).color;
    }

    /**
     * Calculates the 5 interlocking CAGED position bounding boxes across frets 0-22.
     * @param {string|number} root - Selected root key ('C', 'A', etc.)
     * @param {number} numFrets - Number of frets (default 22)
     * @param {string} shapeFilter - 'all' or specific shape 'C', 'A', 'G', 'E', 'D'
     * @returns {Array<object>} Array of CAGED box definitions
     */
    static calculateCagedBoxes(root = 'C', numFrets = 22, shapeFilter = 'all') {
        const rootIdx = (typeof root === 'number')
            ? ((root % 12 + 12) % 12)
            : FretboardVisualizer.parseNote(root);

        const boxes = [];
        const filter = (typeof shapeFilter === 'string') ? shapeFilter.toUpperCase() : 'ALL';

        // Patterns are defined relative to C (0). Shift by rootIdx.
        for (let i = 0; i < CAGED_BASE_PATTERNS.length; i++) {
            const pattern = CAGED_BASE_PATTERNS[i];
            if (filter !== 'ALL' && pattern.shape !== filter) {
                continue;
            }

            // Test octave shifts -1, 0, 1, 2 to cover entire 22-fret span
            for (let oct = -1; oct <= 2; oct++) {
                const rawStart = pattern.baseStart + rootIdx + oct * 12;
                const rawEnd = pattern.baseEnd + rootIdx + oct * 12;

                // Check overlap with fretboard range [0, numFrets]
                if (rawEnd >= 0 && rawStart <= numFrets) {
                    const startFret = Math.max(0, rawStart);
                    const endFret = Math.min(numFrets, rawEnd);

                    if (startFret <= endFret) {
                        boxes.push({
                            shape: pattern.shape,
                            label: `${pattern.shape} Form`,
                            startFret: startFret,
                            endFret: endFret,
                            rawStart: rawStart,
                            rawEnd: rawEnd,
                            rootString: pattern.rootString,
                            color: pattern.color,
                            fillColor: pattern.color === '#f59e0b'
                                ? 'rgba(245, 158, 11, 0.12)'
                                : pattern.color === '#10b981'
                                ? 'rgba(16, 185, 129, 0.12)'
                                : pattern.color === '#06b6d4'
                                ? 'rgba(6, 182, 212, 0.12)'
                                : pattern.color === '#3b82f6'
                                ? 'rgba(59, 130, 246, 0.12)'
                                : 'rgba(139, 92, 246, 0.12)'
                        });
                    }
                }
            }
        }

        // Sort by startFret
        boxes.sort((a, b) => a.startFret - b.startFret || a.endFret - b.endFret);
        return boxes;
    }
}

if (typeof module !== 'undefined') {
    module.exports = FretboardVisualizer;
}
