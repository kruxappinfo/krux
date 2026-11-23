// Fase 0 — regresión: ejecuta las suites de reglas YA existentes (tests/integration/rules/*.cjs) contra las reglas propuestas y
// contra las actuales, en el emulador aislado. Trabaja con COPIAS temporales (.regression-copy/) en las que solo se cambian el
// puerto (8089→8190, 9109→9190), el proyecto (demo-krux-audit→demo-krux-phase0) y la raíz; los originales no se modifican.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const L = require('./_lib.cjs');
const SRC = path.join(L.ROOT, 'tests/integration/rules');
const DST = path.join(__dirname, '.regression-copy');
fs.rmSync(DST, { recursive: true, force: true }); fs.mkdirSync(DST);
const files = fs.readdirSync(SRC).filter(f => f.endsWith('.cjs'));
for (const f of files) {
  const s = fs.readFileSync(path.join(SRC, f), 'utf8')
    .replace(/8089/g, '8190').replace(/9109/g, '9190').replace(/demo-krux-audit/g, 'demo-krux-phase0')
    .replace("path.resolve(__dirname, '../../..')", `'${L.ROOT}'`);
  fs.writeFileSync(path.join(DST, f), s);
}
(async () => {
  const summary = {};
  for (const mode of (process.env.MODES || 'current,proposal').split(',')) {
    await L.loadFirestoreRules(mode);
    summary[mode] = {};
    for (const f of files) {
      // Las suites existentes usan ids fijos (p. ej. ascents/a-ses-1): se vacía Firestore del emulador antes de cada una para que sean repetibles
      await fetch(`http://${L.FS_HOST}:${L.FS_PORT}/emulator/v1/projects/${L.PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
      const r = cp.spawnSync('node', [path.join(DST, f)], { encoding: 'utf8', timeout: 240000 });
      const out = r.stdout || '';
      const lines = out.split('\n');
      summary[mode][f] = { exit: r.status, resumen: (lines.filter(l => /\d+\/\d+/.test(l)).pop() || '').trim(),
        fallos: lines.filter(l => /^FALLA|\bFAIL|✗|^✘/.test(l)).map(l => l.trim().slice(0, 200)) };
    }
  }
  console.log(JSON.stringify(summary, null, 1));
  fs.rmSync(DST, { recursive: true, force: true });
})();
