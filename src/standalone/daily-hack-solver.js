// daily-hack-solver.js
// Fully automated solver for daily hacking minigames on cor3.gg
// Handles both "System Log Integrity" and "Signal Hack" puzzles end-to-end.
// Flow: Open daily ops tab → Start task → Detect puzzle → Solve → Close windows.
// Injected into MAIN world. Controllable via window.__dailyHackAbort flag.

(function () {
    if (window.__dailyHackActive) {
        console.log('[COR3 Daily Hack] Solver already active.');
        return;
    }
    window.__dailyHackActive = true;
    window.__dailyHackAbort = false;

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const hlog = (msg, level, step, details) => {
        level = level || 'info';
        console.log('[COR3 Daily Hack] [' + (step || 'log') + '] ' + msg, details || '');
        window.postMessage({
            type: 'COR3_DAILY_HACK_LOG',
            timestamp: Date.now(),
            message: msg,
            level: level,
            step: step || 'log',
            details: details || null
        }, '*');
    };

    function diag(step, message, details, level) {
        hlog(message, level || 'info', step, details);
    }

    function selectorInfo(selector) {
        try {
            const nodes = document.querySelectorAll(selector);
            const first = nodes && nodes.length ? nodes[0] : null;
            return {
                selector,
                count: nodes ? nodes.length : 0,
                text: first ? (first.textContent || '').trim().slice(0, 200) : null
            };
        } catch (e) {
            return { selector, error: String(e && e.message || e) };
        }
    }

    function tabBarSnapshot() {
        try {
            return Array.from(document.querySelectorAll('[data-component-name^="TabBarItem-"]')).map(el => ({
                name: el.getAttribute('data-component-name'),
                text: (el.textContent || '').trim().slice(0, 80)
            }));
        } catch (e) {
            return [];
        }
    }

    function dailyComponentSnapshot() {
        try {
            return Array.from(document.querySelectorAll('[data-component-name*="Daily"]'))
                .map(el => el.getAttribute('data-component-name'))
                .filter(Boolean)
                .slice(0, 30);
        } catch (e) {
            return [];
        }
    }

    // --- Wait for an element to appear in DOM, with timeout ---
    function waitForEl(selector, timeoutMs, parent) {
        timeoutMs = timeoutMs || 10000;
        parent = parent || document;
        return new Promise((resolve) => {
            const el = parent.querySelector(selector);
            if (el) { resolve(el); return; }
            const observer = new MutationObserver(() => {
                const found = parent.querySelector(selector);
                if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); }
            });
            observer.observe(parent === document ? document.body : parent, { childList: true, subtree: true });
            const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
        });
    }

    // --- Click helper with React-compatible event dispatch ---
    function click(el) {
        if (!el) return;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    // --- Set React-controlled input value ---
    function setInputValue(input, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // --- Morse / Binary maps for Signal Hack ---
    const MORSE_MAP = {
        LLLLL: '0', SLLLL: '1', SSLLL: '2', SSSLL: '3', SSSSL: '4',
        SSSSS: '5', LSSSS: '6', LLSSS: '7', LLLSS: '8', LLLLS: '9'
    };
    const BINARY_MAP = {
        SSSS: '0', SSSL: '1', SSLS: '2', SSLL: '3', SLSS: '4',
        SLSL: '5', SLLS: '6', SLLL: '7', LSSS: '8', LSSL: '9'
    };

    // Encoding option header text → internal key
    const ENCODING_LABELS = {
        'MORSE': 'Morse Numeric (0-9)',
        'BINARY': 'Binary Numeric'
    };

    // --- System Log Integrity: valid types & statuses ---
    const VALID_TYPES = new Set(['AUTH', 'TEMP-SYNC', 'SCAN', 'ROUTE-CHECK', 'RADIO-TEST', 'PING', 'SYNC']);
    const VALID_STATUSES = new Set(['OK', 'WARN', 'ERROR']);
    const ERROR_LABELS = {
        TIME: 'Time format is incorrect',
        TYPE: 'Event type is incorrect',
        MISSING_SECTOR: 'Missing /sector parameter',
        MISSING_STATUS: 'Missing /status parameter',
        SECTOR_BAD: '/sector parameter is incorrect',
        STATUS_BAD: '/status parameter is incorrect'
    };

    function analyzeLogLine(rawText) {
        const issues = [];
        const text = (rawText || '').trim();
        const timeMatch = text.match(/^\[(\d{2}):(\d{2}):(\d{2})\]\s+/);
        let rest = text;
        if (timeMatch) {
            const h = Number(timeMatch[1]), m = Number(timeMatch[2]), s = Number(timeMatch[3]);
            if (!(Number.isInteger(h) && h >= 0 && h <= 23 && Number.isInteger(m) && m >= 0 && m <= 59 && Number.isInteger(s) && s >= 0 && s <= 59)) issues.push('TIME');
            rest = text.slice(timeMatch[0].length);
        } else {
            issues.push('TIME');
        }
        const typeMatch = rest.match(/^([A-Z-]+)\b/);
        if (typeMatch) {
            if (!VALID_TYPES.has(typeMatch[1])) issues.push('TYPE');
            rest = rest.slice(typeMatch[0].length).trim();
        } else {
            issues.push('TYPE');
        }
        const hasSector = /(^|\s)\/sector=/.test(rest);
        const hasStatus = /(^|\s)\/status=/.test(rest);
        if (!hasSector) issues.push('MISSING_SECTOR');
        if (!hasStatus) issues.push('MISSING_STATUS');
        if (hasSector) {
            const sm = rest.match(/\/sector=([^\s]+)/);
            const sv = sm ? sm[1] : null;
            const sn = sv != null && /^[0-9]+$/.test(sv) ? Number(sv) : NaN;
            if (!(Number.isInteger(sn) && sn >= 1 && sn <= 256)) issues.push('SECTOR_BAD');
        }
        if (hasStatus) {
            const stm = rest.match(/\/status=([^\s]+)/);
            const stv = stm ? stm[1] : null;
            if (!(stv != null && VALID_STATUSES.has(stv))) issues.push('STATUS_BAD');
        }
        return [...new Set(issues)];
    }

    function clickCheckbox(entryEl) {
        const input = entryEl.querySelector('input[type="checkbox"]') ||
                       entryEl.querySelector('.checkbox input') ||
                       entryEl.querySelector('[role="checkbox"]') ||
                       entryEl.querySelector('input');
        if (!input) return false;
        if (input.tagName === 'INPUT' && input.type === 'checkbox') {
            if (!input.checked) {
                input.checked = true;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }
            return true;
        }
        input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
    }

    function findErrorTypeButton(container, label) {
        return Array.from(container.querySelectorAll('.error-type-button'))
            .find(b => (b.textContent || '').trim() === label) || null;
    }

    // --- Close app windows (decode screen, daily ops) ---
    async function closeAppWindows(count) {
        count = count || 2;
        for (let i = 0; i < count; i++) {
            await sleep(300);
            const closeBtn = document.querySelector('[data-component-name="close-app-btn"]');
            if (closeBtn) {
                click(closeBtn);
                hlog('Closed window ' + (i + 1));
            } else {
                break;
            }
        }
    }

    // =============================================
    // STEP 1: Open Daily Ops tab
    // =============================================
    async function openDailyOpsTab() {
        diag('open.tab', 'Opening Daily Ops tab', {
            url: location.href,
            tabBar: tabBarSnapshot(),
            dailyComponents: dailyComponentSnapshot()
        });
        const selectors = [
            '[data-component-name="TabBarItem-019a0c41-b17f-7abc-1234-567890abcde2"]',
            '[data-component-name="TabBarItem-019a0c41-b17f-7abc-1234-567890abcde1"]'
        ];
        let tabItem = null;
        for (const selector of selectors) {
            tabItem = document.querySelector(selector);
            diag('open.tab', 'Trying Daily Ops tab selector', { selector, found: !!tabItem });
            if (tabItem) break;
        }
        if (!tabItem) {
            diag('open.tab', 'Daily Ops tab bar item not found', {
                selectors,
                tabBar: tabBarSnapshot(),
                dailyComponents: dailyComponentSnapshot()
            }, 'error');
            return false;
        }
        click(tabItem);
        diag('open.tab', 'Clicked Daily Ops tab', { component: tabItem.getAttribute('data-component-name') });
        await sleep(800);
        return true;
    }

    // =============================================
    // STEP 2: Select "Daily Ops" section
    // =============================================
    async function selectDailyOpsSection() {
        const gridButtons = Array.from(document.querySelectorAll('.game-center-grid button')).map(b => (b.textContent || '').trim());
        diag('select.section', 'Selecting Daily Ops section', {
            gameCenterGrids: document.querySelectorAll('.game-center-grid').length,
            gridButtons,
            startButton: selectorInfo('[data-component-name="DailyOpsStartButton"]')
        });
        const dailyOpsBtn = document.querySelector('.game-center-grid button:nth-child(2)');
        if (!dailyOpsBtn) {
            const startBtnCheck = await waitForEl('[data-component-name="DailyOpsStartButton"]', 8000);
            diag('select.section', 'Daily Ops section button missing; checked Start Task button', {
                startButtonFound: !!startBtnCheck,
                dailyComponents: dailyComponentSnapshot()
            }, startBtnCheck ? 'info' : 'error');
            if (startBtnCheck) {
                return true;
            }
            return false;
        }
        click(dailyOpsBtn);
        diag('select.section', 'Clicked Daily Ops section', { text: (dailyOpsBtn.textContent || '').trim() });
        await sleep(1000);
        return true;
    }

    // =============================================
    // STEP 3: Click "Start Task" button
    // =============================================
    async function clickStartTask() {
        diag('start.task', 'Waiting for Start Task button', {
            startButton: selectorInfo('[data-component-name="DailyOpsStartButton"]')
        });
        const startBtn = await waitForEl('[data-component-name="DailyOpsStartButton"]', 8000);
        if (!startBtn) {
            diag('start.task', 'Could not find Start Task button', {
                startButton: selectorInfo('[data-component-name="DailyOpsStartButton"]'),
                dailyComponents: dailyComponentSnapshot()
            }, 'error');
            return false;
        }
        click(startBtn);
        diag('start.task', 'Clicked Start Task', { text: (startBtn.textContent || '').trim() });
        await sleep(1000);
        return true;
    }

    // =============================================
    // Signal Hack — full end-to-end
    // =============================================
    async function solveSignalHackFull() {
        diag('solve.signal', 'Signal Hack solver started', {
            getSignal: selectorInfo('.go190644802')
        });

        // Step A: Click "Get Signal" button
        const getSignalBtn = await waitForEl('.go190644802', 5000);
        if (!getSignalBtn) {
            diag('solve.signal', 'Could not find Get Signal button', {
                selector: selectorInfo('.go190644802')
            }, 'error');
            return false;
        }
        click(getSignalBtn);
        diag('solve.signal', 'Clicked Get Signal');
        await sleep(1500);

        // Step B: Wait for pulse timeline and decode
        const timeline = await waitForEl('.pulse-timeline', 10000);
        if (!timeline) {
            diag('solve.signal', 'Could not find pulse timeline after Get Signal', {
                timeline: selectorInfo('.pulse-timeline')
            }, 'error');
            return false;
        }

        const groups = Array.from(timeline.querySelectorAll('.pulse-group'));
        diag('solve.signal', 'Pulse groups collected', { count: groups.length });
        const pulses = groups.map((g, i) => {
            const isShort = !!g.querySelector('.pulse-bar.short');
            const longCount = g.querySelectorAll('.pulse-bar.long').length;
            if (isShort) return 'S';
            if (longCount >= 3) return 'L';
            const bar = g.querySelector('.pulse-bar');
            if (bar?.classList.contains('short')) return 'S';
            if (bar?.classList.contains('long')) return 'L';
            console.log(`[COR3 Daily Hack] Pulse group #${i} couldn't be classified. Using "?".`);
            return '?';
        });

        const decode = (groupSize, map) => {
            const result = [];
            for (let i = 0; i < pulses.length; i += groupSize) {
                const chunk = pulses.slice(i, i + groupSize);
                if (chunk.length < groupSize) break;
                result.push(map[chunk.join('')] ?? '?');
            }
            return result.join('');
        };

        const morseResult = decode(5, MORSE_MAP);
        const binaryResult = decode(4, BINARY_MAP);
        const countDigits = s => (s.match(/[0-9]/g) || []).length;
        const countUnknown = s => (s.match(/\?/g) || []).length;

        const md = countDigits(morseResult);
        const bd = countDigits(binaryResult);
        let encoding, value;
        if (md === 0 && bd === 0) {
            hlog('Could not decode signal — no valid digits found', 'error');
            return false;
        } else if (md > bd) {
            encoding = 'MORSE';
            value = morseResult;
        } else if (bd > md) {
            encoding = 'BINARY';
            value = binaryResult;
        } else if (countUnknown(morseResult) <= countUnknown(binaryResult)) {
            encoding = 'MORSE';
            value = morseResult;
        } else {
            encoding = 'BINARY';
            value = binaryResult;
        }

        hlog(`Signal Hack → Type: ${encoding}, Value: ${value}`);
        console.log(`[COR3 Daily Hack] Pulses: ${pulses.join(' ')}`);

        // Step C: Click "Select Encoding" (next-button)
        await sleep(500);
        const selectEncodingBtn = document.querySelector('.next-button');
        if (!selectEncodingBtn) {
            hlog('Could not find Select Encoding button (.next-button)', 'error');
            return false;
        }
        click(selectEncodingBtn);
        hlog('Clicked Select Encoding');
        await sleep(800);

        // Step D: Choose the correct encoding option
        const targetLabel = ENCODING_LABELS[encoding];
        const encodingOptions = Array.from(document.querySelectorAll('.encoding-option'));
        diag('solve.signal', 'Encoding options collected', {
            targetLabel,
            count: encodingOptions.length,
            headers: encodingOptions.map(o => {
                const h = o.querySelector('.option-header');
                return h ? (h.textContent || '').trim() : null;
            })
        });
        let chosen = null;
        for (const opt of encodingOptions) {
            const header = opt.querySelector('.option-header');
            if (header && (header.textContent || '').trim() === targetLabel) {
                chosen = opt;
                break;
            }
        }
        if (!chosen) {
            diag('solve.signal', 'Could not find encoding option', { targetLabel }, 'error');
            return false;
        }
        click(chosen);
        hlog(`Selected encoding: ${targetLabel}`);
        await sleep(500);

        // Step E: Click "Decode Signal" (next-button again)
        const decodeBtn = document.querySelector('.next-button');
        if (!decodeBtn) {
            hlog('Could not find Decode Signal button (.next-button)', 'error');
            return false;
        }
        click(decodeBtn);
        hlog('Clicked Decode Signal');
        await sleep(800);

        // Step F: Enter the code value
        const codeInput = await waitForEl('.code-input', 5000);
        if (!codeInput) {
            diag('solve.signal', 'Could not find code input', {
                input: selectorInfo('.code-input')
            }, 'error');
            return false;
        }
        setInputValue(codeInput, value);
        diag('solve.signal', 'Entered code', { value });
        await sleep(400);

        // Step G: Click "CONFIRM CODE"
        const confirmBtn = document.querySelector('.submit-button');
        if (!confirmBtn) {
            diag('solve.signal', 'Could not find Confirm Code button', {
                submit: selectorInfo('.submit-button')
            }, 'error');
            return false;
        }
        click(confirmBtn);
        diag('solve.signal', 'Clicked CONFIRM CODE');
        await sleep(1500);

        // Step H: Check for success
        const resultTitle = document.querySelector('.result-title');
        if (resultTitle && resultTitle.classList.contains('success')) {
            diag('solve.signal', 'Signal Hack VERIFIED — Success!', {
                result: (resultTitle.textContent || '').trim()
            }, 'success');
        } else if (resultTitle) {
            diag('solve.signal', 'Signal Hack result was not success', {
                className: resultTitle.className,
                text: (resultTitle.textContent || '').trim()
            }, 'warn');
        } else {
            diag('solve.signal', 'Could not verify result — no .result-title found', {
                result: selectorInfo('.result-title')
            }, 'warn');
        }

        // Step I: Close windows (decode screen + daily ops)
        await sleep(500);
        await closeAppWindows(3);

        return true;
    }

    // =============================================
    // System Log Integrity — full end-to-end
    // =============================================
    async function solveSystemLogIntegrityFull() {
        diag('solve.log', 'System Log Integrity solver started', {
            getLogs: selectorInfo('.go190644802')
        });

        // Step A: Click "Get Logs" button
        const getLogsBtn = await waitForEl('.go190644802', 5000);
        if (!getLogsBtn) {
            diag('solve.log', 'Could not find Get Logs button', {
                selector: selectorInfo('.go190644802')
            }, 'error');
            return false;
        }
        click(getLogsBtn);
        diag('solve.log', 'Clicked Get Logs');
        await sleep(4000);
        // Step B: Wait for pulse timeline and decode
        const log_entries = await waitForEl('.log-entries', 10000);
        if (!log_entries) {
            diag('solve.log', 'Could not find log-entries after Get Logs', {
                logEntries: selectorInfo('.log-entries')
            }, 'error');
            return false;
        }
        const logContainer = document.querySelector('.log-entries');
        if (!logContainer) {
            diag('solve.log', 'Could not find log-entries container', null, 'error');
            return false;
        }
        const entries = Array.from(logContainer.querySelectorAll('.log-entry.log-entry-appearing'));
        diag('solve.log', 'Log entries collected', {
            appearing: entries.length,
            allEntries: logContainer.querySelectorAll('.log-entry').length
        });
        if (!entries.length) {
            diag('solve.log', 'No .log-entry.log-entry-appearing elements found', {
                logEntries: selectorInfo('.log-entries')
            }, 'error');
            return false;
        }

        const analyzed = entries.map(el => {
            const textEl = el.querySelector('span') || el.querySelector('.log-line') || el;
            const text = (textEl?.textContent || '').trim();
            return { el, text, issues: analyzeLogLine(text) };
        }).filter(e => e.issues.length > 0);

        analyzed.sort((a, b) => b.issues.length - a.issues.length);
        const selected = analyzed.slice(0, 2);
        diag('solve.log', 'Invalid log entries analyzed', {
            total: entries.length,
            invalid: analyzed.length,
            selected: selected.length,
            details: analyzed.map(e => ({ text: e.text.slice(0, 160), issues: e.issues }))
        });
        if (selected.length === 0) {
            diag('solve.log', 'No invalid log entries found — puzzle may already be solved', null, 'warn');
            return false;
        }
        if (selected.length < 2) diag('solve.log', 'Only found fewer than 2 invalid logs', { count: selected.length }, 'warn');

        for (const entry of selected) {
            clickCheckbox(entry.el);
        }

        hlog(`Selected ${selected.length} wrong log(s)`);
        selected.forEach((e, i) => {
            console.log(`[SELECTED #${i + 1}] ${e.text}`);
            e.issues.forEach(iss => console.log(`  - ${ERROR_LABELS[iss] || iss}`));
        });

        // Click confirm button
        const confirmSelectionBtn = document.querySelector('.confirm-button');
        if (!confirmSelectionBtn) {
            hlog('Could not find .confirm-button', 'error');
            return false;
        }
        click(confirmSelectionBtn);
        await sleep(1000);

        // Handle analysis/fix phase
        const analysisContainer = await waitForEl('.analysis-container', 5000);
        if (!analysisContainer) {
            hlog('Could not find .analysis-container after confirming', 'error');
            return false;
        }

        const blocks = Array.from(analysisContainer.querySelectorAll('.error-analysis-block'));
        diag('solve.log', 'Analysis blocks collected', {
            count: blocks.length,
            analysisContainer: selectorInfo('.analysis-container')
        });
        if (!blocks.length) {
            diag('solve.log', 'No .error-analysis-block found', null, 'error');
            return false;
        }

        const issueMap = new Map(selected.map(e => [e.text, e.issues]));

        for (const block of blocks) {
            const lineDisplay = block.querySelector('.log-line-display');
            const lineText = (lineDisplay?.textContent || '').trim();
            let issues = issueMap.get(lineText);
            if (!issues) {
                const match = selected.find(e => e.text === lineText) ||
                              selected.find(e => lineText && e.text && (e.text.includes(lineText) || lineText.includes(e.text)));
                issues = match ? match.issues : null;
            }
            if (!issues || !issues.length) {
                console.log('[COR3 Daily Hack] Could not map analysis block to picked issues:', lineText);
                continue;
            }

            const fixBtn = block.querySelector('.fix-error-button');
            if (fixBtn) {
                click(fixBtn);
                await sleep(50);
                for (const iss of issues) {
                    const label = ERROR_LABELS[iss] || iss;
                    const errBtn = findErrorTypeButton(block, label);
                    if (errBtn) {
                        click(errBtn);
                        await sleep(25);
                    } else {
                        console.log('[COR3 Daily Hack] Could not find error-type-button for:', label);
                    }
                }
                hlog(`Fixed: ${lineText.substring(0, 40)}...`);
            }
        }
        await sleep(1000);
        // Click confirm button
        const confirmFixesBtn = document.querySelector('.confirm-button');
        if (!confirmFixesBtn) {
            hlog('Could not find .confirm-button', 'error');
            return false;
        }
        click(confirmFixesBtn);

        await sleep(1000);
        // Click confirm button
        const scanBtn = document.querySelector('.scan-button');
        if (!scanBtn) {
            hlog('Could not find .confirm-button', 'error');
            return false;
        }
        click(scanBtn);

        // Wait for result
        await sleep(1500);
        const resultTitle = document.querySelector('.result-title');
        if (resultTitle && resultTitle.classList.contains('success')) {
            diag('solve.log', 'System Log Integrity VERIFIED — Success!', {
                result: (resultTitle.textContent || '').trim()
            }, 'success');
        } else if (resultTitle) {
            diag('solve.log', 'System Log Integrity result was not success', {
                className: resultTitle.className,
                text: (resultTitle.textContent || '').trim()
            }, 'warn');
        } else {
            diag('solve.log', 'Could not verify System Log Integrity result — no .result-title found', {
                result: selectorInfo('.result-title')
            }, 'warn');
        }

        // Close windows
        await sleep(500);
        await closeAppWindows(3);

        return true;
    }

    // =============================================
    // Detect puzzle type from DOM
    // =============================================
    let _lastPuzzleDiagTitle = null;
    let _lastPuzzleDiagAt = 0;

    function detectPuzzle() {
        // First check for hack type label in the DOM (most reliable).
        // The game UI can be localized, so match both English and Chinese titles.
        var hackTypeDiv = document.querySelector('[data-component-name="DailyOpsTaskInfoTitle"]');
        const title = hackTypeDiv ? (hackTypeDiv.textContent || '').trim() : '';
        if (title.includes('System Log Integrity') || title.includes('系统日志完整性')) return 'log';
        if (title.includes('Signal Decode') || title.includes('Signal Hack') ||
            title.includes('信号解码') || title.includes('信号破解')) return 'signal';

        // DOM fallback: the title may lag behind the rendered puzzle.
        if (document.querySelector('.log-entries, .log-entry')) return 'log';
        if (document.querySelector('.pulse-timeline, .encoding-option, .code-input')) return 'signal';

        const now = Date.now();
        if (title !== _lastPuzzleDiagTitle || now - _lastPuzzleDiagAt > 5000) {
            _lastPuzzleDiagTitle = title;
            _lastPuzzleDiagAt = now;
            diag('detect.puzzle', 'Puzzle type not detected', {
                title,
                titleSelector: selectorInfo('[data-component-name="DailyOpsTaskInfoTitle"]'),
                dailyComponents: dailyComponentSnapshot()
            }, 'warn');
        }
        return null;
    }

    // =============================================
    // Main run — full automation flow with retry
    // =============================================
    const MAX_ATTEMPTS = 3;

    async function attemptSolve() {
        diag('attempt.start', 'Starting Daily Ops attempt', {
            url: location.href,
            tabBar: tabBarSnapshot(),
            dailyComponents: dailyComponentSnapshot()
        });
        // STEP 1: Open Daily Ops tab
        const tabOpened = await openDailyOpsTab();
        if (!tabOpened || window.__dailyHackAbort) return { success: false, abort: true };

        // STEP 2: Select Daily Ops section
        const sectionSelected = await selectDailyOpsSection();
        if (!sectionSelected || window.__dailyHackAbort) return { success: false, abort: true };

        // STEP 3: Wait for puzzle to appear
        diag('detect.puzzle', 'Waiting for puzzle title before Start Task');
        let puzzle = null;
        let waited = 0;
        while (!puzzle && waited < 15000 && !window.__dailyHackAbort) {
            puzzle = detectPuzzle();
            await sleep(500);
            waited += 500;
        }
        diag('detect.puzzle', 'Puzzle detection before Start Task', {
            puzzle,
            title: selectorInfo('[data-component-name="DailyOpsTaskInfoTitle"]')
        });

        // STEP 4: Click "Start Task"
        const taskStarted = await clickStartTask();
        if (!taskStarted || window.__dailyHackAbort) return { success: false, abort: true };

        if (window.__dailyHackAbort) return { success: false, abort: true };

        const puzzleAfterStart = detectPuzzle();
        diag('detect.puzzle', 'Puzzle detection after Start Task', {
            beforeStart: puzzle,
            afterStart: puzzleAfterStart,
            title: selectorInfo('[data-component-name="DailyOpsTaskInfoTitle"]')
        });
        if (!puzzle && puzzleAfterStart) puzzle = puzzleAfterStart;

        if (!puzzle) {
            diag('detect.puzzle', 'No puzzle detected after Start Task; stopping attempt', {
                title: selectorInfo('[data-component-name="DailyOpsTaskInfoTitle"]'),
                dailyComponents: dailyComponentSnapshot()
            }, 'error');
            return { success: false, abort: false };
        }

        // STEP 4: Solve based on type
        let solved = false;
        try {
            if (puzzle === 'signal') {
                solved = await solveSignalHackFull();
            } else if (puzzle === 'log') {
                solved = await solveSystemLogIntegrityFull();
            }
        } catch (e) {
            hlog('Error: ' + (e.message || e), 'error');
            console.log('[COR3 Daily Hack] Error:', e);
            solved = false;
        }

        // Verify success by checking for .result-title.success
        const resultTitle = document.querySelector('.result-title');
        if (resultTitle && resultTitle.classList.contains('success')) {
            return { success: true };
        }

        return { success: solved === true, abort: false };
    }

    async function run() {
        diag('solver.start', 'Solver started — full automation mode', {
            url: location.href,
            maxAttempts: MAX_ATTEMPTS,
            tabBar: tabBarSnapshot(),
            dailyComponents: dailyComponentSnapshot()
        });

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (window.__dailyHackAbort) break;

            if (attempt > 1) {
                diag('solver.retry', `Retry attempt ${attempt}/${MAX_ATTEMPTS} — closing windows and restarting...`, null, 'warn');
                await closeAppWindows(4);
                await sleep(3000);
                if (window.__dailyHackAbort) break;
            }

            diag('solver.attempt', `Running attempt ${attempt}/${MAX_ATTEMPTS}`);
            const result = await attemptSolve();
            diag('solver.result', `Attempt ${attempt}/${MAX_ATTEMPTS} finished`, result);

            if (result.abort) {
                diag('solver.abort', 'Solver aborted', null, 'warn');
                break;
            }

            if (result.success) {
                hlog('✅ Daily hack completed successfully!', 'success');
                // Keep the persistent toggle enabled and let the scheduler pick the next check.
                window.postMessage({ type: 'COR3_DAILY_HACK_RUN_FINISHED', success: true, reason: 'success' }, '*');
                // Refresh daily ops data so UI reflects completion
                window.postMessage({ type: 'COR3_FETCH_DAILY_OPS' }, '*');
                cleanup();
                return;
            }

            if (attempt < MAX_ATTEMPTS) {
                hlog(`Attempt ${attempt}/${MAX_ATTEMPTS} failed — will retry...`, 'warn');
            }
        }

        // All attempts failed — keep the persistent toggle enabled and retry later.
        hlog(`Daily hack failed after ${MAX_ATTEMPTS} attempts — will retry later`, 'error');
        window.postMessage({ type: 'COR3_DAILY_HACK_RUN_FINISHED', success: false, reason: 'attempts_exhausted' }, '*');
        cleanup();
    }

    function cleanup() {
        window.__dailyHackActive = false;
        window.__dailyHackAbort = false;
    }

    run();
})();
