/**
 * Fretboard Visualizer (HTML5 Canvas)
 * Renders a 22-fret horizontal guitar neck with physically proportional frets,
 * realistic string gauges (string 6 thickest to string 1 thinnest),
 * standard mother-of-pearl inlays, dynamic string vibration physics,
 * and glowing neon badges showing note names and finger numbers.
 */

class FretboardVisualizer {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            throw new Error(`Canvas with id "${canvasId}" not found.`);
        }
        this.ctx = this.canvas.getContext('2d');

        this.numFrets = options.numFrets || 22;
        this.numStrings = 6;
        
        // Active lit notes: Map of `${string}-${fret}` => { noteName, finger, timestamp, intensity, color }
        this.activeNotes = new Map();

        // Scale Overlay State (Target, Passing, and Avoid notes)
        this.scaleOverlayNotes = [];
        this.scaleOverlayVisible = true;
        this.scaleOverlayMode = 'noteName'; // 'noteName' or 'interval'
        this.scaleOverlayShowAvoid = false;

        // String vibration physics: array of { amplitude, frequency, phase, decay }
        this.stringVibrations = Array.from({ length: 6 }, () => ({
            amplitude: 0,
            frequency: 12,
            phase: 0,
            decay: 0.94
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

        this.initCanvasResolution();
        this.setupEvents();
        this.startRenderLoop();
    }

    /**
     * Supports Retina and high-DPI displays with sharp lines.
     */
    initCanvasResolution() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        
        // Use client width or fallback
        const width = rect.width || this.canvas.parentElement.clientWidth || 1000;
        const height = rect.height || 220;

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);

        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        this.cssWidth = width;
        this.cssHeight = height;

        // Compute fret x-coordinates using accurate 18-EDO logarithmic guitar spacing
        this.calculateFretPositions();
    }

    /**
     * Calculates logarithmic physical guitar fret positions.
     */
    calculateFretPositions() {
        this.fretPositions = [];
        this.fretWidths = [];

        // Neck dimensions
        this.neckMarginLeft = 46; // Room for nut and open string indicators
        this.neckMarginRight = 24;
        this.neckMarginY = 24;
        this.neckWidth = this.cssWidth - this.neckMarginLeft - this.neckMarginRight;
        this.neckHeight = this.cssHeight - this.neckMarginY * 2;

        // Logarithmic scale length: each fret is spaced according to scaleLength * (1 - 2^(-n/12))
        // We normalize so fret 22 lands exactly at neckWidth.
        const totalRatio = 1 - Math.pow(2, -this.numFrets / 12);

        // Fret 0 is at the nut
        this.fretPositions[0] = this.neckMarginLeft;

        for (let i = 1; i <= this.numFrets; i++) {
            const ratio = (1 - Math.pow(2, -i / 12)) / totalRatio;
            this.fretPositions[i] = this.neckMarginLeft + ratio * this.neckWidth;
            this.fretWidths[i] = this.fretPositions[i] - this.fretPositions[i - 1];
        }

        // String Y positions (1 to 6 from top to bottom)
        this.stringY = [];
        const stringSpacing = this.neckHeight / (this.numStrings - 1);
        for (let s = 0; s < this.numStrings; s++) {
            this.stringY[s] = this.neckMarginY + s * stringSpacing;
        }
    }

    setupEvents() {
        window.addEventListener('resize', () => {
            this.initCanvasResolution();
        });

        // Click / Touch to trigger (string, fret)
        const handlePointer = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const clickY = e.clientY - rect.top;

            const target = this.getFretAtCoordinates(clickX, clickY);
            if (target && this.onFretClick) {
                this.onFretClick(target.string, target.fret);
            }
        };

        this.canvas.addEventListener('mousedown', handlePointer);
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                handlePointer(e.touches[0]);
                e.preventDefault();
            }
        }, { passive: false });
    }

    /**
     * Maps mouse (x, y) coordinates to (string, fret).
     */
    getFretAtCoordinates(x, y) {
        // Find closest string
        let closestString = 1;
        let minDistY = Infinity;
        for (let s = 0; s < this.numStrings; s++) {
            const dist = Math.abs(y - this.stringY[s]);
            if (dist < minDistY) {
                minDistY = dist;
                closestString = s + 1;
            }
        }

        // Vertical boundary check
        if (minDistY > (this.neckHeight / (this.numStrings - 1))) {
            return null;
        }

        // Find fret
        // If left of nut or very close to fret 0 => open string (fret 0)
        if (x < this.fretPositions[0] + 8) {
            return { string: closestString, fret: 0 };
        }

        for (let f = 1; f <= this.numFrets; f++) {
            const fretX = this.fretPositions[f];
            const prevFretX = this.fretPositions[f - 1];
            if (x >= prevFretX && x <= fretX) {
                return { string: closestString, fret: f };
            }
        }

        return null;
    }

    /**
     * Activates a glowing neon badge at (string, fret).
     */
    lightUpNote(string, fret, noteName = '', finger = 0, color = null) {
        const key = `${string}-${fret}`;
        const neonColors = [this.colors.neonCyan, this.colors.neonAmber, this.colors.neonPink, this.colors.neonLime];
        const chosenColor = color || neonColors[(string - 1) % neonColors.length];

        this.activeNotes.set(key, {
            string: string,
            fret: fret,
            noteName: noteName,
            finger: finger,
            timestamp: performance.now(),
            intensity: 1.0,
            color: chosenColor
        });

        // Trigger string vibration
        const strIdx = string - 1;
        if (this.stringVibrations[strIdx]) {
            this.stringVibrations[strIdx].amplitude = 4.2;
            this.stringVibrations[strIdx].phase = 0;
        }
    }

    /**
     * Clears all currently highlighted notes.
     */
    clearActiveNotes() {
        this.activeNotes.clear();
    }

    /**
     * Sets live fretboard scale overlay notes and rendering options.
     * @param {Array<object>} notes - Array of {string, fret, noteType, noteName, interval}
     * @param {object} options - { visible, mode, showAvoid }
     */
    setScaleOverlay(notes, options = {}) {
        this.scaleOverlayNotes = notes || [];
        if (options.visible !== undefined) this.scaleOverlayVisible = options.visible;
        if (options.mode !== undefined) this.scaleOverlayMode = options.mode;
        if (options.showAvoid !== undefined) this.scaleOverlayShowAvoid = options.showAvoid;
    }

    /**
     * Clears active scale overlay.
     */
    clearScaleOverlay() {
        this.scaleOverlayNotes = [];
    }

    /**
     * Continuous 60fps render loop for smooth string vibration and badge glow animations.
     */
    startRenderLoop() {
        const render = () => {
            this.draw();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    draw() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);

        // 1. Draw Guitar Neck Wood Background
        this.drawNeckWood(ctx);

        // 2. Draw Inlay Fret Markers
        this.drawFretMarkers(ctx);

        // 3. Draw Frets & Nut
        this.drawFretsAndNut(ctx);

        // 4. Draw Strings with Vibration & Varying Gauges
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

        // Wood grain gradient (dark rosewood / ebony aesthetic)
        const neckGrad = ctx.createLinearGradient(x, y, x, y + h);
        neckGrad.addColorStop(0.0, '#1c1613');
        neckGrad.addColorStop(0.2, '#29211c');
        neckGrad.addColorStop(0.5, '#1e1815');
        neckGrad.addColorStop(0.8, '#261f1a');
        neckGrad.addColorStop(1.0, '#14100e');

        ctx.save();
        // Neck body
        ctx.fillStyle = neckGrad;
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

        for (const fret of this.markerFrets) {
            if (fret > this.numFrets) continue;

            const prevX = this.fretPositions[fret - 1];
            const currX = this.fretPositions[fret];
            const midX = (prevX + currX) / 2;

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
        // Pearloid gradient
        const dotGrad = ctx.createRadialGradient(x - radius * 0.3, y - radius * 0.3, radius * 0.1, x, y, radius);
        dotGrad.addColorStop(0.0, '#ffffff');
        dotGrad.addColorStop(0.4, '#e3e8ea');
        dotGrad.addColorStop(0.8, '#b8c2c5');
        dotGrad.addColorStop(1.0, '#758085');

        ctx.fillStyle = dotGrad;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // Inner pearloid luster ring
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
    }

    drawFretsAndNut(ctx) {
        ctx.save();

        // 1. Draw Nut at Fret 0
        const nutX = this.fretPositions[0];
        const nutY = this.neckMarginY - 2;
        const nutW = 7;
        const nutH = this.neckHeight + 4;

        // Bone/Brass nut gradient
        const nutGrad = ctx.createLinearGradient(nutX - nutW, nutY, nutX, nutY);
        nutGrad.addColorStop(0, '#d1c4b2');
        nutGrad.addColorStop(0.5, '#f5efe6');
        nutGrad.addColorStop(1, '#b0a390');

        ctx.fillStyle = nutGrad;
        ctx.fillRect(nutX - nutW, nutY, nutW, nutH);

        ctx.strokeStyle = '#4a3d31';
        ctx.lineWidth = 1;
        ctx.strokeRect(nutX - nutW, nutY, nutW, nutH);

        // 2. Draw Metallic Nickel-Silver Frets (1 to 22)
        for (let f = 1; f <= this.numFrets; f++) {
            const fx = this.fretPositions[f];
            const topY = this.neckMarginY;
            const bottomY = topY + this.neckHeight;

            // Fret shadow (gives 3D bevel depth)
            ctx.strokeStyle = this.colors.fretShadow;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.moveTo(fx + 1.2, topY);
            ctx.lineTo(fx + 1.2, bottomY);
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
            ctx.fillText(f.toString(), fx - this.fretWidths[f] / 2, bottomY + 16);
        }

        ctx.restore();
    }

    drawStrings(ctx) {
        ctx.save();
        const startX = this.neckMarginLeft - 6;
        const endX = this.neckMarginLeft + this.neckWidth;

        for (let s = 0; s < this.numStrings; s++) {
            const baseY = this.stringY[s];
            const gauge = this.stringGauges[s];
            const vib = this.stringVibrations[s];

            // Calculate animated wave deflection
            const waveOffset = vib.amplitude * Math.sin(vib.phase);

            // Shadow under string
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.65)';
            ctx.lineWidth = gauge + 1.0;
            ctx.beginPath();
            ctx.moveTo(startX, baseY + 1.5);
            ctx.lineTo(endX, baseY + 1.5);
            ctx.stroke();

            // String body (strings 4, 5, 6 are wound bronze/nickel, 1, 2, 3 are plain steel)
            if (s >= 3) {
                // Wound string gradient
                const strGrad = ctx.createLinearGradient(startX, baseY - gauge / 2, startX, baseY + gauge / 2);
                strGrad.addColorStop(0, '#8c7b70');
                strGrad.addColorStop(0.5, '#e4d5cb');
                strGrad.addColorStop(1, '#5c4e45');
                ctx.strokeStyle = strGrad;
            } else {
                // Plain steel string gradient
                const strGrad = ctx.createLinearGradient(startX, baseY - gauge / 2, startX, baseY + gauge / 2);
                strGrad.addColorStop(0, '#78909c');
                strGrad.addColorStop(0.4, '#ffffff');
                strGrad.addColorStop(1, '#546e7a');
                ctx.strokeStyle = strGrad;
            }

            ctx.lineWidth = gauge;
            ctx.beginPath();
            
            if (Math.abs(waveOffset) > 0.05) {
                // Draw vibrating curved string
                ctx.moveTo(startX, baseY);
                const midX = (startX + endX) / 2;
                ctx.quadraticCurveTo(midX, baseY + waveOffset, endX, baseY);
            } else {
                ctx.moveTo(startX, baseY);
                ctx.lineTo(endX, baseY);
            }
            ctx.stroke();
        }

        ctx.restore();
    }

    drawStringLabels(ctx) {
        ctx.save();
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 11px "Inter", "Segoe UI", sans-serif';

        for (let s = 0; s < this.numStrings; s++) {
            const y = this.stringY[s];
            const name = this.stringNames[s];

            // Open string tuning badge
            ctx.fillStyle = '#94a3b8';
            ctx.fillText(name, this.neckMarginLeft - 14, y);
        }

        // Nut "0" header
        ctx.textAlign = 'center';
        ctx.fillStyle = '#64748b';
        ctx.font = '10px monospace';
        ctx.fillText('NUT', this.neckMarginLeft - 22, this.neckMarginY - 8);

        ctx.restore();
    }

    drawActiveBadges(ctx) {
        const now = performance.now();

        for (const [key, note] of this.activeNotes.entries()) {
            const age = (now - note.timestamp) / 1000;
            // Decay intensity over 1.8 seconds
            if (age > 1.8) {
                this.activeNotes.delete(key);
                continue;
            }

            const alpha = Math.max(0, 1 - age / 1.8);
            const strIdx = note.string - 1;
            const baseY = this.stringY[strIdx];

            let badgeX;
            if (note.fret === 0) {
                // Open string: place badge just left of the nut
                badgeX = this.neckMarginLeft - 26;
            } else {
                // Center between frets
                const prevX = this.fretPositions[note.fret - 1];
                const currX = this.fretPositions[note.fret];
                badgeX = (prevX + currX) / 2;
            }

            this.renderNeonBadge(ctx, badgeX, baseY, note.noteName, note.finger, note.color, alpha);
        }
    }

    /**
     * Renders a glowing neon circular badge with high-intensity bloom,
     * note name label, and finger number indicator.
     */
    renderNeonBadge(ctx, x, y, noteName, finger, colorHex, alpha) {
        const radius = 13.5;

        ctx.save();
        ctx.globalAlpha = alpha;

        // 1. Intense Outer Bloom Glow
        ctx.shadowColor = colorHex;
        ctx.shadowBlur = 18;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;

        // 2. Translucent Circular Background
        ctx.fillStyle = 'rgba(10, 15, 24, 0.88)';
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();

        // 3. Glowing Neon Border
        ctx.strokeStyle = colorHex;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Reset shadow for crisp text
        ctx.shadowBlur = 0;

        // 4. Note Name Label in Center
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px "Inter", "Segoe UI", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(noteName || '', x, y - (finger > 0 ? 1 : 0));

        // 5. Finger Number Badge (small glowing pill at upper right)
        if (finger && finger > 0) {
            const fX = x + 10;
            const fY = y - 10;
            const fRadius = 6.5;

            ctx.fillStyle = colorHex;
            ctx.beginPath();
            ctx.arc(fX, fY, fRadius, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 8.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(finger.toString(), fX, fY);
        } else if (finger === 0 && noteName) {
            // Open string pill
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

    /**
     * Draws the full fretboard scale overlay (Target, Passing, and Avoid notes).
     */
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
            const baseY = this.stringY[strIdx];

            let badgeX;
            if (item.fret === 0) {
                badgeX = this.neckMarginLeft - 26;
            } else {
                const prevX = this.fretPositions[item.fret - 1];
                const currX = this.fretPositions[item.fret];
                badgeX = (prevX + currX) / 2;
            }

            const label = (this.scaleOverlayMode === 'interval') ? item.interval : item.noteName;
            this.renderScaleOverlayBadge(ctx, badgeX, baseY, label, item.noteType, item.interval);
        }
        ctx.restore();
    }

    /**
     * Renders an individual scale overlay badge with specialized visual styles for:
     * - "target": Chord Tones (Root, 3rd, 5th, 7th)
     * - "passing": Safe Extensions and Pentatonic steps
     * - "avoid": Clashing half-step intervals
     */
    renderScaleOverlayBadge(ctx, x, y, label, noteType, interval) {
        ctx.save();

        if (noteType === 'target') {
            const isRoot = (interval === 'R' || interval === '1');
            const radius = isRoot ? 12.0 : 10.5;

            // Outer Bloom / Glow
            ctx.shadowColor = isRoot ? '#ffd166' : '#00f3ff';
            ctx.shadowBlur = isRoot ? 12 : 8;

            // Background fill
            ctx.fillStyle = isRoot ? 'rgba(35, 28, 12, 0.90)' : 'rgba(10, 24, 38, 0.88)';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = isRoot ? '#ffd166' : '#00f3ff';
            ctx.lineWidth = isRoot ? 2.4 : 1.8;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            // Label
            ctx.shadowBlur = 0;
            ctx.fillStyle = isRoot ? '#fff275' : '#ffffff';
            ctx.font = isRoot ? 'bold 10.5px "Inter", sans-serif' : 'bold 9.5px "Inter", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label || '', x, y);

        } else if (noteType === 'passing') {
            const radius = 8.5;

            ctx.shadowColor = '#10b981';
            ctx.shadowBlur = 4;

            ctx.fillStyle = 'rgba(6, 32, 22, 0.85)';
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();

            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();

            ctx.shadowBlur = 0;
            ctx.fillStyle = '#6ee7b7';
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

    updatePhysics() {
        // Dampen string vibrations
        for (let s = 0; s < this.numStrings; s++) {
            const vib = this.stringVibrations[s];
            if (vib.amplitude > 0.01) {
                vib.amplitude *= vib.decay;
                vib.phase += 0.85;
            } else {
                vib.amplitude = 0;
            }
        }
    }
}

if (typeof module !== 'undefined') {
    module.exports = FretboardVisualizer;
}
