/*
 * AI Memory Control — A/B UI prototype
 * Vanilla HTML/CSS/JavaScript with optional server-side Google Gemini API.
 * A/B study principle: both conditions start from identical data.
 * All state is kept in memory; refreshing or "Reset demo" restores the baseline.
 */

const INITIAL_MEMORIES = Object.freeze([
  { id: 1, text: 'User likes coffee.' },
  { id: 2, text: 'User prefers cold drinks.' },
  { id: 3, text: 'User is a university student.' },
]);

const INITIAL_MESSAGES = Object.freeze([
  { role: 'user', text: 'Can you recommend a drink for me?' },
  { role: 'assistant', text: 'An iced latte would be a refreshing choice.', sourceMemories: [
    { id: 1, text: 'User likes coffee.' },
    { id: 2, text: 'User prefers cold drinks.' },
  ] },
]);

const VERSIONS = {
  A: {
    label: 'Hidden Memory',
    description: 'Version A: the assistant remembers preferences, but memory controls are hidden.',
    guideTitle: 'Version A — Hidden Memory',
    guideDescription: 'The assistant uses personal preferences in its responses, but the interface does not give users a way to inspect or change stored memories.',
    tasks: [
      "Read the assistant's drink recommendation.",
      'Try to find where the assistant stores preferences.',
      'Try asking what the assistant remembers.',
    ],
  },
  B: {
    label: 'Manage Memory',
    description: 'Version B: users can inspect, edit, add, and delete stored AI memories.',
    guideTitle: 'Version B — Manage Memory',
    guideDescription: 'A visible Manage Memory entry lets users inspect what the AI remembers, edit outdated preferences, add information, and delete memories.',
    tasks: [
      'Open Manage Memory from the assistant header.',
      'Edit a preference or delete a memory.',
      'Return to chat and request a new recommendation.',
    ],
  },
};

const $ = (selector) => document.querySelector(selector);
const cloneMemories = () => INITIAL_MEMORIES.map(({ id, text }) => ({ id, text }));
const cloneMessages = () => INITIAL_MESSAGES.map(({ role, text, sourceMemories }) => ({
  role, text, sourceMemories: sourceMemories?.map(m => ({ ...m })) || [],
}));

function createState() {
  return {
    A: { memories: cloneMemories(), messages: cloneMessages() },
    B: { memories: cloneMemories(), messages: cloneMessages() },
  };
}

let versions = createState();
let currentVersion = 'A';
let currentView = 'chat';
let editingId = null; // Number for edit, 'new' for add, or null.
let deletingId = null;
let nextMemoryId = 4;
let toastTimeout = null;
let lastFocusedElement = null;
let responseMode = 'mock';
let waitingForGemini = false;
let apiAvailable = false;
let modelName = '';
let quickEditId = null;
let quickEditReturnFocus = null;


function data() { return versions[currentVersion]; }

// User-generated strings enter the DOM only via textContent/value, never innerHTML.
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 2500);
}

function renderHeader() {
  const isB = currentVersion === 'B';
  $('#versionA').classList.toggle('is-active', !isB);
  $('#versionB').classList.toggle('is-active', isB);
  $('#versionA').setAttribute('aria-pressed', String(!isB));
  $('#versionB').setAttribute('aria-pressed', String(isB));
  $('#conditionDescription').textContent = VERSIONS[currentVersion].description;
  $('#guideTitle').textContent = VERSIONS[currentVersion].guideTitle;
  $('#guideDescription').textContent = VERSIONS[currentVersion].guideDescription;
  $('#previewState').textContent = `VERSION ${currentVersion} · ${currentView === 'chat' ? 'CHAT' : 'MANAGE MEMORY'}`;

  const tasks = $('#taskList');
  tasks.replaceChildren(...VERSIONS[currentVersion].tasks.map((task) => element('li', '', task)));
  $('#memoryNav').hidden = !isB || currentView !== 'chat';
  $('#backToChat').hidden = currentView !== 'memory';
  $('#chatView').hidden = currentView !== 'chat';
  $('#memoryView').hidden = currentView !== 'memory';
}

