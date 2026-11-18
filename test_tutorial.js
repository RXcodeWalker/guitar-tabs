/**
 * Automated Verification Suite for FretDSP Interactive Hands-On Guided Tour
 */

const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('css/styles.css', 'utf8');
const tutorialSrc = fs.readFileSync('js/tutorial.js', 'utf8');

// 1. Verify HTML integration
assert(html.includes('id="btnStartTour"'), 'Missing #btnStartTour launcher in index.html');
assert(html.includes('<script src="js/tutorial.js"></script>'), 'Missing js/tutorial.js script tag');

// 2. Verify CSS styles exist
for (const cls of [
    '.tour-launch-btn', '.tour-spotlight', '.tour-card', '.tour-topics-menu',
    '.tour-try-btn', '.tour-beacon-target', '.tour-mission-box', '.tour-mode-picker',
    '.tour-jam-pad', '.tour-score-pill'
]) {
    assert(css.includes(cls), `Missing ${cls} style in css/styles.css`);
}

// 3. Verify every referenced DOM ID exists in index.html
const requiredIds = [
    'btnStartTour', 'selectAudioInput',
    'bpmSlider', 'btnBpmMinus', 'btnBpmPlus', 'btnTapTempo', 'btnMetronomeSound',
    'sectionFretboard', 'fretboardCanvas', 'selectTestChord', 'selectOverlayMode', 'btnToggleScaleOverlay',
    'sectionTablature', 'btnPlayBack', 'zoomSlider', 'selectSynthSound', 'btnLoopTab',
    'practiceTrainerBar', 'btnPracticeMode', 'btnToggleSpeedTrainer', 'btnSetLoopRange',
    'sectionSpectral', 'spectralCanvas',
    'sectionStrobe', 'btnPluckFresh', 'btnPluckNormal', 'btnPluckWorn',
    'sectionEffectsRack', 'btnOdStomp', 'btnCabStomp', 'btnDelayStomp', 'btnReverbStomp', 'btnMasterStomp',
    'odDriveSlider', 'odToneSlider', 'odLevelSlider', 'cabProfileSelect', 'cabPosSlider', 'cabDistSlider',
    'delayTimeSlider', 'delayFeedbackSlider', 'delayMixSlider', 'reverbSizeSlider', 'reverbDampingSlider', 'reverbMixSlider', 'masterVolumeSlider',
    'pedalBackingTrack', 'btnBackingStomp', 'backingBypassStatus', 'backingGrooveSelect', 'backingProgressionSelect', 'btnMuteDrums', 'btnMuteBass', 'btnMuteKeys',
    'sectionActionTray', 'btnPlayDemo', 'selectDemoSong', 'btnOpenExportModal', 'btnExportAsciiQuick',
    'sectionKeyboardGuide'
];
for (const id of requiredIds) {
    assert(html.includes(`id="${id}"`), `Missing element id="${id}" in index.html`);
}

for (const cls of ['app-header', 'master-control-bar', 'audio-routing-rack', 'gain-meter-rack', 'bpm-controls-group']) {
    assert(html.includes(cls), `Missing class "${cls}" in index.html`);
}

