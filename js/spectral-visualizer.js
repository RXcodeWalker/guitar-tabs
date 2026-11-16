/**
 * Real-Time FFT Spectral Heat-Map & Harmonic Overtones Visualizer (60 FPS)
 * 
 * Features:
 * 1. Logarithmic/Musical Frequency Response Spectrum (60 Hz - 2500 Hz).
 * 2. Harmonic Overtone Peak Detection & Annotation (f0 fundamental, 2f0, 3f0, 4f0, 5f0).
 * 3. 2D Spectral Heat-Map (Waterfall Spectrogram) with high-contrast phosphor glow gradient.
 * 4. Automatic audio source bridging (Live Microphone + Synthesizer Audio Contexts).
 */

class SpectralHeatmapVisualizer {
    constructor(canvasId, options = {}) {
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.warn(`SpectralHeatmapVisualizer: Canvas #${canvasId} not found.`);
            return;
        }
        this.ctx = this.canvas.getContext('2d');

        this.dsp = options.dsp || null;
        this.synth = options.synth || null;

        // FFT settings
        this.fftSize = options.fftSize || 2048;
        this.frequencyBinCount = this.fftSize / 2;
        this.freqData = new Uint8Array(this.frequencyBinCount);
        this.synthFreqData = new Uint8Array(this.frequencyBinCount);

        // Waterfall / Spectrogram buffer
        this.waterfallHeight = 80;
        this.waterfallCanvas = document.createElement('canvas');
        this.waterfallCtx = this.waterfallCanvas.getContext('2d');

        // Guitar tuning reference markers
        this.referenceFrequencies = [
            { name: 'E2', freq: 82.41 },
            { name: 'A2', freq: 110.00 },
            { name: 'D3', freq: 146.83 },
            { name: 'G3', freq: 196.00 },
            { name: 'B3', freq: 246.94 },
            { name: 'E4', freq: 329.63 },
            { name: 'A4', freq: 440.00 },
            { name: 'E5', freq: 659.25 },
            { name: '1k', freq: 1000.0 },
            { name: '2k', freq: 2000.0 }
        ];

        // Harmonic state tracking
        this.fundamentalFreq = 0;
        this.harmonics = [];
        this.peakLevel = 0;

        // Color Palette
        this.colors = {
            bg: '#121214',
            panelBg: '#0e0e10',
            gridLine: 'rgba(255, 255, 255, 0.06)',
            gridText: '#64748b',
            curveStroke: '#00f3ff',
            curveGlow: 'rgba(0, 243, 255, 0.4)',
            fillGradientTop: 'rgba(0, 243, 255, 0.25)',
            fillGradientBottom: 'rgba(18, 18, 20, 0.0)',
            amberOvertone: '#ffb020',
            cyanFundamental: '#00f3ff',
            peakWhite: '#ffffff'
        };

        // Heatmap color lookup table (0-255)
        this.colorLUT = this.buildColorLUT();