function renderMessages() {
  const container = $('#messages');
  const fragment = document.createDocumentFragment();
  for (const message of data().messages) {
    const bubble = element('div', `message ${message.role}${message.pending ? ' pending' : ''}`, message.text);
    if (message.role !== 'assistant') {
      fragment.appendChild(bubble);
      continue;
    }
    const response = element('div', 'assistant-response');
    response.appendChild(bubble);
    // Version A has no memory UI. Version B shows citations for memories
    // selected by Gemini, with snapshot text from the moment of generation.
    if (currentVersion === 'B' && !message.pending && message.sourceMemories?.length) {
      const citations = element('div', 'memory-attribution');
      citations.appendChild(element('span', 'attribution-label', 'Based on memory:'));
      for (const source of message.sourceMemories) {
        const current = data().memories.find(m => m.id === source.id);
        const chip = element('button', `memory-source-chip${current ? '' : ' is-removed'}`, source.text);
        chip.type = 'button';
        if (current) {
          chip.title = 'Click to edit this memory';
          chip.setAttribute('aria-label', `Edit memory used for this reply: ${source.text}`);
          chip.addEventListener('click', () => openQuickEditMemory(source.id));
        } else {
          chip.disabled = true;
          chip.title = 'This memory has since been deleted';
          chip.textContent = `${source.text} (deleted)`;
        }
        citations.appendChild(chip);
      }
      response.appendChild(citations);
    }
    fragment.appendChild(response);
  }
  container.replaceChildren(fragment);
  const scroll = $('#chatScroll');
  requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
}

function makeSmallButton(label, className, handler) {
  const button = element('button', `small-button ${className}`, label);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

function memoryEditRow(memory) {
  const row = element('div', 'memory-item is-editing');
  const input = element('input', 'memory-edit-input');
  input.type = 'text';
  input.maxLength = 150;
  input.placeholder = 'Enter a memory...';
  input.setAttribute('aria-label', 'Edit memory text');
  input.value = memory?.text ?? '';

  const save = () => {
    const newText = input.value.trim();
    if (!newText) {
      input.focus();
      showToast('Memory cannot be empty.');
      return;
    }
    if (editingId === 'new') {
      data().memories.push({ id: nextMemoryId++, text: newText });
      showToast('Memory added.');
    } else {
      const target = data().memories.find((m) => m.id === editingId);
      if (target) target.text = newText;
      showToast('Memory updated.');
    }
    editingId = null;
    renderMemoryList();
  };
  const cancel = () => {
    editingId = null;
    renderMemoryList();
  };
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  });

  const actions = element('div', 'memory-actions');
  actions.append(
    makeSmallButton('Save', '', save),
    makeSmallButton('Cancel', '', cancel)
  );
  row.append(input, actions);
  return { row, input };
}

function renderMemoryList() {
  const container = $('#memoryList');
  const memories = data().memories;
  $('#memoryCount').textContent = `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}`;
  const fragment = document.createDocumentFragment();
  let focusTarget = null;

  if (memories.length === 0 && editingId !== 'new') {
    fragment.append(element('div', 'empty-memories', 'No memories saved yet. You can add one below.'));
  }

  for (const memory of memories) {
    if (editingId === memory.id) {
      const edit = memoryEditRow(memory);
      fragment.append(edit.row);
      focusTarget = edit.input;
      continue;
    }
    const row = element('div', 'memory-item');
    const text = element('div', 'memory-text', memory.text);
    const actions = element('div', 'memory-actions');
    const edit = makeSmallButton('Edit', '', () => {
      editingId = memory.id;
      renderMemoryList();
    });
    edit.setAttribute('aria-label', `Edit memory: ${memory.text}`);
    const del = makeSmallButton('Delete', 'small-button-danger', () => openDeleteModal(memory.id));
    del.setAttribute('aria-label', `Delete memory: ${memory.text}`);
    actions.append(edit, del);
    row.append(text, actions);
    fragment.append(row);
  }

  if (editingId === 'new') {
    const newEntry = memoryEditRow(null);
    fragment.append(newEntry.row);
    focusTarget = newEntry.input;
  }

  container.replaceChildren(fragment);
  $('#addMemory').disabled = editingId !== null;
  if (focusTarget) focusTarget.focus();
}

function render() {
  renderHeader();
  renderMessages();
  if (currentView === 'memory') renderMemoryList();
}

function changeVersion(version) {
  if (!VERSIONS[version]) return;
  closeQuickEditModal();
  closeDeleteModal();
  currentVersion = version;
  currentView = 'chat';
  editingId = null;
  $('#messageInput').value = '';
  render();
}

function showView(view) {
  if (view === 'memory' && currentVersion !== 'B') return;
  currentView = view;
  editingId = null;
  render();
}

// Memory citation -> single-click inline editor dialog, without leaving chat.
function openQuickEditMemory(id) {
  if (currentVersion !== 'B' || currentView !== 'chat') return;
  const memory = data().memories.find(m => m.id === id);
  if (!memory) { showToast('This memory has been deleted.'); return; }
  quickEditId = id;
  quickEditReturnFocus = document.activeElement;
  $('#quickEditInput').value = memory.text;
  $('#quickEditOverlay').hidden = false;
  $('#quickEditInput').focus();
  $('#quickEditInput').select();
}

