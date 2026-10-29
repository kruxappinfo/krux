// Ejecuta varias URLs seguidas en LA MISMA instancia de Chrome (mismo perfil y almacenamiento local):
// sirve para probar cierres y reinicios de la aplicación. Imprime el título final de cada paso.
// uso: node cdp-seq.mjs <timeoutPorPasoMs> <url1> <url2> ...
import { spawn } from 'node:child_process';
const [timeoutMs, ...urls] = process.argv.slice(2);
const port = 9340 + Math.floor(Math.random() * 500);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, '--window-size=390,844', '--user-data-dir=/private/tmp/claude-501/cdp-profile-' + port, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws;
try {
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (_) {} await sleep(250); }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  for (const url of urls) {
    await send('Page.navigate', { url });
    const t0 = Date.now(); let title = '';
    while (Date.now() - t0 < Number(timeoutMs)) {
      const r = await send('Runtime.evaluate', { expression: 'document.title' });
      title = r.result?.result?.value || '';
      if (/^(T\||ERR)/.test(title)) break;
      await sleep(400);
    }
    console.log(title);
  }
} finally { try { ws?.close(); } catch (_) {} chrome.kill('SIGKILL'); }
