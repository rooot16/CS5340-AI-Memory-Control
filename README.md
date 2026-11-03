# AI Memory Control — Gemini v2.0 (Automatic Memory Summarization)

A lightweight CS5340 HCI A/B web prototype built with **plain HTML, CSS, JavaScript, and Node.js**. No npm packages or database are required. Both versions use Google Gemini to answer questions and automatically summarize suitable user-stated information into durable browser-local memory.

## Start in VS Code

1. Install **Node.js 20.6+**.
2. Copy `.env.example` to `.env` and paste your Google AI Studio key into `GEMINI_API_KEY`.
3. Run `npm.cmd start` in PowerShell (or `npm start` in Command Prompt).
4. Open `http://127.0.0.1:3000`.

For offline demo mode, choose **Mock AI** in Response mode. Mock AI uses a deliberately small set of literal first-person patterns to simulate auto-saving (for example, `I like green tea.`); true semantic summarization is provided by Gemini.

## Automatic memory summarization

- After **each successful Gemini reply**, the **same API request** also returns structured `memoryUpdates` suggestions. There is **no additional model request** per message.
- The model is instructed to remember only **stable, explicitly stated, non-sensitive user facts/preferences**, and to ignore casual questions, temporary instructions, and private secrets.
- It proposes **add / update / delete** operations. `delete` is permitted only when the current user message explicitly requests that the matching memory be forgotten. Suggestions are validated by the server **and again in the browser**. There is basic exact-string de-duplication and a maximum of 25 memories per version. Semantic extraction may still make mistakes; users should review entries.
- A saved memory is marked **✦ Auto-saved from chat** in the Version B dashboard. Version B also has an **Automatically summarize memories** on/off switch, stored across reloads. Version A learns automatically but intentionally hides memory management controls, preserving the HCI A/B UI comparison.
- Newly saved memories are used on **subsequent** replies, not retroactively in the original response. Model-reported reply attribution remains available only in Version B.
- Memory and chat history are saved in **this browser's `localStorage`**, separate for A and B. Other browsers/devices don't share them. Manual edits and deletes take effect in future prompts.
- Previously deleted memory is **not re-extracted from older chat history**: only the **current** user message and currently saved memory list are sent to Gemini. If the user states the preference again, it may be saved again.
- Use the top-right menu's **Clear all local data** to erase both versions' chats and saved memories in this browser. This does not erase information previously transmitted to the API provider.

## Technical layout

- `index.html` — accessible full-window UI: chat sidebar, A/B menu, Memory Dashboard
- `styles.css` — responsive styling
- `app.js` — localStorage, chat actions, auto-memory operations and validation
- `server.js` — Node.js HTTP server and Gemini proxy. Keeps `GEMINI_API_KEY` outside the browser.
- `test/` — Node.js API regression tests and Playwright browser interaction tests

The Gemini proxy uses Google `generateContent` + a structured JSON schema requiring `reply`, `usedMemoryIds`, and `memoryUpdates`. See Google's [structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output) for background. The model's `usedMemoryIds` are **self-reported** and are not a proven explanation of internal reasoning.

## Test and deployment

```bash
npm test
```

If Playwright / Chromium are installed, run:

```bash
python test/auto_memory_test.py
python test/browser_storage_test.py
python test/browser_reply_actions_test.py
```

To deploy on Render: commit the source (but **never `.env`**) to GitHub. Configure a Render **Node Web Service** with start command **`node server.js`** and set environment variables `GEMINI_API_KEY`, `GEMINI_MODEL`, `HOST=0.0.0.0`. Render provides `PORT` automatically.

**Public demo safety:** The included API endpoint is not authenticated or rate-limited. Add a password or server-side rate limiting before broadly publishing it. Automatic memory is a prototype: do not enter passwords, sensitive personal data, or real participant data without informed consent. The `localStorage` data is not encrypted, and sending prompts to a provider may have separate retention/data-use implications. API use may incur charges or limits.
