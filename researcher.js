/* researcher.js: researcher tools for the AI Memory Control A/B study.
 *
 * Only appears when the page URL contains ?researcher=1, so participants
 * who open the normal link never see it.
 *
 *  - Start new participant: asks for a participant ID, erases the previous
 *    participant's chats and memories, restores the app's starting memories,
 *    and sets which version this participant uses first. Odd-numbered IDs
 *    (P01, P03, ...) start with Version A and even-numbered IDs with
 *    Version B, so both orders are used equally. IDs without a number get a
 *    coin flip.
 *  - Checklist of the six study tasks for the version on screen. Ticking a
 *    task records the time. A notes box records difficulties per version.
 *  - Elapsed-time counter and a button to switch to the other version.
 *  - Export session data: downloads one JSON file per participant with the
 *    ID, condition order, task times, notes, AI mode and model, and both
 *    versions' chats and memories.
 *  - Warns when the app is not in Gemini mode.
 *
 * app.js is not modified. This file reads globals that app.js defines
 * (currentVersion, changeVersion, STORAGE_KEY, waitingForGemini,
 * responseMode, modelName), so index.html must load it AFTER app.js:
 *   <script src="researcher.js" defer></script>
 * server.js must also list /researcher.js and /researcher.css in STATIC_FILES.
 */
