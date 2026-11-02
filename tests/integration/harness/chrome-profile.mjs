// Perfil de Chrome aislado por ejecución para cdp.mjs y cdp-seq.mjs.
// Antes cada ejecución usaba «cdp-profile-<puerto>» con un puerto aleatorio de 500 posibles y no borraba nunca el perfil: un puerto repetido
// reutilizaba el localStorage de una ejecución anterior (colas de sincronización de cuentas que ya no existen) y los perfiles llenaban el disco.
// Ahora: un directorio nuevo y vacío por ejecución (mkdtemp), borrado al terminar bien y CONSERVADO si la ejecución falla (con su ruta en stderr).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Raíz de los perfiles: CDP_PROFILE_ROOT, o /private/tmp/claude-501 si existe, o el directorio temporal del sistema
export const profileRoot = () => process.env.CDP_PROFILE_ROOT || (existsSync('/private/tmp/claude-501') ? '/private/tmp/claude-501' : tmpdir());

// ¿Sigue algún proceso (Chrome o sus ayudantes) usando este perfil?
export function profileInUse(dir) {
  const r = spawnSync('pgrep', ['-f', '--', '--user-data-dir=' + dir], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}

// ¿El título final de una página de pruebas indica fallo? (sin título, ERR, JSON con «fallos» o «err», o sin terminar)
export function titleFailed(title) {
  if (!title || !/^T\|/.test(title)) return true;
  try { const r = JSON.parse(title.slice(2)); return (Array.isArray(r.fallos) && r.fallos.length > 0) || !!r.err; } catch (_) { return true; }
}

// Crea el perfil y lanza Chrome. Devuelve { chrome, port, profile, startError } (startError: se rellena si Chrome no puede arrancar).
export function launchChrome(args, { port = 9340 + Math.floor(Math.random() * 500), root = profileRoot() } = {}) {
  const profile = mkdtempSync(join(root, 'cdp-run-'));
  const run = { chrome: null, port, profile, startError: null, keep: !!process.env.KEEP_PROFILE };
  run.chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, ...args, '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  run.chrome.on('error', e => { run.startError = e; });
  return run;
}

// Cierra Chrome y decide qué hacer con el perfil. ok=false (o KEEP_PROFILE=1) lo conserva y escribe su ruta en stderr.
// Un perfil que algún proceso sigue usando tampoco se borra. Devuelve true si el perfil se ha borrado.
export async function finishRun(run, ok, why = '') {
  try { run.chrome.kill('SIGKILL'); } catch (_) {}
  for (let i = 0; i < 40 && (run.chrome.exitCode === null && run.chrome.signalCode === null); i++) await sleep(100);
  for (let i = 0; i < 50 && profileInUse(run.profile); i++) await sleep(100);       // los ayudantes tardan un momento en morir
  if (!ok || run.keep) {
    try { writeFileSync(join(run.profile, 'KRUX-EJECUCION.txt'), `${new Date().toISOString()} ${ok ? 'conservado (KEEP_PROFILE)' : 'ejecución fallida'} ${why}\n`); } catch (_) {}
    console.error(`[arnés] perfil conservado (${ok ? 'KEEP_PROFILE' : 'ejecución fallida'}${why ? ': ' + why : ''}): ${run.profile}`);
    return false;
  }
  if (profileInUse(run.profile)) { console.error(`[arnés] perfil NO borrado: sigue en uso por algún proceso: ${run.profile}`); return false; }
  try { rmSync(run.profile, { recursive: true, force: true }); return true; }
  catch (e) { console.error(`[arnés] no se pudo borrar el perfil ${run.profile}: ${e.message}`); return false; }
}
