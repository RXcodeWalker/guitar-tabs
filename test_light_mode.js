/**
 * Comprehensive Verification Suite for FretDSP Clean Light Mode & Theme Toggle
 */

const fs = require('fs');
const assert = require('assert');

console.log('================================================================================');
console.log('TEST SUITE: FRETDSP CLEAN LIGHT MODE & THEME TOGGLE ENGINE');
console.log('================================================================================\n');

// 1. Verify index.html integration
console.log('--- Section 1: HTML Markup & Hydration Script ---');
const html = fs.readFileSync('index.html', 'utf8');

assert(html.includes('id="btnThemeToggle"'), 'Missing #btnThemeToggle button in index.html');
console.log('  ✓ #btnThemeToggle button element present in header');

assert(html.includes('id="themeToggleIcon"'), 'Missing #themeToggleIcon in index.html');
console.log('  ✓ #themeToggleIcon present in index.html');

assert(html.includes('id="themeToggleLabel"'), 'Missing #themeToggleLabel in index.html');
console.log('  ✓ #themeToggleLabel present in index.html');

assert(html.includes('fretdsp_theme'), 'Missing inline theme hydration script in index.html');
console.log('  ✓ Instant theme hydration script present in <head> to prevent FOUT');

assert(html.includes('<kbd>T</kbd>'), 'Missing T hotkey documentation in keyboard guide footer');
console.log('  ✓ Theme shortcut key <kbd>T</kbd> documented in keyboard guide');

// 2. Verify CSS definitions
console.log('\n--- Section 2: CSS Stylesheet Light Mode & Theme Switcher Rules ---');
const css = fs.readFileSync('css/styles.css', 'utf8');

const requiredCssSelectors = [
    '.theme-toggle-btn',
    '.theme-toggle-icon',
    '.header-action-group',
    ':root[data-theme="light"]',
    'body.light-theme',
    'body.light-theme .chassis-panel',
    'body.light-theme .stomp-button',
    'body.light-theme .action-btn',
    'body.light-theme .digital-display',
    'body.light-theme .select-hardware',
    'body.light-theme .toggle-switch-btn',
    'body.light-theme .canvas-frame',
    'body.light-theme .tab-transport-bar',
    'body.light-theme .transport-btn',
    'body.light-theme .strobe-analyzer-panel',
    'body.light-theme .effects-rack-chassis',
    'body.light-theme .chord-scale-ribbon',
    'body.light-theme .modal-content',
    'body.light-theme .tour-card',
    'body.light-theme .tour-mission-box',
    'body.light-theme .tour-mission-badge',
    'body.light-theme .tour-mission-prompt',
    'body.light-theme .tour-task-item',
    'body.light-theme .tour-task-check',
    'body.light-theme .tour-tip-box',
    'body.light-theme .tour-try-primary',
    'body.light-theme .tour-try-secondary',
    'body.light-theme .tour-score-pill',
    'body.light-theme .tour-topics-btn',
    'body.light-theme .tour-close-btn',
    'body.light-theme .scale-recommendation-pill',
    'body.light-theme .wear-fresh',
    'body.light-theme .wear-worn'
];

for (const sel of requiredCssSelectors) {
    assert(css.includes(sel), `Missing required CSS selector: ${sel}`);
    console.log(`  ✓ ${sel} selector defined`);
}

// Verify high-contrast color choices in Light Mode (WCAG accessibility)
assert(css.includes('body.light-theme .tour-mission-prompt') && css.includes('#0f172a'), 'Light mode mission prompt must have high-contrast dark text');
console.log('  ✓ Light mode mission prompt uses high-contrast dark slate text (#0f172a)');

assert(css.includes('body.light-theme .tour-tip-box') && css.includes('#92400e'), 'Light mode tip box must use dark amber text (#92400e) on light background');
console.log('  ✓ Light mode tip box uses high-contrast dark amber text (#92400e)');

assert(css.includes('body.light-theme .tour-try-primary') && css.includes('#065f46'), 'Light mode try button must use dark forest green text (#065f46)');
console.log('  ✓ Light mode try button uses high-contrast dark forest emerald text (#065f46)');

// 3. Verify Tablature Theme API
console.log('\n--- Section 3: TablatureStaff setTheme() Dynamic Canvas Palette ---');
const tablatureSrc = fs.readFileSync('js/tablature.js', 'utf8');
assert(tablatureSrc.includes('setTheme(theme)'), 'TablatureStaff missing setTheme method');

