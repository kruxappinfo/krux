// scripts/route-photos-orphans.py (capas 2 y 3 de los documentos huérfanos): comprobaciones ESTÁTICAS y sin red de que la herramienta no puede tocar lo prohibido.
// El comportamiento completo (informe, plan, archivado, restauración) se prueba contra el emulador en tests/integration/rules/phase0/route-photos-orphans-tool.cjs.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(__dirname, '..');
const TOOL = path.join(ROOT, 'scripts/route-photos-orphans.py');
const SRC = fs.readFileSync(TOOL, 'utf8');
const OPERATIVE = SRC.split('def cmd_selftest')[0];   // el selftest nombra colecciones prohibidas a propósito para comprobar que se rechazan
const hasPython = spawnSync('python3', ['--version']).status === 0;

describe('route-photos-orphans.py: garantías estáticas', () => {
  it.skipIf(!hasPython)('el autotest del script (protecciones y clasificación, sin red) pasa', () => {
    const r = spawnSync('python3', [TOOL, 'selftest'], { encoding: 'utf8' });
    expect(r.stdout + r.stderr).toMatch(/selftest OK/);
    expect(r.status).toBe(0);
  });

  it('solo conoce las colecciones route-photos, route-photo-tombstones y route-photos-archive (ni trazados, ni sectores, ni vías, ni usuarios)', () => {
    expect(OPERATIVE).not.toMatch(/sector_route_drawings|sector_images|pending_routes|pending_poi|pending_sectors|pending_schools|ascents|aleje_votes|estado_votes|grade_votes|'users'|'posts'|'admins'|conversations/);
    expect(OPERATIVE).toMatch(/COL_PHOTOS, COL_TOMB, COL_ARCHIVE = 'route-photos', 'route-photo-tombstones', 'route-photos-archive'/);
  });

  it('una sola salida de red, siempre precedida de la validación; Storage solo se lee', () => {
    expect((OPERATIVE.match(/urllib\.request\.urlopen/g) || []).length).toBe(1);
    expect(OPERATIVE).toMatch(/self\.guard\.check\(method, url, body\)\n\s+self\.guard\.sent/);
    expect(OPERATIVE).toMatch(/if method != 'GET':\n\s+raise Refused\(f'Storage es solo lectura/);
    expect(OPERATIVE).not.toMatch(/method='(DELETE|PUT|PATCH)'|\.delete\(|requests\./);
    expect(OPERATIVE).not.toMatch(/storage\.googleapis\.com[^\n]*(DELETE|upload)/i);
  });

  it('el informe y el plan usan una conexión de SOLO LECTURA; solo apply y restore pueden escribir, y apply solo si se aprobó', () => {
    expect(OPERATIVE).toMatch(/def cmd_report[\s\S]*?api = Api\(args\)   # allow_writes=None/);
    expect(OPERATIVE).toMatch(/def cmd_plan[\s\S]*?api = Api\(args\)   # solo lectura/);
    expect(OPERATIVE).toMatch(/api = Api\(args, allow_writes='apply' if execute else None\)/);
    expect(OPERATIVE).toMatch(/api = Api\(args, allow_writes='restore' if execute else None\)/);
    expect((OPERATIVE.match(/api\.commit\(/g) || []).length).toBe(2);   // apply y restore
  });

  it('exige aprobación explícita: hash del lote, frase de confirmación, copia previa y re-verificación antes de tocar cada documento', () => {
    expect(OPERATIVE).toMatch(/args\.approve != batch\['planHash'\]/);
    expect(OPERATIVE).toMatch(/typed != phrase/);
    expect(OPERATIVE).toMatch(/backup\(api, d\)/);
    expect(OPERATIVE).toMatch(/el documento ha cambiado desde que se planificó/);
    expect(OPERATIVE).toMatch(/el archivo no está confirmado como ausente/);
    expect(OPERATIVE).toMatch(/solo se pueden planificar documentos «huerfano_confirmado»/);
  });

  it('el archivado es atómico: crear copia, borrar el documento (con precondición de versión) y crear la marca en un único commit', () => {
    const apply = OPERATIVE.slice(OPERATIVE.indexOf('def cmd_apply'), OPERATIVE.indexOf('def cmd_restore'));
    expect((apply.match(/api\.commit\(writes\)/g) || []).length).toBe(1);
    expect(apply).toMatch(/COL_ARCHIVE, i\)[\s\S]*?'exists': False[\s\S]*?COL_PHOTOS, i\)[\s\S]*?'updateTime': it\['updateTime'\][\s\S]*?COL_TOMB, i\)[\s\S]*?'exists': False/);
  });

  it('los informes, lotes y copias nunca se sobrescriben y no guardan tokens de descarga', () => {
    expect(OPERATIVE).toMatch(/'w' if overwrite else 'x'/);
    expect(OPERATIVE).not.toMatch(/'photoUrl'\s*:/);   // el informe no copia photoUrl (lleva el token)
  });
});

describe('capa 0: se mantiene A0 y A1 NO está implementada (decisión del propietario)', () => {
  const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const RULE_FILES = ['storage.rules', 'storage.rules.previous', 'firestore.rules', 'docs/security-phase0/storage.rules.phase0c.proposal', 'docs/security-phase0/firestore.rules.phase0c.proposal',
    'docs/security-phase0/firestore.rules.route-photos-only.proposal', 'docs/security-phase0/firestore.rules.phase0b.proposal'];

  it('ninguna regla (desplegada, propuesta o variante) contiene la excepción de A1: borrar sin marca los documentos sin storagePath', () => {
    for (const f of RULE_FILES) {
      const code = read(f).replace(/\/\/.*$/gm, '');
      expect(code, `${f} contiene A1`).not.toMatch(/!\s*\(\s*'storagePath'\s+in\s+resource\.data\s*\)/);
    }
  });

  it('la regla de borrado de route-photos sigue exigiendo la marca a TODOS (también a administradores)', () => {
    const code = read('docs/security-phase0/firestore.rules.route-photos-only.proposal').replace(/\/\/.*$/gm, '');
    const rule = code.slice(code.indexOf("allow delete: if isAuthenticated() && existsAfter(tombstonePath())"));
    expect(rule.slice(0, rule.indexOf(';') + 1)).toMatch(/existsAfter\(tombstonePath\(\)\) && \(\s*isAdmin\(\) \|\| isSuperAdmin\(\)/);
  });

  it('A1 solo existe como estudio: el constructor en memoria de las pruebas y el motor real; ningún archivo desplegable', () => {
    expect(read('tests/integration/rules/phase0/_variants.cjs')).toMatch(/function variantA1/);
    expect(read('tests/integration/rules/phase0/admin-orphan-resolution.cjs')).toMatch(/A1 NO se adopta ni se implementa/);
    expect(read('firebase.json')).not.toMatch(/A1|variant/i);
  });

  it('el procedimiento administrativo solo usa subcomandos, opciones y protecciones que existen en la herramienta', () => {
    const doc = read('docs/security-phase0/STORAGE-ORPHANS-RUNBOOK.md');
    for (const sub of ['report', 'plan', 'apply', 'restore']) expect(SRC).toContain(`sub.add_parser('${sub}')`);
    for (const flag of ['--previous', '--report', '--ids', '--batch', '--limit', '--approve', '--confirm-text', '--apply', '--id', '--out']) {
      expect(doc).toContain(flag);
      expect(SRC).toContain(`'${flag}'`);
    }
    expect(doc).toMatch(/python3 scripts\/route-photos-orphans\.py report\b/);
    expect(doc).toMatch(/ARCHIVAR N DOCUMENTOS/);
    expect(SRC).toMatch(/ARCHIVAR \{len\(todo\)\} DOCUMENTOS/);
    expect(doc).toMatch(/Nunca se borra desde la consola/);
    expect(doc).toMatch(/Jamás se borran ni se modifican trazados de vías/);
    expect(doc).toMatch(/Nada de esto se ha ejecutado en producción/);
  });

  it('el procedimiento no pide ningún borrado de Storage ni de trazados', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/STORAGE-ORPHANS-RUNBOOK.md'), 'utf8');
    expect(doc).not.toMatch(/gcloud storage (rm|mv)|gsutil (rm|mv)|\.delete\(\)|sector_route_drawings/);
  });

  it('el canario no pide ningún borrado manual con privilegios y limpia con la app (coherente con la regla 2 del runbook)', () => {
    const canary = fs.readFileSync(path.join(ROOT, 'docs/security-phase0/STORAGE-CANARY.md'), 'utf8');
    expect(canary).not.toMatch(/gcloud storage (rm|mv)|gsutil (rm|mv)|se borran con privilegios|borrarlos? (desde|en) la consola/i);
    const after = canary.slice(canary.indexOf('## 4. Después del canario'));
    expect(after).toMatch(/no hay ningún borrado manual con privilegios/);
    expect(after).toMatch(/deleteRoutePhoto\(id, '<uid del autor>'\)/);
    expect(canary).toMatch(/C21[^\n]*deleteRoutePhoto\(id, '<uid>'\)[^\n]*nunca desde la consola/);
  });

  it('apply exige siempre el informe original (sin él no hay ni simulación) y el lote atómico completo', () => {
    expect(OPERATIVE).not.toMatch(/if os\.path\.exists\(rpath\)/);
    expect(OPERATIVE).toMatch(/if not os\.path\.isfile\(rpath\):\n\s+sys\.exit\(f'RECHAZADO: no se encuentra el informe original/);
    expect(OPERATIVE).toMatch(/if ops != need:\n\s+raise Refused\('el lote de archivado debe ser exactamente/);
  });
});

