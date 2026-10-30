// Mini cliente CDP: abre una URL en Chrome headless y espera a que document.title cambie (tiempo real)
import { spawn } from 'node:child_process';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
const [url, doneRe = '^(T\\||ERR)', timeoutMs = '90000', width = '500', height = '900'] = process.argv.slice(2);
const port = 9340 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--window-size=${width},${height}`, '--user-data-dir=/private/tmp/claude-501/cdp-profile-' + port, '--no-first-run', ...(process.env.CHROME_FLAGS||'').split(' ').filter(Boolean), 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (_) {} await sleep(250); }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  const consoleLog = process.env.CONSOLE_LOG; if (consoleLog) writeFileSync(consoleLog, '');
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (consoleLog && (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown')) appendFileSync(consoleLog, Date.now() + ' ' + (m.method === 'Runtime.exceptionThrown' ? 'EXC ' + JSON.stringify(m.params.exceptionDetails.text) : (m.params.type + ' ' + m.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ').slice(0, 400))) + '\n');
  });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url });
  // SHOTS_DIR: capturas de pantalla bajo demanda (la página pone el título «S|nombre»; SHOT_W recorta al ancho de la maqueta)
  const shots = process.env.SHOTS_DIR; const seenShots = new Set(); if (shots) mkdirSync(shots, { recursive: true });
  const re = new RegExp(doneRe); const t0 = Date.now(); let title = '';
  while (Date.now() - t0 < Number(timeoutMs)) {
    const r = await send('Runtime.evaluate', { expression: 'document.title' });
    title = r.result?.result?.value || '';
    if (shots && /^S\|/.test(title) && !seenShots.has(title)) {
      seenShots.add(title);
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Number(process.env.SHOT_W || width), height: Number(height), scale: 2 } });
      writeFileSync(`${shots}/${title.slice(2)}.png`, Buffer.from(shot.result.data, 'base64'));
      continue;
    }
    if (re.test(title)) break;
    await sleep(shots ? 150 : 400);
  }
  console.log(title);
} finally { try { ws?.close(); } catch (_) {} chrome.kill('SIGKILL'); }