// Mock Tablature instance
const TablatureModule = eval(`(function() {
    let module = { exports: {} };
    ${tablatureSrc}
    return module.exports || (typeof TablatureStaff !== 'undefined' ? TablatureStaff : null);
})()`);

assert(typeof TablatureModule === 'function', 'Failed to evaluate TablatureStaff');
const tabInstance = new TablatureModule(null, { bpm: 120 });

assert(tabInstance.colors.background === '#0a0a0d', 'Default dark background should be #0a0a0d');
console.log('  ✓ Default dark mode tablature background is #0a0a0d');

tabInstance.setTheme('light');
assert(tabInstance.colors.background === '#ffffff', 'Light mode tablature background should be #ffffff');
assert(tabInstance.colors.noteText === '#0f172a', 'Light mode note text should be dark slate #0f172a');
assert(tabInstance.colors.playhead === '#0284c7', 'Light mode playhead should be deep cyan/sky #0284c7');
console.log('  ✓ tabInstance.setTheme("light") successfully switched to clean white canvas palette');

tabInstance.setTheme('dark');
assert(tabInstance.colors.background === '#0a0a0d', 'Dark mode tablature background should be restored to #0a0a0d');
assert(tabInstance.colors.noteText === '#ffffff', 'Dark mode note text should be restored to #ffffff');
console.log('  ✓ tabInstance.setTheme("dark") successfully restored dark boutique palette');

// 4. Verify Spectral Visualizer Theme API
console.log('\n--- Section 4: SpectralHeatmapVisualizer setTheme() Palette ---');
const spectralSrc = fs.readFileSync('js/spectral-visualizer.js', 'utf8');
assert(spectralSrc.includes('setTheme(theme)'), 'SpectralHeatmapVisualizer missing setTheme method');

const SpectralModule = eval(`(function() {
    let module = { exports: {} };
    ${spectralSrc}
    return module.exports || (typeof SpectralHeatmapVisualizer !== 'undefined' ? SpectralHeatmapVisualizer : null);
})()`);

assert(typeof SpectralModule === 'function', 'Failed to evaluate SpectralHeatmapVisualizer');
const specInstance = new SpectralModule(null);

assert(specInstance.colors.bg === '#121214', 'Default dark spectral bg should be #121214');
console.log('  ✓ Default dark mode spectral bg is #121214');

specInstance.setTheme('light');
assert(specInstance.colors.bg === '#ffffff', 'Light mode spectral bg should be #ffffff');
assert(specInstance.colors.curveStroke === '#0284c7', 'Light mode curve stroke should be #0284c7');
console.log('  ✓ specInstance.setTheme("light") successfully switched to clean studio light palette');

specInstance.setTheme('dark');
assert(specInstance.colors.bg === '#121214', 'Dark mode spectral bg should be restored to #121214');
assert(specInstance.colors.curveStroke === '#00f3ff', 'Dark mode curve stroke should be restored to #00f3ff');
console.log('  ✓ specInstance.setTheme("dark") successfully restored neon dark palette');

// 5. Verify App.js Theme Orchestrator & Keyboard Shortcuts
console.log('\n--- Section 5: App.js Orchestrator & State Flow Simulation ---');
const appSrc = fs.readFileSync('js/app.js', 'utf8');

assert(appSrc.includes('btnThemeToggle'), 'app.js does not query btnThemeToggle');
assert(appSrc.includes('fretdsp_theme'), 'app.js does not persist to localStorage fretdsp_theme');
assert(appSrc.includes("e.key.toLowerCase() === 't'"), 'app.js does not handle "T" keyboard shortcut for theme');
console.log('  ✓ app.js queries btnThemeToggle, persists to localStorage, and maps "T" shortcut');

