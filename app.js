/*
 * AI Memory Control — A/B UI prototype
 * Vanilla HTML/CSS/JavaScript with optional server-side Google Gemini API.
 * A/B study principle: both conditions start from identical data.
 * Conversations and both versions' memories are persisted in browser localStorage. A local-data clear erases both versions.
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

// Each experiment condition has its own conversations and memory state.
// Chat data is local to this browser; no chat history is sent to the API.
const STORAGE_KEY = 'cs5340-ai-memory-chat-history-v1.5';

function newId() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function makeConversation(messages = [], title = 'New chat') {
  const now = Date.now();
  return { id: newId(), title, messages, createdAt: now, updatedAt: now };
}

function createState() {
  const exampleA = makeConversation(cloneMessages(), 'Drink recommendation');
  const exampleB = makeConversation(cloneMessages(), 'Drink recommendation');
  return {
    A: { memories: cloneMemories(), autoSave: true, conversations: [exampleA], activeChatId: exampleA.id },
    B: { memories: cloneMemories(), autoSave: true, conversations: [exampleB], activeChatId: exampleB.id },
  };
}

// Keep an empty, seed-free state after Clear all local data. Unlike Reset demo,
// this must NOT recreate example memories or messages on the next refresh.
function createClearedState() {
  const chatA = makeConversation();
  const chatB = makeConversation();
  return {
    A: { memories: [], autoSave: true, conversations: [chatA], activeChatId: chatA.id },
    B: { memories: [], autoSave: true, conversations: [chatB], activeChatId: chatB.id },
  };
}

function loadState() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
  catch { return createState(); }
  if (!stored || typeof stored !== 'object') return createState();
  const baseline = stored.cleared === true ? createClearedState() : createState();
  for (const version of ['A', 'B']) {
    const saved = stored[version];
    if (!saved || !Array.isArray(saved.conversations)) continue;
    baseline[version].autoSave = saved.autoSave !== false;
    const conversations = saved.conversations.slice(0, 60).flatMap(chat => {
      if (!chat || typeof chat.id !== 'string' || !Array.isArray(chat.messages)) return [];
      const messages = chat.messages.slice(-120).flatMap(message => {
        if (!message || !['user', 'assistant'].includes(message.role) || typeof message.text !== 'string') return [];
        const sourceMemories = Array.isArray(message.sourceMemories)
          ? message.sourceMemories.filter(m => m && Number.isSafeInteger(m.id) && typeof m.text === 'string')
            .slice(0, 25).map(m => ({ id: m.id, text: m.text.slice(0, 150) }))
          : [];
        return [{ role: message.role, text: message.text.slice(0, 6000), sourceMemories }];
      });
      return [{
        id: chat.id, title: typeof chat.title === 'string' ? chat.title.slice(0, 90) : 'New chat', messages,
        createdAt: Number(chat.createdAt) || Date.now(), updatedAt: Number(chat.updatedAt) || Date.now(),
      }];
    });
    if (!conversations.length) continue;
    baseline[version].conversations = conversations;
    baseline[version].activeChatId = conversations.some(c => c.id === saved.activeChatId)
      ? saved.activeChatId : conversations[0].id;
    if (Array.isArray(saved.memories)) {
      const clean = saved.memories.filter(m => m && Number.isSafeInteger(m.id) && m.id > 0 &&
        typeof m.text === 'string' && m.text.trim().length && m.text.length <= 150).slice(0, 25);
      baseline[version].memories = [...new Map(clean.map(m => [m.id, { id: m.id, text: m.text, ...(m.source === 'auto' ? {source: 'auto'} : {}) }])).values()];
    }
  }
  return baseline;
}

function persistState() {
  try {
    // Store only finished messages, not temporary "thinking" indicators.
    const snapshot = Object.fromEntries(['A', 'B'].map(version => [version, {
      memories: versions[version].memories,
      autoSave: versions[version].autoSave,
      activeChatId: versions[version].activeChatId,
      conversations: versions[version].conversations.map(chat => ({
        ...chat, messages: chat.messages.filter(message => !message.pending),
      })),
    }]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...snapshot, cleared: dataWasCleared, currentVersion }));
  } catch { /* The page remains usable when storage is unavailable/full. */ }
}