// 4. Simulated DOM execution test
class MockEl {
    constructor(tag, rect) {
        this.tagName = tag.toUpperCase();
        this.className = '';
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.children = [];
        this.listeners = {};
        this._innerHTML = '';
        this.textContent = '';
        this.value = '';
        this.hidden = false;
        this.disabled = false;
        this.offsetWidth = 100;
        this._rect = rect || { top: 120, bottom: 420, left: 40, right: 1200, width: 1160, height: 300 };
        this._classes = new Set();
        this.classList = {
            add: (...c) => c.forEach(x => this._classes.add(x)),
            remove: (...c) => c.forEach(x => this._classes.delete(x)),
            toggle: (x, f) => {
                if (f === undefined) {
                    this._classes.has(x) ? this._classes.delete(x) : this._classes.add(x);
                } else if (f) {
                    this._classes.add(x);
                } else {
                    this._classes.delete(x);
                }
            },
            contains: (x) => this._classes.has(x)
        };
    }
    set innerHTML(v) { this._innerHTML = v; this.children = []; }
    get innerHTML() { return this._innerHTML; }
    setAttribute(k, v) { this.attributes[k] = v; }
    appendChild(c) { this.children.push(c); return c; }
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    removeEventListener(ev, fn) {
        if (!this.listeners[ev]) return;
        this.listeners[ev] = this.listeners[ev].filter(f => f !== fn);
    }
    emit(ev, payload = {}) {
        (this.listeners[ev] || []).slice().forEach(fn => fn(Object.assign({ preventDefault() {}, target: this }, payload)));
    }
    click() { this.emit('click'); }
    querySelector(sel) {
        if (!this._qCache) this._qCache = {};
        if (!this._qCache[sel]) this._qCache[sel] = new MockEl('div');
        return this._qCache[sel];
    }
    querySelectorAll() { return this.children; }
    getBoundingClientRect() { return this._rect; }
}

const storage = {};
const winListeners = {};
const docListeners = {};
const elementsById = {};
requiredIds.forEach(id => {
    const rect = (id === 'sectionEffectsRack')
        ? { top: 20, bottom: 780, left: 40, right: 1200, width: 1160, height: 760 }
        : { top: 120, bottom: 420, left: 40, right: 1200, width: 1160, height: 300 };
    elementsById[id] = new MockEl('div', rect);
});
const classElements = {
    '.app-header': new MockEl('header'),
    '.master-control-bar': new MockEl('section'),
    '.audio-routing-rack': new MockEl('div'),
    '.gain-meter-rack': new MockEl('div'),
    '.bpm-controls-group': new MockEl('div')
};

const emitWin = (ev, payload = {}) => {
    (winListeners[ev] || []).slice().forEach(fn => fn(Object.assign({ preventDefault() {} }, payload)));
};

const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame: () => {},
    localStorage: {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); }
    },
    window: {
        innerWidth: 1280,
        innerHeight: 800,
        scrollY: 0,
        location: { hash: '' },
        scrollTo: () => {},
        addEventListener: (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); },
        removeEventListener: (ev, fn) => {
            if (!winListeners[ev]) return;
            winListeners[ev] = winListeners[ev].filter(f => f !== fn);
        },
        dispatchEvent: (ev) => emitWin(ev.type, ev)
    },
    document: {
        body: new MockEl('body'),
        createElement: (t) => new MockEl(t),
        getElementById: (id) => elementsById[id] || null,
        querySelector: (sel) => {
            if (sel.startsWith('#')) return elementsById[sel.slice(1)] || null;
            return classElements[sel] || null;
        },
        addEventListener: (ev, fn) => { (docListeners[ev] = docListeners[ev] || []).push(fn); }
    },
    KeyboardEvent: function (t, o) { this.type = t; Object.assign(this, o); }
};
sandbox.window.window = sandbox.window;

vm.runInNewContext(tutorialSrc, sandbox);
(docListeners['DOMContentLoaded'] || []).forEach(fn => fn());

const tour = sandbox.window.fretDSPTutorial;
assert(tour, 'Expected window.fretDSPTutorial to be initialized');
assert.strictEqual(tour.steps.length, 12, 'Expected 12 tour steps');
assert.strictEqual(tour.totalMissions, 11, 'Expected 11 interactive missions');

// Start tour & walk every step
tour.start(0);
for (let i = 0; i < tour.steps.length; i++) {
    tour.goTo(i);
    const step = tour.steps[i];
    if (step.target) {
        assert(sandbox.document.querySelector(step.target), `Target did not resolve: ${step.target}`);
        assert(tour.spotlightEl.classList.contains('open'), `Spotlight should open for ${step.id}`);
        assert(!Number.isNaN(parseInt(tour.cardEl.style.top, 10)), `Invalid card top on ${step.id}`);
        assert(!Number.isNaN(parseInt(tour.cardEl.style.left, 10)), `Invalid card left on ${step.id}`);
    }
}

