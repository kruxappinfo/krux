// Utilidades para el emulador de Storage (API REST con el mismo formato que el SDK web: subida multipart, «Authorization: Firebase <idToken>»).
const fs = require('node:fs');
const L = require('./_lib.cjs');
const HOST = `http://127.0.0.1:${L.ST_PORT}`;
const BUCKET = `${L.PROJECT}.appspot.com`;
const setRules = async (content) => {
  const r = await fetch(`${HOST}/internal/setRules`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'storage.rules', content }] } }) });
  if (!r.ok) throw new Error('setRules: ' + r.status + ' ' + (await r.text()));
};
const loadStorageRules = (file) => setRules(fs.readFileSync(file, 'utf8'));
const authHeader = (tok) => (tok === 'owner' ? { Authorization: 'Bearer owner' } : tok ? { Authorization: 'Firebase ' + tok } : {});
// Cada petición lleva un límite de tiempo: si el emulador de Storage deja de contestar (se ha observado con la CPU saturada: una petición Storage→Firestore del motor de reglas
// se queda sin respuesta), la prueba falla enseguida y con un código propio en lugar de esperar 300 s por petición; y las siguientes fallan sin esperar.
const TIMEOUT_MS = Number(process.env.KX_ST_TIMEOUT_MS || 30000);
const state = { wedged: null };
const call = async (url, init) => {
  if (state.wedged) { const e = new Error('el emulador de Storage dejó de responder antes: ' + state.wedged); e.code = 'EMULATOR_WEDGED'; throw e; }
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) }); }
  catch (err) {
    const timeout = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const e = new Error(`${timeout ? `sin respuesta en ${TIMEOUT_MS} ms` : 'fallo de red'}: ${init && init.method || 'GET'} ${decodeURIComponent(url.split('/o/').pop().split('?')[0]).slice(0, 90)}`);
    e.code = timeout ? 'EMULATOR_TIMEOUT' : 'EMULATOR_NETWORK'; if (timeout) state.wedged = e.message; throw e;
  }
};
const fail = (r, t) => { const e = new Error(`${r.status} ${t.slice(0, 80)}`); e.code = r.status === 401 || r.status === 403 ? 'permission-denied' : 'http-' + r.status; return e; };
async function upload(tok, objPath, contentType = 'image/jpeg', size = 1024) {
  const boundary = 'bnd' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: objPath, contentType });
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    Buffer.alloc(size, 7), Buffer.from(`\r\n--${boundary}--`)]);
  const r = await call(`${HOST}/v0/b/${BUCKET}/o?name=${encodeURIComponent(objPath)}`, { method: 'POST',
    headers: { ...authHeader(tok), 'X-Goog-Upload-Protocol': 'multipart', 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
async function del(tok, objPath) {
  const r = await call(`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}`, { method: 'DELETE', headers: authHeader(tok) });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
async function read(tok, objPath) {
  const r = await call(`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}?alt=media`, { headers: authHeader(tok) });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
async function meta(tok, objPath) {   // metadatos del objeto (timeCreated, etc.)
  const r = await call(`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}`, { headers: authHeader(tok) });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return JSON.parse(t);
}
async function patchMeta(tok, objPath, meta) {
  const r = await call(`${HOST}/v0/b/${BUCKET}/o/${encodeURIComponent(objPath)}`, { method: 'PATCH',
    headers: { ...authHeader(tok), 'Content-Type': 'application/json' }, body: JSON.stringify(meta) });
  const t = await r.text(); if (!r.ok) throw fail(r, t); return t;
}
// «ausente» solo si el emulador responde 404: un tiempo agotado o un error de red NO se interpretan como «no existe» (sería un falso positivo)
const present = async (objPath) => { try { await read('owner', objPath); return true; } catch (e) { if (e && e.code === 'http-404') return false; throw e; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
module.exports = { HOST, BUCKET, state, setRules, loadStorageRules, upload, del, read, meta, patchMeta, present, sleep };