let versions = loadState();
let dataWasCleared = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')?.cleared === true; }
  catch { return false; }
})();
let currentVersion = (() => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')?.currentVersion === 'B' ? 'B' : 'A'; }
  catch { return 'A'; }
})();
let currentView = 'chat';
let editingId = null; // Number for edit, 'new' for add, or null.
let deletingId = null;
let nextMemoryId = Math.max(4, ...['A', 'B'].flatMap(v => versions[v].memories.map(m => m.id + 1)));
let toastTimeout = null;
let lastFocusedElement = null;
let responseMode = 'mock';
let waitingForGemini = false;
let apiAvailable = false;
let modelName = '';
let highlightedMemoryId = null;
let sidebarOpen = false;
let settingsMenuOpen = false;
let clearDialogReturnFocus = null;


function data() { return versions[currentVersion]; }
function currentChat() {
  return data().conversations.find(chat => chat.id === data().activeChatId) || data().conversations[0];
}
function chatTitle(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 32 ? `${clean.slice(0, 32).trimEnd()}…` : clean || 'New chat';
}
function closeSidebar() {
  sidebarOpen = false;
  $('#chatSidebar').classList.remove('is-open');
  $('#sidebarScrim').hidden = true;
  $('#sidebarToggle').setAttribute('aria-expanded', 'false');
}
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  $('#chatSidebar').classList.toggle('is-open', sidebarOpen);
  $('#sidebarScrim').hidden = !sidebarOpen;
  $('#sidebarToggle').setAttribute('aria-expanded', String(sidebarOpen));
}
function renderChatHistory() {
  const fragment = document.createDocumentFragment();
  $('#historyCaption').textContent = `Version ${currentVersion} · Chat history`;
  const conversations = [...data().conversations]
    .filter(chat => chat.messages.length > 0 || !dataWasCleared)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!conversations.length) {
    fragment.append(element('p', 'history-empty', 'No saved conversations yet.'));
  }
  for (const chat of conversations) {
    const row = element('div', `history-row${chat.id === data().activeChatId ? ' is-selected' : ''}`);
    const open = element('button', 'history-open');
    open.type = 'button';
    open.dataset.chatId = chat.id;
    open.title = chat.title;
    open.setAttribute('aria-current', chat.id === data().activeChatId ? 'page' : 'false');
    open.append(
      element('span', 'history-title', chat.title),
      element('span', 'history-preview', chat.messages.at(-1)?.text || 'Start a conversation'),
    );
    open.addEventListener('click', () => selectChat(chat.id));
    const remove = element('button', 'history-delete');
    remove.type = 'button';
    remove.title = 'Delete chat';
    remove.setAttribute('aria-label', `Delete chat: ${chat.title}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    remove.addEventListener('click', () => deleteChat(chat.id));
    row.append(open, remove);
    fragment.appendChild(row);
  }
  $('#chatHistory').replaceChildren(fragment);
  $('#newChat').disabled = waitingForGemini;
  if (waitingForGemini) $('#chatHistory').querySelectorAll('button').forEach(button => { button.disabled = true; });
}
function selectChat(id) {
  if (waitingForGemini || !data().conversations.some(c => c.id === id)) return;
  closeDeleteModal();
  data().activeChatId = id;
  currentView = 'chat';
  editingId = null;
  $('#messageInput').value = '';
  closeSidebar();
  persistState();
  render();
}
function startNewChat() {
  if (waitingForGemini) return;
  closeDeleteModal();
  // Re-use an empty chat rather than creating an accidental stack of blanks.
  const current = currentChat();
  if (!current || current.messages.length) {
    const chat = makeConversation();
    data().conversations.unshift(chat);
    data().activeChatId = chat.id;
  }
  currentView = 'chat';
  editingId = null;
  $('#messageInput').value = '';
  closeSidebar();
  persistState();
  render();
  $('#messageInput').focus();
}
function deleteChat(id) {
  if (waitingForGemini) return;
  const chat = data().conversations.find(c => c.id === id);
  if (!chat || !window.confirm(`Delete "${chat.title}"? This cannot be undone.`)) return;
  data().conversations = data().conversations.filter(c => c.id !== id);
  if (!data().conversations.length) data().conversations.push(makeConversation());
  if (data().activeChatId === id) data().activeChatId = data().conversations[0].id;
  currentView = 'chat';
  persistState();
  render();
  showToast('Chat deleted.');
}

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

function closeSettingsMenu(restoreFocus = false) {
  if (!settingsMenuOpen) return;
  settingsMenuOpen = false;
  $('#settingsMenu').hidden = true;
  $('#settingsMenuToggle').setAttribute('aria-expanded', 'false');
  if (restoreFocus) $('#settingsMenuToggle').focus();
}
function toggleSettingsMenu() {
  if (waitingForGemini) return;
  settingsMenuOpen = !settingsMenuOpen;
  $('#settingsMenu').hidden = !settingsMenuOpen;
  $('#settingsMenuToggle').setAttribute('aria-expanded', String(settingsMenuOpen));
  if (settingsMenuOpen) (currentVersion === 'A' ? $('#menuVersionA') : $('#menuVersionB')).focus();
}
function openClearAllDialog() {
  if (waitingForGemini) return;
  closeSettingsMenu();
  clearDialogReturnFocus = $('#settingsMenuToggle');
  const chats = ['A', 'B'].reduce((total, version) => total + versions[version].conversations.filter(c => c.messages.length > 0).length, 0);
  const memories = versions.A.memories.length + versions.B.memories.length;
  $('#clearAllSummary').textContent = `${chats} conversation${chats === 1 ? '' : 's'} and ${memories} saved memor${memories === 1 ? 'y' : 'ies'} will be removed.`;
  $('#clearAllOverlay').hidden = false;
  $('#cancelClearAll').focus();
}
function closeClearAllDialog() {
  if ($('#clearAllOverlay').hidden) return;
  $('#clearAllOverlay').hidden = true;
  if (clearDialogReturnFocus?.isConnected) clearDialogReturnFocus.focus();
  clearDialogReturnFocus = null;
}
function clearAllBrowserData() {
  if (waitingForGemini) return;
  // Clear only keys owned by THIS demo, not unrelated sites or apps.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith('cs5340-ai-memory-')) localStorage.removeItem(key);
    }
  } catch { /* Storage may be blocked; still clear the active UI. */ }
  versions = createClearedState();
  dataWasCleared = true;
  nextMemoryId = 4;
  currentVersion = 'A';
  currentView = 'chat';
  editingId = null;
  deletingId = null;
  $('#messageInput').value = '';
  closeDeleteModal();
  closeSidebar();
  closeClearAllDialog();
  persistState(); // Persist an EMPTY state marker so defaults never reappear on refresh.
  render();
  showToast('Local memories and chats cleared for both versions.');
}

function renderHeader() {
  const isB = currentVersion === 'B';
  $('#menuVersionA').classList.toggle('is-selected', !isB);
  $('#menuVersionB').classList.toggle('is-selected', isB);
  $('#menuVersionA').setAttribute('aria-pressed', String(!isB));
  $('#menuVersionB').setAttribute('aria-pressed', String(isB));
  $('#memoryNav').hidden = !isB || currentView !== 'chat';
  $('#backToChat').hidden = currentView !== 'memory';
  $('#chatView').hidden = currentView !== 'chat';
  $('#memoryView').hidden = currentView !== 'memory';
}

async function copyAssistantReply(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for browsers without the asynchronous Clipboard API.
      const input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if (!copied) throw new Error('Copy command was rejected');
    }
    showToast('Reply copied to clipboard.');
  } catch (error) {
    console.warn('Could not copy reply:', error);
    showToast('Unable to copy. Please select the reply text and copy it manually.');
  }
}

function renderMessages() {
  const container = $('#messages');
  const fragment = document.createDocumentFragment();
  for (const [index, message] of currentChat().messages.entries()) {
    const textNode = element('div', `message ${message.role}${message.pending ? ' pending' : ''}`);
    textNode.appendChild(element('span', 'message-text', message.text));
    if (message.role !== 'assistant') {
      fragment.appendChild(textNode);
      continue;
    }

    const response = element('div', 'assistant-response');
    response.appendChild(textNode);

    // Action buttons appear directly below the unboxed reply text.
    // Show Manage memory only when the response has attributed memories and Version B is active.
    if (!message.pending) {
      const actions = element('div', 'response-actions');
      actions.setAttribute('aria-label', 'Reply actions');
      const copyButton = element('button', 'response-action');
      copyButton.type = 'button';
      copyButton.title = 'Copy this reply';
      copyButton.setAttribute('aria-label', 'Copy reply');
      copyButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg><span>Copy</span>';
      copyButton.addEventListener('click', () => copyAssistantReply(message.text));
      actions.appendChild(copyButton);

      if (currentVersion === 'B' && Array.isArray(message.sourceMemories) && message.sourceMemories.length > 0) {
        const memoryButton = element('button', 'response-action response-memory-action');
        memoryButton.type = 'button';
        memoryButton.title = 'View the memories for this reply and manage saved memories';
        memoryButton.setAttribute('aria-label', 'Manage memory for this reply');
        memoryButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5.2C9.5 2.5 5.1 3.9 5 7.2c-2 1.4-2.2 4.6.2 6.2-.5 3.2 1.8 5.3 4.3 4.6 1.7.9 3.5-.2 3.5-2V7.2c0-.9-.5-1.6-1.4-2Z"/><path d="M12 5.2c2.5-2.7 6.9-1.3 7 2 2 1.4 2.2 4.6-.2 6.2.5 3.2-1.8 5.3-4.3 4.6-1.7.9-3.5-.2-3.5-2V7.2c0-.9.5-1.6 1.4-2Z"/></svg><span>Manage memory</span>';
        actions.appendChild(memoryButton);

        if (message.sourceMemories?.length) {
          const panelId = `memory-sources-${index}`;
          memoryButton.setAttribute('aria-expanded', 'false');
          memoryButton.setAttribute('aria-controls', panelId);
          const panel = element('section', 'memory-source-panel');
          panel.id = panelId;
          panel.hidden = true;
          panel.setAttribute('aria-label', 'Memories used for this response');
          const heading = element('div', 'memory-source-heading');
          heading.append(element('span', '', 'Memories used in this reply'));
          const closeButton = element('button', 'memory-panel-close', '×');
          closeButton.type = 'button';
          closeButton.setAttribute('aria-label', 'Close memory details');
          heading.appendChild(closeButton);
          panel.appendChild(heading);
          const list = element('div', 'memory-source-list');
          for (const source of message.sourceMemories) {
            const current = data().memories.find(m => m.id === source.id);
            if (!current) {
              const row = element('div', 'memory-source-row is-deleted');
              row.append(element('span', 'memory-source-row-icon', '✦'));
              const content = element('div', 'memory-source-row-content');
              content.append(element('span', 'memory-source-row-text', source.text));
              content.append(element('span', 'memory-source-meta', 'Deleted · no longer in Memory Dashboard'));
              row.appendChild(content);
              list.appendChild(row);
              continue;
            }
            const jump = element('button', 'memory-source-row');
            jump.type = 'button';
            jump.title = 'Open this memory in Manage Memory';
            jump.setAttribute('aria-label', `Open memory in dashboard: ${current.text}`);
            jump.append(element('span', 'memory-source-row-icon', '✦'));
            const content = element('span', 'memory-source-row-content');
            content.append(element('span', 'memory-source-row-text', current.text));
            if (source.text !== current.text) content.append(element('span', 'memory-source-meta', 'Updated since this reply'));
            jump.append(content, element('span', 'memory-source-arrow', '↗'));
            jump.addEventListener('click', () => jumpToMemory(source.id));
            list.appendChild(jump);
          }
          panel.appendChild(list);
          const dashboardButton = element('button', 'memory-dashboard-link', 'Open Memory Dashboard ↗');
          dashboardButton.type = 'button';
          dashboardButton.addEventListener('click', () => showView('memory'));
          panel.appendChild(dashboardButton);
          const closePanel = () => {
            panel.hidden = true;
            memoryButton.setAttribute('aria-expanded', 'false');
          };
          const togglePanel = () => {
            const opening = panel.hidden;
            container.querySelectorAll('.memory-source-panel').forEach(p => { p.hidden = true; });
            container.querySelectorAll('.response-memory-action').forEach(b => b.setAttribute('aria-expanded', 'false'));
            panel.hidden = !opening;
            if (opening) {
              memoryButton.setAttribute('aria-expanded', 'true');
              requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
            }
          };
          memoryButton.addEventListener('click', togglePanel);
          closeButton.addEventListener('click', () => { closePanel(); memoryButton.focus(); });
          panel.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); closePanel(); memoryButton.focus(); }
          });
          response.append(actions, panel);
        }
      } else {
        // No relevant memory source was reported: only show Copy.
        response.appendChild(actions);
      }
    }
    fragment.appendChild(response);
  }
  container.replaceChildren(fragment);
  const scroll = $('#chatScroll');
  requestAnimationFrame(() => { scroll.scrollTop = scroll.scrollHeight; });
}

function jumpToMemory(id) {
  if (currentVersion !== 'B') return;
  if (!data().memories.some(m => m.id === id)) {
    showToast('This memory has been deleted.');
    return;
  }
  highlightedMemoryId = id;
  showView('memory');
  requestAnimationFrame(() => {
    const row = $('#memoryList').querySelector(`[data-memory-id="${id}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const edit = row.querySelector('button');
    if (edit) edit.focus({ preventScroll: true });
  });
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
      if (target) { target.text = newText; target.source = 'manual'; }
      showToast('Memory updated.');
    }
    editingId = null;
    persistState();
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
  $('#autoMemoryToggle').checked = data().autoSave !== false;
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
    const row = element('div', `memory-item${highlightedMemoryId === memory.id ? ' is-highlighted' : ''}`);
    row.dataset.memoryId = String(memory.id);
    const textWrap = element('div', 'memory-text-wrap');
    const text = element('div', 'memory-text', memory.text);
    textWrap.appendChild(text);
    if (memory.source === 'auto') textWrap.appendChild(element('span', 'memory-origin', '✦ Auto-saved from chat'));
    const actions = element('div', 'memory-actions');
    const edit = makeSmallButton('Edit', '', () => {
      editingId = memory.id;
      renderMemoryList();
    });
    edit.setAttribute('aria-label', `Edit memory: ${memory.text}`);
    const del = makeSmallButton('Delete', 'small-button-danger', () => openDeleteModal(memory.id));
    del.setAttribute('aria-label', `Delete memory: ${memory.text}`);
    actions.append(edit, del);
    row.append(textWrap, actions);
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
  renderChatHistory();
  if (currentView === 'memory') renderMemoryList();
}

