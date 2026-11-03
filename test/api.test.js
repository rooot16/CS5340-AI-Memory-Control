const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => server.close(resolve));

async function freePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitFor(base) {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${base}/api/status`);
      if (response.ok) return;
    } catch { /* server not ready yet */ }
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  assert.fail('Node server did not start');
}

test('Gemini proxy preserves A/B isolation and keeps API secret server-side', async (t) => {
  const captured = [];
  const mockGoogle = http.createServer(async (req, res) => {
    let source = '';
    for await (const chunk of req) source += chunk;
    captured.push({ path: req.url, key: req.headers['x-goog-api-key'], body: JSON.parse(source) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify({ reply: 'An iced latte would be a refreshing choice.', usedMemoryIds: [1, 2, 999, 1] }) }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 35, candidatesTokenCount: 9, totalTokenCount: 44 },
    }));
  });
  const upstreamPort = await listen(mockGoogle);
  t.after(() => close(mockGoogle));

  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      GEMINI_API_KEY: 'test-only-do-not-share',
      GEMINI_MODEL: 'gemini-3.5-flash-lite',
      GEMINI_API_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1beta`,
      PORT: String(port),
    },
    stdio: 'pipe',
  });
  t.after(() => { child.kill(); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(base);

  const status = await (await fetch(`${base}/api/status`)).json();
  assert.deepEqual(status, { configured: true, provider: 'Gemini', model: 'gemini-3.5-flash-lite' });

  const html = await (await fetch(base)).text();
  const js = await (await fetch(`${base}/app.js`)).text();
  assert.match(html, /Real Gemini API/);
  assert.doesNotMatch(`${html}${js}`, /test-only-do-not-share/);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);

  const post = async body => {
    const response = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  };

  const a = await post({ version: 'A', message: 'Recommend a drink', memories: ['User hates coffee.'] });
  assert.equal(a.status, 200);
  assert.equal(a.json.reply, 'An iced latte would be a refreshing choice.');
  assert.deepEqual(a.json.usedMemoryIds, []); // Version A source IDs stay hidden
  assert.equal(captured[0].key, 'test-only-do-not-share');
  assert.equal(captured[0].path, '/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.match(captured[0].body.systemInstruction.parts[0].text, /User likes coffee\./);
  assert.match(captured[0].body.systemInstruction.parts[0].text, /Do NOT preface normal answers/);
  assert.doesNotMatch(captured[0].body.systemInstruction.parts[0].text, /User hates coffee\./);
  assert.deepEqual(captured[0].body.contents, [{ role: 'user', parts: [{ text: 'Recommend a drink' }] }]);
  assert.equal(captured[0].body.generationConfig.maxOutputTokens, 768);
  assert.equal(captured[0].body.generationConfig.responseMimeType, 'application/json');
  assert.deepEqual(captured[0].body.generationConfig.responseSchema.required, ['reply','usedMemoryIds']);

  const b = await post({ version: 'B', message: 'Suggest something', memories: [{ id: 1, text: 'User likes tea.' }, { id: 2, text: 'User prefers hot drinks.' }] });
  assert.deepEqual(b.json.usedMemoryIds, [1, 2]); // rejects unknown / duplicate source IDs
  assert.equal(b.status, 200);
  assert.match(captured[1].body.systemInstruction.parts[0].text, /User likes tea\./);
  assert.doesNotMatch(captured[1].body.systemInstruction.parts[0].text, /User likes coffee\./);
  assert.match(captured[1].body.systemInstruction.parts[0].text, /ID 1: User likes tea\./);

  const removed = await post({ version: 'B', message: 'What do you remember?', memories: [] });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.usedMemoryIds, []);
  assert.match(captured[2].body.systemInstruction.parts[0].text, /\(none\)/);
  assert.doesNotMatch(captured[2].body.systemInstruction.parts[0].text, /User likes coffee\./);

  assert.equal((await post({ version: 'B', message: '', memories: [] })).status, 400);
  assert.equal((await post({ version: 'B', message: 'hello', memories: [{ id: 1, text: 'x'.repeat(151) }] })).status, 400);
  assert.equal((await post({ version: 'B', message: 'hello', memories: [{id:1,text:'a'},{id:1,text:'b'}] })).status, 400);
  assert.equal((await post({ version: 'B', message: 'hello', memories: [{id:'abc',text:'a'}] })).status, 400);
});

test('when no Gemini key is configured, mock mode still works and API reports unconfigured', async (t) => {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, GEMINI_API_KEY: 'your_api_key_here', PORT: String(port) },
    stdio: 'pipe',
  });
  t.after(() => { child.kill(); });
  const base = `http://127.0.0.1:${port}`;
  await waitFor(base);
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.configured, false);
  const response = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 'A', message: 'Hi' }),
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /key not configured/);
});
