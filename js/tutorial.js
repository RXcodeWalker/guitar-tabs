/**
 * FretDSP Interactive Guided Tour & Plain-English Tutorial
 * Walks users step-by-step through every panel of the app in simple,
 * jargon-free language with live spotlight highlighting and "Try It" demos.
 */

class FretDSPTutorial {
    constructor(options = {}) {
        this.storageKey = options.storageKey || 'fretdsp_tour_seen_v1';
        this.currentIndex = 0;
        this.isOpen = false;
        this.isTopicsOpen = false;
        this.rafId = null;
        this.demoPluckTimers = [];

        this.steps = this.buildSteps();
        this.createDOM();
        this.bindEvents();
    }

    buildSteps() {
        return [
            {
                id: 'welcome',
                category: 'Welcome',
                shortTitle: 'Welcome to FretDSP',
                title: 'Welcome to Your All-in-One Guitar Studio',
                target: null, // Centered modal card
                icon: '🎸',
                summary: 'FretDSP turns your browser into a smart guitar workspace. Play a real guitar into your microphone—or just click the screen—to write tabs, tune up, shape your tone, and jam with a backing band.',
                points: [
                    { label: 'Two ways to play', text: 'Plug in a guitar/mic, OR try everything right now with your mouse and computer keyboard.' },
                    { label: 'Zero jargon', text: 'This quick 2-minute tour explains each panel in plain English—and lets you test features live along the way.' },
                    { label: 'Go at your own pace', text: 'Use Next / Back, arrow keys (← →), or jump to any topic using the Topics menu above.' }
                ],
                tip: 'Tip: You can replay this tour anytime by clicking "Take a Tour" in the top-right corner.'
            },
            {
                id: 'audio-setup',
                category: 'Step 1 • Setup',
                shortTitle: 'Mic & Volume Meter',
                title: 'Pick Your Mic & Check Your Volume',
                target: '.app-header',
                icon: '🎙️',
                summary: 'Before playing a real guitar, this top bar helps you pick the right input and make sure your volume is in the sweet spot.',
                points: [
                    { label: 'Audio Input Source', text: 'Choose your laptop mic, USB microphone, or guitar audio interface from the dropdown.' },
                    { label: 'Input Gain Meter', text: 'Watch the green-to-yellow bar move as you play. Aim for healthy green/yellow levels.' },
                    { label: 'CLIP Warning Light', text: 'If the red CLIP light flashes, your signal is too loud and distorting—turn your guitar or mic volume down slightly.' }
                ],
                tip: 'No mic plugged in? No problem—keep going! Almost every feature works with clicks and built-in sounds.'
            },
            {
                id: 'master-controls',
                category: 'Step 2 • Core Controls',
                shortTitle: 'Listen, Beat & Quick Tuner',
                title: 'Start Listening, Keep Time & Quick Tune',
                target: '.master-control-bar',
                icon: '⏱️',
                summary: 'This strip is your main dashboard for listening to your guitar, setting the beat, cleaning up your timing, and checking notes on the fly.',
                points: [
                    { label: 'Start Listening', text: 'Press this big footswitch to turn your microphone on so FretDSP hears what you play.' },
                    { label: 'Metronome & Tap', text: 'Set your speed (BPM) with the slider or tap the "Tap" button to match a song in your head. Toggle "Click ON" for an audible beat.' },
                    { label: 'Quantize', text: 'Automatically tidies up slightly early or late notes onto a neat rhythm grid (like 1/8 or 1/16 notes) so your tab looks clean.' },
                    { label: 'Mini Pedal Tuner', text: 'Shows the exact note you just played. Green in the middle means in tune; left is flat (too low), right is sharp (too high).' }
                ]
            },
            {
                id: 'fretboard',
                category: 'Step 3 • Play & Solo',
                shortTitle: 'Interactive Fretboard & Scales',
                title: 'Light-Up Fretboard & Live Scale Helper',
                target: '#sectionFretboard',
                icon: '✨',
                summary: 'Watch every note you play light up across all 22 frets—or click directly on any fret to hear it and write it into your tab!',
                points: [
                    { label: 'Tuning & Register', text: 'Switch between Standard, Drop D, DADGAD, and more. "Register" tells the app which part of the neck you prefer to play in.' },
                    { label: 'Gate Slider', text: 'Ignores quiet room background noise so only real guitar plucks trigger notes.' },
                    { label: 'Live Chord & Scale Ribbon', text: 'Strum a chord (or pick a Preset) and the fretboard highlights matching solo notes: Blue = core chord tones, Green = smooth passing notes, Red = clashing notes (hidden by default).' }
                ],
                actions: [
                    {
                        label: '🎸 Pluck a Sample Riff on the Neck',
                        kind: 'primary',
                        onClick: (btn, tour) => tour.playSampleFretboardArpeggio(btn)
                    }
                ],
                tip: 'Try clicking directly on the guitar neck right now—it stays interactive during the tour!'
            },
            {
                id: 'tablature',
                category: 'Step 4 • Auto Tabs',
                shortTitle: 'Scrolling Tab & Playback',
                title: 'Automatic Guitar Tab & Instant Playback',
                target: '#sectionTablature',
                icon: '🎼',
                summary: 'Every note you play on your guitar—or click on the fretboard—gets written automatically onto this 6-string scrolling guitar tab.',
                points: [
                    { label: 'Play Back & Loop', text: 'Hit "Play Back" to hear your written tab played out loud, or turn on "Loop" to repeat it endlessly.' },
                    { label: 'Pause, Rewind & Clear', text: 'Freeze the scrolling line anytime, jump back to Measure 1, or wipe the sheet clean to start fresh.' },
                    { label: 'Synth Engine & Zoom', text: 'Switch between a realistic plucked string sound (Karplus-Strong) or a clean synth, and slide "Staff Zoom" to spread notes out or pack them closer.' }
                ]
            },
            {
                id: 'practice-mode',
                category: 'Step 5 • Practice Coach',
                shortTitle: 'Practice Mode & Speed Trainer',
                title: 'Master Tough Riffs with A-B Loops & Speed Trainer',
                target: '#practiceTrainerBar',
                icon: '🎯',
                summary: 'Built right into the tab dock is a personal practice coach that helps you nail tricky sections cleanly before playing them fast.',
                points: [
                    { label: 'Practice Mode', text: 'Turn this ON while playing along to get live Accuracy %, Streak counts, and instant timing feedback.' },
                    { label: 'A-B Loop', text: 'Pick a Start Bar and End Bar (like Bar 1 to Bar 2) and click "Set Loop" to repeat just the tricky part.' },
                    { label: 'Speed Trainer', text: 'Start slow! After every 1, 2, or 4 loops you finish, FretDSP automatically bumps your speed up (+3, +5, or +10 BPM) until you reach full tempo.' }
                ]
            },
            {
                id: 'spectral',
                category: 'Step 6 • Sound X-Ray',
                shortTitle: 'Sound Heat-Map Visualizer',
                title: 'See Inside Your Sound (Heat-Map)',
                target: '#sectionSpectral',
                icon: '🌈',
                summary: 'This live colorful chart is like an X-ray of your guitar’s tone, moving smoothly in real time as you play.',
                points: [
                    { label: 'Main Note (f₀)', text: 'The bright cyan peak shows the main pitch of the note you played.' },
                    { label: 'Overtones (2f₀, 3f₀)', text: 'Every guitar string rings with extra harmonic layers above the main note—that’s what gives your guitar warmth and sparkle.' },
                    { label: 'Why it helps', text: 'Great for watching how long your notes sustain, spotting unwanted fret buzz, or seeing how effects change your tone.' }
                ]
            },
            {
                id: 'strobe-tuner',
                category: 'Step 7 • Precision Tuning',
                shortTitle: 'Strobe Tuner & String Health',
                title: 'Studio Strobe Tuner & Old-String Detector',
                target: '#sectionStrobe',
                icon: '🎯',
                summary: 'Need ultra-accurate tuning or wondering if it’s time to change your guitar strings? This precision analyzer handles both.',
                points: [
                    { label: 'Reading the Spinning Rings', text: 'Spinning clockwise = sharp (too high). Spinning counter-clockwise = flat (too low). When the ring freezes still, you are dead-on in tune!' },
                    { label: 'String Wear Gauge', text: 'Old, worn-out strings lose flexibility and their overtones go slightly out of tune. This meter rates your string from Fresh (green) to Worn (red).' },
                    { label: 'No Mic? Test It Below', text: 'Use the built-in simulator buttons to compare how a brand-new string vs. an old worn string looks and sounds.' }
                ],
                actions: [
                    {
                        label: '🟢 Simulate Fresh String',
                        kind: 'secondary',
                        onClick: () => {
                            const btn = document.getElementById('btnPluckFresh');
                            if (btn) btn.click();
                        }
                    },
                    {
                        label: '🔴 Simulate Worn String',
                        kind: 'primary',
                        onClick: () => {
                            const btn = document.getElementById('btnPluckWorn');
                            if (btn) btn.click();
                        }
                    }
                ]
            },
            {
                id: 'effects-rack',
                category: 'Step 8 • Tone & Pedals',
                shortTitle: 'Guitar Effects Pedalboard',
                title: 'Shape Your Guitar Tone with Stompbox Pedals',
                target: '#sectionEffectsRack',
                icon: '🎛️',
                summary: 'Sculpt your sound with a built-in pedalboard—without messing up pitch detection! Click any round silver footswitch at the bottom of a pedal to turn it ON or OFF.',
                points: [
                    { label: 'Tube Screamer & Cabinet Sim', text: 'Add warm rock overdrive crunch, then run it through realistic amp speaker cabinets (like a classic 4x12 rock stack or 1x12 tweed amp).' },
                    { label: 'Analog Delay & Ambient Reverb', text: 'Add rhythmic echoes and lush room/hall space to make solos sound huge.' },
                    { label: 'Master Output Bay', text: 'Control overall volume, send built-in playback through your pedals ("Synth to FX"), or enable "Speaker Monitor" to hear your live mic (wear headphones so it doesn’t feedback!).' }
                ]
            },
            {
                id: 'backing-track',
                category: 'Step 9 • Jam Band',
                shortTitle: 'Rhythm Trio Backing Band',
                title: 'Jam Live with Your Own Built-In Backing Band',
                target: '#pedalBackingTrack',
                icon: '🥁',
                summary: 'Practice soloing or songwriting anytime with a built-in drummer, bass player, and keyboardist that locks right to your tempo.',
                points: [
                    { label: 'Pick a Progression—or Let Them Follow You', text: 'Choose 12-Bar Blues, Pop, or Jazz progressions—OR choose "Follow Live Guitar Chords" so the band reacts to whatever chords you strum!' },
                    { label: 'Switch the Groove', text: 'Change the feel between Rock 8ths, Blues Shuffle, Funk 16ths, or Jazz Walking Bass.' },
                    { label: 'Instant Mini Mixer', text: 'Adjust Drums, Bass, and Keys volumes separately, or tap D / B / K to mute any player.' }
                ],
                actions: [
                    {
                        label: '🥁 Toggle Backing Band Preview',
                        kind: 'primary',
                        dynamicLabel: () => {
                            const status = document.getElementById('backingBypassStatus');
                            return (status && status.textContent.trim() === 'ACCOMPANYING')
                                ? '⏹ Stop Backing Band'
                                : '🥁 Preview Backing Band';
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
                title: 'Try Famous Demo Riffs, Export & Share',
                target: '#sectionActionTray',
                icon: '📤',
                summary: 'Want instant inspiration—or ready to save a riff you just recorded? Everything for demo playback and sharing lives in this dock.',
                points: [
                    { label: 'Demo Riffs & Drills', text: 'Pick an iconic riff (like Sweet Child O’ Mine or Smoke On The Water) or a practice exercise and hit "Play Demo" to see the whole studio come alive.' },
                    { label: 'Export Anywhere', text: 'Copy clean text ASCII Tabs, download a MIDI file (.mid) for GarageBand/Ableton/Logic, or open "Export Suite" for MusicXML (Guitar Pro & MuseScore) and JSON.' },
                    { label: 'Copy Shareable Link', text: 'Packs your entire recorded riff right into a web link you can send to a bandmate or friend!' }
                ],
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
                category: 'Finish • Pro Tips',
                shortTitle: 'Keyboard Shortcuts & Jam!',
                title: 'Play Faster with Quick Keyboard Shortcuts',
                target: '#sectionKeyboardGuide',
                icon: '⌨️',
                summary: 'You’ve seen the whole studio! Even without a guitar in your hands, your computer keyboard doubles as a handy instrument and remote control.',
                points: [
                    { label: 'Play Notes Instantly', text: 'Press keys 1–6 to pluck open strings, or A S D F G H J K to jam a rock pentatonic scale.' },
                    { label: 'Control Playback Hands-Free', text: 'Space pauses scrolling, P plays back your tab, L toggles Loop, R rewinds, Q tidies up timing, and B toggles the Backing Band.' },
                    { label: 'Need a Refresher?', text: 'Click "Take a Tour" at the top right anytime to revisit any feature.' }
                ],
                tip: 'You’re all set! Click "Finish & Start Playing" to jump right in.'
            }
        ];
    }

    createDOM() {
        // Full-screen dim overlay (used when step has no specific target element)
        this.backdropEl = document.createElement('div');
        this.backdropEl.className = 'tour-backdrop-full';
        this.backdropEl.setAttribute('aria-hidden', 'true');

        // Glowing spotlight cutout ring (uses giant box-shadow so target stays clickable!)
        this.spotlightEl = document.createElement('div');
        this.spotlightEl.className = 'tour-spotlight';
        this.spotlightEl.setAttribute('aria-hidden', 'true');

        // Floating Tour Card
        this.cardEl = document.createElement('div');
        this.cardEl.className = 'tour-card';
        this.cardEl.setAttribute('role', 'dialog');
        this.cardEl.setAttribute('aria-label', 'FretDSP Guided Feature Tour');
        this.cardEl.innerHTML = `
            <div class="tour-progress-track">
                <div class="tour-progress-fill" id="tourProgressFill"></div>
            </div>

            <div class="tour-card-topbar">
                <div class="tour-meta-left">
                    <span class="tour-category-pill" id="tourCategoryPill">Welcome</span>
                    <span class="tour-step-counter" id="tourStepCounter">1 / 12</span>
                </div>
                <div class="tour-meta-right">
                    <button type="button" class="tour-topics-btn" id="tourTopicsBtn" title="Jump to any feature">
                        <span>☰ Topics</span>
                    </button>
                    <button type="button" class="tour-close-btn" id="tourCloseBtn" title="Close tour (Esc)" aria-label="Close tour">✕</button>
                </div>
            </div>

            <!-- Collapsible Topics Jump Menu -->
            <div class="tour-topics-menu" id="tourTopicsMenu" hidden></div>

            <div class="tour-card-body">
                <div class="tour-heading-row">
                    <span class="tour-step-icon" id="tourStepIcon">🎸</span>
                    <h2 class="tour-step-title" id="tourStepTitle"></h2>
                </div>
                <p class="tour-step-summary" id="tourStepSummary"></p>
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

        // Cache references
        this.progressFill = this.cardEl.querySelector('#tourProgressFill');
        this.categoryPill = this.cardEl.querySelector('#tourCategoryPill');
        this.stepCounter = this.cardEl.querySelector('#tourStepCounter');
        this.topicsBtn = this.cardEl.querySelector('#tourTopicsBtn');
        this.topicsMenu = this.cardEl.querySelector('#tourTopicsMenu');
        this.closeBtn = this.cardEl.querySelector('#tourCloseBtn');
        this.stepIcon = this.cardEl.querySelector('#tourStepIcon');
        this.stepTitle = this.cardEl.querySelector('#tourStepTitle');
        this.stepSummary = this.cardEl.querySelector('#tourStepSummary');
        this.pointsList = this.cardEl.querySelector('#tourPointsList');
        this.actionsRow = this.cardEl.querySelector('#tourActionsRow');
        this.tipBox = this.cardEl.querySelector('#tourTipBox');
        this.dotsWrap = this.cardEl.querySelector('#tourDotsWrap');
        this.btnSkip = this.cardEl.querySelector('#tourBtnSkip');
        this.btnPrev = this.cardEl.querySelector('#tourBtnPrev');
        this.btnNext = this.cardEl.querySelector('#tourBtnNext');

        this.buildTopicsMenu();
        this.buildProgressDots();
    }

    buildTopicsMenu() {
        this.topicsMenu.innerHTML = '';
        this.steps.forEach((step, idx) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'tour-topic-item';
            item.dataset.stepIndex = idx;
            item.innerHTML = `
                <span class="tour-topic-num">${idx + 1}</span>
                <span class="tour-topic-icon">${step.icon}</span>
                <span class="tour-topic-name">${step.shortTitle}</span>
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

    bindEvents() {
        // Header launch button
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

        // Clicking dim full-screen backdrop closes welcome card
        this.backdropEl.addEventListener('click', () => this.close());

        // Keyboard navigation while tour is open
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

        // Keep spotlight & card anchored on scroll or resize
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
        this.currentIndex = index;
        this.toggleTopics(false);
        this.renderStepContent();
        this.positionCurrentStep(true);
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

        // Render bullet points
        this.pointsList.innerHTML = '';
        (step.points || []).forEach((pt) => {
            const li = document.createElement('li');
            li.innerHTML = `<strong class="tour-point-label">${pt.label}:</strong> <span>${pt.text}</span>`;
            this.pointsList.appendChild(li);
        });

        // Render optional interactive Try-It buttons
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

        // Render optional tip
        if (step.tip) {
            this.tipBox.hidden = false;
            this.tipBox.textContent = step.tip;
        } else {
            this.tipBox.hidden = true;
        }

        // Update progress dots & topics highlight
        this.dotsWrap.querySelectorAll('.tour-dot').forEach((dot, idx) => {
            dot.classList.toggle('active', idx === this.currentIndex);
            dot.classList.toggle('completed', idx < this.currentIndex);
        });
        this.topicsMenu.querySelectorAll('.tour-topic-item').forEach((item, idx) => {
            item.classList.toggle('active', idx === this.currentIndex);
        });

        // Update navigation buttons
        const isFirst = this.currentIndex === 0;
        const isLast = this.currentIndex === total - 1;

        this.btnPrev.style.display = isFirst ? 'none' : 'inline-flex';
        this.btnSkip.textContent = isFirst ? 'Maybe Later' : 'Skip Tour';
        this.btnSkip.style.display = isLast ? 'none' : 'inline-flex';

        if (isFirst) {
            this.btnNext.textContent = 'Start 2-Min Tour →';
        } else if (isLast) {
            this.btnNext.textContent = 'Finish & Start Playing ✓';
        } else {
            this.btnNext.textContent = 'Next →';
        }
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

        // Centered welcome mode (no spotlight target)
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

        // Targeted spotlight mode
        this.backdropEl.classList.remove('open');
        this.cardEl.classList.remove('tour-card-centered');

        if (shouldScroll) {
            const initialRect = targetEl.getBoundingClientRect();
            const vh = window.innerHeight;
            // Scroll target comfortably into the upper-middle part of the viewport
            const targetTopDoc = initialRect.top + window.scrollY;
            const desiredTop = initialRect.height > vh * 0.65
                ? Math.max(0, targetTopDoc - 24)
                : Math.max(0, targetTopDoc - Math.max(24, (vh - initialRect.height) * 0.25));

            window.scrollTo({
                top: desiredTop,
                behavior: 'smooth'
            });

            // Re-run positioning after smooth scroll settles
            setTimeout(() => {
                if (this.isOpen) this.positionCurrentStep(false);
            }, 380);
        }

        const rect = targetEl.getBoundingClientRect();
        const pad = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Position spotlight cutout ring around the target panel
        const spotTop = Math.max(-20, rect.top - pad);
        const spotLeft = Math.max(4, rect.left - pad);
        const spotWidth = Math.min(vw - 8, rect.width + pad * 2);
        const spotHeight = Math.max(40, rect.height + pad * 2);

        this.spotlightEl.style.top = `${spotTop}px`;
        this.spotlightEl.style.left = `${spotLeft}px`;
        this.spotlightEl.style.width = `${spotWidth}px`;
        this.spotlightEl.style.height = `${spotHeight}px`;
        this.spotlightEl.classList.add('open');

        // Measure card dimensions for smart placement
        const cardWidth = Math.min(480, vw - 24);
        this.cardEl.style.width = `${cardWidth}px`;
        const cardRect = this.cardEl.getBoundingClientRect();
        const cardHeight = cardRect.height || 320;
        const margin = 16;

        const spaceBelow = vh - (rect.bottom + pad);
        const spaceAbove = (rect.top - pad);

        let top;
        let left;

        // Center horizontally relative to the highlighted target, clamped to viewport
        const idealLeft = rect.left + (rect.width / 2) - (cardWidth / 2);
        left = Math.max(margin, Math.min(vw - cardWidth - margin, idealLeft));

        if (spaceBelow >= cardHeight + margin) {
            // Fits comfortably below the highlighted section
            top = rect.bottom + pad + 14;
        } else if (spaceAbove >= cardHeight + margin) {
            // Fits comfortably above the highlighted section
            top = rect.top - pad - cardHeight - 14;
        } else {
            // Section fills most of the screen: dock neatly at bottom-right so user can still inspect the panel
            top = Math.max(margin, vh - cardHeight - margin);
            left = Math.max(margin, vw - cardWidth - margin);
        }

        // Final viewport clamp
        top = Math.max(margin, Math.min(vh - cardHeight - margin, top));

        this.cardEl.style.top = `${Math.round(top)}px`;
        this.cardEl.style.left = `${Math.round(left)}px`;
        this.cardEl.style.right = 'auto';
        this.cardEl.style.bottom = 'auto';
    }

    /**
     * Interactive demo for Step 4: Plucks an A-minor pentatonic phrase using
     * the app's own real keyboard/fretboard pipeline so users see and hear it live!
     */
    playSampleFretboardArpeggio(btn) {
        this.clearDemoTimers();
        const keys = ['a', 'd', 'g', 'j', 'k', 'j', 'g', 'a'];
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '🎵 Playing sample phrase...';

        keys.forEach((k, idx) => {
            const t = setTimeout(() => {
                window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
                if (idx === keys.length - 1) {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            }, idx * 210);
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

    // Auto-greet first-time visitors after canvases finish initial paint
    if (!tutorial.hasBeenSeen() && !window.location.hash.startsWith('#riff=')) {
        setTimeout(() => {
            if (!tutorial.isOpen) {
                tutorial.start(0);
            }
        }, 550);
    }
});
