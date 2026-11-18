/**
 * FretDSP Interactive Hands-On Guided Tour
 * Plain-English feature tour with live spotlighting, pulsing control beacons,
 * real-time interactive mini-missions, audio previews, and progress tracking.
 */

class FretDSPTutorial {
    constructor(options = {}) {
        this.storageKey = options.storageKey || 'fretdsp_tour_seen_v1';
        this.currentIndex = 0;
        this.isOpen = false;
        this.isTopicsOpen = false;
        this.rafId = null;
        this.demoPluckTimers = [];

        // User preference chosen on Welcome screen: 'guitar' | 'mouse'
        this.userMode = 'mouse';

        // Track interactive mission state per step id
        this.completedMissions = new Set();
        this.stepState = {};

        // Active DOM listeners & beacon elements for the current step (cleaned up on step change/close)
        this.activeCleanups = [];
        this.activeBeacons = [];

        this.steps = this.buildSteps();
        this.totalMissions = this.steps.filter(s => !!s.mission).length;

        this.createDOM();
        this.bindEvents();
    }

    buildSteps() {
        return [
            {
                id: 'welcome',
                category: 'Welcome',
                shortTitle: 'Welcome to FretDSP',
                title: 'Welcome to Your Interactive Guitar Studio',
                target: null,
                icon: '🎸',
                summary: 'Learn the whole studio in 2 minutes by actually trying it! Each stop highlights a real panel on screen and gives you a quick hands-on mini-challenge.',
                showModePicker: true,
                points: [
                    { label: 'Learn by doing', text: 'Every spotlighted panel stays clickable—twist knobs, pluck frets, and stomp pedals right during the tour.' },
                    { label: 'Zero jargon', text: 'Every control is explained in plain English, and you can skip ahead or jump to any topic anytime.' }
                ],
                tip: 'Pick how you plan to play today above, then hit Start Interactive Tour!'
            },
            {
                id: 'audio-setup',
                category: 'Step 1 • Setup',
                shortTitle: 'Mic & Volume Meter',
                title: 'Pick Your Mic & Watch the Volume Meter',
                target: '.app-header',
                icon: '🎙️',
                summary: 'This top bar lets you pick your microphone or guitar interface and check that your signal volume is loud enough without distorting.',
                points: [
                    { label: 'Audio Input Source', text: 'Select your laptop mic, USB mic, or audio interface.' },
                    { label: 'Input Gain & CLIP', text: 'Aim for green/yellow on the bar. If red CLIP flashes, lower your volume slightly.' }
                ],
                mission: {
                    prompt: 'Check the audio input selector or test the live volume meter!',
                    beacons: ['.audio-routing-rack', '.gain-meter-rack'],
                    tasks: [
                        { id: 'check_signal', label: 'Open Audio Input dropdown OR click "Test Volume Meter" below' }
                    ],
                    setup: (ctx) => {
                        const sel = document.getElementById('selectAudioInput');
                        ctx.listen(sel, 'mousedown', () => ctx.completeTask('check_signal', 'Input selector ready!'));
                        ctx.listen(sel, 'change', () => ctx.completeTask('check_signal', 'Audio input selected!'));
                    }
                },
                actions: [
                    {
                        label: '🔊 Test Volume Meter',
                        kind: 'primary',
                        onClick: (btn, tour) => {
                            tour.triggerSampleNote('a');
                            tour.completeCurrentTask('check_signal', 'See the green-yellow meter bounce!');
                        }
                    }
                ],
                dynamicTip: (mode) => mode === 'guitar'
                    ? 'Guitar tip: Select your audio interface or mic now so you are ready when we engage listening!'
                    : 'Mouse & Keyboard tip: No mic needed—click "Test Volume Meter" above to watch the meter react live!'
            },
            {
                id: 'master-controls',
                category: 'Step 2 • Core Controls',
                shortTitle: 'Listen, Beat & Quick Tuner',
                title: 'Start Listening, Keep Time & Quick Tune',
                target: '.master-control-bar',
                icon: '⏱️',
                summary: 'Your main command strip: turn your mic on, set the song speed (BPM), tidy up your timing with Quantize, and check notes on the mini tuner.',
                points: [
                    { label: 'Start Listening', text: 'Turns on your microphone so FretDSP hears your guitar in real time.' },
                    { label: 'Metronome & Tap', text: 'Slide BPM or tap "Tap" to match any tempo. Toggle "Click ON" for a beat click.' },
                    { label: 'Quantize & Mini Tuner', text: 'Quantize snaps messy timing onto the beat; the needle shows flat (left) vs. sharp (right).' }
                ],
                mission: {
                    prompt: 'Try changing the tempo on the live Metronome bar!',
                    beacons: ['.bpm-controls-group', '#btnTapTempo'],
                    tasks: [
                        { id: 'change_bpm', label: 'Drag the BPM slider, click + / -, or tap "Tap" tempo' }
                    ],
                    setup: (ctx) => {
                        const slider = document.getElementById('bpmSlider');
                        const minus = document.getElementById('btnBpmMinus');
                        const plus = document.getElementById('btnBpmPlus');
                        const tap = document.getElementById('btnTapTempo');
                        const onChange = () => {
                            const val = slider ? slider.value : '';
                            ctx.completeTask('change_bpm', `Nice! Tempo updated${val ? ` to ${val} BPM` : ''}.`);
                        };
                        ctx.listen(slider, 'input', onChange);
                        ctx.listen(minus, 'click', onChange);
                        ctx.listen(plus, 'click', onChange);
                        ctx.listen(tap, 'click', onChange);
                    }
                },
                actions: [
                    {
                        label: '🔔 Toggle Metronome Click',
                        kind: 'secondary',
                        onClick: () => {
                            const btn = document.getElementById('btnMetronomeSound');
                            if (btn) btn.click();
                        }
                    }
                ]
            },
            {
                id: 'fretboard',
                category: 'Step 3 • Play & Solo',
                shortTitle: 'Interactive Fretboard & Scales',
                title: 'Light-Up Fretboard & Live Scale Helper',
                target: '#sectionFretboard',
                icon: '✨',
                summary: 'Every note you play lights up across all 22 frets—and you can click any fret directly to hear it and write it into your tab!',
                points: [
                    { label: 'Color-Coded Scale Guide', text: 'Blue = safe chord tones, Green = smooth passing notes, Red = clashing notes (hidden by default).' },
                    { label: 'Tuning & Register', text: 'Switch tunings (Standard, Drop D, DADGAD) or pick where your hand prefers to play.' }
                ],
                mission: {
                    prompt: 'Play right on the glowing guitar neck & switch a scale!',
                    beacons: ['#fretboardCanvas', '#selectTestChord'],
                    tasks: [
                        { id: 'pluck_3', label: 'Click 3 frets on the neck (or press A, D, G)', targetCount: 3 },
                        { id: 'change_scale', label: 'Pick a different Chord Preset (or toggle Overlay / Intervals)' }
                    ],
                    setup: (ctx) => {
                        const canvas = document.getElementById('fretboardCanvas');
                        const preset = document.getElementById('selectTestChord');
                        const modeSel = document.getElementById('selectOverlayMode');
                        const overlayBtn = document.getElementById('btnToggleScaleOverlay');

                        ctx.listen(canvas, 'pointerdown', () => ctx.incrementTask('pluck_3', 3, 'notes plucked'));
                        ctx.listen(window, 'keydown', (e) => {
                            if (ctx.isTyping(e)) return;
                            const k = (e.key || '').toLowerCase();
                            if ('123456asdfghjk'.includes(k)) {
                                ctx.incrementTask('pluck_3', 3, 'notes plucked');
                            }
                        });
                        ctx.listen(preset, 'change', () => {
                            ctx.completeTask('change_scale', `Scale switched to ${preset.value}!`);
                        });
                        ctx.listen(modeSel, 'change', () => ctx.completeTask('change_scale', 'Label mode updated!'));
                        ctx.listen(overlayBtn, 'click', () => ctx.completeTask('change_scale', 'Scale overlay toggled!'));
                    }
                },
                actions: [
                    {
                        label: '🎸 Play Sample Riff for Me',
                        kind: 'primary',
                        onClick: (btn, tour) => tour.playSampleFretboardArpeggio(btn)
                    }
                ],
                tip: 'Go ahead—click directly on the fretboard above! Each click plays a real string sound and adds a note to your tab.'
            },
            {
                id: 'tablature',
                category: 'Step 4 • Auto Tabs',
                shortTitle: 'Scrolling Tab & Playback',
                title: 'Automatic Guitar Tab & Instant Playback',
                target: '#sectionTablature',
                icon: '🎼',
                summary: 'Everything you play on your guitar—or click on the fretboard—gets written onto this scrolling 6-string tab automatically.',
                points: [
                    { label: 'Play Back & Loop', text: 'Hear your written tab played out loud, or loop it continuously.' },
                    { label: 'Synth Engine & Zoom', text: 'Switch between Karplus-Strong plucked string or Poly Clean synth, and zoom note spacing.' }
                ],
                mission: {
                    prompt: 'Test the tab playback or tweak the sound & zoom!',
                    beacons: ['#btnPlayBack', '#zoomSlider'],
                    tasks: [
                        { id: 'use_tab', label: 'Click "Play Back", drag "Staff Zoom", or change Synth Engine' }
                    ],
                    setup: (ctx) => {
                        const playBtn = document.getElementById('btnPlayBack');
                        const zoom = document.getElementById('zoomSlider');
                        const synthSel = document.getElementById('selectSynthSound');
                        const loopBtn = document.getElementById('btnLoopTab');
                        ctx.listen(playBtn, 'click', () => ctx.completeTask('use_tab', 'Tab playback triggered!'));
                        ctx.listen(zoom, 'input', () => ctx.completeTask('use_tab', 'Tab spacing zoomed!'));
                        ctx.listen(synthSel, 'change', () => ctx.completeTask('use_tab', 'Synth engine switched!'));
                        ctx.listen(loopBtn, 'click', () => ctx.completeTask('use_tab', 'Loop toggled!'));
                    }
                },
                actions: [
                    {
                        label: '▶ Add Starter Notes & Play Back',
                        kind: 'primary',
                        onClick: (btn, tour) => {
                            tour.playSampleFretboardArpeggio(btn, () => {
                                const playBtn = document.getElementById('btnPlayBack');
                                if (playBtn && !playBtn.classList.contains('btn-playing')) {
                                    playBtn.click();
                                }
                            });
                            tour.completeCurrentTask('use_tab', 'Starter riff written and playing back!');
                        }
                    }
                ]
            },
            {
                id: 'practice-mode',
                category: 'Step 5 • Practice Coach',
                shortTitle: 'Practice Mode & Speed Trainer',
                title: 'Master Tough Riffs with A-B Loops & Speed Trainer',
                target: '#practiceTrainerBar',
                icon: '🎯',
                summary: 'Your built-in practice coach grades your accuracy, repeats tricky measures on a loop, and speeds up automatically as you improve.',
                points: [
                    { label: 'Practice Mode', text: 'Turn ON while playing along to see live Accuracy % and Streak counts.' },
                    { label: 'A-B Loop & Speed Trainer', text: 'Repeat Bars 1–2 and auto-bump BPM (+3, +5, or +10) every few clean loops.' }
                ],
                mission: {
                    prompt: 'Arm your practice coach right on the dock!',
                    beacons: ['#btnPracticeMode', '#btnToggleSpeedTrainer'],
                    tasks: [
                        { id: 'arm_practice', label: 'Click "Practice Mode", "Set Loop", or "Speed Trainer"' }
                    ],
                    setup: (ctx) => {
                        const pBtn = document.getElementById('btnPracticeMode');
                        const sBtn = document.getElementById('btnToggleSpeedTrainer');
                        const lBtn = document.getElementById('btnSetLoopRange');
                        ctx.listen(pBtn, 'click', () => ctx.completeTask('arm_practice', 'Practice Mode toggled!'));
                        ctx.listen(sBtn, 'click', () => ctx.completeTask('arm_practice', 'Speed Trainer toggled!'));
                        ctx.listen(lBtn, 'click', () => ctx.completeTask('arm_practice', 'A-B Loop markers set!'));
                    }
                }
            },
            {
                id: 'spectral',
                category: 'Step 6 • Sound X-Ray',
                shortTitle: 'Sound Heat-Map Visualizer',
                title: 'See Inside Your Sound (Heat-Map)',
                target: '#sectionSpectral',
                icon: '🌈',
                summary: 'This real-time glowing waterfall is like an X-ray of your tone—showing your main pitch (f₀) and the shimmering overtones (2f₀, 3f₀) stacked above it.',
                points: [
                    { label: 'Spot Sustain & Buzz', text: 'Clean notes form smooth, bright horizontal bands; fret buzz scatters noisy static.' }
                ],
                mission: {
                    prompt: 'Send a note into the visualizer and watch the harmonic peaks glow!',
                    beacons: ['#spectralCanvas'],
                    tasks: [
                        { id: 'light_spectrum', label: 'Press key A, D, or G—or click "Pulse Sound X-Ray" below' }
                    ],
                    setup: (ctx) => {
                        ctx.listen(window, 'keydown', (e) => {
                            if (ctx.isTyping(e)) return;
                            const k = (e.key || '').toLowerCase();
                            if ('123456asdfghjk'.includes(k)) {
                                ctx.completeTask('light_spectrum', 'Look at those glowing harmonic overtones!');
                            }
                        });
                    }
                },
                actions: [
                    {
                        label: '🌈 Pulse Sound X-Ray',
                        kind: 'primary',
                        onClick: (btn, tour) => {
                            tour.playSampleFretboardArpeggio(btn);
                            tour.completeCurrentTask('light_spectrum', 'Watch the f₀ and 2f₀ lines scroll across!');
                        }
                    }
                ]
            },
            {
                id: 'strobe-tuner',
                category: 'Step 7 • Precision Tuning',
                shortTitle: 'Strobe Tuner & String Health',
                title: 'Studio Strobe Tuner & Old-String Detector',
                target: '#sectionStrobe',
                icon: '🎯',
                summary: 'Get pinpoint tuning with spinning strobe rings, and check whether your guitar strings are fresh or worn out and stiff.',
                points: [
                    { label: 'Spinning Rings', text: 'Clockwise = sharp, Counter-clockwise = flat, Frozen still = dead-on in tune!' },
                    { label: 'String Wear Gauge', text: 'Measures string stiffness so you know when old strings stop ringing true.' }
                ],
                mission: {
                    prompt: 'Compare a Fresh string vs. a Worn string right in the simulator!',
                    beacons: ['#btnPluckFresh', '#btnPluckWorn'],
                    tasks: [
                        { id: 'pluck_fresh', label: 'Click "Pluck Fresh" to see a healthy green gauge' },
                        { id: 'pluck_worn', label: 'Click "Pluck Worn" to watch the gauge jump to red!' }
                    ],
                    setup: (ctx) => {
                        const fresh = document.getElementById('btnPluckFresh');
                        const worn = document.getElementById('btnPluckWorn');
                        const normal = document.getElementById('btnPluckNormal');
                        ctx.listen(fresh, 'click', () => ctx.completeTask('pluck_fresh', 'Fresh string: steady ring & green gauge!'));
                        ctx.listen(worn, 'click', () => ctx.completeTask('pluck_worn', 'Worn string: stiff harmonics & red alert!'));
                        ctx.listen(normal, 'click', () => ctx.completeTask('pluck_fresh', 'Good playable string analyzed!'));
                    }
                },
                tip: 'Click the two highlighted buttons inside the panel above (no microphone needed!).'
            },
            {
                id: 'effects-rack',
                category: 'Step 8 • Tone & Pedals',
                shortTitle: 'Guitar Effects Pedalboard',
                title: 'Shape Your Guitar Tone with Stompbox Pedals',
                target: '#sectionEffectsRack',
                icon: '🎛️',
                summary: 'Dial in rock crunch, amp cabinet resonance, analog echo, and lush reverb—all without throwing off pitch tracking!',
                points: [
                    { label: 'Stomp Footswitches', text: 'Click the silver button at the bottom of any pedal to switch it ON or OFF.' },
                    { label: 'Master Output Bay', text: 'Set overall volume, keep "Synth to FX" ON to hear pedals on playback, and wear headphones if using "Speaker Monitor".' }
                ],
                mission: {
                    prompt: 'Try out your virtual pedalboard—stomp a switch & twist a slider!',
                    beacons: ['#btnOdStomp', '#odDriveSlider', '#cabProfileSelect'],
                    tasks: [
                        { id: 'stomp_pedal', label: 'Click any silver pedal footswitch to toggle its LED' },
                        { id: 'tweak_knob', label: 'Slide any effect control or change the Cabinet Profile' }
                    ],
                    setup: (ctx) => {
                        ['btnOdStomp', 'btnCabStomp', 'btnDelayStomp', 'btnReverbStomp', 'btnMasterStomp'].forEach(id => {
                            ctx.listen(document.getElementById(id), 'click', () => ctx.completeTask('stomp_pedal', 'Stompbox switched!'));
                        });
                        [
                            'odDriveSlider', 'odToneSlider', 'odLevelSlider',
                            'cabPosSlider', 'cabDistSlider',
                            'delayTimeSlider', 'delayFeedbackSlider', 'delayMixSlider',
                            'reverbSizeSlider', 'reverbDampingSlider', 'reverbMixSlider',
                            'masterVolumeSlider'
                        ].forEach(id => {
                            ctx.listen(document.getElementById(id), 'input', () => ctx.completeTask('tweak_knob', 'Tone dial adjusted!'));
                        });
                        ctx.listen(document.getElementById('cabProfileSelect'), 'change', () => ctx.completeTask('tweak_knob', 'Amp cabinet swapped!'));
                    }
                },
                actions: [
                    {
                        label: '🎸 Hear Current Pedal Tone',
                        kind: 'primary',
                        onClick: (btn, tour) => tour.triggerSampleNote('a')
                    }
                ]
            },
            {
                id: 'backing-track',
                category: 'Step 9 • Jam Band',
                shortTitle: 'Rhythm Trio Backing Band',
                title: 'Jam Live with Your Own Built-In Backing Band',
                target: '#pedalBackingTrack',
                icon: '🥁',
                summary: 'A built-in drummer, bass player, and keyboardist that groove at your tempo—either on classic progressions or following your live guitar chords!',
                points: [
                    { label: 'Instant Mix & Mute', text: 'Slide Drums/Bass/Keys levels or tap D, B, K to mute any player.' }
                ],
                mission: {
                    prompt: 'Fire up the Rhythm Trio and change their groove!',
                    beacons: ['#btnBackingStomp', '#backingGrooveSelect'],
                    tasks: [
                        { id: 'toggle_band', label: 'Click the silver Rhythm Trio footswitch (or press B) to start' },
                        { id: 'change_groove', label: 'Switch Groove Style, Progression, or mute D / B / K' }
                    ],
                    setup: (ctx) => {
                        ctx.listen(document.getElementById('btnBackingStomp'), 'click', () => {
                            ctx.completeTask('toggle_band', 'Band engaged! Tap the switch again anytime to stop.');
                            setTimeout(() => ctx.tour.refreshActionButtons(), 120);
                        });
                        ctx.listen(document.getElementById('backingGrooveSelect'), 'change', () => ctx.completeTask('change_groove', 'Groove style changed!'));
                        ctx.listen(document.getElementById('backingProgressionSelect'), 'change', () => ctx.completeTask('change_groove', 'Chord progression changed!'));
                        ['btnMuteDrums', 'btnMuteBass', 'btnMuteKeys'].forEach(id => {
                            ctx.listen(document.getElementById(id), 'click', () => ctx.completeTask('change_groove', 'Band member muted/unmuted!'));
                        });
                    }
                },
                actions: [
                    {
                        label: '🥁 Start / Stop Band',
                        kind: 'secondary',
                        dynamicLabel: () => {
                            const status = document.getElementById('backingBypassStatus');
                            return (status && status.textContent.trim() === 'ACCOMPANYING')
                                ? '⏹ Stop Backing Band'
                                : '🥁 Start Backing Band';
                        },
                        onClick: (btn, tour) => {
                            const stomp = document.getElementById('btnBackingStomp');
                            if (stomp) stomp.click();
                            setTimeout(() => tour.refreshActionButtons(), 120);
                        }
                    }
                ]
            },
            {
                id: 'action-tray',
                category: 'Step 10 • Songs & Save',
                shortTitle: 'Demo Riffs, Export & Share',
                title: 'Play Iconic Demo Riffs, Export & Share',
                target: '#sectionActionTray',
                icon: '📤',
                summary: 'Load famous riffs and practice drills instantly, or export your recorded tabs to ASCII, MIDI, MusicXML (Guitar Pro / MuseScore), or a shareable link!',
                points: [
                    { label: 'Shareable Links', text: '"Copy Shareable Link" packs your whole riff into a URL you can send to anyone.' }
                ],
                mission: {
                    prompt: 'Try launching a Demo Riff or opening the Export Suite!',
                    beacons: ['#btnPlayDemo', '#btnOpenExportModal'],
                    tasks: [
                        { id: 'try_tray', label: 'Click "Play Demo", switch Demo Riffs, or open "Export Suite..."' }
                    ],
                    setup: (ctx) => {
                        ctx.listen(document.getElementById('btnPlayDemo'), 'click', () => {
                            ctx.completeTask('try_tray', 'Demo riff rolling! Watch the fretboard & tab!');
                            setTimeout(() => ctx.tour.refreshActionButtons(), 120);
                        });
                        ctx.listen(document.getElementById('selectDemoSong'), 'change', () => ctx.completeTask('try_tray', 'Demo song picked!'));
                        ctx.listen(document.getElementById('btnOpenExportModal'), 'click', () => ctx.completeTask('try_tray', 'Export Suite opened!'));
                        ctx.listen(document.getElementById('btnExportAsciiQuick'), 'click', () => ctx.completeTask('try_tray', 'ASCII Tab exported!'));
                    }
                },
                actions: [
                    {
                        label: '▶ Play Selected Demo Riff',
                        kind: 'primary',
                        dynamicLabel: () => {
                            const btnDemo = document.getElementById('btnPlayDemo');
                            return (btnDemo && btnDemo.textContent.includes('Stop'))
                                ? '⏹ Stop Demo Riff'
                                : '▶ Play a Demo Riff';
                        },
                        onClick: (btn, tour) => {
                            const btnDemo = document.getElementById('btnPlayDemo');
                            if (btnDemo) btnDemo.click();
                            setTimeout(() => tour.refreshActionButtons(), 120);
                        }
                    }
                ]
            },
            {
                id: 'shortcuts',
                category: 'Finale • Jam Pad',
                shortTitle: 'Interactive Jam & Shortcuts',
                title: 'Final Challenge: Jam on Your Keyboard!',
                target: '#sectionKeyboardGuide',
                icon: '⌨️',
                summary: 'Even without a guitar handy, your keyboard is a playable instrument and studio remote (Space = Pause, P = Play Back, Q = Quantize, B = Band).',
                showKeyJamPad: true,
                points: [
                    { label: 'Replay Anytime', text: 'Click "Take a Tour" in the top-right header whenever you want a quick refresher.' }
                ],
                mission: {
                    prompt: 'Play 4 notes right now using keys A–K (or click the keys below)!',
                    beacons: ['#sectionKeyboardGuide'],
                    tasks: [
                        { id: 'jam_4', label: 'Play 4 notes on the mini keyboard jam pad', targetCount: 4 }
                    ],
                    setup: (ctx) => {
                        ctx.listen(window, 'keydown', (e) => {
                            if (ctx.isTyping(e)) return;
                            const k = (e.key || '').toLowerCase();
                            if ('123456asdfghjk'.includes(k)) {
                                ctx.tour.flashJamKey(k);
                                ctx.incrementTask('jam_4', 4, 'notes jammed');
                            }
                        });
                    }
                }
            }
        ];
    }

