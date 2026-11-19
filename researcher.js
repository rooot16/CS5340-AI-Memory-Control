/* researcher.js — Study-session helper tools for the AI Memory Control A/B prototype.
 *
 * Adds a small "Researcher Tools" panel on top of the existing prototype:
 *   - Participant ID field
 *   - "Start New Participant" button: clears prior data AND randomizes which
 *     condition (A or B) comes first, so order is counterbalanced across your
 *     6-8 participants instead of everyone doing A then B.
 *   - A live checklist of the 6 study tasks for whichever version is active,
 *     each with a timestamp recorded when checked off.
 *   - "Export Session Data" button: downloads a single JSON file with the
 *     participant ID, condition order, task timestamps, and the full chat +
 *     memory state for both versions, so you don't have to transcribe anything
 *     by hand during analysis.
 *
 * This file does NOT modify app.js. It only reads/calls things app.js already
 * exposes as globals (VERSIONS, currentVersion, changeVersion(), clearAllBrowserData(),
 * STORAGE_KEY) because classic <script> tags share one global scope. Load this
 * file with a <script defer> tag AFTER app.js in index.html.
 */
(function () {
  const SESSION_KEY = 'cs5340-researcher-session-v1';
  const APP_STORAGE_KEY_FALLBACK = 'cs5340-ai-memory-chat-history-v1.5';

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
  }
  function saveSession(session) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* ignore */ }
  }

  let session = loadSession() || {
    participantId: '',
    order: ['A', 'B'],
    startedAt: null,
    taskLog: [], // { version, taskIndex, taskText, completedAt }
  };

  function randomOrder() {
    return Math.random() < 0.5 ? ['A', 'B'] : ['B', 'A'];
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getActiveVersion() {
    return typeof currentVersion !== 'undefined' ? currentVersion : 'A';
  }

  // --- Floating toggle button + panel ---
  const toggleBtn = el('button', 'researcher-toggle', '🔬 Researcher Tools');
  toggleBtn.type = 'button';
  document.body.appendChild(toggleBtn);

  const panel = el('div', 'researcher-panel');
  panel.hidden = true;
  document.body.appendChild(panel);

  let timerIntervalId = null;

  function render() {
    panel.innerHTML = '';
    const activeVersion = getActiveVersion();

    // Participant ID
    const idRow = el('div', 'rp-row');
    idRow.appendChild(el('label', 'rp-label', 'Participant ID'));
    const idInput = el('input', 'rp-input');
    idInput.type = 'text';
    idInput.placeholder = 'e.g. P01';
    idInput.value = session.participantId;
    idInput.addEventListener('input', (e) => {
      session.participantId = e.target.value;
      saveSession(session);
    });
    idRow.appendChild(idInput);
    panel.appendChild(idRow);

    // Condition order (counterbalanced)
    const orderRow = el('div', 'rp-row');
    orderRow.appendChild(el('span', 'rp-label', 'Condition order'));
    orderRow.appendChild(el('span', 'rp-order-text', session.order.join(' then ')));
    panel.appendChild(orderRow);

    // Start new participant (resets data + re-randomizes order)
    const startBtn = el('button', 'rp-button rp-start', 'Start New Participant');
    startBtn.type = 'button';
    startBtn.addEventListener('click', () => {
      const ok = window.confirm(
        'This clears all saved chats/memories for both versions and starts a ' +
        'fresh, counterbalanced session. Continue?'
      );
      if (!ok) return;
      session.order = randomOrder();
      session.startedAt = Date.now();
      session.taskLog = [];
      saveSession(session);
      if (typeof clearAllBrowserData === 'function') clearAllBrowserData();
      if (typeof changeVersion === 'function') changeVersion(session.order[0]);
      render();
    });
    panel.appendChild(startBtn);

    // Task checklist for whichever version is currently active
    panel.appendChild(el('div', 'rp-subheading', `Tasks — Version ${activeVersion}`));
    const tasks = (typeof VERSIONS !== 'undefined' && VERSIONS[activeVersion] && VERSIONS[activeVersion].tasks) || [];
    const list = el('div', 'rp-task-list');
    tasks.forEach((taskText, index) => {
      const row = el('label', 'rp-task-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = session.taskLog.some(t => t.version === activeVersion && t.taskIndex === index);
      cb.addEventListener('change', () => {
        if (cb.checked) {
          session.taskLog.push({ version: activeVersion, taskIndex: index, taskText, completedAt: Date.now() });
        } else {
          session.taskLog = session.taskLog.filter(t => !(t.version === activeVersion && t.taskIndex === index));
        }
        saveSession(session);
      });
      row.append(cb, el('span', '', taskText));
      list.appendChild(row);
    });
    if (!tasks.length) list.appendChild(el('p', 'rp-note', 'No task list found for this version.'));
    panel.appendChild(list);

    // Elapsed time since "Start New Participant" was pressed
    const timerRow = el('div', 'rp-row');
    timerRow.appendChild(el('span', 'rp-label', 'Elapsed'));
    const timerSpan = el('span', 'rp-timer', '--:--');
    timerRow.appendChild(timerSpan);
    panel.appendChild(timerRow);

    clearInterval(timerIntervalId);
    if (session.startedAt) {
      const update = () => {
        const secs = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        const m = String(Math.floor(secs / 60)).padStart(2, '0');
        const s = String(secs % 60).padStart(2, '0');
        timerSpan.textContent = `${m}:${s}`;
      };
      update();
      timerIntervalId = setInterval(update, 1000);
    }

    // Export full session as a JSON file
    const exportBtn = el('button', 'rp-button rp-export', 'Export Session Data (JSON)');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', exportSession);
    panel.appendChild(exportBtn);

    panel.appendChild(el('p', 'rp-note', 'This panel is for the researcher running the session, not the participant.'));
  }

  function exportSession() {
    const storageKey = typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : APP_STORAGE_KEY_FALLBACK;
    let appData = null;
    try { appData = JSON.parse(localStorage.getItem(storageKey) || 'null'); }
    catch { appData = null; }

    const payload = {
      participantId: session.participantId || '(not set)',
      order: session.order,
      startedAt: session.startedAt ? new Date(session.startedAt).toISOString() : null,
      exportedAt: new Date().toISOString(),
      taskLog: session.taskLog.map(t => ({ ...t, completedAt: new Date(t.completedAt).toISOString() })),
      appData, // full chat history + memories for both Version A and Version B
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `session-${(session.participantId || 'unnamed').replace(/\s+/g, '_')}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  toggleBtn.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) render();
  });

  // app.js doesn't emit an event when the version switches, so this just
  // checks every half-second and re-renders the task list if it changed.
  let lastSeenVersion = getActiveVersion();
  setInterval(() => {
    if (!panel.hidden && getActiveVersion() !== lastSeenVersion) {
      lastSeenVersion = getActiveVersion();
      render();
    }
  }, 500);
})();