function closeQuickEditModal() {
  if ($('#quickEditOverlay').hidden) return;
  $('#quickEditOverlay').hidden = true;
  quickEditId = null;
  if (quickEditReturnFocus?.isConnected) quickEditReturnFocus.focus();
  quickEditReturnFocus = null;
}

function saveQuickEditMemory() {
  if (quickEditId === null || currentVersion !== 'B') return;
  const input = $('#quickEditInput');
  const text = input.value.trim();
  if (!text) { showToast('Memory cannot be empty.'); input.focus(); return; }
  const memory = data().memories.find(m => m.id === quickEditId);
  if (!memory) { closeQuickEditModal(); showToast('Memory no longer exists.'); return; }
  memory.text = text;
  closeQuickEditModal();
  // Existing replies retain original citations, as a historical snapshot;
  // the new memory text affects subsequent Gemini requests only.
  showToast('Memory updated. Future replies will use the change.');
}

function openDeleteModal(id) {
  const memory = data().memories.find((m) => m.id === id);
  if (!memory) return;
  deletingId = id;
  lastFocusedElement = document.activeElement;
  $('#deleteMemoryPreview').textContent = memory.text;
  $('#deleteOverlay').hidden = false;
  $('#cancelDelete').focus();
}

function closeDeleteModal() {
  if ($('#deleteOverlay').hidden) return;
  $('#deleteOverlay').hidden = true;
  deletingId = null;
  if (lastFocusedElement?.isConnected) lastFocusedElement.focus();
  lastFocusedElement = null;
}

function confirmDelete() {
  if (deletingId === null) return;
  data().memories = data().memories.filter((m) => m.id !== deletingId);
  closeDeleteModal();
  renderMemoryList();
  showToast('Memory deleted.');
}

function makeMockReply(prompt, memories) {
  // Deterministic mock attribution: only relevant memory IDs are attached.
  const query = prompt.toLowerCase();
  const matches = pattern => memories.filter(m => pattern.test(m.text.toLowerCase()));
  const coffeeDislike = matches(/\b(dislike|dislikes|hate|hates|avoid|avoids)\s+coffee\b/);
  const coffeeLike = matches(/\b(like|likes|love|loves|prefer|prefers)\s+coffee\b/);
  const teaLike = matches(/\b(like|likes|love|loves|prefer|prefers)\s+tea\b/);
  const cold = matches(/\b(cold|iced|chilled)\b/);
  const student = matches(/\b(student|university|school)\b/);
  const answer = (reply, sources = []) => ({
    reply, usedMemoryIds: [...new Set(sources.map(m => m.id))],
  });

  if (/remember|memory|memories|know about me|stored|recall/.test(query)) {
    if (!memories.length) return answer("I don't currently have any saved memories about you.");
    return answer(`Here's what I remember about you:\n${memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n')}`, memories);
  }
  if (/drink|beverage|coffee|latte|tea|recommend/.test(query)) {
    if (teaLike.length) return answer('An iced jasmine tea could be a great choice.', [...teaLike, ...cold]);
    if (coffeeDislike.length) return answer('A refreshing iced fruit tea sounds like a good option.', [...coffeeDislike, ...cold]);
    if (coffeeLike.length && cold.length) return answer('An iced latte would be a refreshing choice.', [...coffeeLike, ...cold]);
    if (coffeeLike.length) return answer('A cappuccino would be a lovely choice.', coffeeLike);
    if (cold.length) return answer('Try a chilled lemonade with fresh mint.', cold);
    return answer('A refreshing herbal tea might be worth trying.');
  }
  if (/study|exam|learn|homework|class/.test(query)) {
    return student.length
      ? answer('Try studying in focused 25-minute blocks with short breaks between sessions.', student)
      : answer('Try a 25-minute focused session followed by a 5-minute break.');
  }
  return answer('I can help with suggestions, study tips, and questions about saved memories.');
}

function setBusy(busy) {
  waitingForGemini = busy;
  $('#messageInput').disabled = busy;
  $('#sendMessage').disabled = busy;
  $('#resetDemo').disabled = busy;
  $('#versionA').disabled = busy;
  $('#versionB').disabled = busy;
  $('#aiMode').disabled = busy;
  document.querySelectorAll('[data-prompt]').forEach((button) => { button.disabled = busy; });
}

function updateApiStatus(message, status = '') {
  const el = $('#apiStatus');
  el.textContent = message;
  el.className = `api-status ${status ? `is-${status}` : ''}`;
}

