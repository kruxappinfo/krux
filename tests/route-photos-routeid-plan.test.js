// scripts/route-photos-routeid-plan.py: plan y verificación (SOLO LECTURA) de la migración de `routeId` de las fotos de vía antiguas. Sin red: usa --docs-file.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts/route-photos-routeid-plan.py');
const hasPython = spawnSync('python3', ['--version']).status === 0;
const S = v => ({ stringValue: v }), I = v => ({ integerValue: String(v) }), T = v => ({ timestampValue: v });
const doc = (id, f) => ({ name: `projects/p/databases/(default)/documents/route-photos/${id}`, fields: f, updateTime: '2026-01-01T00:00:00Z' });
const old = (id, school, name, extra = {}) => doc(id, { schoolId: S(school), routeName: S(name), filename: S(`${id}.jpeg`), photoUrl: S('https://h/o/x?alt=media&token=t'), uploadedBy: S('u'), uploadedByName: S('n'), uploadedAt: T('2025-11-27T16:24:03Z'), ...extra });

let tmp, rootDir;
const geo = (rel, feats) => { const p = path.join(rootDir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify({ features: feats.map(([id, nombre]) => ({ properties: { id, nombre, sector: 's' } })) })); };
const run = (args, docs, extra = []) => {
  const f = path.join(tmp, `docs-${Math.random().toString(36).slice(2)}.json`); fs.writeFileSync(f, JSON.stringify({ documents: docs }));
  return spawnSync('python3', ['-I', TOOL, '--root', rootDir, '--docs-file', f, ...args, ...extra], { encoding: 'utf8' });
};
const plan = docs => { const r = run(['plan', '--out', path.join(tmp, 'out-' + Math.random().toString(36).slice(2))], docs); const m = r.stdout.match(/Plan guardado en (.+)/); return { r, file: m && m[1].trim(), data: m && JSON.parse(fs.readFileSync(m[1].trim(), 'utf8')) }; };