(function () {
  'use strict';

  if (!new URLSearchParams(window.location.search).has('researcher')) return;

  const SESSION_KEY = 'cs5340-researcher-session-v2';
  // app.js saves its data under keys with this prefix. SESSION_KEY does not
  // use it, so the researcher session survives when app data is cleared.
  const APP_KEY_PREFIX = 'cs5340-ai-memory-';

  const STUDY_TASKS = [
    'Personalized Recommendation: ask the AI for a drink recommendation',
    'Memory Awareness: find out what the AI remembers about you',
    'Memory Correction: update your drink preference',
    'Memory Verification: in a new chat, check that the updated preference is used',
    'Memory Deletion: remove a memory you do not want the AI to keep',
    'Deletion Verification: in a new chat, check that the removed memory is no longer used',
  ];

  // Readers for app.js globals. Classic scripts share one global scope.
  const app = {
    version: () => (typeof currentVersion !== 'undefined' && currentVersion === 'B' ? 'B' : 'A'),
    busy: () => typeof waitingForGemini !== 'undefined' && waitingForGemini === true,
    mode: () => (typeof responseMode !== 'undefined' ? responseMode : 'unknown'),
    model: () => (typeof modelName !== 'undefined' ? modelName : ''),
    storageKey: () => (typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'cs5340-ai-memory-chat-history-v1.5'),
    switchTo: (version) => { if (typeof changeVersion === 'function') changeVersion(version); },
  };

  function emptySession() {
    return {
      participantId: '',
      order: ['A', 'B'],
      startedAt: null,
      conditionStartedAt: {},
      taskLog: [],
      notes: { A: '', B: '' },
      exportedAt: null,
      exportedHash: null,
      pendingStartVersion: null,
    };
  }

  function loadSession() {
    const fresh = emptySession();
    try {
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return fresh;
      return {
        ...fresh,
        ...saved,
        order: Array.isArray(saved.order) && saved.order.length === 2 ? saved.order : fresh.order,
        conditionStartedAt: saved.conditionStartedAt && typeof saved.conditionStartedAt === 'object' ? saved.conditionStartedAt : {},
        taskLog: Array.isArray(saved.taskLog) ? saved.taskLog : [],
        notes: { ...fresh.notes, ...(saved.notes && typeof saved.notes === 'object' ? saved.notes : {}) },
      };
    } catch {
      return fresh;
    }
  }

  let session = loadSession();

  function saveSession() {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage unavailable */ }
  }

  // "Start new participant" reloads the page so app.js rebuilds its starting
  // state. Once it has, open the condition this participant does first.
  if (session.pendingStartVersion === 'A' || session.pendingStartVersion === 'B') {
    const first = session.pendingStartVersion;
    session.pendingStartVersion = null;
    saveSession();
    app.switchTo(first);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeButton(label, className, onClick) {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function iso(ms) {
    return ms ? new Date(ms).toISOString() : null;
  }

  function appDataText() {
    try { return localStorage.getItem(app.storageKey()) || ''; } catch { return ''; }
  }

  // Cheap fingerprint of everything that goes into an export. Used to warn
  // before a participant's data is erased without being exported.
  function fingerprint() {
    const text = appDataText() + JSON.stringify(session.taskLog) + JSON.stringify(session.notes) + session.participantId;
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
    return hash;
  }

  function hasUnexportedData() {
    return Boolean(session.startedAt) && session.exportedHash !== fingerprint();
  }

  function statusText() {
    if (!session.startedAt) return 'No participant started yet.';
    if (hasUnexportedData()) return 'Not exported since the last change.';
    return `Exported at ${new Date(session.exportedAt).toLocaleTimeString()}.`;
  }

  const panel = el('section', 'researcher-panel');
  panel.setAttribute('aria-label', 'Researcher tools');
  panel.hidden = true;

  const toggle = makeButton('🔬 Researcher', 'researcher-toggle', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) render();
  });
  toggle.setAttribute('aria-expanded', 'false');
  document.body.append(toggle, panel);

  let timerId = null;

  function render() {
    clearInterval(timerId);
    timerId = null;
    const scrollTop = panel.scrollTop;
    const version = app.version();
    const other = version === 'A' ? 'B' : 'A';
    const status = el('p', 'rp-status', statusText());
    panel.replaceChildren();

    panel.appendChild(el('h2', 'rp-title', 'Researcher tools'));
    if (app.mode() !== 'gemini') {
      panel.appendChild(el('p', 'rp-warning',
        'Response mode is not Gemini. Switch it to Gemini API so every participant gets the same AI.'));
    }

    const idRow = el('label', 'rp-row');
    const idInput = el('input', 'rp-input');
    idInput.type = 'text';
    idInput.placeholder = 'e.g. P03';
    idInput.value = session.participantId;
    idInput.addEventListener('input', () => {
      session.participantId = idInput.value.trim();
      saveSession();
    });
    idRow.append(el('span', 'rp-label', 'Participant'), idInput);
    panel.appendChild(idRow);

    const orderRow = el('div', 'rp-row');
    orderRow.append(
      el('span', 'rp-label', 'Order'),
      el('span', 'rp-value', session.startedAt ? `${session.order[0]} first, then ${session.order[1]}` : 'Chosen when you start')
    );
    panel.appendChild(orderRow);

    const timer = el('span', 'rp-value rp-timer', '--:--');
    const timeRow = el('div', 'rp-row');
    timeRow.append(el('span', 'rp-label', 'Elapsed'), timer);
    panel.appendChild(timeRow);
    if (session.startedAt) {
      const tick = () => {
        timer.textContent = clock(Date.now() - session.startedAt);
        status.textContent = statusText();
      };
      tick();
      timerId = setInterval(tick, 1000);
    }

    panel.appendChild(makeButton('Start new participant', 'rp-button rp-primary', startNewParticipant));
    panel.appendChild(makeButton(`Switch to Version ${other}`, 'rp-button', () => {
      if (!app.busy()) app.switchTo(other);
    }));

    panel.appendChild(el('h3', 'rp-subheading', `Tasks in Version ${version}`));
    const list = el('div', 'rp-task-list');
    const conditionStart = session.conditionStartedAt[version] || session.startedAt;
    STUDY_TASKS.forEach((task, index) => {
      const logged = session.taskLog.find(t => t.version === version && t.taskIndex === index);
      const box = el('input');
      box.type = 'checkbox';
      box.checked = Boolean(logged);
      box.addEventListener('change', () => {
        session.taskLog = session.taskLog.filter(t => !(t.version === version && t.taskIndex === index));
        if (box.checked) session.taskLog.push({ version, taskIndex: index, task, completedAt: Date.now() });
        saveSession();
        render();
      });
      const row = el('label', 'rp-task-row');
      row.append(
        box,
        el('span', 'rp-task-text', task),
        el('span', 'rp-task-time', logged && conditionStart ? clock(logged.completedAt - conditionStart) : '')
      );
      list.appendChild(row);
    });
    panel.appendChild(list);

    const notesLabel = el('label', 'rp-notes-label');
    const notes = el('textarea', 'rp-notes');
    notes.rows = 3;
    notes.placeholder = 'Difficulties, hesitations, comments';
    notes.value = session.notes[version] || '';
    notes.addEventListener('input', () => {
      session.notes[version] = notes.value;
      saveSession();
      status.textContent = statusText();
    });
    notesLabel.append(el('span', 'rp-label', `Notes for Version ${version}`), notes);
    panel.appendChild(notesLabel);

    panel.appendChild(makeButton('Export session data', 'rp-button rp-export', exportSession));
    panel.appendChild(status);
    panel.appendChild(el('p', 'rp-note',
      'Only visible when the link ends with ?researcher=1. Between participants, use Start new participant, not Clear all local data, which leaves the AI with no starting memories.'));
    panel.scrollTop = scrollTop;
  }

  // Counterbalancing: with sequential IDs (P01, P02, ...), odd numbers start
  // with Version A and even numbers with Version B, so a small study ends up
  // with equal numbers in each order. A coin flip alone often would not.
  function orderFor(participantId) {
    const match = participantId.match(/(\d+)\D*$/);
    if (match) return Number(match[1]) % 2 === 1 ? ['A', 'B'] : ['B', 'A'];
    return Math.random() < 0.5 ? ['A', 'B'] : ['B', 'A'];
  }

  function startNewParticipant() {
    if (app.busy()) {
      window.alert('The AI is still replying. Try again when the reply appears.');
      return;
    }
    if (hasUnexportedData()) {
      const who = session.participantId || 'The current participant';
      if (!window.confirm(`${who}’s data has not been exported since the last change. Starting a new participant will erase it. Continue anyway?`)) return;
    }
    const id = window.prompt('This erases all chats and memories in this browser and restores the starting memories.\n\nNew participant ID (for example P03):', '');
    if (id === null) return;

    const order = orderFor(id.trim());
    const now = Date.now();
    session = {
      ...emptySession(),
      participantId: id.trim(),
      order,
      startedAt: now,
      conditionStartedAt: { [order[0]]: now },
      pendingStartVersion: order[0],
    };
    saveSession();

    // Remove only this app's saved chats and memories. With nothing saved,
    // app.js rebuilds its starting memories and example chat on reload.
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(APP_KEY_PREFIX)) localStorage.removeItem(key);
      }
    } catch { /* storage unavailable */ }
    window.location.reload();
  }

  function exportSession() {
    let appData = null;
    try { appData = JSON.parse(appDataText() || 'null'); } catch { appData = null; }
    const start = session.startedAt;
    const payload = {
      participantId: session.participantId || '(no ID)',
      conditionOrder: session.order,
      responseMode: app.mode(),
      model: app.model(),
      sessionStartedAt: iso(start),
      conditionStartedAt: { A: iso(session.conditionStartedAt.A), B: iso(session.conditionStartedAt.B) },
      exportedAt: new Date().toISOString(),
      tasks: session.taskLog
        .slice()
        .sort((a, b) => a.completedAt - b.completedAt)
        .map(t => {
          const conditionStart = session.conditionStartedAt[t.version];
          return {
            version: t.version,
            task: t.task,
            completedAt: iso(t.completedAt),
            secondsFromSessionStart: start ? Math.round((t.completedAt - start) / 1000) : null,
            secondsFromConditionStart: conditionStart ? Math.round((t.completedAt - conditionStart) / 1000) : null,
          };
        }),
      notes: session.notes,
      appData, // chats and memories for both versions, exactly as app.js saved them
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeId = (session.participantId || 'no-id').replace(/[^\w-]+/g, '_');
    link.download = `session-${safeId}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    session.exportedAt = Date.now();
    session.exportedHash = fingerprint();
    saveSession();
    if (!panel.hidden) render();
  }

  // app.js has no event for version or mode changes, so check twice a second.
  // This also records when each condition started, however the switch happened.
  let lastSeen = '';
  setInterval(() => {
    const version = app.version();
    if (session.startedAt && !session.conditionStartedAt[version]) {
      session.conditionStartedAt[version] = Date.now();
      saveSession();
    }
    const seen = `${version}|${app.mode()}`;
    if (seen !== lastSeen) {
      lastSeen = seen;
      if (!panel.hidden) render();
    }
  }, 500);
})();