    createDOM() {
        this.backdropEl = document.createElement('div');
        this.backdropEl.className = 'tour-backdrop-full';
        this.backdropEl.setAttribute('aria-hidden', 'true');

        this.spotlightEl = document.createElement('div');
        this.spotlightEl.className = 'tour-spotlight';
        this.spotlightEl.setAttribute('aria-hidden', 'true');

        this.cardEl = document.createElement('div');
        this.cardEl.className = 'tour-card';
        this.cardEl.setAttribute('role', 'dialog');
        this.cardEl.setAttribute('aria-label', 'FretDSP Interactive Guided Tour');
        this.cardEl.innerHTML = `
            <div class="tour-progress-track">
                <div class="tour-progress-fill" id="tourProgressFill"></div>
            </div>

            <div class="tour-card-topbar">
                <div class="tour-meta-left">
                    <span class="tour-category-pill" id="tourCategoryPill">Welcome</span>
                    <span class="tour-step-counter" id="tourStepCounter">1 / 12</span>
                    <span class="tour-score-pill" id="tourScorePill" title="Hands-on challenges completed">⭐ 0/${this.totalMissions}</span>
                </div>
                <div class="tour-meta-right">
                    <button type="button" class="tour-topics-btn" id="tourTopicsBtn" title="Jump to any feature">
                        <span>☰ Topics</span>
                    </button>
                    <button type="button" class="tour-close-btn" id="tourCloseBtn" title="Close tour (Esc)" aria-label="Close tour">✕</button>
                </div>
            </div>

            <div class="tour-topics-menu" id="tourTopicsMenu" hidden></div>

            <div class="tour-card-body">
                <div class="tour-heading-row">
                    <span class="tour-step-icon" id="tourStepIcon">🎸</span>
                    <h2 class="tour-step-title" id="tourStepTitle"></h2>
                </div>
                <p class="tour-step-summary" id="tourStepSummary"></p>

                <!-- Welcome Mode Picker -->
                <div class="tour-mode-picker" id="tourModePicker" hidden>
                    <button type="button" class="tour-mode-card active" data-mode="mouse">
                        <span class="tour-mode-emoji">💻</span>
                        <strong>Mouse &amp; Keyboard</strong>
                        <span>Click frets &amp; try built-in sounds right away</span>
                    </button>
                    <button type="button" class="tour-mode-card" data-mode="guitar">
                        <span class="tour-mode-emoji">🎸</span>
                        <strong>Real Guitar + Mic</strong>
                        <span>Play live through your mic or audio interface</span>
                    </button>
                </div>

                <!-- Interactive Hands-On Mission Box -->
                <div class="tour-mission-box" id="tourMissionBox" hidden>
                    <div class="tour-mission-header">
                        <span class="tour-mission-badge" id="tourMissionBadge">🎯 YOUR TURN</span>
                        <span class="tour-mission-prompt" id="tourMissionPrompt"></span>
                    </div>
                    <ul class="tour-mission-checklist" id="tourMissionChecklist"></ul>
                    <div class="tour-mission-feedback" id="tourMissionFeedback" hidden></div>
                </div>

                <!-- Interactive Keyboard Jam Pad (Finale Step) -->
                <div class="tour-jam-pad" id="tourJamPad" hidden>
                    <div class="tour-jam-keys" id="tourJamKeys"></div>
                    <div class="tour-finale-summary" id="tourFinaleSummary"></div>
                </div>

                <ul class="tour-points-list" id="tourPointsList"></ul>
                <div class="tour-actions-row" id="tourActionsRow" hidden></div>
                <div class="tour-tip-box" id="tourTipBox" hidden></div>
            </div>

            <div class="tour-card-footer">
                <div class="tour-dots-wrap" id="tourDotsWrap" aria-label="Tour progress"></div>
                <div class="tour-nav-buttons">
                    <button type="button" class="tour-btn tour-btn-ghost" id="tourBtnSkip">Skip</button>
                    <button type="button" class="tour-btn tour-btn-secondary" id="tourBtnPrev">← Back</button>
                    <button type="button" class="tour-btn tour-btn-primary" id="tourBtnNext">Next →</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.backdropEl);
        document.body.appendChild(this.spotlightEl);
        document.body.appendChild(this.cardEl);

        // Cache DOM refs
        this.progressFill = this.cardEl.querySelector('#tourProgressFill');
        this.categoryPill = this.cardEl.querySelector('#tourCategoryPill');
        this.stepCounter = this.cardEl.querySelector('#tourStepCounter');
        this.scorePill = this.cardEl.querySelector('#tourScorePill');
        this.topicsBtn = this.cardEl.querySelector('#tourTopicsBtn');
        this.topicsMenu = this.cardEl.querySelector('#tourTopicsMenu');
        this.closeBtn = this.cardEl.querySelector('#tourCloseBtn');
        this.stepIcon = this.cardEl.querySelector('#tourStepIcon');
        this.stepTitle = this.cardEl.querySelector('#tourStepTitle');
        this.stepSummary = this.cardEl.querySelector('#tourStepSummary');
        this.modePicker = this.cardEl.querySelector('#tourModePicker');
        this.missionBox = this.cardEl.querySelector('#tourMissionBox');
        this.missionBadge = this.cardEl.querySelector('#tourMissionBadge');
        this.missionPrompt = this.cardEl.querySelector('#tourMissionPrompt');
        this.missionChecklist = this.cardEl.querySelector('#tourMissionChecklist');
        this.missionFeedback = this.cardEl.querySelector('#tourMissionFeedback');
        this.jamPad = this.cardEl.querySelector('#tourJamPad');
        this.jamKeysWrap = this.cardEl.querySelector('#tourJamKeys');
        this.finaleSummary = this.cardEl.querySelector('#tourFinaleSummary');
        this.pointsList = this.cardEl.querySelector('#tourPointsList');
        this.actionsRow = this.cardEl.querySelector('#tourActionsRow');
        this.tipBox = this.cardEl.querySelector('#tourTipBox');
        this.dotsWrap = this.cardEl.querySelector('#tourDotsWrap');
        this.btnSkip = this.cardEl.querySelector('#tourBtnSkip');
        this.btnPrev = this.cardEl.querySelector('#tourBtnPrev');
        this.btnNext = this.cardEl.querySelector('#tourBtnNext');

        this.buildTopicsMenu();
        this.buildProgressDots();
        this.buildJamPadKeys();
    }

    buildTopicsMenu() {
        this.topicsMenu.innerHTML = '';
        this.steps.forEach((step, idx) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'tour-topic-item';
            item.dataset.stepIndex = idx;
            item.dataset.stepId = step.id;
            item.innerHTML = `
                <span class="tour-topic-num">${idx + 1}</span>
                <span class="tour-topic-icon">${step.icon}</span>
                <span class="tour-topic-name">${step.shortTitle}</span>
                <span class="tour-topic-check" aria-hidden="true"></span>
            `;
            item.addEventListener('click', () => {
                this.toggleTopics(false);
                this.goTo(idx);
            });
            this.topicsMenu.appendChild(item);
        });
    }

    buildProgressDots() {
        this.dotsWrap.innerHTML = '';
        this.steps.forEach((step, idx) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'tour-dot';
            dot.title = `${idx + 1}. ${step.shortTitle}`;
            dot.setAttribute('aria-label', `Go to step ${idx + 1}: ${step.shortTitle}`);
            dot.addEventListener('click', () => this.goTo(idx));
            this.dotsWrap.appendChild(dot);
        });
    }

    buildJamPadKeys() {
        const keys = [
            { key: 'a', note: 'A2' },
            { key: 's', note: 'C3' },
            { key: 'd', note: 'D3' },
            { key: 'f', note: 'E3' },
            { key: 'g', note: 'G3' },
            { key: 'h', note: 'A3' },
            { key: 'j', note: 'C4' },
            { key: 'k', note: 'D4' }
        ];
        this.jamKeysWrap.innerHTML = '';
        keys.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tour-jam-key';
            btn.dataset.key = item.key;
            btn.innerHTML = `<kbd>${item.key.toUpperCase()}</kbd><span>${item.note}</span>`;
            btn.addEventListener('click', () => {
                this.triggerSampleNote(item.key);
            });
            this.jamKeysWrap.appendChild(btn);
        });
    }

    flashJamKey(k) {
        const el = this.jamKeysWrap.querySelector(`.tour-jam-key[data-key="${k}"]`);
        if (!el) return;
        el.classList.add('pressed');
        setTimeout(() => el.classList.remove('pressed'), 260);
    }

    bindEvents() {
        const launchBtn = document.getElementById('btnStartTour');
        if (launchBtn) {
            launchBtn.addEventListener('click', () => this.start(0));
        }

        this.closeBtn.addEventListener('click', () => this.close());
        this.btnSkip.addEventListener('click', () => this.close());
        this.btnPrev.addEventListener('click', () => this.prev());
        this.btnNext.addEventListener('click', () => this.next());

        this.topicsBtn.addEventListener('click', () => {
            this.toggleTopics(!this.isTopicsOpen);
        });

        this.backdropEl.addEventListener('click', () => this.close());

        // Welcome mode cards
        this.modePicker.querySelectorAll('.tour-mode-card').forEach(btn => {
            btn.addEventListener('click', () => {
                this.userMode = btn.dataset.mode || 'mouse';
                this.modePicker.querySelectorAll('.tour-mode-card').forEach(b => {
                    b.classList.toggle('active', b === btn);
                });
            });
        });

        window.addEventListener('keydown', (e) => {
            if (!this.isOpen) return;
            if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT')) {
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this.close();
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.next();
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.prev();
            }
        });

        const scheduleReposition = () => {
            if (!this.isOpen) return;
            if (this.rafId) cancelAnimationFrame(this.rafId);
            this.rafId = requestAnimationFrame(() => this.positionCurrentStep(false));
        };
        window.addEventListener('scroll', scheduleReposition, { passive: true });
        window.addEventListener('resize', scheduleReposition, { passive: true });
    }

    toggleTopics(show) {
        this.isTopicsOpen = show;
        this.topicsMenu.hidden = !show;
        this.topicsBtn.classList.toggle('active', show);
    }

    start(stepIndex = 0) {
        this.isOpen = true;
        this.toggleTopics(false);
        this.cardEl.classList.add('open');
        this.goTo(stepIndex);
    }

    close() {
        this.isOpen = false;
        this.toggleTopics(false);
        this.cleanupStepInteractions();
        this.clearDemoTimers();
        this.cardEl.classList.remove('open', 'tour-card-centered');
        this.backdropEl.classList.remove('open');
        this.spotlightEl.classList.remove('open');
        this.markSeen();
    }

    markSeen() {
        try {
            localStorage.setItem(this.storageKey, 'true');
        } catch (err) {
            // Ignore storage restrictions
        }
    }

    hasBeenSeen() {
        try {
            return localStorage.getItem(this.storageKey) === 'true';
        } catch (err) {
            return false;
        }
    }

    next() {
        if (this.currentIndex < this.steps.length - 1) {
            this.goTo(this.currentIndex + 1);
        } else {
            this.close();
        }
    }

    prev() {
        if (this.currentIndex > 0) {
            this.goTo(this.currentIndex - 1);
        }
    }

    goTo(index) {
        if (index < 0 || index >= this.steps.length) return;
        this.cleanupStepInteractions();
        this.currentIndex = index;
        this.toggleTopics(false);
        this.renderStepContent();
        this.attachStepInteractions();
        this.positionCurrentStep(true);
    }

    getStepState(stepId) {
        if (!this.stepState[stepId]) {
            this.stepState[stepId] = { tasks: {}, counts: {}, feedback: '' };
        }
        return this.stepState[stepId];
    }

    cleanupStepInteractions() {
        this.activeCleanups.forEach(fn => {
            try { fn(); } catch (e) {}
        });
        this.activeCleanups = [];

        this.activeBeacons.forEach(el => {
            if (el && el.classList) el.classList.remove('tour-beacon-target');
        });
        this.activeBeacons = [];
    }

    attachStepInteractions() {
        const step = this.steps[this.currentIndex];
        if (!step || !step.mission) return;

        // Add subtle pulsing beacons on target controls
        if (Array.isArray(step.mission.beacons)) {
            step.mission.beacons.forEach(sel => {
                const el = document.querySelector(sel);
                if (el) {
                    el.classList.add('tour-beacon-target');
                    this.activeBeacons.push(el);
                }
            });
        }

        const ctx = {
            tour: this,
            isTyping: (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT'),
            listen: (el, eventName, handler) => {
                if (!el || typeof el.addEventListener !== 'function') return;
                el.addEventListener(eventName, handler);
                this.activeCleanups.push(() => el.removeEventListener(eventName, handler));
            },
            completeTask: (taskId, feedbackMsg) => {
                this.completeTaskForStep(step.id, taskId, feedbackMsg);
            },
            incrementTask: (taskId, targetCount, unitLabel) => {
                this.incrementTaskForStep(step.id, taskId, targetCount, unitLabel);
            }
        };

        if (typeof step.mission.setup === 'function') {
            step.mission.setup(ctx);
        }
    }

    completeCurrentTask(taskId, feedbackMsg) {
        const step = this.steps[this.currentIndex];
        if (step && step.mission) {
            this.completeTaskForStep(step.id, taskId, feedbackMsg);
        }
    }

    incrementTaskForStep(stepId, taskId, targetCount, unitLabel = 'done') {
        const state = this.getStepState(stepId);
        const current = (state.counts[taskId] || 0) + 1;
        state.counts[taskId] = Math.min(targetCount, current);

        if (state.counts[taskId] >= targetCount) {
            this.completeTaskForStep(stepId, taskId, `Awesome! ${targetCount}/${targetCount} ${unitLabel}!`);
        } else {
            state.feedback = `Nice! ${state.counts[taskId]} / ${targetCount} ${unitLabel} — keep going!`;
            if (this.steps[this.currentIndex]?.id === stepId) {
                this.renderMissionUI();
            }
        }
    }

    completeTaskForStep(stepId, taskId, feedbackMsg = '') {
        const step = this.steps.find(s => s.id === stepId);
        if (!step || !step.mission) return;

        const state = this.getStepState(stepId);
        state.tasks[taskId] = true;
        if (feedbackMsg) state.feedback = feedbackMsg;

        // Check if every task in this step's mission is done
        const allDone = step.mission.tasks.every(t => !!state.tasks[t.id]);
        if (allDone && !this.completedMissions.has(stepId)) {
            this.completedMissions.add(stepId);
            this.updateScoreUI(true);
        } else {
            this.updateScoreUI(false);
        }

        if (this.steps[this.currentIndex]?.id === stepId) {
            this.renderMissionUI();
            if (step.showKeyJamPad) {
                this.renderFinaleSummary();
            }
        }
    }

    updateScoreUI(pop = false) {
        const done = this.completedMissions.size;
        this.scorePill.textContent = `⭐ ${done}/${this.totalMissions}`;
        this.scorePill.classList.toggle('has-score', done > 0);
        if (pop) {
            this.scorePill.classList.remove('score-pop');
            void this.scorePill.offsetWidth;
            this.scorePill.classList.add('score-pop');
        }

        // Update topics menu checkmarks
        this.topicsMenu.querySelectorAll('.tour-topic-item').forEach(item => {
            const id = item.dataset.stepId;
            const checkEl = item.querySelector('.tour-topic-check');
            if (checkEl) {
                checkEl.textContent = this.completedMissions.has(id) ? '✓' : '';
            }
            item.classList.toggle('mission-done', this.completedMissions.has(id));
        });
    }

    renderStepContent() {
        const step = this.steps[this.currentIndex];
        const total = this.steps.length;
        const pct = ((this.currentIndex + 1) / total) * 100;

        this.progressFill.style.width = `${pct}%`;
        this.categoryPill.textContent = step.category;
        this.stepCounter.textContent = `${this.currentIndex + 1} / ${total}`;
        this.stepIcon.textContent = step.icon;
        this.stepTitle.textContent = step.title;
        this.stepSummary.textContent = step.summary;

        // Mode picker (Welcome only)
        this.modePicker.hidden = !step.showModePicker;

        // Interactive Mission Box
        this.renderMissionUI();

        // Interactive Finale Jam Pad
        this.jamPad.hidden = !step.showKeyJamPad;
        if (step.showKeyJamPad) {
            this.renderFinaleSummary();
        }

        // Bullet points
        this.pointsList.innerHTML = '';
        (step.points || []).forEach((pt) => {
            const li = document.createElement('li');
            li.innerHTML = `<strong class="tour-point-label">${pt.label}:</strong> <span>${pt.text}</span>`;
            this.pointsList.appendChild(li);
        });

        // Action buttons
        this.actionsRow.innerHTML = '';
        if (Array.isArray(step.actions) && step.actions.length > 0) {
            this.actionsRow.hidden = false;
            step.actions.forEach((act, actIdx) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = `tour-try-btn ${act.kind === 'secondary' ? 'tour-try-secondary' : 'tour-try-primary'}`;
                btn.dataset.actionIndex = actIdx;
                btn.textContent = typeof act.dynamicLabel === 'function' ? act.dynamicLabel() : act.label;
                btn.addEventListener('click', () => act.onClick(btn, this));
                this.actionsRow.appendChild(btn);
            });
        } else {
            this.actionsRow.hidden = true;
        }

        // Tip (supports mode-aware dynamicTip or static tip)
        const resolvedTip = typeof step.dynamicTip === 'function' ? step.dynamicTip(this.userMode) : step.tip;
        if (resolvedTip) {
            this.tipBox.hidden = false;
            this.tipBox.textContent = resolvedTip;
        } else {
            this.tipBox.hidden = true;
        }

        // Progress dots & Topics menu active state
        this.dotsWrap.querySelectorAll('.tour-dot').forEach((dot, idx) => {
            const s = this.steps[idx];
            dot.classList.toggle('active', idx === this.currentIndex);
            dot.classList.toggle('completed', idx < this.currentIndex || this.completedMissions.has(s.id));
        });
        this.topicsMenu.querySelectorAll('.tour-topic-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === this.currentIndex);
        });

        // Navigation buttons
        const isFirst = this.currentIndex === 0;
        const isLast = this.currentIndex === total - 1;

        this.btnPrev.style.display = isFirst ? 'none' : 'inline-flex';
        this.btnSkip.textContent = isFirst ? 'Maybe Later' : 'Skip Tour';
        this.btnSkip.style.display = isLast ? 'none' : 'inline-flex';

        if (isFirst) {
            this.btnNext.textContent = 'Start Interactive Tour →';
        } else if (isLast) {
            this.btnNext.textContent = 'Finish & Start Jamming ✓';
        } else {
            this.btnNext.textContent = 'Next →';
        }
    }

    renderMissionUI() {
        const step = this.steps[this.currentIndex];
        if (!step || !step.mission) {
            this.missionBox.hidden = true;
            return;
        }

        this.missionBox.hidden = false;
        const state = this.getStepState(step.id);
        const allDone = step.mission.tasks.every(t => !!state.tasks[t.id]);

        this.missionBox.classList.toggle('mission-completed', allDone);
        this.missionBadge.textContent = allDone ? '✓ COMPLETED' : '🎯 YOUR TURN';
        this.missionPrompt.textContent = step.mission.prompt;

        this.missionChecklist.innerHTML = '';
        step.mission.tasks.forEach(task => {
            const isDone = !!state.tasks[task.id];
            const li = document.createElement('li');
            li.className = `tour-task-item${isDone ? ' done' : ''}`;
            const countSuffix = (!isDone && task.targetCount)
                ? ` <span class="tour-task-count">(${state.counts[task.id] || 0}/${task.targetCount})</span>`
                : '';
            li.innerHTML = `
                <span class="tour-task-check">${isDone ? '✓' : '○'}</span>
                <span class="tour-task-text">${task.label}${countSuffix}</span>
            `;
            this.missionChecklist.appendChild(li);
        });

        if (state.feedback) {
            this.missionFeedback.hidden = false;
            this.missionFeedback.textContent = state.feedback;
        } else {
            this.missionFeedback.hidden = true;
        }
    }

    renderFinaleSummary() {
        const done = this.completedMissions.size;
        const msg = done >= this.totalMissions
            ? `🏆 Tour Master! You completed all ${done}/${this.totalMissions} hands-on challenges!`
            : done > 0
                ? `🎉 Awesome job! You completed ${done} of ${this.totalMissions} hands-on challenges.`
                : `🎸 You’ve toured every feature—press any glowing key above to jam!`;
        this.finaleSummary.textContent = msg;
    }

    refreshActionButtons() {
        const step = this.steps[this.currentIndex];
        if (!step || !step.actions) return;
        this.actionsRow.querySelectorAll('.tour-try-btn').forEach((btn, idx) => {
            const act = step.actions[idx];
            if (act && typeof act.dynamicLabel === 'function') {
                btn.textContent = act.dynamicLabel();
            }
        });
    }

    positionCurrentStep(shouldScroll = false) {
        const step = this.steps[this.currentIndex];
        const targetEl = step.target ? document.querySelector(step.target) : null;

        if (!targetEl) {
            this.spotlightEl.classList.remove('open');
            this.backdropEl.classList.add('open');
            this.cardEl.classList.add('tour-card-centered');
            this.cardEl.style.top = '';
            this.cardEl.style.left = '';
            this.cardEl.style.right = '';
            this.cardEl.style.bottom = '';
            return;
        }

        this.backdropEl.classList.remove('open');
        this.cardEl.classList.remove('tour-card-centered');

        if (shouldScroll) {
            const initialRect = targetEl.getBoundingClientRect();
            const vh = window.innerHeight;
            const targetTopDoc = initialRect.top + window.scrollY;
            const desiredTop = initialRect.height > vh * 0.65
                ? Math.max(0, targetTopDoc - 24)
                : Math.max(0, targetTopDoc - Math.max(24, (vh - initialRect.height) * 0.25));

            window.scrollTo({
                top: desiredTop,
                behavior: 'smooth'
            });

            setTimeout(() => {
                if (this.isOpen) this.positionCurrentStep(false);
            }, 380);
        }

        const rect = targetEl.getBoundingClientRect();
        const pad = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        const spotTop = Math.max(-20, rect.top - pad);
        const spotLeft = Math.max(4, rect.left - pad);
        const spotWidth = Math.min(vw - 8, rect.width + pad * 2);
        const spotHeight = Math.max(40, rect.height + pad * 2);

        this.spotlightEl.style.top = `${spotTop}px`;
        this.spotlightEl.style.left = `${spotLeft}px`;
        this.spotlightEl.style.width = `${spotWidth}px`;
        this.spotlightEl.style.height = `${spotHeight}px`;
        this.spotlightEl.classList.add('open');

        const cardWidth = Math.min(490, vw - 24);
        this.cardEl.style.width = `${cardWidth}px`;
        const cardRect = this.cardEl.getBoundingClientRect();
        const cardHeight = cardRect.height || 360;
        const margin = 16;

        const spaceBelow = vh - (rect.bottom + pad);
        const spaceAbove = (rect.top - pad);

        let top;
        let left;

        const idealLeft = rect.left + (rect.width / 2) - (cardWidth / 2);
        left = Math.max(margin, Math.min(vw - cardWidth - margin, idealLeft));

        if (spaceBelow >= cardHeight + margin) {
            top = rect.bottom + pad + 14;
        } else if (spaceAbove >= cardHeight + margin) {
            top = rect.top - pad - cardHeight - 14;
        } else {
            top = Math.max(margin, vh - cardHeight - margin);
            left = Math.max(margin, vw - cardWidth - margin);
        }

        top = Math.max(margin, Math.min(vh - cardHeight - margin, top));

        this.cardEl.style.top = `${Math.round(top)}px`;
        this.cardEl.style.left = `${Math.round(left)}px`;
        this.cardEl.style.right = 'auto';
        this.cardEl.style.bottom = 'auto';
    }

    triggerSampleNote(key = 'a') {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }

    playSampleFretboardArpeggio(btn, onDone) {
        this.clearDemoTimers();
        const keys = ['a', 'd', 'g', 'j', 'k', 'j', 'g', 'a'];
        const originalText = btn ? btn.textContent : '';
        if (btn) {
            btn.disabled = true;
            btn.textContent = '🎵 Playing sample phrase...';
        }

        keys.forEach((k, idx) => {
            const t = setTimeout(() => {
                this.triggerSampleNote(k);
                if (idx === keys.length - 1) {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText;
                    }
                    if (typeof onDone === 'function') onDone();
                }
            }, idx * 200);
            this.demoPluckTimers.push(t);
        });
    }

    clearDemoTimers() {
        this.demoPluckTimers.forEach(t => clearTimeout(t));
        this.demoPluckTimers = [];
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const tutorial = new FretDSPTutorial();
    window.fretDSPTutorial = tutorial;

    if (!tutorial.hasBeenSeen() && !window.location.hash.startsWith('#riff=')) {
        setTimeout(() => {
            if (!tutorial.isOpen) {
                tutorial.start(0);
            }
        }, 550);
    }
});
