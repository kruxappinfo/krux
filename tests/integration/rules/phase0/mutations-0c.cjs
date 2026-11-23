// Comprobación de que las pruebas de storage-phase0c-rules.cjs TIENEN DIENTES: se rompe una regla a propósito (mutación) y la suite debe fallar.
// Una mutación «sobrevive» (= prueba insuficiente) si la suite sigue pasando. Solo emulador local. Uso: node mutations-0c.cjs  (el emulador debe estar arrancado)
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../../../..');
const ST = fs.readFileSync(path.join(ROOT, 'storage.rules'), 'utf8');
const FS = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/firestore.rules.phase0c.proposal'), 'utf8');
const rm = (src, needle) => { if (!src.includes(needle)) throw new Error('texto no encontrado: ' + needle.slice(0, 60)); return src.replace(needle, ''); };
const sub = (src, a, b) => { if (!src.includes(a)) throw new Error('texto no encontrado: ' + a.slice(0, 60)); return src.replace(a, b); };
const rmNth = (src, needle, n) => { let i = -1; for (let k = 0; k <= n; k++) { i = src.indexOf(needle, i + 1); if (i < 0) throw new Error('texto no encontrado: ' + needle); } return src.slice(0, i) + src.slice(i + needle.length); };
const MUT = [
  ['Storage: el borrado del autor ignora uploadedAt del documento (solo timeCreated)', 'st', s => rm(s, "          && request.time < firestore.get(photoDoc()).data.uploadedAt + duration.value(12, 'h')\n")],
  ['Storage: el borrado del autor ignora timeCreated (solo el documento)', 'st', s => sub(s, "          && request.time < resource.timeCreated + duration.value(12, 'h')));", "          ));")],
  ['Storage: el autor puede borrar el archivo SIN documento (solo timeCreated)', 'st', s => sub(s, "          && firestore.exists(photoDoc())\n          && request.time < firestore.get(photoDoc()).data.uploadedAt + duration.value(12, 'h')", "          && (!firestore.exists(photoDoc()) || request.time < firestore.get(photoDoc()).data.uploadedAt + duration.value(12, 'h'))")],
  ['Storage: la ventana de subida se amplía a 30 min (en lugar de 5)', 'st', s => sub(s, "duration.value(5, 'm')", "duration.value(30, 'm')")],
  ['Storage: la ventana de subida se SUMA al plazo de borrado (uploadedAt + 12 h + 5 min)', 'st', s => sub(s, "uploadedAt + duration.value(12, 'h')\n          && request.time < resource.timeCreated", "uploadedAt + duration.value(12, 'h') + duration.value(5, 'm')\n          && request.time < resource.timeCreated")],
  ['Storage: el plazo del autor es de 13 h (en lugar de 12)', 'st', s => sub(s, "uploadedAt + duration.value(12, 'h')\n          && request.time < resource.timeCreated", "uploadedAt + duration.value(13, 'h')\n          && request.time < resource.timeCreated")],
  ['Storage: la subida no exige que exista el documento', 'st', s => rm(s, "        && firestore.exists(photoDoc())\n"), 'equivalente: la condición siguiente, firestore.get(...).data.uploadedBy, ya falla si el documento no existe'],
  ['Storage: la subida no limita la ventana tras uploadedAt', 'st', s => rm(s, "\n        && request.time < firestore.get(photoDoc()).data.uploadedAt + duration.value(5, 'm')")],
  ['Storage: el spotter tiene privilegio de borrado en fotos de vía', 'st', s => sub(s, 'allow delete: if signedIn() && (isAdmin() || isSuperAdmin() ||', 'allow delete: if signedIn() && (isAdminOrSpotter() || isSuperAdmin() ||')],
  ['Storage: se permite sobrescribir (update)', 'st', s => sub(s, '      allow update: if false;\n      // Borrado.', '      allow update: if signedIn() && request.auth.uid == uid;\n      // Borrado.')],
  ['Storage: vuelve el comodín global', 'st', s => s.replace('    // 6. Todo lo demás', '    match /{allPaths=**} { allow read, write: if request.auth != null; }\n    // 6. Todo lo demás')],
  ['Storage: fotos de vía: se puede sobrescribir (sin resource == null)', 'st', s => rmNth(s, ' && resource == null', 0)],
  ['Storage: fotos de rocódromo: se puede sobrescribir (sin resource == null)', 'st', s => rmNth(s, ' && resource == null', 1)],
  ['Storage: el tipo declarado no tiene que coincidir con la extensión', 'st', s => rm(s, ' && typeMatchesExtension()')],
  ['Storage: el borrado del autor no exige ser el dueño de la carpeta', 'st', s => sub(s, '(request.auth.uid == uid\n          && firestore.exists(photoDoc())', '(true\n          && firestore.exists(photoDoc())')],
  ['Storage: la subida no comprueba el autor del documento', 'st', s => rm(s, "        && firestore.get(photoDoc()).data.uploadedBy == uid\n")],
  ['Firestore: crear un id con marca está permitido', 'fs', s => rm(s, ' && !exists(tombstonePath())')],
  ['Firestore: borrar sin dejar marca está permitido', 'fs', s => rm(s, 'existsAfter(tombstonePath()) && ')],
  ['Firestore: uploadedAt lo puede poner el cliente', 'fs', s => rm(s, '          && d.uploadedAt == request.time\n')],
  ['Firestore: el borrado del autor sin límite de 12 h', 'fs', s => rm(s, "\n          && request.time < resource.data.uploadedAt + duration.value(12, 'h')")],
  ['Firestore: cualquiera crea marcas sueltas', 'fs', s => rm(s, '        && !existsAfter(/databases/$(database)/documents/route-photos/$(photoId))\n')],
  ['Firestore: el spotter tiene privilegio de borrado', 'fs', s => sub(s, '        isAdmin() || isSuperAdmin() ||\n        (resource.data.uploadedBy', '        isAdmin() || isSuperAdmin() || (isAuthenticated() && exists(/databases/$(database)/documents/admins/$(request.auth.uid)) && get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.role == \'spotter\') ||\n        (resource.data.uploadedBy')]
];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-mut-'));
let survivors = 0;
for (const [label, which, fn, equivalente] of MUT) {
  if (process.env.MUT_ONLY && !label.includes(process.env.MUT_ONLY)) continue;
  const env = { ...process.env, MODE: 'proposal' };
  const f = path.join(dir, 'm.rules');
  if (which === 'st') { fs.writeFileSync(f, fn(ST)); env.STORAGE_RULES_FILE = f; } else { fs.writeFileSync(f, fn(FS)); env.RULES_FILE = f; }
  const r = spawnSync('node', [path.join(__dirname, 'storage-phase0c-rules.cjs')], { env, encoding: 'utf8' });
  let resumen = '?', fallos = 0;
  try { const d = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); resumen = d.resumen; fallos = d.fallos.length; } catch (_) { fallos = -1; resumen = 'sin resultado (' + (r.stderr || '').slice(0, 80) + ')'; }
  if (fallos === -1) { survivors++; console.log(`INVÁLIDA   ${label} → las reglas mutadas no cargan: corregir la mutación (${resumen})`); continue; }
  const mata = fallos !== 0;
  if (!mata && equivalente) { console.log(`EQUIVALENTE ${label} → 0 fallos, sin diferencia observable (${equivalente})`); continue; }
  if (!mata) survivors++;
  console.log(`${mata ? 'DETECTADA ' : 'SOBREVIVE '} ${label} → ${fallos} fallos (${resumen})`);
}
console.log(survivors ? `\n${survivors} mutaciones SOBREVIVEN o son inválidas: faltan pruebas` : `\nTodas las mutaciones (${MUT.length}) son detectadas por la suite`);
process.exit(survivors ? 1 : 0);
