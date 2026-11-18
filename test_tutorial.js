/**
 * Automated Verification Suite for FretDSP Interactive Guided Tour (js/tutorial.js)
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
for (const cls of ['.tour-launch-btn', '.tour-spotlight', '.tour-card', '.tour-topics-menu', '.tour-try-btn']) {
    assert(css.includes(cls), `Missing ${cls} style in css/styles.css`);
}

// 3. Verify every referenced DOM ID exists in index.html
const requiredIds = [
    'btnStartTour',
    'sectionFretboard',
    'sectionTablature',
    'practiceTrainerBar',
    'sectionSpectral',
    'sectionStrobe',
    'sectionEffectsRack',
    'pedalBackingTrack',
    'sectionActionTray',
    'sectionKeyboardGuide',
    'btnPluckFresh',
    'btnPluckWorn',
    'btnBackingStomp',
    'backingBypassStatus',
    'btnPlayDemo'
];
for (const id of requiredIds) {
    assert(html.includes(`id="${id}"`), `Missing element id="${id}" in index.html`);
}

for (const cls of ['app-header', 'master-control-bar']) {
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
        this.hidden = false;
        this.disabled = false;
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
    click() { (this.listeners.click || []).forEach(fn => fn({ preventDefault() {} })); }
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
    // Simulate a very tall section for Effects Rack to verify bottom-right viewport docking
    const rect = (id === 'sectionEffectsRack')
        ? { top: 20, bottom: 780, left: 40, right: 1200, width: 1160, height: 760 }
        : { top: 120, bottom: 420, left: 40, right: 1200, width: 1160, height: 300 };
    elementsById[id] = new MockEl('div', rect);
});

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
        dispatchEvent: () => {}
    },
    document: {
        body: new MockEl('body'),
        createElement: (t) => new MockEl(t),
        getElementById: (id) => elementsById[id] || null,
        querySelector: (sel) => {
            if (sel.startsWith('#')) return elementsById[sel.slice(1)] || null;
            if (sel === '.app-header' || sel === '.master-control-bar') return new MockEl('section');
            return null;
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

// Walk through every single step
tour.start(0);
assert.strictEqual(tour.isOpen, true);

for (let i = 0; i < tour.steps.length; i++) {
    tour.goTo(i);
    const step = tour.steps[i];
    if (step.target) {
        assert(sandbox.document.querySelector(step.target), `Target did not resolve: ${step.target}`);
        assert(tour.spotlightEl.classList.contains('open'), `Spotlight should open for ${step.id}`);
        const topPx = parseInt(tour.cardEl.style.top, 10);
        const leftPx = parseInt(tour.cardEl.style.left, 10);
        assert(!Number.isNaN(topPx) && topPx >= 16, `Card top out of bounds (${tour.cardEl.style.top}) on ${step.id}`);
        assert(!Number.isNaN(leftPx) && leftPx >= 16, `Card left out of bounds (${tour.cardEl.style.left}) on ${step.id}`);
    } else {
        assert(tour.backdropEl.classList.contains('open'), 'Backdrop should open on Welcome step');
        assert(tour.cardEl.classList.contains('tour-card-centered'), 'Welcome card should be centered');
    }
}

// Verify keyboard navigation
tour.goTo(2);
(winListeners['keydown'] || []).forEach(fn => fn({ key: 'ArrowRight', preventDefault() {} }));
assert.strictEqual(tour.currentIndex, 3, 'ArrowRight should advance to next step');
(winListeners['keydown'] || []).forEach(fn => fn({ key: 'ArrowLeft', preventDefault() {} }));
assert.strictEqual(tour.currentIndex, 2, 'ArrowLeft should return to previous step');
(winListeners['keydown'] || []).forEach(fn => fn({ key: 'Escape', preventDefault() {} }));
assert.strictEqual(tour.isOpen, false, 'Escape should close the tour');
assert.strictEqual(tour.hasBeenSeen(), true, 'Closing tour should persist seen state in localStorage');

// Verify header button relaunches tour
elementsById['btnStartTour'].click();
assert.strictEqual(tour.isOpen, true, 'Clicking #btnStartTour should open the tour');
assert.strictEqual(tour.currentIndex, 0, 'Clicking #btnStartTour should start from step 0');

// Verify Topics toggle
tour.toggleTopics(true);
assert.strictEqual(tour.topicsMenu.hidden, false, 'Topics menu should open');
tour.toggleTopics(false);
assert.strictEqual(tour.topicsMenu.hidden, true, 'Topics menu should close');

console.log('✅ All FretDSP tutorial checks passed (12/12 steps, selectors, positioning, keyboard, persistence).');