async function detectApi() {
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('Backend unavailable');
    const status = await response.json();
    apiAvailable = Boolean(status.configured);
    modelName = status.model || '';
    if (apiAvailable) {
      responseMode = 'gemini';
      $('#aiMode').value = 'gemini';
      updateApiStatus(`${modelName} · ready`, 'ready');
    } else {
      updateApiStatus('API Key not configured; Mock works', 'error');
    }
  } catch {
    // Opening index.html directly or with Live Server supports mock mode only.
    updateApiStatus('Use npm.cmd start for Gemini mode', 'error');
  }
}

async function makeRealReply(prompt, memories, version) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prompt, memories, version }),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Unexpected server reply. Start the Node server with npm start.'); }
  if (!response.ok) throw new Error(result.error || 'Gemini request failed');
  if (!result.reply || typeof result.reply !== 'string') throw new Error('Model returned no text');
  return {
    reply: result.reply,
    usedMemoryIds: Array.isArray(result.usedMemoryIds) ? result.usedMemoryIds : [],
  };
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || waitingForGemini) return;
  const target = data();
  const version = currentVersion;
  target.messages.push({ role: 'user', text: trimmed });
  $('#messageInput').value = '';

  if (responseMode === 'mock') {
    const result = makeMockReply(trimmed, target.memories);
    const sources = target.memories.filter(m => result.usedMemoryIds.includes(m.id));
    target.messages.push({ role: 'assistant', text: result.reply, sourceMemories: sources.map(m => ({ ...m })) });
    renderMessages();
    $('#messageInput').focus();
    return;
  }

  // The API receives only this prompt + the CURRENT active memories.
  // Sending past assistant responses would allow deleted preferences to leak
  // back in through historical text, invalidating the memory-control study.
  const sentMemories = target.memories.map(m => ({ ...m }));
  const pending = { role: 'assistant', text: 'Gemini is thinking…', pending: true, sourceMemories: [] };
  target.messages.push(pending);
  renderMessages();
  setBusy(true);
  try {
    const result = await makeRealReply(trimmed, sentMemories, version);
    pending.text = result.reply;
    pending.sourceMemories = sentMemories.filter(m => result.usedMemoryIds.includes(m.id));
  } catch (error) {
    // Keep the user message so it can be copied/retried, but show failure clearly.
    pending.text = `Request failed: ${error.message}`;
    showToast('Gemini request failed. Check the server terminal and .env file.');
  } finally {
    pending.pending = false;
    setBusy(false);
    renderMessages();
    $('#messageInput').focus();
  }
}

$('#versionA').addEventListener('click', () => changeVersion('A'));
$('#aiMode').addEventListener('change', (event) => {
  responseMode = event.target.value;
  if (responseMode === 'gemini' && !apiAvailable) showToast('Gemini requires a running Node server and a valid API key.');
});
$('#versionB').addEventListener('click', () => changeVersion('B'));
$('#memoryNav').addEventListener('click', () => showView('memory'));
$('#backToChat').addEventListener('click', () => showView('chat'));
$('#chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage($('#messageInput').value);
});
document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => sendMessage(button.dataset.prompt));
});
$('#addMemory').addEventListener('click', () => {
  if (editingId !== null) return;
  editingId = 'new';
  renderMemoryList();
});
$('#cancelQuickEdit').addEventListener('click', closeQuickEditModal);
$('#saveQuickEdit').addEventListener('click', saveQuickEditMemory);
$('#quickEditInput').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); saveQuickEditMemory(); }
});
$('#quickEditOverlay').addEventListener('click', event => {
  if (event.target === $('#quickEditOverlay')) closeQuickEditModal();
});
$('#cancelDelete').addEventListener('click', closeDeleteModal);
$('#confirmDelete').addEventListener('click', confirmDelete);
$('#deleteOverlay').addEventListener('click', (event) => {
  if (event.target === $('#deleteOverlay')) closeDeleteModal();
});
document.addEventListener('keydown', (event) => {
  if (!$('#quickEditOverlay').hidden) {
    if (event.key === 'Escape') { event.preventDefault(); closeQuickEditModal(); }
    if (event.key === 'Tab') {
      const controls = [$('#quickEditInput'), $('#cancelQuickEdit'), $('#saveQuickEdit')];
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if ($('#deleteOverlay').hidden) return;
  if (event.key === 'Escape') closeDeleteModal();
  // Keep keyboard focus on the dialog while it is displayed.
  if (event.key === 'Tab') {
    const first = $('#cancelDelete');
    const last = $('#confirmDelete');
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
$('#resetDemo').addEventListener('click', () => {
  closeQuickEditModal();
  closeDeleteModal();
  versions = createState();
  nextMemoryId = 4;
  editingId = null;
  currentView = 'chat';
  $('#messageInput').value = '';
  render();
  showToast('Both versions have been reset.');
});

render();
detectApi();
