// route-photos.js (cliente de fotos de vía): carga el código REAL en un entorno simulado (sin red ni Firebase) y comprueba el orden de las
// operaciones, el formato que exigen las reglas de la Fase 0c, la limpieza ante fallos parciales y los reintentos.
// Las reglas en sí se prueban en tests/integration/rules/phase0 (emulador); aquí se verifica que el CLIENTE cumple el contrato de las reglas.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'route-photos.js'), 'utf8');
const SRC_FULL = SRC;
const STORAGE_RULES = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
const FS_RULES = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0c.proposal'), 'utf8');

const err = (code) => Object.assign(new Error('sim ' + code), { code });

// Firestore y Storage en memoria, con interruptores de fallo
function boot({ uid = 'u1', email = 'u1@test.dev', fail = {}, prepare, loggedIn = true, clock, preload = {} } = {}) {
  const docs = new Map(), files = new Map(), calls = [], count = {};
  const ls = { ...preload };
  // fail[nombre](n) devuelve un Error (falla antes de ejecutar) o { after: true, error } (la operación SÍ se ejecuta y el cliente ve un error: respuesta perdida)
  const step = async (name, fn) => {
    calls.push(name); count[name] = (count[name] || 0) + 1;
    const f = fail[name] ? fail[name](count[name]) : null;
    if (f && f.hang) return new Promise(() => {});   // la operación no termina nunca (app cerrada a mitad)
    if (f && !f.after) throw f;
    const out = await fn();
    if (f && f.after) throw f.error;
    return out;
  };
  const FieldValue = { serverTimestamp: () => ({ __ts: true }) };
  const snap = (id, data) => ({ id, exists: data !== undefined, data: () => data });
  const db = {
    collection: (c) => ({
      doc: (id) => ({ id, c, set: (d) => step('doc.set', async () => { if (docs.has(c + '/' + id)) throw err('permission-denied'); docs.set(c + '/' + id, { ...d }); }),
        get: () => step('doc.get', async () => snap(id, docs.get(c + '/' + id))), delete: () => step('doc.delete', async () => { docs.delete(c + '/' + id); }) }),
      where: () => ({ where: () => ({ get: async () => ({ empty: true, docs: [] }) }) })
    }),
    batch: () => { const ops = []; return { delete: (r) => ops.push(['d', r]), set: (r, d) => ops.push(['s', r, d]),
      commit: () => step('batch.commit', async () => { for (const [t, r, d] of ops) { if (t === 'd') docs.delete(r.c + '/' + r.id); else docs.set(r.c + '/' + r.id, d); } }) }; }
  };
  const storage = { app: { options: { storageBucket: 'climbmaps-80cae.firebasestorage.app' } },
    ref: () => ({ child: (p) => ({ put: (d, m) => step('file.put', async () => { files.set(p, { size: d.size, meta: m }); }),
      getMetadata: () => step('file.getMetadata', async () => { if (!files.has(p)) throw err('storage/object-not-found'); return files.get(p); }),
      delete: () => step('file.delete', async () => { if (!files.has(p)) throw err('storage/object-not-found'); files.delete(p); }) }) }) };
  const ctx = { console: { log() {}, error() {}, warn() {} }, db, storage, firebase: { firestore: { FieldValue } }, Uint8Array, crypto: globalThis.crypto,
    currentUser: loggedIn ? { uid, email, displayName: 'Tester' } : null,
    localStorage: { getItem: (k) => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); } } };
  if (prepare) ctx.kxPrepareImageForUpload = prepare;
  if (clock) ctx.Date = { now: () => clock.t };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, docs, files, calls, count, ls };
}
const file = (name, type, size = 1024) => ({ name, type, size, lastModified: 7 });