function changeVersion(version) {
  if (!VERSIONS[version] || waitingForGemini) return;
  closeSettingsMenu();
  closeDeleteModal();
  currentVersion = version;
  highlightedMemoryId = null;
  closeSidebar();
  currentView = 'chat';
  editingId = null;
  $('#messageInput').value = '';
  render();
  persistState();
}

function showView(view) {
  if (view === 'memory' && currentVersion !== 'B') return;
  currentView = view;
  if (view !== 'memory') highlightedMemoryId = null;
  closeSidebar();
  editingId = null;
  render();
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
  persistState();
  closeDeleteModal();
  renderMemoryList();
  showToast('Memory deleted.');
}

// Called after a successful reply; apply model proposals only to the current
// participant's own version-scoped browser memory list. Never persist a model's
// raw text without validation. If the same fact already exists, skip it.
function normalizeMemoryText(text) {
  return text.toLowerCase().replace(/[.,!?。！？\s]+/g, ' ').trim();
}
function applyMemoryUpdates(target, updates) {
  if (!target.autoSave || !Array.isArray(updates)) return { added: 0, updated: 0, deleted: 0 };
  const changed = { added: 0, updated: 0, deleted: 0 };
  const forbidden = /(?:password|passcode|api[ -]?key|secret[ -]?key|credit[ -]?card|social security|passport number|bank account|home address|diagnos|medical record|身份证|银行卡|密码|密钥|住址)/i;
  for (const op of updates.slice(0, 2)) {
    if (!op || !['add', 'update', 'delete'].includes(op.action) || !Number.isSafeInteger(op.memoryId) || typeof op.text !== 'string') continue;
    const clean = op.text.replace(/\s+/g, ' ').trim();
    if (op.action !== 'delete' && (!clean || clean.length > 150 || forbidden.test(clean))) continue;
    if (op.action === 'add') {
      if (op.memoryId !== 0 || target.memories.length >= 25 || target.memories.some(m => normalizeMemoryText(m.text) === normalizeMemoryText(clean))) continue;
      target.memories.push({ id: nextMemoryId++, text: clean, source: 'auto' });
      changed.added++;
    } else {
      const pos = target.memories.findIndex(m => m.id === op.memoryId);
      if (pos < 0) continue;
      if (op.action === 'delete') {
        target.memories.splice(pos, 1);
        changed.deleted++;
      } else if (normalizeMemoryText(target.memories[pos].text) !== normalizeMemoryText(clean) &&
                 !target.memories.some(m => m.id !== op.memoryId && normalizeMemoryText(m.text) === normalizeMemoryText(clean))) {
        target.memories[pos] = { ...target.memories[pos], text: clean, source: 'auto' };
        changed.updated++;
      }
    }
  }
  return changed;
}

