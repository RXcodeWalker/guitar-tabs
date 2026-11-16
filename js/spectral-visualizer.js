/**
 * Real-Time FFT Spectral Heat-Map & Harmonic Distortion Diagnostic Visualizer (60 FPS)
 * 
 * Features:
 * 1. Logarithmic/Musical Frequency Response Spectrum (65 Hz - 2400 Hz).
 * 2. Harmonic Overtone & Saturation Analyzer:
 *    - Dominant fundamental peak f0 detection with sub-bin parabolic interpolation.
 *    - Energy sampling at integer multiples (2f0, 3f0, 4f0, 5f0).
 *    - Even-to-Odd Harmonic Ratio computation: asymmetric tube warmth vs symmetric transistor clipping.
 *    - Total Harmonic Distortion (THD) estimation and Peak Overtone Order identification.
 * 3. Rolling Waterfall Spectrogram:
 *    - Off-screen canvas ring buffer maintaining exactly 128 spectral slices over time.
 *    - Analog phosphor / heat palette (Dark Blue -> Magenta -> Amber -> Neon White).
 *    - Continuous vertical scrolling with hardware-accelerated bilinear interpolation.
 * 4. Diagnostic HUD with interactive on-canvas toggle button ([ HUD: ON / OFF ]).
 * 5. Zero-allocation 60 FPS rendering loop with pre-allocated TypedArrays and LUTs.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

class SpectralHeatmapVisualizer {
    constructor(canvasId, options = {}) {
        this.options = options;
        this.dsp = options.dsp || null;
        this.synth = options.synth || null;

        // FFT Settings
        this.fftSize = options.fftSize || 2048;
        this.frequencyBinCount = this.fftSize / 2;
        this.freqData = new Uint8Array(this.frequencyBinCount);
        this.synthFreqData = new Uint8Array(this.frequencyBinCount);

        // Waterfall Ring Buffer Settings (128 slices)
        this.waterfallSlices = options.waterfallSlices || 128;
        this.waterfallOrientation = options.waterfallOrientation || 'vertical';
        this.ringHead = 0;
        this.waterfallWidth = 512;

        // Pre-allocated typed arrays for spectrum curve (Zero-Allocation Loop)
        this.maxCurvePoints = 512;
        this.curveX = new Float32Array(this.maxCurvePoints);
        this.curveY = new Float32Array(this.maxCurvePoints);
        this.curveVal = new Float32Array(this.maxCurvePoints);

        // Pre-allocated arrays for 5 harmonics (f0, 2f0, 3f0, 4f0, 5f0)
        this.harmonicCount = 5;
        this.harmonicFreqs = new Float32Array(5);
        this.harmonicAmps = new Float32Array(5);
        this.harmonicPows = new Float32Array(5);
        this.harmonicDb = new Float32Array(5);
        this.harmonicRawVals = new Float32Array(5);
        this.harmonicX = new Float32Array(5);
        this.harmonicActive = new Uint8Array(5);

        // Pre-configured harmonic meta
        this.harmonicConfigs = [
            { order: 1, label: 'f₀ (Fund)', type: 'fund', color: '#00f3ff' },
            { order: 2, label: '2f₀ (2nd)', type: 'even', color: '#ffb020' },
            { order: 3, label: '3f₀ (3rd)', type: 'odd',  color: '#ec4899' },
            { order: 4, label: '4f₀ (4th)', type: 'even', color: '#facc15' },
            { order: 5, label: '5f₀ (5th)', type: 'odd',  color: '#a855f7' }
        ];

        // State tracking
        this.fundamentalFreq = 0;
        this.fundamentalActive = false;
        this.fundamentalDb = -100;
        this.fundamentalNoteName = '--';
        this.peakLevel = 0;

        // Harmonic distortion metrics
        this.evenEnergy = 0;
        this.oddEnergy = 0;
        this.evenOddRatioSmoothed = 1.0;
        this.evenOddRatioDb = 0.0;
        this.thdSmoothed = 0.0;
        this.thdDb = -100.0;
        this.peakOvertoneOrder = 2;
        this.peakOvertoneAmp = 0;

        // Diagnostic HUD display toggle
        this.showHUD = options.showHUD !== undefined ? !!options.showHUD : true;
        this.hudToggleBounds = { x: 0, y: 0, w: 92, h: 22 };
        this.isToggleHovered = false;

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

        // Color Palette
        this.colors = {
            bg: '#121214',
            panelBg: '#0e0e10',
            gridLine: 'rgba(255, 255, 255, 0.06)',
            gridText: '#64748b',
            curveStroke: '#00f3ff',
            curveGlow: 'rgba(0, 243, 255, 0.4)',
            fillGradientTop: 'rgba(0, 243, 255, 0.28)',
            fillGradientBottom: 'rgba(18, 18, 22, 0.0)',
            amberOvertone: '#ffb020',
            cyanFundamental: '#00f3ff',
            peakWhite: '#ffffff'
        };

        // Precalculated Analog Phosphor / Heat Palette Lookup Table (256 entries)
        this.colorLUT = new Array(256);
        this.colorLUT32 = new Uint32Array(256);
        this.buildAnalogPhosphorLUT();

        // Browser canvas initialization
        if (typeof document !== 'undefined') {
            this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
            if (!this.canvas) {
                console.warn(`SpectralHeatmapVisualizer: Canvas ${canvasId} not found.`);
                return;
            }
            this.ctx = this.canvas.getContext('2d');

            // Offscreen Waterfall Ring Buffer Canvas (fixed 128 slices tall)
            this.waterfallCanvas = document.createElement('canvas');
            this.waterfallCtx = this.waterfallCanvas.getContext('2d', { willReadFrequently: false });

            this.initCanvasResolution();
            this.setupListeners();
            this.startLoop();
        } else {
            // Headless / Node testing environment
            this.canvas = null;
            this.ctx = null;
            this.waterfallCanvas = null;
            this.waterfallCtx = null;
            this.initHeadlessBuffers();
        }
    }

    /**
     * Builds precalculated 256-entry Analog Phosphor / Heat Palette:
     * Dark Blue -> Magenta -> Amber -> Neon White.
     */
    buildAnalogPhosphorLUT() {
        // Endianness detection for 32-bit pixel buffer
        const testBuf = new ArrayBuffer(4);
        const testU8 = new Uint8ClampedArray(testBuf);
        const testU32 = new Uint32Array(testBuf);
        testU8[0] = 1;
        testU8[1] = 2;
        testU8[2] = 3;
        testU8[3] = 4;
        const isLittleEndian = testU32[0] === 0x04030201;

        for (let i = 0; i < 256; i++) {
            const t = i / 255.0;
            let r = 0, g = 0, b = 0;

            if (t <= 0.30) {
                // 1. Dark Blue (8, 12, 40) -> Vibrant Magenta (205, 25, 145)
                const k = t / 0.30;
                r = Math.round(8 + k * 197);
                g = Math.round(12 + k * 13);
                b = Math.round(40 + k * 105);
            } else if (t <= 0.65) {
                // 2. Vibrant Magenta (205, 25, 145) -> Solar Amber (255, 165, 0)
                const k = (t - 0.30) / 0.35;
                r = Math.round(205 + k * 50);
                g = Math.round(25 + k * 140);
                b = Math.round(145 * (1 - k));
            } else {
                // 3. Solar Amber (255, 165, 0) -> Incandescent Neon White (255, 255, 255)
                const k = (t - 0.65) / 0.35;
                r = 255;
                g = Math.round(165 + k * 90);
                b = Math.round(k * 255);
            }

            this.colorLUT[i] = { r, g, b, hex: `rgb(${r},${g},${b})` };

            if (isLittleEndian) {
                this.colorLUT32[i] = (255 << 24) | (b << 16) | (g << 8) | r;
            } else {
                this.colorLUT32[i] = (r << 24) | (g << 16) | (b << 8) | 255;
            }
        }
    }

    initHeadlessBuffers() {
        this.waterfallWidth = 512;
        this.sliceData32 = new Uint32Array(this.waterfallWidth);
        this.sliceImageData = { data: new Uint8ClampedArray(this.waterfallWidth * 4) };
    }

    initCanvasResolution() {
        if (!this.canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        const width = rect.width || this.canvas.parentElement?.clientWidth || 900;
        const height = rect.height || 210;

        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.ctx.resetTransform();
        this.ctx.scale(dpr, dpr);

        this.logicalWidth = width;
        this.logicalHeight = height;

        // Size offscreen waterfall ring buffer (width x 128 slices)
        this.waterfallWidth = Math.max(256, Math.round(width));
        this.waterfallCanvas.width = this.waterfallWidth;
        this.waterfallCanvas.height = this.waterfallSlices;

        // Pre-allocate 1-slice ImageData and 32-bit pixel view
        this.sliceImageData = this.waterfallCtx.createImageData(this.waterfallWidth, 1);
        this.sliceData32 = new Uint32Array(this.sliceImageData.data.buffer);

        // Pre-fill ring buffer with background quiet color
        this.waterfallCtx.fillStyle = '#080c28';
        this.waterfallCtx.fillRect(0, 0, this.waterfallWidth, this.waterfallSlices);
    }

    setupListeners() {
        window.addEventListener('resize', () => {
            this.initCanvasResolution();
        });

        // Interactive HUD Toggle: Click / Touch
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('pointermove', (e) => this.handleCanvasPointerMove(e));

        // Hotkey: 'H' or 'D' toggles Diagnostic HUD
        window.addEventListener('keydown', (e) => {
            const tag = document.activeElement ? document.activeElement.tagName : '';
            if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
                if (e.key === 'h' || e.key === 'H' || e.key === 'd' || e.key === 'D') {
                    this.toggleHUD();
                }
            }
        });
    }

    handleCanvasClick(e) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const b = this.hudToggleBounds;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            this.toggleHUD();
        }
    }

    handleCanvasPointerMove(e) {
        if (!this.canvas) return;
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const b = this.hudToggleBounds;
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
            this.canvas.style.cursor = 'pointer';
            this.isToggleHovered = true;
        } else if (this.isToggleHovered) {
            this.canvas.style.cursor = 'default';
            this.isToggleHovered = false;
        }
    }

    /**
     * Toggles the Diagnostic HUD overlay and badges on/off.
     */
    toggleHUD(forceState) {
        this.showHUD = typeof forceState === 'boolean' ? forceState : !this.showHUD;
        return this.showHUD;
    }

    setHUDVisible(visible) {
        this.showHUD = !!visible;
        return this.showHUD;
    }

    isHUDVisible() {
        return this.showHUD;
    }

    /**
     * Map frequency in Hz (65 Hz to 2400 Hz) to normalized X coordinate (0.0 to width).
     */
    freqToX(freq, width) {
        const minFreq = 65.0; // Low D# / E2 region
        const maxFreq = 2400.0;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const logFreq = Math.log10(Math.max(minFreq, Math.min(maxFreq, freq)));
        return ((logFreq - logMin) / (logMax - logMin)) * width;
    }

    xToFreq(x, width) {
        const minFreq = 65.0;
        const maxFreq = 2400.0;
        const ratio = Math.max(0, Math.min(1, x / width));
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        return Math.pow(10, logMin + ratio * (logMax - logMin));
    }

    freqToNoteName(freq) {
        if (freq <= 30) return '--';
        const midi = Math.round(69 + 12 * Math.log2(freq / 440.0));
        if (midi < 12 || midi > 127) return '--';
        const name = NOTE_NAMES[midi % 12];
        const oct = Math.floor(midi / 12) - 1;
        return `${name}${oct}`;
    }

    startLoop() {
        const render = () => {
            this.drawFrame();
            requestAnimationFrame(render);
        };
        requestAnimationFrame(render);
    }

    /**
     * Harmonic Overtone & Saturation Analyzer:
     * 1. Detects dominant fundamental f0 with sub-bin parabolic interpolation.
     * 2. Samples energy at integer multiples (2f0, 3f0, 4f0, 5f0).
     * 3. Computes Even-to-Odd Harmonic Ratio (Asymmetric Tube Warmth vs Symmetric Transistor Clipping).
     * 4. Computes Total Harmonic Distortion (THD) and identifies Peak Overtone Order.
     * ZERO MEMORY ALLOCATION inside this hot calculation.
     */
    analyzeHarmonics(sampleRate) {
        const sr = sampleRate || 44100;
        const nyquist = sr / 2;
        const binHz = nyquist / this.frequencyBinCount;

        // Search dominant fundamental peak in typical guitar range (70 Hz - 1200 Hz)
        const minBin = Math.max(1, Math.floor(70 / binHz));
        const maxBin = Math.min(this.frequencyBinCount - 2, Math.floor(1200 / binHz));

        let maxVal = 0;
        let peakBin = 0;

        for (let b = minBin; b <= maxBin; b++) {
            const v = this.freqData[b];
            if (v > maxVal && v > this.freqData[b - 1] && v >= this.freqData[b + 1]) {
                maxVal = v;
                peakBin = b;
            }
        }

        this.peakLevel = maxVal / 255.0;

        if (maxVal < 25 || peakBin === 0) {
            this.fundamentalActive = false;
            // Decay harmonic levels smoothly
            for (let i = 0; i < 5; i++) {
                this.harmonicAmps[i] *= 0.85;
                this.harmonicPows[i] *= 0.72;
                this.harmonicActive[i] = 0;
            }
            this.evenEnergy *= 0.85;
            this.oddEnergy *= 0.85;
            this.thdSmoothed *= 0.90;
            return;
        }

        // Sub-bin parabolic refinement for fundamental f0
        const a = this.freqData[peakBin - 1];
        const b = this.freqData[peakBin];
        const c = this.freqData[peakBin + 1];
        const denom = a - 2 * b + c;
        const delta = denom !== 0 ? 0.5 * (a - c) / denom : 0;
        let refinedBin = peakBin + delta;
        let detectedF0 = refinedBin * binHz;

        // Subharmonic test: check if true f0 is 1 octave lower (prominent in guitar bridge pickup)
        const halfBin = Math.round(refinedBin / 2);
        if (halfBin >= minBin) {
            const halfVal = this.freqData[halfBin];
            if (halfVal > 35 && halfVal > maxVal * 0.35) {
                const ha = this.freqData[halfBin - 1];
                const hb = this.freqData[halfBin];
                const hc = this.freqData[halfBin + 1];
                const hDenom = ha - 2 * hb + hc;
                const hDelta = hDenom !== 0 ? 0.5 * (ha - hc) / hDenom : 0;
                detectedF0 = (halfBin + hDelta) * binHz;
            }
        }

        this.fundamentalFreq = detectedF0;
        this.fundamentalActive = true;
        this.fundamentalNoteName = this.freqToNoteName(detectedF0);

        // Sample energy at integer multiples: f0, 2f0, 3f0, 4f0, 5f0
        for (let order = 1; order <= 5; order++) {
            const targetFreq = detectedF0 * order;
            const targetBin = Math.round(targetFreq / binHz);
            const idx = order - 1;

            if (targetFreq > nyquist || targetBin >= this.frequencyBinCount - 2 || targetBin < 1) {
                this.harmonicActive[idx] = 0;
                this.harmonicAmps[idx] = 0;
                this.harmonicPows[idx] = 0;
                this.harmonicDb[idx] = -100;
                this.harmonicRawVals[idx] = 0;
                this.harmonicFreqs[idx] = targetFreq;
                continue;
            }

            // Window search (+/- 2 bins) to account for string inharmonicity / dispersion
            const wStart = Math.max(1, targetBin - 2);
            const wEnd = Math.min(this.frequencyBinCount - 2, targetBin + 2);
            let hMax = 0;
            let hPeakBin = targetBin;

            for (let k = wStart; k <= wEnd; k++) {
                if (this.freqData[k] > hMax) {
                    hMax = this.freqData[k];
                    hPeakBin = k;
                }
            }

            // Parabolic interpolation around local harmonic peak
            const ha = this.freqData[hPeakBin - 1];
            const hb = this.freqData[hPeakBin];
            const hc = this.freqData[hPeakBin + 1];
            const hDen = ha - 2 * hb + hc;
            const hDel = hDen !== 0 ? 0.5 * (ha - hc) / hDen : 0;
            const hFreq = (hPeakBin + hDel) * binHz;
            const hVal = Math.max(0, Math.min(255, hb - 0.125 * (ha - hc) * hDel));

            // dB scale mapping: 0 -> -100 dB, 255 -> -30 dB
            const db = -100.0 + (hVal / 255.0) * 70.0;
            const linAmp = Math.pow(10, db / 20.0);
            const linPow = linAmp * linAmp;

            this.harmonicActive[idx] = 1;
            this.harmonicFreqs[idx] = hFreq;
            this.harmonicAmps[idx] = linAmp;
            this.harmonicPows[idx] = linPow;
            this.harmonicDb[idx] = db;
            this.harmonicRawVals[idx] = hVal;
        }

        this.fundamentalDb = this.harmonicDb[0];

        // Even Harmonics: 2f0 (idx 1), 4f0 (idx 3)
        const e2 = this.harmonicActive[1] ? this.harmonicPows[1] : 0;
        const e4 = this.harmonicActive[3] ? this.harmonicPows[3] : 0;
        this.evenEnergy = e2 + e4;

        // Odd Harmonics: 3f0 (idx 2), 5f0 (idx 4)
        const o3 = this.harmonicActive[2] ? this.harmonicPows[2] : 0;
        const o5 = this.harmonicActive[4] ? this.harmonicPows[4] : 0;
        this.oddEnergy = o3 + o5;

        // Compute Even-to-Odd Harmonic Ratio
        const eps = 1e-12;
        let instantRatio = 1.0;
        if (this.oddEnergy > eps && this.evenEnergy > eps) {
            instantRatio = Math.sqrt(this.evenEnergy) / Math.sqrt(this.oddEnergy);
        } else if (this.evenEnergy > eps) {
            instantRatio = 8.0;
        } else if (this.oddEnergy > eps) {
            instantRatio = 0.125;
        }

        // Exponential smoothing for stable HUD readout
        this.evenOddRatioSmoothed = this.evenOddRatioSmoothed * 0.85 + instantRatio * 0.15;
        this.evenOddRatioDb = 20.0 * Math.log10(Math.max(1e-4, this.evenOddRatioSmoothed));

        // Total Harmonic Distortion (THD) = sqrt(sum of overtone powers) / fundamental amplitude
        const overtonePower = e2 + o3 + e4 + o5;
        const fundAmp = this.harmonicActive[0] ? this.harmonicAmps[0] : eps;
        let instantThd = 0.0;
        if (fundAmp > eps) {
            instantThd = (Math.sqrt(overtonePower) / fundAmp) * 100.0;
        }
        this.thdSmoothed = this.thdSmoothed * 0.85 + instantThd * 0.15;
        this.thdDb = 20.0 * Math.log10(Math.max(1e-4, this.thdSmoothed / 100.0));

        // Detect Peak Overtone Order among 2f0, 3f0, 4f0, 5f0
        let maxOvertoneAmp = 0;
        let peakOrder = 2;
        for (let ord = 2; ord <= 5; ord++) {
            const idx = ord - 1;
            if (this.harmonicActive[idx] && this.harmonicAmps[idx] > maxOvertoneAmp) {
                maxOvertoneAmp = this.harmonicAmps[idx];
                peakOrder = ord;
            }
        }
        this.peakOvertoneOrder = peakOrder;
        this.peakOvertoneAmp = maxOvertoneAmp;
    }

    /**
     * Classifies distortion character based on Even-vs-Odd Harmonic Ratio.
     */
    getHarmonicCharacter() {
        if (!this.fundamentalActive || this.peakLevel < 0.10) {
            return 'STANDBY';
        }
        const r = this.evenOddRatioSmoothed;
        if (r > 1.25) {
            return 'TUBE WARMTH (Asymmetric • Even Dominant)';
        } else if (r < 0.80) {
            return 'TRANSISTOR CLIP (Symmetric • Odd Dominant)';
        } else {
            return 'BALANCED (Linear Harmonic Profile)';
        }
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
            for (let i = 0; i < this.frequencyBinCount; i++) {
                this.freqData[i] = Math.floor(this.freqData[i] * 0.90);
            }
        }

        // Run Harmonic Overtone & Saturation Analyzer
        this.analyzeHarmonics(sampleRate);

        // Layout heights
        const spectrumHeight = h * 0.58;
        const waterfallY = spectrumHeight + 4;
        const waterfallH = h - waterfallY;

        // 1. Draw Background
        this.ctx.fillStyle = this.colors.bg;
        this.ctx.fillRect(0, 0, w, h);

        // 2. Draw Top Section: Logarithmic Spectrum Curve & Reference Grid
        this.drawSpectrumSection(w, spectrumHeight, sampleRate);

        // 3. Draw Bottom Section: Rolling Waterfall Spectrogram (128 slices)
        this.drawWaterfallSection(w, waterfallY, waterfallH, sampleRate);

        // 4. Draw Interactive HUD Toggle Button
        this.drawHUDToggleButton(this.ctx, w);
    }

    drawSpectrumSection(w, h, sampleRate) {
        const ctx = this.ctx;

        // Gradient background
        const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
        bgGrad.addColorStop(0, '#15151a');
        bgGrad.addColorStop(1, '#0e0e12');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, w, h);

        // Reference Guitar Frequencies & Grid
        ctx.strokeStyle = this.colors.gridLine;
        ctx.lineWidth = 1;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';

        for (let i = 0; i < this.referenceFrequencies.length; i++) {
            const ref = this.referenceFrequencies[i];
            const x = this.freqToX(ref.freq, w);
            if (x < 10 || x > w - 10) continue;

            // Vertical grid line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h - 18);
            ctx.stroke();

            // Frequency label
            const isGuitarString = ref.name.includes('2') || ref.name.includes('3') || ref.name.includes('4');
            ctx.fillStyle = isGuitarString ? 'rgba(0, 243, 255, 0.65)' : this.colors.gridText;
            ctx.fillText(ref.name, x, h - 6);
        }

        // Horizontal dB Guidelines (-12 dB, -24 dB, -36 dB)
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

        // Interpolate smooth curve points into pre-allocated typed arrays (Zero-Allocation)
        const nyquist = sampleRate / 2;
        const binHz = nyquist / this.frequencyBinCount;
        const numPoints = Math.min(w, this.maxCurvePoints - 1);

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

            const normY = rawVal / 255.0;
            const y = (h - 22) - (normY * (h - 32));

            this.curveX[i] = x;
            this.curveY[i] = y;
            this.curveVal[i] = rawVal;
        }

        // Draw Fill under spectrum curve
        const fillGrad = ctx.createLinearGradient(0, 0, 0, h - 22);
        fillGrad.addColorStop(0, 'rgba(0, 243, 255, 0.28)');
        fillGrad.addColorStop(0.6, 'rgba(0, 243, 255, 0.07)');
        fillGrad.addColorStop(1, 'rgba(18, 18, 22, 0.0)');

        ctx.fillStyle = fillGrad;
        ctx.beginPath();
        ctx.moveTo(0, h - 22);
        for (let i = 0; i <= numPoints; i++) {
            ctx.lineTo(this.curveX[i], this.curveY[i]);
        }
        ctx.lineTo(w, h - 22);
        ctx.closePath();
        ctx.fill();

        // Glowing Stroke
        ctx.shadowColor = this.colors.curveGlow;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = this.colors.curveStroke;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(this.curveX[0], this.curveY[0]);
        for (let i = 1; i <= numPoints; i++) {
            ctx.lineTo(this.curveX[i], this.curveY[i]);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw Harmonic Badges & Needles (when HUD is active)
        if (this.showHUD && this.fundamentalActive && this.fundamentalFreq > 70) {
            this.drawHarmonicBadges(w, h);
        }

        // Draw Diagnostic HUD Metrics Panel
        if (this.showHUD) {
            this.drawHUDMetrics(w, h);
        } else {
            this.drawMinimalHeader(w);
        }
    }

    drawHarmonicBadges(w, h) {
        const ctx = this.ctx;

        for (let idx = 0; idx < 5; idx++) {
            if (!this.harmonicActive[idx]) continue;
            const freq = this.harmonicFreqs[idx];
            if (freq > 2350) continue;

            const x = this.freqToX(freq, w);
            this.harmonicX[idx] = x;
            if (x < 15 || x > w - 15) continue;

            const cfg = this.harmonicConfigs[idx];

            // Vertical indicator needle line
            ctx.strokeStyle = cfg.color;
            ctx.lineWidth = cfg.order === 1 ? 1.6 : 1.0;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(x, 30);
            ctx.lineTo(x, h - 24);
            ctx.stroke();
            ctx.setLineDash([]);

            // Overtone Badge
            const tagW = cfg.order === 1 ? 64 : 52;
            const tagX = x - tagW / 2;
            const tagY = 8 + (idx % 2) * 12; // Stagger slightly to avoid overlap

            ctx.fillStyle = 'rgba(14, 16, 22, 0.92)';
            ctx.fillRect(tagX, tagY, tagW, 14);
            ctx.strokeStyle = cfg.color;
            ctx.strokeRect(tagX, tagY, tagW, 14);

            ctx.fillStyle = cfg.color;
            ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(cfg.label, x, tagY + 10);
        }
    }

    drawHUDMetrics(w, h) {
        const ctx = this.ctx;

        // Glassmorphism HUD diagnostic card
        const hudW = Math.min(w - 130, 420);
        const hudH = 50;
        const hudX = 12;
        const hudY = 8;

        ctx.fillStyle = 'rgba(10, 12, 18, 0.88)';
        ctx.fillRect(hudX, hudY, hudW, hudH);
        ctx.strokeStyle = 'rgba(0, 243, 255, 0.22)';
        ctx.lineWidth = 1;
        ctx.strokeRect(hudX, hudY, hudW, hudH);

        // Header Line: Fundamental + Note Name
        ctx.textAlign = 'left';
        ctx.font = '700 10px "JetBrains Mono", monospace';

        if (this.fundamentalActive && this.peakLevel > 0.10) {
            ctx.fillStyle = '#00f3ff';
            ctx.fillText(`f₀: ${this.fundamentalFreq.toFixed(1)} Hz [${this.fundamentalNoteName}]`, hudX + 8, hudY + 14);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fillText(`(${this.fundamentalDb.toFixed(1)} dB)`, hudX + 130, hudY + 14);

            // THD readout
            ctx.fillStyle = '#facc15';
            ctx.fillText(`THD: ${this.thdSmoothed.toFixed(1)}%`, hudX + 185, hudY + 14);

            // Peak Overtone Order
            ctx.fillStyle = this.peakOvertoneOrder % 2 === 0 ? '#ffb020' : '#ec4899';
            ctx.fillText(`Peak: ${this.peakOvertoneOrder}f₀ (${this.peakOvertoneOrder % 2 === 0 ? 'Even' : 'Odd'})`, hudX + 265, hudY + 14);

            // Line 2: Even vs Odd Harmonic Ratio & Character Diagnostic
            const ratioStr = `Even/Odd: ${this.evenOddRatioSmoothed.toFixed(2)}:1 (${this.evenOddRatioDb >= 0 ? '+' : ''}${this.evenOddRatioDb.toFixed(1)} dB)`;
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '600 9px "JetBrains Mono", monospace';
            ctx.fillText(ratioStr, hudX + 8, hudY + 28);

            // Diagnostic Status Tag
            const charStr = this.getHarmonicCharacter();
            if (this.evenOddRatioSmoothed > 1.25) {
                ctx.fillStyle = '#ffb020';
            } else if (this.evenOddRatioSmoothed < 0.80) {
                ctx.fillStyle = '#ec4899';
            } else {
                ctx.fillStyle = '#10b981';
            }
            ctx.fillText(`● ${charStr}`, hudX + 8, hudY + 42);

            // Mini Harmonic Energy Meter Bar
            this.drawMiniHarmonicBars(ctx, hudX + hudW - 120, hudY + 24, 112, 20);
        } else {
            ctx.fillStyle = '#64748b';
            ctx.fillText('SPECTRUM DIAGNOSTICS • STANDBY (AWAITING INPUT)', hudX + 8, hudY + 16);
            ctx.font = '9px "JetBrains Mono", monospace';
            ctx.fillText('Even-vs-Odd Ratio: 1.00:1 (Balanced) • THD: 0.0%', hudX + 8, hudY + 34);
        }
    }

    drawMiniHarmonicBars(ctx, x, y, w, h) {
        const barW = Math.floor(w / 5) - 3;
        for (let i = 0; i < 5; i++) {
            const bx = x + i * (barW + 3);
            const val = this.harmonicActive[i] ? this.harmonicRawVals[i] : 0;
            const norm = Math.max(0, Math.min(1, val / 255.0));
            const barH = Math.max(2, norm * (h - 6));

            // Background slot
            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.fillRect(bx, y, barW, h - 6);

            // Filled bar
            ctx.fillStyle = this.harmonicConfigs[i].color;
            ctx.fillRect(bx, y + (h - 6) - barH, barW, barH);

            // Order label
            ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.font = '7px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(`${i + 1}`, bx + barW / 2, y + h);
        }
    }

    drawMinimalHeader(w) {
        const ctx = this.ctx;
        ctx.textAlign = 'left';
        ctx.font = '700 10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
        ctx.fillText('SPECTRUM 65Hz - 2.4kHz [HUD HIDDEN]', 12, 18);
    }

    drawHUDToggleButton(ctx, w) {
        const btnW = 96;
        const btnH = 20;
        const btnX = w - btnW - 12;
        const btnY = 8;

        this.hudToggleBounds.x = btnX;
        this.hudToggleBounds.y = btnY;
        this.hudToggleBounds.w = btnW;
        this.hudToggleBounds.h = btnH;

        // Button background
        ctx.fillStyle = this.showHUD 
            ? (this.isToggleHovered ? 'rgba(0, 243, 255, 0.22)' : 'rgba(0, 243, 255, 0.12)')
            : (this.isToggleHovered ? 'rgba(255, 255, 255, 0.12)' : 'rgba(20, 22, 28, 0.85)');
        ctx.fillRect(btnX, btnY, btnW, btnH);

        // Border
        ctx.strokeStyle = this.showHUD ? '#00f3ff' : 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(btnX, btnY, btnW, btnH);

        // Indicator LED
        ctx.fillStyle = this.showHUD ? '#00f3ff' : '#64748b';
        ctx.beginPath();
        ctx.arc(btnX + 8, btnY + btnH / 2, 3, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = this.showHUD ? '#ffffff' : '#94a3b8';
        ctx.fillText(this.showHUD ? 'HUD [ON]' : 'HUD [OFF]', btnX + 16, btnY + 14);
    }

    /**
     * Rolling Waterfall Spectrogram:
     * - Maintains an off-screen canvas ring buffer of the previous 128 spectral slices.
     * - Maps dB amplitude to the Analog Phosphor / Heat Palette.
     * - Renders continuous vertical scrolling with smooth bilinear interpolation.
     * ZERO ALLOCATION inside this hot loop.
     */
    recordWaterfallSlice(sampleRate) {
        const wfW = this.waterfallWidth;
        const nyquist = sampleRate / 2;
        const binHz = nyquist / this.frequencyBinCount;

        // Populate current 1-pixel scanline using 32-bit pixel writes
        for (let x = 0; x < wfW; x++) {
            const freq = this.xToFreq(x, wfW);
            const binFloat = freq / binHz;
            const bin0 = Math.floor(binFloat);
            const bin1 = Math.min(this.frequencyBinCount - 1, bin0 + 1);
            const frac = binFloat - bin0;

            const v0 = this.freqData[bin0] || 0;
            const v1 = this.freqData[bin1] || 0;
            const val = Math.round(v0 + (v1 - v0) * frac);

            this.sliceData32[x] = this.colorLUT32[val];
        }

        // Put image slice into off-screen canvas ring buffer
        if (this.waterfallCtx) {
            this.waterfallCtx.putImageData(this.sliceImageData, 0, this.ringHead);
        }

        // Step ring buffer head (newest slice advances, rolling history downwards)
        this.ringHead = (this.ringHead - 1 + this.waterfallSlices) % this.waterfallSlices;
    }

    drawWaterfallSection(w, yOffset, h, sampleRate) {
        const ctx = this.ctx;
        const wfW = this.waterfallWidth;
        const totalSlices = this.waterfallSlices;

        if (wfW === 0 || !this.waterfallCanvas) return;

        // 1. Record current FFT slice into ring buffer (Zero-Allocation)
        this.recordWaterfallSlice(sampleRate);

        // 2. Render continuous vertical scrolling via 2-slice ring buffer blit
        // Head represents the row of the latest written slice.
        // Region 1 (Newer): rows head -> 127
        // Region 2 (Older): rows 0 -> head - 1
        const head = (this.ringHead + 1) % totalSlices;
        const count1 = totalSlices - head;
        const count2 = head;

        const h1 = (count1 / totalSlices) * h;
        const h2 = h - h1;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'medium';

        // Blit Region 1 (top of waterfall, newest down to split)
        if (count1 > 0) {
            ctx.drawImage(
                this.waterfallCanvas,
                0, head, wfW, count1,
                0, yOffset, w, h1
            );
        }

        // Blit Region 2 (split down to oldest slices)
        if (count2 > 0) {
            ctx.drawImage(
                this.waterfallCanvas,
                0, 0, wfW, count2,
                0, yOffset + h1, w, h2
            );
        }

        // Dividing separator line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, yOffset);
        ctx.lineTo(w, yOffset);
        ctx.stroke();

        // Section legend
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.textAlign = 'left';
        ctx.fillText('HEAT-MAP WATERFALL [128 SLICES • PHOSPHOR PALETTE • TIME ▼]', 12, yOffset + 12);
    }

    /**
     * Returns diagnostic metrics for external consumers or test runners.
     */
    getDiagnostics() {
        return {
            fundamentalFreq: this.fundamentalFreq,
            fundamentalNote: this.fundamentalNoteName,
            fundamentalDb: this.fundamentalDb,
            thdPercent: this.thdSmoothed,
            thdDb: this.thdDb,
            evenEnergy: this.evenEnergy,
            oddEnergy: this.oddEnergy,
            evenOddRatio: this.evenOddRatioSmoothed,
            evenOddRatioDb: this.evenOddRatioDb,
            peakOvertoneOrder: this.peakOvertoneOrder,
            character: this.getHarmonicCharacter(),
            showHUD: this.showHUD
        };
    }
}

if (typeof module !== 'undefined') {
    module.exports = SpectralHeatmapVisualizer;
}