        this.initCanvasResolution();
        this.setupResizeListener();
        this.startLoop();
    }

    /**
     * Builds precalculated 256-entry RGB heat-map color lookup table.
     */
    buildColorLUT() {
        const lut = [];
        for (let i = 0; i < 256; i++) {
            const t = i / 255;
            let r = 0, g = 0, b = 0;
            if (t < 0.2) {
                // Background dark to indigo
                const k = t / 0.2;
                r = Math.round(18 + k * 20);
                g = Math.round(18 + k * 10);
                b = Math.round(20 + k * 60);
            } else if (t < 0.5) {
                // Indigo to Electric Cyan
                const k = (t - 0.2) / 0.3;
                r = Math.round(38 * (1 - k));
                g = Math.round(28 + k * 215);
                b = Math.round(80 + k * 175);
            } else if (t < 0.8) {
                // Cyan to Golden Amber
                const k = (t - 0.5) / 0.3;
                r = Math.round(k * 255);
                g = Math.round(243 - k * 67);
                b = Math.round(255 * (1 - k * 0.87));
            } else {
                // Amber to Incandescent White
                const k = (t - 0.8) / 0.2;
                r = 255;
                g = Math.round(176 + k * 79);
                b = Math.round(32 + k * 223);
            }
            lut.push({ r, g, b });
        }
        return lut;
    }

    initCanvasResolution() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || this.canvas.parentElement.clientWidth || 900;
        const height = rect.height || 210;

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        this.logicalWidth = width;
        this.logicalHeight = height;

        // Size offscreen waterfall canvas
        this.waterfallCanvas.width = Math.round(width);
        this.waterfallCanvas.height = Math.round(height * 0.42);
        this.waterfallCtx.fillStyle = '#121214';
        this.waterfallCtx.fillRect(0, 0, this.waterfallCanvas.width, this.waterfallCanvas.height);
    }

    setupResizeListener() {
        window.addEventListener('resize', () => {
            this.initCanvasResolution();
        });
    }

    /**
     * Map frequency in Hz (60 Hz to 2400 Hz) to normalized X coordinate (0.0 to 1.0)
     * using logarithmic scale matching human auditory and musical perception.
     */
    freqToX(freq, width) {
        const minFreq = 65.0; // Low D#
        const maxFreq = 2400.0;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const logFreq = Math.log10(Math.max(minFreq, Math.min(maxFreq, freq)));
        const ratio = (logFreq - logMin) / (logMax - logMin);
        return ratio * width;
    }

    xToFreq(x, width) {
        const minFreq = 65.0;
        const maxFreq = 2400.0;
        const ratio = Math.max(0, Math.min(1, x / width));
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        return Math.pow(10, logMin + ratio * (logMax - logMin));
    }

    startLoop() {
        const render = () => {
            this.drawFrame();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    drawFrame() {
        if (!this.canvas || !this.ctx) return;

        const w = this.logicalWidth;
        const h = this.logicalHeight;
        if (!w || !h) return;

        // Extract frequency data from microphone DSP or Synth
        let activeAnalyser = null;
        let sampleRate = 44100;

        if (this.dsp && this.dsp.isRunning && this.dsp.analyser) {
            activeAnalyser = this.dsp.analyser;
            if (this.dsp.audioCtx) sampleRate = this.dsp.audioCtx.sampleRate;
        } else if (this.synth && this.synth.analyser) {
            activeAnalyser = this.synth.analyser;
            if (this.synth.audioCtx) sampleRate = this.synth.audioCtx.sampleRate;
        }

        if (activeAnalyser) {
            activeAnalyser.getByteFrequencyData(this.freqData);
        } else {
            // Decay data smoothly to zero
            for (let i = 0; i < this.freqData.length; i++) {
                this.freqData[i] = Math.floor(this.freqData[i] * 0.90);
            }
        }

        // Layout heights
        const spectrumHeight = h * 0.58;
        const waterfallY = spectrumHeight + 4;
        const waterfallH = h - waterfallY;

        // 1. Draw Background
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(0, 0, w, h);

        // 2. Draw Top Section: Frequency Spectrum & Harmonics
        this.drawSpectrumSection(w, spectrumHeight, sampleRate);

        // 3. Draw Bottom Section: Waterfall Spectrogram Heat-Map
        this.drawWaterfallSection(w, waterfallY, waterfallH, sampleRate);
    }

    drawSpectrumSection(w, h, sampleRate) {
        const ctx = this.ctx;

        // Subtle gradient background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#151518');
        bgGrad.addColorStop(1, '#0e0e10');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Frequency Grid Lines & Reference Guitar Labels
        ctx.strokeStyle = this.colors.gridLine;
        ctx.lineWidth = 1;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';

        for (const ref of this.referenceFrequencies) {
            const x = this.freqToX(ref.freq, w);
            if (x < 10 || x > w - 10) continue;

            // Vertical grid line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h - 18);
            ctx.stroke();

            // Label
            ctx.fillStyle = ref.name.includes('2') || ref.name.includes('3') || ref.name.includes('4') 
                ? 'rgba(0, 243, 255, 0.65)' 
                : this.colors.gridText;
            ctx.fillText(ref.name, x, h - 6);
        }

        // Horizontal dB guidelines (-12, -24, -36 dB)
        ctx.setLineDash([3, 5]);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
        for (const frac of [0.25, 0.50, 0.75]) {
            const y = h * frac;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Build smooth spectrum curve
        const nyquist = sampleRate / 2;
        const binHz = nyquist / this.frequencyBinCount;

        // Sample points across width
        const numPoints = Math.min(w, 280);
        const curvePoints = [];

        let maxVal = 0;
        let peakFreq = 0;

        for (let i = 0; i <= numPoints; i++) {
            const x = (i / numPoints) * w;
            const freq = this.xToFreq(x, w);
            const binFloat = freq / binHz;
            const bin0 = Math.floor(binFloat);
            const bin1 = Math.min(this.frequencyBinCount - 1, bin0 + 1);
            const frac = binFloat - bin0;

            const val0 = this.freqData[bin0] || 0;
            const val1 = this.freqData[bin1] || 0;
            const rawVal = val0 + (val1 - val0) * frac;

            if (rawVal > maxVal && freq >= 75 && freq <= 1500) {
                maxVal = rawVal;
                peakFreq = freq;
            }

            // Normalization
            const normY = (rawVal / 255.0);
            const y = (h - 22) - (normY * (h - 32));
            curvePoints.push({ x, y, val: rawVal });
        }

        this.peakLevel = maxVal / 255.0;

        // Fill under spectrum curve
        if (curvePoints.length > 0) {
            const fillGrad = ctx.createLinearGradient(0, 0, 0, h - 22);
            fillGrad.addColorStop(0, 'rgba(0, 243, 255, 0.28)');
            fillGrad.addColorStop(0.6, 'rgba(0, 243, 255, 0.08)');
            fillGrad.addColorStop(1, 'rgba(18, 18, 20, 0.0)');

            ctx.fillStyle = fillGrad;
            ctx.beginPath();
            ctx.moveTo(0, h - 22);
            for (const pt of curvePoints) {
                ctx.lineTo(pt.x, pt.y);
            }
            ctx.lineTo(w, h - 22);
            ctx.closePath();
            ctx.fill();

            // Glow Stroke
            ctx.shadowColor = this.colors.curveGlow;
            ctx.shadowBlur = 8;
            ctx.strokeStyle = this.colors.curveStroke;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
            for (let i = 1; i < curvePoints.length; i++) {
                ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Harmonic Peak Detection & Annotation
        if (maxVal > 35 && peakFreq > 75) {
            this.fundamentalFreq = peakFreq;
            this.drawHarmonicBadges(w, h, peakFreq);
        }

        // Top Header Overlay Badge
        this.drawHUDMetrics(w, h);
    }

    drawHarmonicBadges(w, h, f0) {
        const ctx = this.ctx;
        const harmonics = [
            { label: 'f0 (Fund)', freq: f0, color: this.colors.cyanFundamental, isFund: true },
            { label: '2f0 (2nd)', freq: f0 * 2, color: this.colors.amberOvertone, isFund: false },
            { label: '3f0 (3rd)', freq: f0 * 3, color: '#10b981', isFund: false },
            { label: '4f0 (4th)', freq: f0 * 4, color: '#ec4899', isFund: false }
        ];

        for (const hItem of harmonics) {
            if (hItem.freq > 2350) continue;
            const x = this.freqToX(hItem.freq, w);
            if (x < 15 || x > w - 15) continue;

            // Vertical indicator needle
            ctx.strokeStyle = hItem.color;
            ctx.lineWidth = hItem.isFund ? 1.5 : 1.0;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x, 26);
            ctx.lineTo(x, h - 24);
            ctx.stroke();
            ctx.setLineDash([]);

            // Harmonic Badge
            ctx.fillStyle = 'rgba(18, 18, 20, 0.9)';
            const tagW = hItem.isFund ? 68 : 56;
            ctx.fillRect(x - tagW / 2, 8, tagW, 16);
            ctx.strokeStyle = hItem.color;
            ctx.strokeRect(x - tagW / 2, 8, tagW, 16);

            ctx.fillStyle = hItem.color;
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(hItem.label, x, 20);
        }
    }

    drawHUDMetrics(w, h) {
        const ctx = this.ctx;
        ctx.textAlign = 'left';
        ctx.font = '700 10px "JetBrains Mono", monospace';

        // Spectral Status HUD (top left)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.fillText('SPECTRUM 60Hz - 2.4kHz', 12, 18);

        // Peak Metric HUD (top right)
        ctx.textAlign = 'right';
        if (this.fundamentalFreq > 0 && this.peakLevel > 0.12) {
            ctx.fillStyle = '#00f3ff';
            ctx.fillText(`FUNDAMENTAL: ${this.fundamentalFreq.toFixed(1)} Hz`, w - 14, 18);
        } else {
            ctx.fillStyle = '#64748b';
            ctx.fillText('STANDBY • AWAITING INPUT', w - 14, 18);
        }
    }

    drawWaterfallSection(w, yOffset, h, sampleRate) {
        const ctx = this.ctx;
        const wfW = this.waterfallCanvas.width;
        const wfH = this.waterfallCanvas.height;

        if (wfW === 0 || wfH === 0) return;

        // 1. Scroll previous frame down by 1 pixel in offscreen canvas
        this.waterfallCtx.drawImage(
            this.waterfallCanvas,
            0, 0, wfW, wfH - 1,
            0, 1, wfW, wfH - 1
        );

        // 2. Generate current top 1-pixel scanline from frequency bins
        const imgData = this.waterfallCtx.createImageData(wfW, 1);
        const data = imgData.data;

        const nyquist = sampleRate / 2;
        const binHz = nyquist / this.frequencyBinCount;

        for (let x = 0; x < wfW; x++) {
            const freq = this.xToFreq(x, wfW);
            const binIdx = Math.min(this.frequencyBinCount - 1, Math.floor(freq / binHz));
            const val = this.freqData[binIdx] || 0;
            const rgb = this.colorLUT[val] || this.colorLUT[0];

            const idx = x * 4;
            data[idx] = rgb.r;
            data[idx + 1] = rgb.g;
            data[idx + 2] = rgb.b;
            data[idx + 3] = 255;
        }

        this.waterfallCtx.putImageData(imgData, 0, 0);

        // 3. Blit offscreen waterfall to destination canvas
        ctx.drawImage(this.waterfallCanvas, 0, yOffset, w, h);

        // 4. Subtle glass separator line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yOffset);
        ctx.lineTo(w, yOffset);
        ctx.stroke();

        // Label for heat-map
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.textAlign = 'left';
        ctx.fillText('HEAT-MAP WATERFALL [TIME ▼]', 12, yOffset + 12);
    }
}

if (typeof module !== 'undefined') {
    module.exports = SpectralHeatmapVisualizer;
}