// Mock mode supports a small, transparent set of patterns for offline demos;
// real Gemini does semantic summarization and update/deletion suggestions.
function mockMemoryUpdates(text) {
  const trimmed = text.trim();
  const firstPerson = trimmed.match(/^I (?:really )?(like|love|prefer|enjoy) ([a-z][^!?\n.]{1,65})(?:[.!。])?$/i);
  const student = trimmed.match(/^I(?: am|'m) (?:a|an) (university student|college student|game developer|software engineer)(?:[.!])?$/i);
  const cnPreference = trimmed.match(/^我(?:很|非常|更)?喜欢(.{1,36})[。！.!]?$/);
  const value = firstPerson
    ? `User ${({ like:'likes', love:'loves', prefer:'prefers', enjoy:'enjoys' })[firstPerson[1].toLowerCase()]} ${firstPerson[2].trim().replace(/[.!。]$/, '')}.`
    : student ? `User is a ${student[1]}.`
    : cnPreference ? `User likes ${cnPreference[1].trim().replace(/[。！.!]$/, '')}.`
    : null;
  return value ? [{ action: 'add', memoryId: 0, text: value }] : [];
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
  $('#settingsMenuToggle').disabled = busy;
  $('#menuVersionA').disabled = busy;
  $('#menuVersionB').disabled = busy;
  $('#clearAllData').disabled = busy;
  if (busy) closeSettingsMenu();
  $('#aiMode').disabled = busy;
  $('#newChat').disabled = busy;
  $('#chatHistory').querySelectorAll('button').forEach(button => { button.disabled = busy; });
}

function updateApiStatus(message, status = '') {
  const el = $('#apiStatus');
  el.textContent = message;
  el.className = `api-status ${status ? `is-${status}` : ''}`;
}

async function detectApi() {
  // ?mode=mock remains supported as a convenient initial testing mode.
  const forceMock = new URLSearchParams(window.location.search).get('mode') === 'mock';
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('Backend unavailable');
    const status = await response.json();
    apiAvailable = Boolean(status.configured);
    modelName = status.model || '';
    responseMode = apiAvailable && !forceMock ? 'gemini' : 'mock';
    $('#aiMode').value = responseMode;
    updateApiStatus(apiAvailable ? `${modelName} · ready` : 'API Key not configured; Mock works', apiAvailable ? 'ready' : 'error');
    $('#assistantSubtitle').textContent = responseMode === 'gemini' ? 'Your personal AI helper' : 'Demo assistant';
  } catch {
    apiAvailable = false;
    responseMode = 'mock';
    $('#aiMode').value = 'mock';
    $('#assistantSubtitle').textContent = 'Demo assistant';
    updateApiStatus('Use npm.cmd start for Gemini mode', 'error');
  }
}

async function makeRealReply(prompt, memories, version, autoSave) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: prompt, memories, version, autoSave }),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Unexpected server reply. Start the Node server with npm start.'); }
  if (!response.ok) throw new Error(result.error || 'Gemini request failed');
  if (!result.reply || typeof result.reply !== 'string') throw new Error('Model returned no text');
  return {
    reply: result.reply,
    usedMemoryIds: Array.isArray(result.usedMemoryIds) ? result.usedMemoryIds : [],
    memoryUpdates: Array.isArray(result.memoryUpdates) ? result.memoryUpdates : [],
  };
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || waitingForGemini) return;
  const target = data();
  const chat = currentChat();
  const version = currentVersion;
  if (!chat.messages.some(m => m.role === 'user')) chat.title = chatTitle(trimmed);
  chat.messages.push({ role: 'user', text: trimmed });
  chat.updatedAt = Date.now();
  persistState();
  $('#messageInput').value = '';

  if (responseMode === 'mock') {
    const result = makeMockReply(trimmed, target.memories);
    const sources = target.memories.filter(m => result.usedMemoryIds.includes(m.id));
    chat.messages.push({ role: 'assistant', text: result.reply, sourceMemories: sources.map(m => ({ ...m })) });
    chat.updatedAt = Date.now();
    const learned = applyMemoryUpdates(target, mockMemoryUpdates(trimmed));
    persistState();
    renderMessages();
    renderChatHistory();
    if (version === 'B' && learned.added) showToast(`${learned.added} memory saved from chat.`);
    $('#messageInput').focus();
    return;
  }

  // The API receives only this prompt + the CURRENT active memories.
  // Sending past assistant responses would allow deleted preferences to leak
  // back in through historical text, invalidating the memory-control study.
  const sentMemories = target.memories.map(m => ({ ...m }));
  const pending = { role: 'assistant', text: 'Gemini is thinking…', pending: true, sourceMemories: [] };
  chat.messages.push(pending);
  renderMessages();
  renderChatHistory();
  setBusy(true);
  try {
    const result = await makeRealReply(trimmed, sentMemories, version, target.autoSave);
    pending.text = result.reply;
    pending.sourceMemories = sentMemories.filter(m => result.usedMemoryIds.includes(m.id));
    const learned = applyMemoryUpdates(target, result.memoryUpdates);
    if (version === 'B' && (learned.added || learned.updated || learned.deleted)) {
      const summaries = [learned.added && `${learned.added} saved`, learned.updated && `${learned.updated} updated`, learned.deleted && `${learned.deleted} forgotten`].filter(Boolean);
      showToast(`Memory automatically ${summaries.join(', ')}. View in Manage Memory.`);
    }
  } catch (error) {
    // Keep the user message so it can be copied/retried, but show failure clearly.
    pending.text = `Request failed: ${error.message}`;
    showToast('Gemini request failed. Check the server terminal and .env file.');
  } finally {
    pending.pending = false;
    chat.updatedAt = Date.now();
    persistState();
    setBusy(false);
    renderMessages();
    renderChatHistory();
    $('#messageInput').focus();
  }
}

