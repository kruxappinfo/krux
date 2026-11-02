// Ejecuta varias URLs seguidas en LA MISMA instancia de Chrome (mismo perfil y almacenamiento local):
// sirve para probar cierres y reinicios de la aplicación. Imprime el título final de cada paso.
// uso: node cdp-seq.mjs <timeoutPorPasoMs> <url1> <url2> ...
import { execSync } from 'node:child_process';
import { launchChrome, finishRun, titleFailed } from './chrome-profile.mjs';
const [timeoutMs, ...urls] = process.argv.slice(2);
// Perfil nuevo y vacío por ejecución (chrome-profile.mjs): se borra si todos los pasos van bien y se conserva, con su ruta en stderr, si alguno falla
const run = launchChrome(['--window-size=390,844']);
const { port } = run;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws; let failed = false; let why = '';
try {
  if (run.startError) throw run.startError;
  let targets;
  for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find(t => t.type === 'page')) break; } catch (_) {} await sleep(250); }
  const page = targets.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable');
  // El service worker de la app intercepta los GET largos (canales de Firestore) del emulador y los mantiene ~51 s tras cerrar la página:
  // con el límite de 6 conexiones de Chrome, la siguiente carga o inicio de sesión se queda esperando. KEEP_SW=1 lo conserva.
  if (!process.env.KEEP_SW) await send('Network.enable').then(() => send('Network.setBypassServiceWorker', { bypass: true }));
  for (const url of urls) {
    if (url.startsWith('!')) { console.log('$ ' + url.slice(1)); execSync(url.slice(1), { stdio: 'inherit' }); continue; }
    await send('Page.navigate', { url });
    const t0 = Date.now(); let title = '';
    while (Date.now() - t0 < Number(timeoutMs)) {
      const r = await send('Runtime.evaluate', { expression: 'document.title' });
      title = r.result?.result?.value || '';
      if (/^(T\||ERR)/.test(title)) break;
      await sleep(400);
    }
    console.log(title);
    if (/^ERR/.test(title) || titleFailed(title)) { failed = true; why = why || 'título final: ' + title.slice(0, 120); }
  }
} catch (e) { failed = true; why = String(e && e.message || e).slice(0, 160); throw e;
} finally { try { ws?.close(); } catch (_) {} await finishRun(run, !failed, why); }
