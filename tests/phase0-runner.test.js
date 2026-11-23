// Guardas de la infraestructura de pruebas de Fase 0 (run-phase0.sh, soak.sh, summ.py): un error de sintaxis en el ejecutor dejaba TODAS las suites en «SIN RESULTADO» sin que ninguna prueba lo notara.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const DIR = path.resolve(__dirname, 'integration/rules/phase0');
const summ = (input, env = {}) => spawnSync('python3', ['-I', path.join(DIR, 'summ.py')], { input, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

describe('ejecutores de las suites de Fase 0', () => {
  it.each(['run-phase0.sh', 'soak.sh', 'emulator-phase0.sh'])('%s tiene sintaxis de bash válida', (f) => {
    const r = spawnSync('bash', ['-n', path.join(DIR, f)], { encoding: 'utf8' });
    expect(r.stderr).toBe(''); expect(r.status).toBe(0);
  });
  it('run-phase0.sh resume con summ.py (no con Python en línea) y revisa el bloqueo del emulador tras cada suite', () => {
    const s = fs.readFileSync(path.join(DIR, 'run-phase0.sh'), 'utf8');
    expect(s).toMatch(/summ\(\) \{ python3 "\$HERE\/summ\.py"; \}/);
    expect((s.match(/wedge_check/g) || []).length).toBeGreaterThanOrEqual(8);
  });
  it('summ.py: una suite correcta se resume en una línea', () => {
    const r = summ(JSON.stringify({ archivo: 'a.cjs', modo: 'proposal', resumen: '5/5 cumplen la política', fallos: [] }));
    expect(r.status).toBe(0); expect(r.stdout.trim().split('\n').length).toBe(1); expect(r.stdout).toMatch(/a\.cjs \[ proposal \] 5\/5 cumplen la política \| fallos: 0/);
  });
  it('summ.py: en modo proposal lista cada fallo con etiqueta, esperado, obtenido, error y milisegundo; en modo current no', () => {
    const d = { archivo: 'a.cjs', modo: 'proposal', resumen: '1/2', fallos: [{ label: 'marca X', policy: 'denegado', got: 'permitido', error: 'e1', atMs: 4611 }] };
    const p = summ(JSON.stringify(d)).stdout;
    expect(p).toMatch(/FALLO: marca X \| esperado: denegado \| obtenido: permitido \| e1 \| a los 4611 ms/);
    expect(summ(JSON.stringify({ ...d, modo: 'current' })).stdout).not.toMatch(/FALLO:/);
  });
  it('summ.py: sin JSON (la suite murió) imprime «SIN RESULTADO» con el final de su stderr', () => {
    const f = path.join(DIR, '.test-stderr.tmp'); fs.writeFileSync(f, 'ERROR FATAL el emulador de Storage dejó de responder');
    try { const r = summ('texto sin json', { ERRF: f }); expect(r.stdout).toMatch(/SIN RESULTADO/); expect(r.stdout).toMatch(/dejó de responder/); } finally { fs.rmSync(f, { force: true }); }
  });
});