// Test interactive mission completion & beacon lifecycle:
// 1) Step 2 (index 1): Audio Setup
tour.goTo(1);
assert(classElements['.audio-routing-rack'].classList.contains('tour-beacon-target'), 'Beacon should light on audio-routing-rack');
elementsById['selectAudioInput'].emit('change');
assert(tour.completedMissions.has('audio-setup'), 'Audio setup mission should complete on select change');

// 2) Step 3 (index 2): BPM change (also verifies previous beacon cleaned up)
tour.goTo(2);
assert(!classElements['.audio-routing-rack'].classList.contains('tour-beacon-target'), 'Previous beacon should be cleaned up');
elementsById['bpmSlider'].value = '132';
elementsById['bpmSlider'].emit('input');
assert(tour.completedMissions.has('master-controls'), 'Master controls mission should complete on BPM input');

// 3) Step 4 (index 3): Fretboard 2-part mission (3 plucks + chord change)
tour.goTo(3);
elementsById['fretboardCanvas'].emit('pointerdown');
elementsById['fretboardCanvas'].emit('pointerdown');
assert(!tour.completedMissions.has('fretboard'), 'Fretboard mission should not finish after only 2 plucks');
elementsById['fretboardCanvas'].emit('pointerdown');
elementsById['selectTestChord'].value = 'G7';
elementsById['selectTestChord'].emit('change');
assert(tour.completedMissions.has('fretboard'), 'Fretboard mission should complete after 3 plucks + chord switch');

// 4) Step 8 (index 7): Strobe Tuner Fresh + Worn comparison
tour.goTo(7);
elementsById['btnPluckFresh'].click();
assert(!tour.completedMissions.has('strobe-tuner'), 'Strobe mission needs both Fresh and Worn');
elementsById['btnPluckWorn'].click();
assert(tour.completedMissions.has('strobe-tuner'), 'Strobe mission should complete after Fresh + Worn');

// 5) Step 9 (index 8): Effects Rack stomp + knob
tour.goTo(8);
elementsById['btnOdStomp'].click();
elementsById['odDriveSlider'].emit('input');
assert(tour.completedMissions.has('effects-rack'), 'Effects rack mission should complete after stomp + slider');

// 6) Step 10 (index 9): Rhythm Trio start + groove change
tour.goTo(9);
elementsById['btnBackingStomp'].click();
elementsById['backingGrooveSelect'].emit('change');
assert(tour.completedMissions.has('backing-track'), 'Backing track mission should complete after stomp + groove');

// 7) Step 12 (index 11): Keyboard Jam Pad (4 notes)
tour.goTo(11);
['a', 'd', 'g', 'k'].forEach(k => emitWin('keydown', { key: k }));
assert(tour.completedMissions.has('shortcuts'), 'Finale keyboard jam mission should complete after 4 notes');
assert.strictEqual(tour.completedMissions.size, 7, 'Should have 7 completed missions');
assert(tour.scorePill.textContent.includes('7/11'), `Score pill should show 7/11, got: ${tour.scorePill.textContent}`);

// Keyboard nav & Escape cleanup
emitWin('keydown', { key: 'ArrowLeft' });
assert.strictEqual(tour.currentIndex, 10, 'ArrowLeft should step back');
emitWin('keydown', { key: 'Escape' });
assert.strictEqual(tour.isOpen, false, 'Escape should close tour');
assert.strictEqual(tour.activeBeacons.length, 0, 'Beacons should be cleared on close');
assert.strictEqual(tour.activeCleanups.length, 0, 'Step listeners should be cleaned up on close');

console.log('✅ All interactive FretDSP tutorial tests passed (12 steps, 11 missions, beacons, score, cleanup).');