describe('route-photos.js: subida', () => {
  it('crea el documento ANTES que el archivo y deja una relación 1:1 con el formato que exigen las reglas', async () => {
    const t = boot();
    const url = await t.ctx.uploadRoutePhoto('valeria', 12, 'Vía', file('Foto.JPEG', 'image/jpeg'));
    const [[key, d]] = [...t.docs.entries()];
    const id = key.split('/')[1];
    expect(t.calls.indexOf('doc.set')).toBeLessThan(t.calls.indexOf('file.put'));
    expect(id).toMatch(/^valeria_12_[a-z0-9]{16}$/);
    expect(d.filename).toBe(`${id}.jpg`);
    expect(d.storagePath).toBe(`route-photos/valeria/u1/${id}.jpg`);
    expect([...t.files.keys()]).toEqual([d.storagePath]);
    expect(d.photoUrl).toBe(url);
    expect(url).toBe(`https://firebasestorage.googleapis.com/v0/b/climbmaps-80cae.firebasestorage.app/o/${encodeURIComponent(d.storagePath)}?alt=media`);
    expect(d.uploadedBy).toBe('u1');
  });

  it('uploadedAt lo pone el servidor y el cliente no envía ningún instante propio', async () => {
    const t = boot();
    await t.ctx.uploadRoutePhoto('valeria', 12, 'Vía', file('a.jpg', 'image/jpeg'));
    const [d] = [...t.docs.values()];
    expect(d.uploadedAt).toEqual({ __ts: true });
    expect(Object.keys(d).sort()).toEqual(['filename', 'photoUrl', 'routeId', 'routeName', 'schoolId', 'storagePath', 'uploadedAt', 'uploadedBy', 'uploadedByName']);
    const uploadFn = SRC.slice(SRC.indexOf('async function kxRpUpload'), SRC.indexOf('function kxRpFriendlyError'));
    const payload = uploadFn.slice(uploadFn.indexOf('await docRef.set({'), uploadFn.indexOf('});', uploadFn.indexOf('await docRef.set({')));
    expect(payload.replace('firebase.firestore.FieldValue.serverTimestamp()', '')).not.toMatch(/Date|Math\.|time/i);   // el único valor temporal enviado es serverTimestamp()
    expect(uploadFn).not.toMatch(/new Date/);
    expect((uploadFn.match(/Date\.now/g) || []).length).toBe(3);   // solo relojes LOCALES: la hora de la anotación del diario y el reintento (acceptedAt y su comparación); ninguno llega a Firestore
  });

  it('el formato generado cumple las expresiones de las reglas (contrato cliente↔reglas)', () => {
    const rulePatterns = [
      STORAGE_RULES.match(/file\.matches\('([^']+)'\)/)[1],               // nombre de archivo
      FS_RULES.match(/rand\.matches\('([^']+)'\)/)[1],                     // aleatorio del id
      FS_RULES.match(/d\.schoolId\.matches\('([^']+)'\)/)[1]               // escuela
    ];
    const [fileRe, randRe, schoolRe] = rulePatterns.map(p => new RegExp('^(?:' + p + ')$'));
    const t = boot();
    return (async () => {
      for (const [type, ext] of [['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]) {
        const url = await t.ctx.uploadRoutePhoto('sanmartin', 3, 'V', file('x.' + ext, type));
        const name = decodeURIComponent(url.split('/o/')[1].split('?')[0]).split('/').pop();
        expect(name).toMatch(fileRe);
        expect(name.split('.')[0].split('_').pop()).toMatch(randRe);
        expect(name.endsWith('.' + ext)).toBe(true);
      }
      for (const real of ['aranjuez', 'cuenca', 'mora', 'patones', 'pedriza', 'sanmartin', 'sella', 'toledo', 'valeria']) expect(real).toMatch(schoolRe);
    })();
  });

  it('la extensión sigue al tipo de la imagen REAL que se sube (p. ej. un PNG reducido a JPEG)', async () => {
    const t = boot({ prepare: async () => file('r.jpg', 'image/jpeg', 500) });
    const url = await t.ctx.uploadRoutePhoto('valeria', 1, 'V', file('original.png', 'image/png', 3000));
    expect(url).toMatch(/\.jpg\?alt=media$/);
  });

  it('rechaza tipo, tamaño, vía sin identificador, escuela rara y falta de sesión SIN escribir nada', async () => {
    const bad = [
      ['valeria', 12, 'V', file('a.gif', 'image/gif')],
      ['valeria', 12, 'V', file('a.jpg', 'image/jpeg', 6 * 1024 * 1024)],
      ['valeria', undefined, 'V', file('a.jpg', 'image/jpeg')],
      ['valeria', 1.5, 'V', file('a.jpg', 'image/jpeg')],
      ['valeria', '12', 'V', file('a.jpg', 'image/jpeg')],
      ['mi escuela', 12, 'V', file('a.jpg', 'image/jpeg')]
    ];
    for (const args of bad) {
      const t = boot();
      await expect(t.ctx.uploadRoutePhoto(...args)).rejects.toThrow();
      expect(t.calls).toEqual([]);
    }
    const t = boot({ loggedIn: false });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow();
    expect(t.calls).toEqual([]);
    const big = boot({ prepare: async () => file('g.jpg', 'image/jpeg', 6 * 1024 * 1024) });
    await expect(big.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow(/5MB/);
    expect(big.calls).toEqual([]);   // se reduce antes de crear nada
  });

  it('si el archivo falla siempre, se deshace el documento con su marca y no queda nada pendiente', async () => {
    const t = boot({ fail: { 'file.put': () => err('storage/retry-limit-exceeded') } });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow(/conexi/);
    expect(t.count['file.put']).toBe(2);
    const keys = [...t.docs.keys()];
    expect(keys.filter(k => k.startsWith('route-photos/'))).toEqual([]);
    expect(keys.filter(k => k.startsWith('route-photo-tombstones/')).length).toBe(1);
    expect(t.files.size).toBe(0);
    expect(JSON.parse(t.ls['kx-route-photos-pending-docs'] || '[]')).toEqual([]);
  });

  it('reintento solo si el primer fallo fue pronto: a los 5 s se reintenta; a los 100 s no (no cabría en la ventana de 5 min) y se limpia', async () => {
    const quick = { t: 1e12 };
    const a = boot({ clock: quick, fail: { 'file.put': (n) => { if (n === 1) { quick.t += 5000; return err('storage/retry-limit-exceeded'); } return null; } } });
    await a.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'));
    expect(a.count['file.put']).toBe(2);
    const slow = { t: 1e12 };
    const b = boot({ clock: slow, fail: { 'file.put': () => { slow.t += 100000; return err('storage/retry-limit-exceeded'); } } });
    await expect(b.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow();
    expect(b.count['file.put']).toBe(1);
    expect(b.count['batch.commit']).toBe(1);
    expect([...b.docs.keys()].filter(k => k.startsWith('route-photos/'))).toEqual([]);
    expect([...b.docs.keys()].filter(k => k.startsWith('route-photo-tombstones/')).length).toBe(1);
  });

  it('si las reglas rechazan el archivo por llegar fuera de la ventana (permiso), no se reintenta y se limpia todo', async () => {
    const t = boot({ fail: { 'file.put': () => err('storage/unauthorized') } });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow(/permiso denegado/);
    expect(t.count['file.put']).toBe(1);   // reintentar no cambia un «no»
    expect([...t.docs.keys()].filter(k => k.startsWith('route-photos/'))).toEqual([]);
    expect([...t.docs.keys()].filter(k => k.startsWith('route-photo-tombstones/')).length).toBe(1);
    expect(t.files.size).toBe(0);
    expect(JSON.parse(t.ls['kx-route-photos-pending-docs'] || '[]')).toEqual([]);
  });

  it('un fallo puntual del archivo se reintenta una vez sin limpiar nada', async () => {
    const t = boot({ fail: { 'file.put': (n) => (n === 1 ? err('storage/retry-limit-exceeded') : null) } });
    await t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'));
    expect(t.count['file.put']).toBe(2);
    expect(t.calls).not.toContain('batch.commit');
    expect(t.files.size).toBe(1);
  });

  it('si el archivo llegó al servidor pero el cliente vio un error, no se repite ni se limpia', async () => {
    const t = boot({ fail: { 'file.put': (n) => (n === 1 ? { after: true, error: err('unknown') } : null) } });
    await t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'));
    expect(t.count['file.put']).toBe(1);
    expect(t.calls).not.toContain('batch.commit');
    expect(t.files.size).toBe(1);
  });

  it('si se perdió la respuesta de la creación del documento pero existe y es suyo, continúa con él', async () => {
    const t = boot({ fail: { 'doc.set': (n) => (n === 1 ? { after: true, error: err('unavailable') } : null) } });
    await t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'));
    expect(t.count['doc.set']).toBe(1);
    expect(t.files.size).toBe(1);
    expect([...t.docs.keys()].filter(k => k.startsWith('route-photos/')).length).toBe(1);
  });

  it('si el documento se rechaza, no se sube ningún archivo', async () => {
    const t = boot({ fail: { 'doc.set': () => err('permission-denied') } });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow(/permiso denegado/);
    expect(t.calls).not.toContain('file.put');
  });

  it('sin red para limpiar: el documento huérfano queda pendiente y se borra al volver la red', async () => {
    let down = true;
    const t = boot({ fail: { 'file.put': () => err('storage/retry-limit-exceeded'), 'batch.commit': () => (down ? err('unavailable') : null) } });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow();
    const pending = JSON.parse(t.ls['kx-route-photos-pending-docs']);
    expect(pending.length).toBe(1);
    expect([...t.docs.keys()].some(k => k === 'route-photos/' + pending[0].id)).toBe(true);
    down = false;
    await t.ctx.kxRpRetryPending();
    expect([...t.docs.keys()].some(k => k === 'route-photos/' + pending[0].id)).toBe(false);
    expect(t.docs.has('route-photo-tombstones/' + pending[0].id)).toBe(true);
    expect(JSON.parse(t.ls['kx-route-photos-pending-docs'])).toEqual([]);
  });

  it('doble pulsación con el mismo archivo: una sola subida', async () => {
    const t = boot(); const f = file('d.jpg', 'image/jpeg');
    const [a, b] = await Promise.all([t.ctx.uploadRoutePhoto('valeria', 12, 'V', f), t.ctx.uploadRoutePhoto('valeria', 12, 'V', f)]);
    expect(a).toBe(b);
    expect(t.count['doc.set']).toBe(1);
    expect(t.count['file.put']).toBe(1);
  });

  it('subidas simultáneas de archivos distintos: ids distintos', async () => {
    const t = boot();
    await Promise.all([1, 2, 3, 4, 5].map(i => t.ctx.uploadRoutePhoto('valeria', 12, 'V', file(`p${i}.jpg`, 'image/jpeg'))));
    expect(new Set([...t.docs.keys()]).size).toBe(5);
    expect(t.files.size).toBe(5);
  });
});

describe('route-photos.js: borrado y permisos', () => {
  const seedPhoto = (t, over = {}) => {
    const id = 'valeria_12_abcdefghij012345', path = 'route-photos/valeria/u1/' + id + '.jpg';
    t.docs.set('route-photos/' + id, { uploadedBy: 'u1', schoolId: 'valeria', filename: id + '.jpg', storagePath: path, ...over });
    t.files.set(path, { size: 1 });
    return { id, path };
  };

  it('borra primero el archivo y después el documento junto con su marca (mismo lote)', async () => {
    const t = boot(); const { id, path } = seedPhoto(t);
    await t.ctx.deleteRoutePhoto(id, 'u1');
    expect(t.calls.indexOf('file.delete')).toBeLessThan(t.calls.indexOf('batch.commit'));
    expect(t.files.has(path)).toBe(false);
    expect(t.docs.has('route-photos/' + id)).toBe(false);
    expect(t.docs.get('route-photo-tombstones/' + id)).toMatchObject({ deletedBy: 'u1' });
  });

  it('si el archivo no se puede borrar, no se toca el documento', async () => {
    const t = boot({ fail: { 'file.delete': () => err('unavailable') } }); const { id } = seedPhoto(t);
    await expect(t.ctx.deleteRoutePhoto(id, 'u1')).rejects.toThrow();
    expect(t.docs.has('route-photos/' + id)).toBe(true);
    expect(t.calls).not.toContain('batch.commit');
  });

  it('si el servidor deniega el borrado (pasadas 12 h) el mensaje es claro y no queda nada pendiente', async () => {
    const t = boot({ fail: { 'file.delete': () => err('storage/unauthorized') } }); const { id } = seedPhoto(t);
    await expect(t.ctx.deleteRoutePhoto(id, 'u1')).rejects.toThrow(/12 primeras horas/);
    expect(t.ls['kx-route-photos-pending-docs']).toBeUndefined();
  });

  it('documento sin archivo cuando las reglas responden «sin permiso» al borrar lo inexistente: se comprueba y se borra el documento', async () => {
    const t = boot({ fail: { 'file.delete': () => err('storage/unauthorized') } }); const { id, path } = seedPhoto(t); t.files.delete(path);
    await t.ctx.deleteRoutePhoto(id, 'u1');
    expect(t.docs.has('route-photos/' + id)).toBe(false);
    expect(t.docs.has('route-photo-tombstones/' + id)).toBe(true);
  });

  it('archivo ya inexistente: se borra igualmente el documento', async () => {
    const t = boot(); const { id, path } = seedPhoto(t); t.files.delete(path);
    await t.ctx.deleteRoutePhoto(id, 'u1');
    expect(t.docs.has('route-photos/' + id)).toBe(false);
  });

  it('si falla el lote tras borrar el archivo, queda pendiente y se completa después', async () => {
    let down = true;
    const t = boot({ fail: { 'batch.commit': () => (down ? err('unavailable') : null) } }); const { id } = seedPhoto(t);
    await expect(t.ctx.deleteRoutePhoto(id, 'u1')).rejects.toThrow();
    expect(JSON.parse(t.ls['kx-route-photos-pending-docs']).map(e => e.id)).toEqual([id]);
    down = false;
    await t.ctx.kxRpRetryPending();
    expect(t.docs.has('route-photos/' + id)).toBe(false);
    expect(JSON.parse(t.ls['kx-route-photos-pending-docs'])).toEqual([]);
  });

  it('transición: con las reglas ANTERIORES (el lote con la marca se rechaza) el borrado simple completa el borrado', async () => {
    const t = boot({ fail: { 'batch.commit': () => err('permission-denied') } }); const { id, path } = seedPhoto(t);
    await t.ctx.deleteRoutePhoto(id, 'u1');
    expect(t.calls.indexOf('batch.commit')).toBeLessThan(t.calls.indexOf('doc.delete'));
    expect(t.docs.has('route-photos/' + id)).toBe(false);
    expect(t.files.has(path)).toBe(false);
    expect(t.docs.has('route-photo-tombstones/' + id)).toBe(false);
  });

  it('con las reglas NUEVAS un borrado denegado (plazo vencido) también lo es el simple: error claro y no se oculta ni se anota como pendiente', async () => {
    const t = boot({ fail: { 'batch.commit': () => err('permission-denied'), 'doc.delete': () => err('permission-denied') } }); const { id } = seedPhoto(t);
    await expect(t.ctx.deleteRoutePhoto(id, 'u1')).rejects.toThrow(/12 primeras horas/);
    expect(t.docs.has('route-photos/' + id)).toBe(true);
    expect(t.ls['kx-route-photos-pending-docs']).toBeUndefined();
  });

  it('otro usuario no administrador ni siquiera lo intenta', async () => {
    const t = boot({ uid: 'u2' }); const { id } = seedPhoto(t);
    await expect(t.ctx.deleteRoutePhoto(id, 'u1')).rejects.toThrow(/permission/);
    expect(t.calls).not.toContain('file.delete');
  });

  it('foto antigua (sin storagePath): usa la ruta antigua del archivo', async () => {
    const t = boot({ email: 'krux.app.info@gmail.com' });
    t.docs.set('route-photos/valeria_V_1764000000000', { uploadedBy: 'u9', schoolId: 'valeria', filename: '1764000000000_V.jpeg' });
    t.files.set('route-photos/valeria/1764000000000_V.jpeg', { size: 1 });
    await t.ctx.deleteRoutePhoto('valeria_V_1764000000000', 'u9');
    expect(t.files.size).toBe(0);
    expect(t.docs.has('route-photos/valeria_V_1764000000000')).toBe(false);
  });

  it('permisos de interfaz: cualquier usuario con sesión sube; el spotter no es administrador de fotos', async () => {
    const t = boot(), out = boot({ loggedIn: false });
    expect(await t.ctx.canUploadPhotos()).toBe(true);
    expect(await out.ctx.canUploadPhotos()).toBe(false);
    t.docs.set('admins/u1', { role: 'spotter' });
    t.ctx.db.collection = (c) => ({ doc: (id) => ({ get: async () => ({ exists: t.docs.has(c + '/' + id), data: () => t.docs.get(c + '/' + id) }) }) });
    expect(await t.ctx.isPhotoAdmin()).toBe(false);
    t.docs.set('admins/u1', { role: 'admin' });
    expect(await t.ctx.isPhotoAdmin()).toBe(true);
    expect(await boot({ email: 'krux.app.info@gmail.com' }).ctx.isPhotoAdmin()).toBe(true);
  });
});

describe('route-photos.js: contrato con los archivos de reglas', () => {
  it('storage.rules y la propuesta 0c son la misma versión y no hay comodín global', () => {
    const proposal = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/storage.rules.phase0c.proposal'), 'utf8');
    expect(proposal).toBe(STORAGE_RULES);
    expect(STORAGE_RULES.replace(/\/\/.*$/gm, '')).not.toMatch(/match\s+\/\{allPaths=\*\*\}/);
  });

  it('firebase.json declara storage.rules y no se ha tocado el resto', () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
    expect(cfg.storage).toEqual({ rules: 'storage.rules' });
    expect(cfg.firestore.rules).toBe('firestore.rules');
    expect(cfg.hosting.public).toBe('www');
  });

  it('la regla de borrado del autor en Storage exige el documento existente y las dos referencias (uploadedAt y timeCreated), todas «<» estrictas', () => {
    const del = STORAGE_RULES.slice(STORAGE_RULES.indexOf('allow delete: if signedIn() && (isAdmin() || isSuperAdmin() ||'));
    const rule = del.slice(0, del.indexOf(';') + 1).replace(/\/\/.*$/gm, '');
    expect(rule).toMatch(/firestore\.exists\(photoDoc\(\)\)/);
    expect(rule).not.toMatch(/!firestore\.exists/);   // sin documento, el autor no borra
    expect(rule).toMatch(/request\.time < firestore\.get\(photoDoc\(\)\)\.data\.uploadedAt \+ duration\.value\(12, 'h'\)/);
    expect(rule).toMatch(/request\.time < resource\.timeCreated \+ duration\.value\(12, 'h'\)/);
    expect(rule).not.toMatch(/<=/);
    expect(rule).not.toMatch(/duration\.value\((?!12, 'h')/);   // la ventana de subida de 5 min NO interviene en el plazo de borrado
  });

  it('firestore.rules.route-photos-only.proposal = firestore.rules desplegado + SOLO el bloque de route-photos (idéntico al de la propuesta 0c)', () => {
    // La base es firestore.rules.previous (el ruleset anterior a la fase 0c, fijado por md5 en rules-rollback-rehearsal.test.js): firestore.rules ya es el desplegado
    const prod = fs.readFileSync(path.join(ROOT, 'firestore.rules.previous'), 'utf8');
    const only = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal'), 'utf8').split('\n');
    const body = only.slice(only.findIndex(l => l.startsWith('// ====')) + 1).join('\n');
    const a = FS_RULES.indexOf('    // ───────── FASE 0c (PROPUESTA, revisión final): fotos de vía');
    const b = FS_RULES.indexOf('    // Posts collection - allows authenticated users to create posts');
    const old = "    match /route-photos/{photoId} {\n      allow read: if true;\n      allow create: if isAuthenticated();\n      allow delete: if isAuthenticated();\n    }\n\n";
    expect(prod.split(old).length).toBe(2);   // si falla: firestore.rules.previous cambió; regenerar la propuesta
    expect(body).toBe(prod.replace(old, FS_RULES.slice(a, b)));
  });

  it('el ensayo del canario y STORAGE-CANARY.md usan los mismos identificadores de paso (C1…C30)', () => {
    const dry = fs.readFileSync(path.join(ROOT, 'tests/integration/rules/phase0/canary-dry-run.cjs'), 'utf8');
    const doc = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/STORAGE-CANARY.md'), 'utf8');
    const ids = [...new Set((dry.match(/\bC\d{1,2}[a-d]?\b/g) || []).map(x => x.replace(/[a-d]$/, '')))];
    expect(ids.length).toBeGreaterThan(15);
    for (const id of ids) expect(doc, `${id} falta en STORAGE-CANARY.md`).toContain(`| ${id}`);
  });

  it('el plazo de 12 h y la ventana de subida de 5 min de las reglas son los acordados (una sola definición por servicio)', () => {
    const code = (s) => s.replace(/\/\/.*$/gm, '');
    expect((code(STORAGE_RULES).match(/duration\.value\(12, 'h'\)/g) || []).length).toBe(2);
    expect((code(STORAGE_RULES).match(/duration\.value\(5, 'm'\)/g) || []).length).toBe(1);   // ventana de subida: 5 min
    expect(code(STORAGE_RULES)).not.toMatch(/duration\.value\((2|10), 'm'\)/);
    expect((code(FS_RULES).match(/duration\.value\(12, 'h'\)/g) || []).length).toBe(1);
    expect(code(STORAGE_RULES)).not.toMatch(/int\(photoStamp|photoStamp\(\)/);   // ningún instante escrito por el cliente
    expect(code(FS_RULES)).not.toMatch(/photoStamp/);
  });
});

describe('route-photos.js: diario de subidas (capa 1: solo anota, comprueba e informa; no borra nada solo)', () => {
  const JOURNAL = 'kx-route-photos-upload-journal', INTERRUPTED = 'kx-route-photos-interrupted-uploads';
  const T0 = 1e12, MIN = 60000;
  const photoId = (n) => `valeria_12_${String(n).padStart(16, 'a').slice(-16)}`;
  const pathOf = (id, uid = 'u1') => `route-photos/valeria/${uid}/${id}.jpg`;
  const entry = (n, ageMin, uid = 'u1') => ({ id: photoId(n), uid, path: pathOf(photoId(n), uid), at: T0 - ageMin * MIN });
  const world = (entries, { docs = [], files = [], uid = 'u1', fail = {} } = {}) => {
    const clock = { t: T0 };
    const t = boot({ uid, clock, fail, preload: { [JOURNAL]: JSON.stringify(entries) } });
    for (const n of docs) t.docs.set('route-photos/' + photoId(n), { uploadedBy: uid, storagePath: pathOf(photoId(n), uid) });
    for (const n of files) t.files.set(pathOf(photoId(n), uid), { size: 1 });
    return t;
  };
  const writes = (t) => t.calls.filter(c => ['doc.set', 'doc.delete', 'batch.commit', 'file.put', 'file.delete'].includes(c));
  const list = (t, key) => JSON.parse(t.ls[key] || '[]');

  it('anota la subida ANTES de crear el documento y borra la anotación al terminar bien', async () => {
    let seenAtDocSet = null; let t;
    t = boot({ fail: { 'doc.set': () => { seenAtDocSet = JSON.parse(t.ls[JOURNAL] || '[]'); return null; } } });
    await t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'));
    expect(seenAtDocSet.length).toBe(1);
    expect(seenAtDocSet[0]).toMatchObject({ uid: 'u1' });
    expect(seenAtDocSet[0].path).toMatch(/^route-photos\/valeria\/u1\/valeria_12_[a-z0-9]{16}\.jpg$/);
    expect(list(t, JOURNAL)).toEqual([]);
  });

  it('si el archivo falla y el cliente limpia (con o sin cola pendiente), la anotación desaparece', async () => {
    const t = boot({ fail: { 'file.put': () => err('storage/retry-limit-exceeded') } });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow();
    expect(list(t, JOURNAL)).toEqual([]);
    const u = boot({ fail: { 'file.put': () => err('storage/retry-limit-exceeded'), 'batch.commit': () => err('unavailable') } });
    await expect(u.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow();
    expect(list(u, JOURNAL)).toEqual([]);                                      // la cola pendiente se ocupa del documento
    expect(JSON.parse(u.ls['kx-route-photos-pending-docs']).length).toBe(1);
  });

  it('si el documento ni se llega a crear, no queda anotación', async () => {
    const t = boot({ fail: { 'doc.set': () => err('permission-denied') } });
    await expect(t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg'))).rejects.toThrow();
    expect(list(t, JOURNAL)).toEqual([]);
  });

  it('si la app se cierra a mitad de la subida (la subida no termina), la anotación queda y el documento también', async () => {
    const t = boot({ fail: { 'file.put': () => ({ hang: true }) } });
    t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg')).catch(() => {});   // no se espera: «la app se cierra»
    await new Promise(r => setTimeout(r, 20));
    expect(list(t, JOURNAL).length).toBe(1);
    expect([...t.docs.keys()].filter(k => k.startsWith('route-photos/')).length).toBe(1);
    expect(t.files.size).toBe(0);
  });

  it('reconciliación: subida interrumpida (documento sí, archivo no, pasados 6 min) → se INFORMA y no se borra NADA', async () => {
    const t = world([entry(1, 7)], { docs: [1] });
    await t.ctx.kxRpRetryPending();
    expect(list(t, INTERRUPTED).map(e => e.id)).toEqual([photoId(1)]);
    expect(list(t, JOURNAL)).toEqual([]);
    expect(writes(t)).toEqual([]);                                             // ninguna escritura ni borrado de ningún tipo
    expect(t.docs.has('route-photos/' + photoId(1))).toBe(true);
    expect(t.ctx.kxRpInterruptedUploads().map(e => e.id)).toEqual([photoId(1)]);
  });

  it('reconciliación: si el archivo existe la subida terminó → se descarta sin más', async () => {
    const t = world([entry(1, 7)], { docs: [1], files: [1] });
    await t.ctx.kxRpRetryPending();
    expect(list(t, INTERRUPTED)).toEqual([]); expect(list(t, JOURNAL)).toEqual([]); expect(writes(t)).toEqual([]);
  });

  it('reconciliación: una subida joven (menos de 6 min) o de otra cuenta no se toca ni se consulta', async () => {
    const t = world([entry(1, 2), entry(2, 30, 'otra')], { docs: [1, 2] });
    await t.ctx.kxRpRetryPending();
    expect(list(t, JOURNAL).length).toBe(2); expect(list(t, INTERRUPTED)).toEqual([]);
    expect(t.calls).toEqual([]);
  });

  it('reconciliación: si el documento ya no existe, o la anotación tiene más de 24 h, se descarta', async () => {
    const t = world([entry(1, 10), entry(2, 25 * 60)], { docs: [2] });
    await t.ctx.kxRpRetryPending();
    expect(list(t, JOURNAL)).toEqual([]); expect(list(t, INTERRUPTED)).toEqual([]); expect(writes(t)).toEqual([]);
  });

  it('reconciliación: un fallo al comprobar (red, permisos) es INDETERMINADO: la anotación se conserva y no se clasifica', async () => {
    const t = world([entry(1, 10)], { docs: [1], fail: { 'file.getMetadata': () => err('unavailable') } });
    await t.ctx.kxRpRetryPending();
    expect(list(t, JOURNAL).length).toBe(1); expect(list(t, INTERRUPTED)).toEqual([]); expect(writes(t)).toEqual([]);
    const u = world([entry(1, 10)], { docs: [1], fail: { 'file.getMetadata': () => err('storage/unauthorized') } });
    await u.ctx.kxRpRetryPending();
    expect(list(u, JOURNAL).length).toBe(1); expect(list(u, INTERRUPTED)).toEqual([]);
  });

  it('una subida en curso en esta pestaña no se reconcilia aunque pase el tiempo', async () => {
    const clock = { t: T0 };
    const t = boot({ clock, fail: { 'file.put': () => ({ hang: true }) } });
    t.ctx.uploadRoutePhoto('valeria', 12, 'V', file('a.jpg', 'image/jpeg')).catch(() => {});
    await new Promise(r => setTimeout(r, 20));
    clock.t += 30 * MIN;
    await t.ctx.kxRpRetryPending();
    expect(list(t, JOURNAL).length).toBe(1); expect(list(t, INTERRUPTED)).toEqual([]);
  });

  it('las interrumpidas detectadas se revalidan (como mucho cada 10 min): si el archivo aparece o el documento desaparece, dejan de constar', async () => {
    const t = world([entry(1, 7), entry(2, 7)], { docs: [1, 2] });
    await t.ctx.kxRpRetryPending();
    expect(list(t, INTERRUPTED).length).toBe(2);
    t.files.set(pathOf(photoId(1)), { size: 1 }); t.docs.delete('route-photos/' + photoId(2));
    const reads = t.calls.length;
    await t.ctx.kxRpRetryPending();
    expect(list(t, INTERRUPTED).length).toBe(2);                                // comprobadas hace menos de 10 min: no se vuelven a leer
    expect(t.calls.length).toBe(reads);
    t.ctx.Date = { now: () => T0 + 11 * MIN };                                   // pasados 10 min sí
    await t.ctx.kxRpRetryPending();
    expect(list(t, INTERRUPTED)).toEqual([]);
  });

  it('descarte EXPLÍCITO: borra el documento con su marca solo si es suyo y el archivo sigue sin existir', async () => {
    const t = world([entry(1, 7)], { docs: [1] });
    await t.ctx.kxRpRetryPending();
    expect(writes(t)).toEqual([]);                                             // hasta aquí, nada borrado
    expect(await t.ctx.kxRpDiscardInterruptedUpload(photoId(1))).toBe(true);
    expect(t.docs.has('route-photos/' + photoId(1))).toBe(false);
    expect(t.docs.has('route-photo-tombstones/' + photoId(1))).toBe(true);
    expect(list(t, INTERRUPTED)).toEqual([]);
  });

  it('descarte explícito: no hace nada si el archivo existe, si hay duda, si el documento es de otro o si no es una interrumpida detectada', async () => {
    const t = world([entry(1, 7), entry(2, 7), entry(3, 7)], { docs: [1, 2, 3] });
    await t.ctx.kxRpRetryPending();
    t.files.set(pathOf(photoId(1)), { size: 1 });                              // el archivo aparece después de detectarla
    expect(await t.ctx.kxRpDiscardInterruptedUpload(photoId(1))).toBe(false);
    t.docs.set('route-photos/' + photoId(2), { uploadedBy: 'otro' });          // el documento es de otro
    expect(await t.ctx.kxRpDiscardInterruptedUpload(photoId(2))).toBe(false);
    t.ctx.storage.ref = () => ({ child: () => ({ getMetadata: async () => { throw err('unavailable'); } }) });   // duda al comprobar
    expect(await t.ctx.kxRpDiscardInterruptedUpload(photoId(3))).toBe(false);
    expect(await t.ctx.kxRpDiscardInterruptedUpload('valeria_12_zzzzzzzzzzzzzzzz')).toBe(false);   // no figura como interrumpida
    expect([...t.docs.keys()].filter(k => k.startsWith('route-photos/')).length).toBe(3);
    expect([...t.docs.keys()].filter(k => k.startsWith('route-photo-tombstones/'))).toEqual([]);
  });

  it('nada del diario llama a un borrado: el código de reconciliación no contiene operaciones de escritura', () => {
    const body = SRC_FULL.slice(SRC_FULL.indexOf('async function kxRpReconcileJournal'), SRC_FULL.indexOf('/**\n * ACCIÓN EXPLÍCITA'));
    expect(body).not.toMatch(/\.delete\(|\.set\(|\.update\(|\.put\(|batch|kxRpDeleteDocWithTombstone|kxRpPendingAdd/);
    const callers = SRC_FULL.match(/kxRpDiscardInterruptedUpload\(/g) || [];
    expect(callers.length).toBe(1);                                            // solo su definición: nadie la llama automáticamente
  });
});