describe.skipIf(!hasPython)('route-photos-routeid-plan.py', () => {
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kx-routeid-')); rootDir = path.join(tmp, 'root');
    geo('Cartografia/Valeria/Valeria_Vias.geojson', [[234, 'Expertos del grado'], [10, 'Doble'], [11, 'Doble'], [12, 'Con punto'], [13.0, 'Entero como 13.0'], [null, 'Sin id']]);
    geo('Cartografia/Mora/Mora_Vias.geojson', [[5, 'Expertos del grado']]);   // mismo nombre en OTRA escuela: no debe confundirse
  });

  it('clasifica: único, ambiguo, sin coincidencia, sin datos; y omite los que ya tienen routeId', () => {
    const { r, data } = plan([
      old('a', 'valeria', 'Expertos del grado'), old('b', 'valeria', 'Doble'), old('c', 'valeria', 'Prueba 1'), old('d', 'valeria', 'Sin id'),
      doc('e', { schoolId: S('valeria'), routeName: S('Expertos del grado'), routeId: I(234) }), doc('f', { routeName: S('X') }), old('g', 'valeria', 'Entero como 13.0'), old('h', 'otra', 'Expertos del grado')]);
    expect(r.status).toBe(0);
    const by = Object.fromEntries(data.items.map(x => [x.id, x]));
    expect(by.a).toMatchObject({ clase: 'unico', routeId: 234 });
    expect(by.b.clase).toBe('ambiguo'); expect(by.c.clase).toBe('sin_coincidencia'); expect(by.d.clase).toBe('sin_coincidencia');
    expect(by.f.clase).toBe('sin_datos'); expect(by.h.clase).toBe('sin_datos'); expect(by.g).toMatchObject({ clase: 'unico', routeId: 13 });
    expect('e' in by).toBe(false); expect(data.ya_con_routeId).toBe(1);
    expect(data.migrables.sort()).toEqual(['a', 'g']);
  });

  it('no confunde vías de escuelas distintas con el mismo nombre', () => {
    const { data } = plan([old('m', 'valeria', 'Expertos del grado'), old('n', 'mora', 'Expertos del grado')]);
    const by = Object.fromEntries(data.items.map(x => [x.id, x]));
    expect([by.m.routeId, by.n.routeId]).toEqual([234, 5]);
  });

  it('es idempotente: tras migrar, un segundo plan no propone nada', () => {
    const migrated = old('a', 'valeria', 'Expertos del grado', { routeId: I(234) });
    const { data } = plan([migrated]);
    expect(data.items).toEqual([]); expect(data.migrables).toEqual([]);
  });

  it('verify: acepta una migración que solo cambia routeId en los planificados', () => {
    const before = [old('a', 'valeria', 'Expertos del grado'), old('c', 'valeria', 'Prueba 1')];
    const { file } = plan(before);
    const after = [old('a', 'valeria', 'Expertos del grado', { routeId: I(234) }), old('c', 'valeria', 'Prueba 1')];
    const r = run(['verify', '--plan', file], after);
    expect(r.status).toBe(0); expect(r.stdout).toMatch(/VERIFICACIÓN CORRECTA/);
  });

  it('verify: detecta routeId equivocado, cambios en otros campos, routeId no planificado y documentos que faltan o sobran', () => {
    const before = [old('a', 'valeria', 'Expertos del grado'), old('c', 'valeria', 'Prueba 1')];
    const { file } = plan(before);
    const bad = (after, re) => { const r = run(['verify', '--plan', file], after); expect(r.status).toBe(1); expect(r.stdout).toMatch(re); };
    bad([old('a', 'valeria', 'Expertos del grado', { routeId: I(235) }), old('c', 'valeria', 'Prueba 1')], /debía ser 234/);
    bad([old('a', 'valeria', 'Expertos del grado', { routeId: I(234), routeName: S('Otro') }), old('c', 'valeria', 'Prueba 1')], /cambió algo más que routeId: routeName/);
    bad([old('a', 'valeria', 'Expertos del grado', { routeId: I(234) }), old('c', 'valeria', 'Prueba 1', { routeId: I(1) })], /routeId no planificado/);
    bad([old('a', 'valeria', 'Expertos del grado', { routeId: I(234) })], /faltan \['c'\]/);
    bad([...before.map((d, i) => i === 0 ? old('a', 'valeria', 'Expertos del grado', { routeId: I(234) }) : d), old('z', 'valeria', 'Doble')], /sobran \['z'\]/);
    bad(before, /routeId es None, debía ser 234/);   // «migración» sin aplicar
  });

  it('solo lee: ninguna petición de escritura y ninguna escritura en la carpeta del repositorio', () => {
    const src = fs.readFileSync(TOOL, 'utf8');
    expect(src).not.toMatch(/method='(POST|PATCH|PUT|DELETE)'|\.commit\(|:commit|updateMask/);
    expect((src.match(/urllib\.request\.Request\(/g) || []).length).toBe(1);
    expect(src).toMatch(/method='GET'\)\s+# SOLO GET/);
  });

  it('con los datos REALES de hoy (nombres de las 5 fotos de vía de producción, sin datos personales): ninguna de las 4 antiguas es migrable', () => {
    // Se usa el GeoJSON real del repositorio: «Prueba 1», «Prueba 3», «Prueba 5» y «parking_2» no existen como vías de Valeria (ni nunca existieron en su historial)
    const docs = ['Prueba 1', 'Prueba 3', 'Prueba 5', 'parking_2'].map((n, i) => old(`valeria_${n.replace(' ', '_')}_${i}`, 'valeria', n)).concat(
      doc('valeria_Expertos_del_grado_x', { schoolId: S('valeria'), routeName: S('Expertos del grado'), routeId: I(234) }));
    const f = path.join(tmp, 'real.json'); fs.writeFileSync(f, JSON.stringify({ documents: docs }));
    const r = spawnSync('python3', ['-I', TOOL, '--root', ROOT, '--docs-file', f, 'plan', '--out', path.join(tmp, 'out-real')], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/ya con routeId: 1 · sin routeId: 4/);
    expect((r.stdout.match(/\[sin_coincidencia\]/g) || []).length).toBe(4);
    expect(r.stdout).toMatch(/Migrables \(coincidencia ÚNICA\): 0/);
  });
});
