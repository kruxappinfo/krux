// scripts/rules-rollback-rehearsal.sh: ensayo de la vuelta atrás de las reglas. Aquí se ejecuta contra un servidor LOCAL que imita la API de Reglas (sin red, sin Firebase).
// Demuestra la lógica del ensayo y de las comprobaciones de hash; NO sustituye a ejecutarlo en un proyecto de pruebas real (limitación documentada en STORAGE-DEPLOY.md §6.1).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts/rules-rollback-rehearsal.sh');
const { start } = require('./integration/rules/phase0/rules-api-mock.cjs');
const hasTools = ['bash', 'curl', 'python3', 'shasum'].every(c => spawnSync(c, ['--version']).error === undefined || spawnSync('which', [c]).status === 0);

// spawnSync bloquearía el bucle de eventos y el servidor simulado no podría responder: se usa spawn asíncrono
const run = (args, env) => new Promise(resolve => {
  const p = spawn('bash', [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME: process.env.HOME, TOKEN: 'token-de-prueba', ...env }, cwd: ROOT });
  let out = ''; p.stdout.on('data', d => out += d); p.stderr.on('data', d => out += d);
  p.on('close', code => resolve({ code, out }));
});

describe.skipIf(!hasTools)('ensayo de la vuelta atrás de las reglas (API simulada)', () => {
  let api;
  beforeAll(async () => { api = await start(); });
  afterAll(async () => { await api.close(); });

  it('Storage y Firestore: crea, activa lo nuevo, recupera lo anterior por PATCH y verifica el SHA-256', async () => {
    const r = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: api.url });
    expect(r.out).toMatch(/ENSAYO CORRECTO/);
    expect(r.code).toBe(0);
    for (const svc of ['storage', 'firestore']) for (const n of [1, 2, 3, 4, 5, 6]) expect(r.out).toContain(`PASO ${svc} ${n}/6`);
    expect(api.log.filter(l => l.startsWith('PATCH')).length).toBe(4);   // por servicio: desplegar lo nuevo (PATCH) y recuperar lo anterior (PATCH); el release inicial se crea con POST
    expect(api.log.filter(l => l.startsWith('POST /v1/projects/krux-rules-test-demo/releases')).length).toBe(2);
    // el release de cada servicio quedó apuntando al ruleset ANTERIOR, cuyo contenido es el archivo de respaldo
    const sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
    expect(sha('storage.rules.previous')).toBe('29cc65bdef1a484c98447ffa627b017de6718568c9a190a67104036d332fb887');
    expect(api.releases.size).toBe(2);
  });

  it('se niega a tocar producción y a ejecutarse sin la confirmación del proyecto', async () => {
    const before = api.log.length;
    let r = await run(['climbmaps-80cae'], { KRUX_REHEARSAL_PROJECT: 'climbmaps-80cae', API_BASE: api.url });
    expect(r.code).not.toBe(0); expect(r.out).toMatch(/PRODUCCIÓN/);
    r = await run(['krux-rules-test-otro'], { API_BASE: api.url });
    expect(r.code).not.toBe(0); expect(r.out).toMatch(/confirma el proyecto/);
    r = await run(['krux-rules-test-otro'], { KRUX_REHEARSAL_PROJECT: 'distinto', API_BASE: api.url });
    expect(r.code).not.toBe(0);
    r = await run(['climbmaps-copia'], { KRUX_REHEARSAL_PROJECT: 'climbmaps-copia', API_BASE: api.url });
    expect(r.code).not.toBe(0); expect(r.out).toMatch(/recuerda/);
    // proyectos de otras apps y cualquier id que no siga la convención del proyecto de pruebas dedicado
    for (const other of ['appescalada-e6b82', 'gastos-a2111', 'mi-proyecto', 'krux-rules-tes', 'KRUX-rules-test-x', 'krux-rules-test_x', 'krux-rules-test x']) {
      r = await run([other], { KRUX_REHEARSAL_PROJECT: other, API_BASE: api.url });
      expect(r.code, other).not.toBe(0); expect(r.out, other).toMatch(/RECHAZADO/);
    }
    expect(api.log.length).toBe(before);   // ninguna de las cuatro llegó a hacer una sola petición
  });

  it('verifica el contenido REAL: si la API guarda un ruleset distinto del enviado (aunque responda 200), el ensayo falla', async () => {
    const m = await start();
    const orig = m.rulesets.set.bind(m.rulesets);
    m.rulesets.set = (k, v) => orig(k, { ...v, source: { files: [{ ...v.source.files[0], content: v.source.files[0].content.replace(/\n$/, '') + ' ' }] } });
    const r = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: m.url });
    await m.close();
    expect(r.code).not.toBe(0); expect(r.out).toMatch(/no coincide con/); expect(r.out).not.toMatch(/ENSAYO CORRECTO/);
  });

  it('cada servicio es independiente: solo Storage, solo Firestore y limpieza opcional que deja el proyecto vacío', async () => {
    for (const [svc, other] of [['storage', 'firestore'], ['firestore', 'storage']]) {
      const m = await start();
      const r = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: m.url, KRUX_REHEARSAL_SERVICES: svc, KRUX_REHEARSAL_CLEANUP: '1' });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain(`PASO ${svc} 6/6`); expect(r.out).not.toContain(`PASO ${other} `);
      expect(r.out).toMatch(/LIMPIEZA: borrados 1 release\(s\) y 2 ruleset\(s\)/);
      expect(m.releases.size).toBe(0); expect(m.rulesets.size).toBe(0);   // el proyecto de pruebas queda vacío
      expect(m.log.filter(l => l.startsWith('PATCH')).length).toBe(2);
      await m.close();
    }
  });

  it('el bucket de Storage se puede indicar (proyectos antiguos: appspot.com) y se usa en el nombre del release', async () => {
    const m = await start();
    const r = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: m.url, KRUX_REHEARSAL_SERVICES: 'storage', KRUX_REHEARSAL_BUCKET: 'krux-rules-test-demo.appspot.com' });
    expect(r.code, r.out).toBe(0);
    expect(m.log.some(l => l.includes('/releases/firebase.storage/krux-rules-test-demo.appspot.com'))).toBe(true);
    await m.close();
  });

  it('rechaza servicios desconocidos y la limpieza no actúa si no se pide', async () => {
    const m = await start();
    const r = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: m.url, KRUX_REHEARSAL_SERVICES: 'hosting' });
    expect(r.code).not.toBe(0); expect(m.log.length).toBe(0);
    const ok = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: m.url });
    expect(ok.code, ok.out).toBe(0); expect(ok.out).not.toMatch(/LIMPIEZA/); expect(m.releases.size).toBe(2);
    await m.close();
  });

  it('detecta una recuperación que no deja el contenido anterior (el ensayo no da por buena una API que miente)', async () => {
    const bad = await start();
    // una API defectuosa: el PATCH responde 200 pero no mueve el release
    const orig = bad.releases.set.bind(bad.releases);
    let patches = 0; bad.releases.set = (k, v) => { if (bad.log[bad.log.length - 1].startsWith('PATCH')) { patches++; if (patches >= 2) return bad.releases; } return orig(k, v); };
    const r = await run(['krux-rules-test-demo'], { KRUX_REHEARSAL_PROJECT: 'krux-rules-test-demo', API_BASE: bad.url });
    await bad.close();
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/FALLO/);
    expect(r.out).not.toMatch(/ENSAYO CORRECTO/);
  });
});

