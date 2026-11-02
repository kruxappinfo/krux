// Pruebas del aislamiento de perfiles de Chrome del arnés (chrome-profile.mjs, cdp.mjs, cdp-seq.mjs). No necesita emuladores ni la app.
//   node tests/integration/harness/aislamiento-perfil.check.mjs
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, finishRun, profileInUse } from './chrome-profile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(join(HERE, 'fixtures/aislamiento.html')).href;
const root = mkdtempSync(join(tmpdir(), 'krux-aislamiento-'));       // raíz propia: la prueba nunca toca otros perfiles
const env = { ...process.env, CDP_PROFILE_ROOT: root };
delete env.KEEP_PROFILE;
const dirs = () => readdirSync(root).filter(n => n.startsWith('cdp-run-'));
const cdp = (query, extra = {}) => spawnSync('node', [join(HERE, 'cdp.mjs'), PAGE + query, '^(T\\||ERR)', '20000'], { env: { ...env, ...extra }, encoding: 'utf8' });
const seq = (...q) => spawnSync('node', [join(HERE, 'cdp-seq.mjs'), '20000', ...q.map(x => PAGE + x)], { env, encoding: 'utf8' });
const titleOf = out => { const l = out.split('\n').find(x => x.startsWith('T|')); return l ? JSON.parse(l.slice(2)) : null; };
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log((ok ? 'OK    ' : 'FALLA ') + name + (ok ? '' : '  ' + extra)); };

try {
  // 1) perfil nuevo y vacío al crearlo; dos lanzamientos con el MISMO puerto reciben perfiles distintos
  const a = launchChrome([], { root, port: 9990 }); const vacio = readdirSync(a.profile).length === 0;
  await finishRun(a, true);
  const b = launchChrome([], { root, port: 9990 }); const c = launchChrome([], { root, port: 9991 });
  check('1 perfil nuevo y vacío al crearlo', vacio, 'contenido: ' + vacio);
  check('1b mismo puerto → perfiles distintos', a.profile !== b.profile && b.profile !== c.profile, a.profile + ' ' + b.profile);
  await finishRun(b, true); await finishRun(c, true);
  check('1c finishRun(ok) borra el perfil', !existsSync(a.profile) && !existsSync(b.profile) && !existsSync(c.profile) && dirs().length === 0);

  // 2) dos ejecuciones consecutivas no comparten almacenamiento (la primera conserva su perfil: KEEP_PROFILE=1)
  const r1 = cdp('', { KEEP_PROFILE: '1' }); const r2 = cdp('');
  check('2 primera ejecución: sin datos previos', titleOf(r1.stdout)?.previa === null, r1.stdout + r1.stderr);
  check('2b segunda ejecución: sin datos previos aunque el perfil anterior siga en disco', titleOf(r2.stdout)?.previa === null && dirs().length === 1, r2.stdout + ' dirs=' + dirs().length);
  check('2c KEEP_PROFILE conserva el perfil y lo anuncia en stderr', r1.stderr.includes('perfil conservado') && r1.stderr.includes(root), r1.stderr);
  dirs().forEach(d => rmSync(join(root, d), { recursive: true, force: true }));

  // 3) limpieza tras una ejecución correcta (cdp.mjs y cdp-seq.mjs)
  const ok1 = cdp(''); const ok2 = seq('', '?otra=1');
  check('3 cdp.mjs correcto: perfil borrado', titleOf(ok1.stdout)?.fallos?.length === 0 && dirs().length === 0, 'dirs=' + dirs());
  check('3b cdp-seq.mjs correcto: perfil borrado; los pasos comparten el perfil', ok2.stdout.includes('"previa":"ejecucion-') && dirs().length === 0, ok2.stdout + ' dirs=' + dirs());

  // 4) ejecución fallida: perfil y evidencias conservados, con su ruta registrada
  const f1 = cdp('?falla=1');
  check('4 cdp.mjs fallido: perfil conservado y anunciado', dirs().length === 1 && f1.stderr.includes(join(root, dirs()[0])), f1.stderr + ' dirs=' + dirs());
  if (dirs().length === 1) {
    const p = join(root, dirs()[0]);
    check('4b evidencias: nota de ejecución y almacenamiento del navegador', existsSync(join(p, 'KRUX-EJECUCION.txt')) && readFileSync(join(p, 'KRUX-EJECUCION.txt'), 'utf8').includes('fallida') && existsSync(join(p, 'Default')));
  }
  dirs().forEach(d => rmSync(join(root, d), { recursive: true, force: true }));
  const f2 = seq('', '?falla=1');
  check('4c cdp-seq.mjs con un paso fallido: perfil conservado', dirs().length === 1 && f2.stderr.includes('perfil conservado'), f2.stderr + ' dirs=' + dirs());
  dirs().forEach(d => rmSync(join(root, d), { recursive: true, force: true }));

  // 5) un perfil que aún usa otro proceso no se borra aunque la ejecución haya ido bien
  const d = launchChrome([], { root, port: 9992 });
  const intruso = spawn('bash', ['-c', 'sleep 60; :', '_', '--user-data-dir=' + d.profile], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 300));
  check('5 profileInUse detecta el proceso', profileInUse(d.profile));
  const borrado = await finishRun(d, true);
  check('5b perfil en uso: no se borra', borrado === false && existsSync(d.profile));
  intruso.kill('SIGKILL'); await new Promise(r => setTimeout(r, 300));
  check('5c ya sin procesos: se borra', (await finishRun(d, true)) === true && !existsSync(d.profile));
} finally {
  if (dirs().length === 0) rmSync(root, { recursive: true, force: true }); else console.log('Quedan perfiles de la prueba en ' + root);
}
console.log(bad ? `\n${bad} comprobaciones con fallo` : '\nTodo correcto');
process.exit(bad ? 1 : 0);