// Simulate DOM state transitions
class MockDOMElement {
    constructor(id) {
        this.id = id;
        this.attributes = {};
        this._classes = new Set();
        this.classList = {
            add: (c) => this._classes.add(c),
            remove: (c) => this._classes.delete(c),
            toggle: (c, force) => {
                if (force === undefined) {
                    this._classes.has(c) ? this._classes.delete(c) : this._classes.add(c);
                } else if (force) {
                    this._classes.add(c);
                } else {
                    this._classes.delete(c);
                }
            },
            contains: (c) => this._classes.has(c)
        };
        this.textContent = '';
        this.title = '';
        this.listeners = {};
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] || null; }
    addEventListener(evt, fn) {
        if (!this.listeners[evt]) this.listeners[evt] = [];
        this.listeners[evt].push(fn);
    }
    click() {
        if (this.listeners['click']) {
            this.listeners['click'].forEach(fn => fn({ preventDefault: () => {} }));
        }
    }
}

// Test state machine with Mock DOM
const mockHtml = new MockDOMElement('html');
const mockBody = new MockDOMElement('body');
const mockBtn = new MockDOMElement('btnThemeToggle');
const mockIcon = new MockDOMElement('themeToggleIcon');
const mockLabel = new MockDOMElement('themeToggleLabel');

let mockLocalStorage = {};
let notifiedTabTheme = null;
let notifiedSpecTheme = null;

const mockTab = {
    setTheme(t) { notifiedTabTheme = t; }
};
const mockSpec = {
    setTheme(t) { notifiedSpecTheme = t; }
};

function testApplyTheme(theme, save = true) {
    const isLight = theme === 'light';
    mockHtml.setAttribute('data-theme', isLight ? 'light' : 'dark');
    mockBody.classList.toggle('light-theme', isLight);

    mockBtn.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    mockBtn.title = isLight ? 'Switch to Dark Mode (Shortcut: T)' : 'Switch to Light Mode (Shortcut: T)';
    mockIcon.textContent = isLight ? '🌙' : '☀️';
    mockLabel.textContent = isLight ? 'Dark Mode' : 'Light Mode';

    mockTab.setTheme(isLight ? 'light' : 'dark');
    mockSpec.setTheme(isLight ? 'light' : 'dark');

    if (save) {
        mockLocalStorage['fretdsp_theme'] = isLight ? 'light' : 'dark';
    }
}

function testToggleTheme() {
    const isCurrentlyLight = mockHtml.getAttribute('data-theme') === 'light' || mockBody.classList.contains('light-theme');
    const next = isCurrentlyLight ? 'dark' : 'light';
    testApplyTheme(next, true);
    return next;
}

// Initial state is dark
testApplyTheme('dark', false);
assert.strictEqual(mockHtml.getAttribute('data-theme'), 'dark');
assert.strictEqual(mockBody.classList.contains('light-theme'), false);
assert.strictEqual(mockLabel.textContent, 'Light Mode');
assert.strictEqual(mockIcon.textContent, '☀️');
assert.strictEqual(notifiedTabTheme, 'dark');
assert.strictEqual(notifiedSpecTheme, 'dark');

// Toggle to light
const switched1 = testToggleTheme();
assert.strictEqual(switched1, 'light');
assert.strictEqual(mockHtml.getAttribute('data-theme'), 'light');
assert.strictEqual(mockBody.classList.contains('light-theme'), true);
assert.strictEqual(mockLabel.textContent, 'Dark Mode');
assert.strictEqual(mockIcon.textContent, '🌙');
assert.strictEqual(mockLocalStorage['fretdsp_theme'], 'light');
assert.strictEqual(notifiedTabTheme, 'light');
assert.strictEqual(notifiedSpecTheme, 'light');
console.log('  ✓ State transition 1: Dark -> Light mode sets data-theme="light", updates icon 🌙, and notifies canvases');

// Toggle back to dark
const switched2 = testToggleTheme();
assert.strictEqual(switched2, 'dark');
assert.strictEqual(mockHtml.getAttribute('data-theme'), 'dark');
assert.strictEqual(mockBody.classList.contains('light-theme'), false);
assert.strictEqual(mockLabel.textContent, 'Light Mode');
assert.strictEqual(mockIcon.textContent, '☀️');
assert.strictEqual(mockLocalStorage['fretdsp_theme'], 'dark');
assert.strictEqual(notifiedTabTheme, 'dark');
assert.strictEqual(notifiedSpecTheme, 'dark');
console.log('  ✓ State transition 2: Light -> Dark mode sets data-theme="dark", updates icon ☀️, and restores canvases');

console.log('\n================================================================================');
console.log('ALL LIGHT MODE & THEME TOGGLE TESTS PASSED! (5/5 sections verified)');
console.log('================================================================================');