describe('los archivos de reglas conservados (anteriores y nuevas)', () => {
  const sha = f => require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
  const manifest = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'docs/security-phase0/RULES-MANIFEST.sha256'), 'utf8').trim().split('\n').map(l => { const [h, f] = l.split(/\s+/); return [f, h]; }));

  it('el manifiesto lista exactamente los cuatro archivos y todos coinciden', () => {
    expect(Object.keys(manifest).sort()).toEqual(['docs/security-phase0/firestore.rules.route-photos-only.proposal', 'firestore.rules.previous', 'storage.rules', 'storage.rules.previous']);
    for (const [f, h] of Object.entries(manifest)) expect(sha(f), f).toBe(h);
  });
  it('las reglas ANTERIORES son las desplegadas hoy (hashes fijados contra la API de Reglas el 2026-11-15)', () => {
    expect(manifest['storage.rules.previous']).toBe('29cc65bdef1a484c98447ffa627b017de6718568c9a190a67104036d332fb887');
    expect(fs.statSync(path.join(ROOT, 'storage.rules.previous')).size).toBe(1444);
    expect(require('node:crypto').createHash('md5').update(fs.readFileSync(path.join(ROOT, 'firestore.rules.previous'))).digest('hex')).toBe('311a726e31a1da22962d8ada891bd08f');
    expect(fs.statSync(path.join(ROOT, 'firestore.rules.previous')).size).toBe(36519);
  });
  it('firestore.rules es el ruleset anterior, la propuesta o la propuesta + geojson_ediciones (2026-11-23) + users/{uid}/private + push_tokens: nunca otra cosa', () => {
    const GEOJSON_BLOCK = `
    // Puntos del geojson movidos por el superadmin desde el mapa (un documento por escuela y uno para rocódromos).
    // Lectura pública: todos los mapas aplican estas ediciones al cargar. Solo escribe la cuenta de Krux.
    match /geojson_ediciones/{docId} {
      allow read: if true;
      allow write: if isAuthenticated() && isSuperAdmin();
    }
`;
    const ANCHOR = "      allow update, delete: if isAuthenticated() && (isAdmin() || isSuperAdmin());\n    }\n";   // cierre de match /pending_poi
    let rules = fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8');
    // Bloque añadido después (2026-11-24): users/{uid}/push_tokens (tokens de push, solo su dueño), justo antes de private
    const pushStart = rules.indexOf('\n      // Tokens de notificaciones push');
    if (pushStart > 0) {
      const pushEnd = rules.indexOf('      }\n', rules.indexOf('match /push_tokens/{tokenId}')) + '      }\n'.length;
      expect(rules.slice(pushEnd).startsWith('\n      // Datos privados del usuario')).toBe(true);
      rules = rules.slice(0, pushStart) + rules.slice(pushEnd);
    }
    // Bloque añadido después (2026-11-24): route_datos (datos de vía de spotters/admins), justo tras geojson_ediciones
    const datosStart = rules.indexOf('\n    // Datos de vía que spotters y admins escriben al momento');
    if (datosStart > 0) {
      const datosEnd = rules.indexOf('\n    }\n', rules.indexOf('match /route_datos/{docId}')) + '\n    }\n'.length;
      expect(rules.slice(0, datosStart).endsWith('allow write: if isAuthenticated() && isSuperAdmin();\n    }\n')).toBe(true);
      rules = rules.slice(0, datosStart) + rules.slice(datosEnd);
    }
    // Cambio posterior (2026-11-24): en users/{uid} otra persona solo suma o resta 1 seguidor al seguir (follow-rules.cjs);
    // se devuelve el bloque anterior para comparar el resto con la propuesta
    const USERS_UPDATE_NEW = "      // El dueño escribe su perfil; otra persona solo puede sumar o restar 1 a sus seguidores\n      // al seguirle o dejar de seguirle (en el mismo lote que crea o borra su documento en followers)\n      allow update: if (isOwner(userId) && usernameKept()) ||\n                      (isAuthenticated() && followerCountChange());\n\n      // El nombre de usuario solo cambia a uno reservado para esta cuenta en usernames/ (y no se puede quitar)\n      function usernameKept() {\n        let before = resource == null ? null : resource.data.get('username', null);\n        let after = request.resource.data.get('username', null);\n        return after == before || (validUsername(after)\n          && getAfter(/databases/$(database)/documents/usernames/$(after)).data.uid == userId);\n      }\n      allow delete: if isOwner(userId);\n\n      // Solo cambia stats.followersCount, en ±1, y cuadra con el documento del que sigue en followers\n      function followerCountChange() {\n        let before = resource.data.get('stats', {});\n        let after = request.resource.data.get('stats', {});\n        let oldCount = before.get('followersCount', 0);\n        let newCount = after.get('followersCount', 0);\n        let followerPath = /databases/$(database)/documents/users/$(userId)/followers/$(request.auth.uid);\n        return request.resource.data.diff(resource.data).affectedKeys().hasOnly(['stats'])\n          && after.diff(before).affectedKeys().hasOnly(['followersCount'])\n          && ((newCount == oldCount + 1 && !exists(followerPath) && existsAfter(followerPath))\n              || (newCount == oldCount - 1 && exists(followerPath) && !existsAfter(followerPath)));\n      }\n\n";
    const USERS_UPDATE_OLD = "      // Allow owner full write, OR allow any authenticated user to update stats or savedPosts\n      allow update: if (isOwner(userId) && usernameKept()) ||\n                      (isAuthenticated() && \n                       (onlyStatsChanged() || onlySavedPostsChanged()));\n\n      // El nombre de usuario solo cambia a uno reservado para esta cuenta en usernames/ (y no se puede quitar)\n      function usernameKept() {\n        let before = resource == null ? null : resource.data.get('username', null);\n        let after = request.resource.data.get('username', null);\n        return after == before || (validUsername(after)\n          && getAfter(/databases/$(database)/documents/usernames/$(after)).data.uid == userId);\n      }\n      allow delete: if isOwner(userId);\n      \n      // Helper to check if only stats fields are being modified\n      function onlyStatsChanged() {\n        let changedKeys = request.resource.data.diff(resource.data).affectedKeys();\n        return changedKeys.hasOnly(['stats']) || \n               changedKeys.hasOnly(['stats.followersCount']) ||\n               changedKeys.hasOnly(['stats.followingCount']) ||\n               changedKeys.hasOnly(['stats.followersCount', 'stats.followingCount']);\n      }\n      \n      // Helper to check if only savedPosts field is being modified (for bookmarks)\n      function onlySavedPostsChanged() {\n        let changedKeys = request.resource.data.diff(resource.data).affectedKeys();\n        return changedKeys.hasOnly(['savedPosts']);\n      }\n\n";
    // Cambio posterior (2026-11-24): likes y contadores de publicaciones/comentarios/respuestas solo de uno en uno y a nombre propio
    // (social-rules.cjs); se devuelven los trozos anteriores
    const SOCIAL_HUNKS = [["      return isAuthenticated() && request.auth.uid == userId;\n    }\n\n    // Likes de otra persona: solo puede poner o quitar SU uid (antes podía reescribir la lista entera).\n    // Las publicaciones antiguas guardaban likes: 0 (número); se trata como lista vacía.\n    function onlyOwnLikeToggled(before, after) {\n      let old = before.get('likes', []);\n      let oldSet = old is list ? old.toSet() : [].toSet();\n      let next = after.get('likes', []);\n      let me = [request.auth.uid].toSet();\n      return next is list && (next.toSet() == oldSet.union(me) || next.toSet() == oldSet.difference(me));\n    }\n\n    // Contadores que cualquiera mueve al comentar o borrar: solo de uno en uno\n    function stepByOne(before, after, field) {\n      let diff = after.get(field, 0) - before.get(field, 0);\n      return after.get(field, 0) is int && (diff == 1 || diff == -1);\n    }\n\n    // Solo cambian likes y/o el contador indicado, y cada uno dentro de lo permitido\n    function likesOrCounterOnly(counter) {\n      let keys = request.resource.data.diff(resource.data).affectedKeys();\n      return keys.hasOnly(['likes', counter])\n        && (!keys.hasAny(['likes']) || onlyOwnLikeToggled(resource.data, request.resource.data))\n        && (!keys.hasAny([counter]) || stepByOne(resource.data, request.resource.data, counter));\n    }\n", "      return isAuthenticated() && request.auth.uid == userId;\n    }\n"], ["      allow read: if true; // Anyone can read posts\n      allow create: if isAuthenticated() && request.resource.data.userId == request.auth.uid; // solo a nombre propio\n      // Allow owner to update/delete, OR allow any authenticated user to update likes/commentsCount\n", "      allow read: if true; // Anyone can read posts\n      allow create: if isAuthenticated(); // Any authenticated user can create posts\n      // Allow owner to update/delete, OR allow any authenticated user to update likes/commentsCount\n"], ["        resource.data.userId == request.auth.uid || // Owner can update anything\n        likesOrCounterOnly('commentsCount') // otros: su like y commentsCount ±1\n      );\n", "        resource.data.userId == request.auth.uid || // Owner can update anything\n        onlyLikesOrCommentsChanged() // Anyone can update likes/commentsCount\n      );\n"], ["      \n// Comments subcollection - allow comment author to edit, comment/post author to delete\n", "      \n      // Helper to check if only likes or commentsCount fields are being modified\n      function onlyLikesOrCommentsChanged() {\n        let changedKeys = request.resource.data.diff(resource.data).affectedKeys();\n        return changedKeys.hasOnly(['likes']) || \n               changedKeys.hasOnly(['commentsCount']) ||\n               changedKeys.hasOnly(['likes', 'commentsCount']);\n     }\n// Comments subcollection - allow comment author to edit, comment/post author to delete\n"], ["          resource.data.userId == request.auth.uid || // Author can update anything\n          likesOrCounterOnly('repliesCount') // otros: su like y repliesCount ±1\n        );\n", "          resource.data.userId == request.auth.uid || // Author can update anything\n          onlyCommentInteractionChanged() // Anyone can update likes or repliesCount\n        );\n"], ["                        get(/databases/$(database)/documents/posts/$(postId)).data.userId == request.auth.uid);\n\n", "                        get(/databases/$(database)/documents/posts/$(postId)).data.userId == request.auth.uid);\n\n        // Helper to check if only likes or repliesCount fields are being modified\n        function onlyCommentInteractionChanged() {\n          let changedKeys = request.resource.data.diff(resource.data).affectedKeys();\n          return changedKeys.hasOnly(['likes']) ||\n                 changedKeys.hasOnly(['repliesCount']) ||\n                 changedKeys.hasOnly(['likes', 'repliesCount']);\n        }\n\n"], ["            resource.data.userId == request.auth.uid ||\n            (request.resource.data.diff(resource.data).affectedKeys().hasOnly(['likes'])\n              && onlyOwnLikeToggled(resource.data, request.resource.data))\n          );\n", "            resource.data.userId == request.auth.uid ||\n            onlyReplyLikesChanged()\n          );\n"], ["          );\n\n        }\n      }\n", "          );\n\n          function onlyReplyLikesChanged() {\n            let changedKeys = request.resource.data.diff(resource.data).affectedKeys();\n            return changedKeys.hasOnly(['likes']);\n          }\n        }\n      }\n"]];
    for (const [nuevo, antiguo] of SOCIAL_HUNKS) if (rules.includes(nuevo)) rules = rules.replace(nuevo, antiguo);
    if (rules.includes(USERS_UPDATE_NEW)) rules = rules.replace(USERS_UPDATE_NEW, USERS_UPDATE_OLD);
    if ([manifest['firestore.rules.previous'], manifest['docs/security-phase0/firestore.rules.route-photos-only.proposal']].includes(sha('firestore.rules'))) return;
    const proposal = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/firestore.rules.route-photos-only.proposal'), 'utf8');
    const at = proposal.indexOf('    match /pending_poi/{poiId} {');
    const end = proposal.indexOf(ANCHOR, at) + ANCHOR.length;
    expect(at).toBeGreaterThan(0);
    // Bloque añadido después: users/{uid}/private (peso del usuario, solo su dueño), tras climb_sessions
    const PRIVATE_ANCHOR = "          && request.resource.data.status in ['active', 'paused', 'finished'];\n      }\n";
    const privStart = rules.indexOf('\n      // Datos privados del usuario');
    const privEnd = rules.indexOf('      }\n', rules.indexOf('match /private/{docId}')) + '      }\n'.length;
    const withoutPrivate = privStart > 0 ? rules.slice(0, privStart) + rules.slice(privEnd) : rules;
    if (privStart > 0) expect(rules.slice(0, privStart).endsWith(PRIVATE_ANCHOR)).toBe(true);
    expect(withoutPrivate.trimEnd()).toBe((proposal.slice(0, end) + GEOJSON_BLOCK + proposal.slice(end)).trimEnd());
  });
  it('storage.rules es copia idéntica de la propuesta 0c y no contiene el comodín global', () => {
    expect(sha('storage.rules')).toBe(sha('docs/security-phase0/storage.rules.phase0c.proposal'));
    const code = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/match \/\{allPaths=\*\*\}/);
  });
  it('el procedimiento de recuperación no depende de git ni de /tmp ni de rutas locales', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/STORAGE-DEPLOY.md'), 'utf8');
    const rec = doc.slice(doc.indexOf('## 6. Recuperación'), doc.indexOf('## 7.'));
    expect(rec).not.toMatch(/git checkout|git restore|git stash|git reset|\/tmp\/|\/Users\//);
    expect(rec).toMatch(/storage\.rules\.previous/); expect(rec).toMatch(/firestore\.rules\.previous/);
  });
});
