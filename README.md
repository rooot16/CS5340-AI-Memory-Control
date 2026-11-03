# AI Memory Control — A/B UI + Gemini API

A CS5340 HCI interactive prototype: **Version A** hides remembered preferences; **Version B** shows an editable memory management interface. Both start with identical memories. Includes deterministic **Mock AI** and **Real Gemini API** modes, with **click-to-edit memory source chips** beneath Version B replies.

## Quick start in VS Code (Windows)

1. Install **Node.js 20.6+**. Open the `AI_Memory_AB_Gemini` folder in VS Code.
2. Get a Gemini API key at <https://aistudio.google.com/api-keys>.
3. In the VS Code **PowerShell** terminal, run:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Open `.env`, replace `your_api_key_here` with your entire Gemini API key. Keep it private.
5. Start the local website:

   ```powershell
   npm.cmd start
   ```

6. Open <http://127.0.0.1:3000>. When the API key is recognized, **Real Gemini API** is selected automatically. You can switch to **Mock AI** at any time.

On macOS/Linux, use `cp .env.example .env` and `npm start` instead. **No `npm install` is needed**: this project uses only built-in Node.js APIs and browser JavaScript.

If you see `API key not configured; Mock works`, check that `.env` exists beside `server.js`, the key is filled in, and you restarted Node with `Ctrl+C` then `npm.cmd start`.

## Configuration

Edit `.env` (not `.env.example`):

```dotenv
GEMINI_API_KEY=your_actual_google_ai_studio_key
GEMINI_MODEL=gemini-3.5-flash-lite
PORT=3000
```

The default model is **`gemini-3.5-flash-lite`**. Model availability and free-tier quotas vary by project; check <https://ai.google.dev/gemini-api/docs/models> and <https://ai.google.dev/gemini-api/docs/pricing>. If your Google project cannot access that model, select a supported model in `.env` and restart the server.

## Request flow

```text
Browser UI (index.html + app.js)
    POST /api/chat  { message, version, memories }
         |
Node.js server (server.js; reads GEMINI_API_KEY from .env)
    POST /v1beta/models/{model}:generateContent
    x-goog-api-key: <server-side key>
         |
    Gemini API → JSON with natural reply + memory IDs
         |
Browser UI  { reply, usedMemoryIds }
```

The browser **never receives** the Gemini API key. The server also restricts static file serving to public UI files, so `.env` and `server.js` cannot be fetched through its local web server.

### A/B experimental semantics

- **A: Hidden Memory** — same seeded memories, no management interface; API server uses a fixed memory list even if someone tampers with browser state.
- **B: Manage Memory** — memory entries are visible, editable, addable, and deletable. The next Gemini request includes only the current B memory list. Every memory is assigned a stable numeric ID for source linking.
- **Same underlying AI** — both versions use identical model and prompting rules to isolate interface visibility/control.
- **Version B attribution** — Relevant assistant replies display **Based on memory: [memory text]**. Click an individual chip to edit that memory in a pop-up, without leaving chat. The edit changes future responses; earlier reply text and citations are preserved as historical snapshots. Deleted citations become disabled.
- **Version A attribution** — Version A deliberately hides memory-source chips and the edit dialog to preserve the hidden-memory comparison.
- **Gemini structured response** — Gemini returns `{ reply, usedMemoryIds }`, and the backend validates IDs against the submitted current memory list. Attribution is **self-reported by the model**, not a definitive proof of which tokens or memories caused the response.
- **Mock** — returns predictable, hard-coded example replies and source IDs; does not use tokens or require an API key.
- **Real Gemini** — asks Gemini for a natural reply (without repeated “Since you…” preambles) and memory IDs; sends only the current question plus currently active memories; *does not send earlier chat turns*, so deleted memory cannot reappear indirectly from prior model responses. As a trade-off, multi-turn context is not supported.
- **Persistence** — edits and chat are in memory in the current browser page; refresh and **Reset demo** restore starter memories. The app does **not** automatically extract new memories from chat.

Free-tier API content may be used by Google to improve products; use **fictional participant memory data** in an HCI study, or review data processing requirements before collecting real information.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `npm.ps1 cannot be loaded` | Use `npm.cmd start` in PowerShell (no policy change needed). |
| `API key not configured; Mock works` | Create `.env` in project root, paste entire Gemini key, restart. |
| `Gemini API access denied` | Check the Google AI Studio project, key permissions, and model availability. |
| `Gemini model not found` | Choose a model available in your Google AI Studio project. |
| `Gemini free-tier rate limit / quota reached` | Check AI Studio quotas, wait, or switch to Mock. |
| `Unexpected server reply` | Use `http://127.0.0.1:3000` instead of opening `index.html` or VS Code Live Server. |
| Port 3000 occupied | In `.env` use `PORT=3001`, restart, and open `http://127.0.0.1:3001`. |

## Project files

```text
AI_Memory_AB_Gemini/
├── index.html             A/B and chat/memory UI
├── styles.css             Layout and theme
├── app.js                 Memory editing, mock mode, Gemini mode
├── server.js              Local server and Gemini API proxy
├── .env.example           Copy to .env and fill in your Gemini key
├── .gitignore             Excludes .env
├── package.json           npm start / npm test
├── README.md              English instructions
├── 快速开始_中文.md          Chinese instructions
└── test/api.test.js       Local integration tests with mock upstream
```

Run tests with `npm.cmd test` on Windows (or `npm test` on macOS/Linux). The tests do **not** call real Google servers or consume your free API quota.

## Deployment note

This is a classroom/local prototype, *not* a public multi-user production backend. Before publishing it, add authentication, rate limits, usage controls, a proper per-participant memory store, HTTPS, and a privacy notice. Deploy the **Node server together with the frontend**; static-only GitHub Pages hosting cannot call `/api/chat`.