$('#aiMode').addEventListener('change', (event) => {
  responseMode = event.target.value;
  $('#assistantSubtitle').textContent = responseMode === 'gemini' ? 'Your personal AI helper' : 'Demo assistant';
  if (responseMode === 'gemini' && !apiAvailable) {
    showToast('Gemini requires a running Node server and a valid API key.');
  }
});
$('#settingsMenuToggle').addEventListener('click', toggleSettingsMenu);
$('#menuVersionA').addEventListener('click', () => changeVersion('A'));
$('#menuVersionB').addEventListener('click', () => changeVersion('B'));
$('#clearAllData').addEventListener('click', openClearAllDialog);
$('#cancelClearAll').addEventListener('click', closeClearAllDialog);
$('#confirmClearAll').addEventListener('click', clearAllBrowserData);
$('#clearAllOverlay').addEventListener('click', event => {
  if (event.target === $('#clearAllOverlay')) closeClearAllDialog();
});
document.addEventListener('pointerdown', event => {
  if (settingsMenuOpen && !event.target.closest('.settings-menu-wrap')) closeSettingsMenu();
});
$('#settingsMenu').addEventListener('keydown', event => {
  const items = [$('#menuVersionA'), $('#menuVersionB'), $('#clearAllData')];
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const index = items.indexOf(document.activeElement);
  const step = event.key === 'ArrowDown' ? 1 : -1;
  items[(index + step + items.length) % items.length].focus();
});
$('#newChat').addEventListener('click', startNewChat);
$('#sidebarToggle').addEventListener('click', toggleSidebar);
$('#sidebarClose').addEventListener('click', closeSidebar);
$('#sidebarScrim').addEventListener('click', closeSidebar);
$('#memoryNav').addEventListener('click', () => showView('memory'));
$('#backToChat').addEventListener('click', () => showView('chat'));
$('#chatForm').addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage($('#messageInput').value);
});
$('#autoMemoryToggle').addEventListener('change', event => {
  if (currentVersion !== 'B' || waitingForGemini) return;
  data().autoSave = event.target.checked;
  persistState();
  showToast(data().autoSave ? 'Automatic memory summarization enabled.' : 'Automatic memory summarization paused.');
});
$('#addMemory').addEventListener('click', () => {
  if (editingId !== null) return;
  editingId = 'new';
  renderMemoryList();
});
$('#cancelDelete').addEventListener('click', closeDeleteModal);
$('#confirmDelete').addEventListener('click', confirmDelete);
$('#deleteOverlay').addEventListener('click', (event) => {
  if (event.target === $('#deleteOverlay')) closeDeleteModal();
});
document.addEventListener('keydown', (event) => {
  if (!$('#clearAllOverlay').hidden) {
    if (event.key === 'Escape') { event.preventDefault(); closeClearAllDialog(); }
    if (event.key === 'Tab') {
      const first = $('#cancelClearAll'), last = $('#confirmClearAll');
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    return;
  }
  if (event.key === 'Escape' && settingsMenuOpen) { event.preventDefault(); closeSettingsMenu(true); return; }
  if (event.key === 'Escape' && sidebarOpen) { closeSidebar(); return; }
  if (event.key === 'Escape') {
    const panel = $('#messages').querySelector('.memory-source-panel:not([hidden])');
    if (panel) {
      panel.hidden = true;
      const button = $('#messages').querySelector(`[aria-controls="${panel.id}"]`);
      if (button) { button.setAttribute('aria-expanded', 'false'); button.focus(); }
      return;
    }
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

render();
detectApi();
