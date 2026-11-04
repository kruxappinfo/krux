// Regresión: la herramienta de edición (botón Spotter) sigue los permisos reales en cada cambio de sesión,
// sin recargar la app. Carga dev-route-editor.js tal cual en un contexto aislado, con un DOM mínimo
// y un Firebase falso (roles y retardos de lectura controlados por la prueba).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../dev-route-editor.js', import.meta.url), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const settle = () => sleep(40);

// --- DOM mínimo: lo justo que usa la herramienta ---
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.id = '';
    this._cls = new Set();
    this._attrs = {};
    this.listeners = {};
    const cls = this._cls;
    this.classList = {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: c => cls.has(c),
      toggle: c => (cls.has(c) ? (cls.delete(c), false) : (cls.add(c), true))
    };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => this._cls.add(c)); }
  set innerHTML(_) {}
  appendChild(c) { c.remove(); c.parentElement = this; this.children.push(c); return c; }
  insertBefore(c, ref) {
    c.remove(); c.parentElement = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
    return c;
  }
  remove() {
    if (!this.parentElement) return;
    const sib = this.parentElement.children;
    sib.splice(sib.indexOf(this), 1);
    this.parentElement = null;
  }
  contains(x) { return x === this || this.children.some(c => c.contains(x)); }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return this._attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  find(pred) { if (pred(this)) return this; for (const c of this.children) { const r = c.find(pred); if (r) return r; } return null; }
}

function makeWorld({ roles, delays = {} }) {
  const body = new El('body');
  const map = body.appendChild(new El('div')); map.id = 'map';
  const stack = map.appendChild(new El('div')); stack.className = 'maplibregl-ctrl-bottom-right';
  const document = {
    readyState: 'complete',
    body,
    createElement: t => new El(t),
    getElementById: id => body.find(e => e.id === id),
    querySelector: sel => (sel === '#map .maplibregl-ctrl-bottom-right' ? stack : null),
    addEventListener() {},
    removeEventListener() {}
  };
  const reads = [];
  const auth = {
    currentUser: null,
    _cbs: [],
    onAuthStateChanged(cb) { this._cbs.push(cb); }
  };
  const db = {
    collection: () => ({
      doc: uid => ({
        get: async () => {
          reads.push(uid);
          await sleep(delays[uid] || 0);
          const role = roles[uid];
          return { exists: !!role, data: () => ({ role }) };
        }
      })
    })
  };
  const intervals = [];
  const ctx = vm.createContext({
    document, auth, db,
    window: { addEventListener() {} },
    console: { log() {}, warn() {}, error() {} },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 5)),   // el reintento de 2 s, acelerado
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    Promise, Set, Date, JSON
  });
  vm.runInContext('var mlMap = null;', ctx);
  vm.runInContext(SRC, ctx, { filename: 'dev-route-editor.js' });

  // Simula Firebase: cambia el usuario y avisa a los listeners (sin esperar a que terminen)
  const signIn = uid => { auth.currentUser = uid ? { uid } : null; return Promise.all(auth._cbs.map(cb => cb(auth.currentUser))); };
  const button = () => document.getElementById('btn-dev-editor');
  const runWatchdog = () => Promise.all(intervals.map(fn => fn()));
  const get = name => vm.runInContext(name, ctx);
  const set = code => vm.runInContext(code, ctx);
  return { document, stack, auth, reads, signIn, button, runWatchdog, get, set };
}

const ROLES = { spotterA: 'spotter', userB: null, adminC: 'admin', userD: 'user' };

describe('herramienta de edición: permisos en cada cambio de sesión', () => {
  let w;
  beforeEach(async () => { w = makeWorld({ roles: ROLES }); await settle(); });

  it('un spotter ve el botón, colocado en la pila de controles', async () => {
    await w.signIn('spotterA');
    expect(w.button()).toBeTruthy();
    expect(w.button().parentElement).toBe(w.stack);
    expect(w.reads).toContain('spotterA');
  });

  it('al cerrar sesión desaparece al instante, junto con modos, menú y modales abiertos', async () => {
    await w.signIn('spotterA');
    w.set('devPOIMode = true; devSectorMode = true;');
    for (const id of ['dev-spotter-menu', 'dev-poi-modal', 'dev-sector-toolbar']) {
      const el = w.document.createElement('div'); el.id = id; w.document.body.appendChild(el);
    }
    w.signIn(null);                       // sin await: debe desaparecer de forma síncrona
    expect(w.button()).toBeNull();
    expect(w.get('devPOIMode')).toBe(false);
    expect(w.get('devSectorMode')).toBe(false);
    for (const id of ['dev-spotter-menu', 'dev-poi-modal', 'dev-sector-toolbar']) expect(w.document.getElementById(id)).toBeNull();
  });

  it('tras el logout, un usuario sin permisos no ve ningún control de edición (y no hereda la caché)', async () => {
    await w.signIn('spotterA');
    await w.signIn(null);
    w.reads.length = 0;
    await w.signIn('userB');
    expect(w.button()).toBeNull();
    expect(w.reads).toContain('userB');              // se consultó su rol real
    expect(w.reads).not.toContain('spotterA');
    await w.runWatchdog();                           // el watchdog tampoco lo crea
    expect(w.button()).toBeNull();
  });

  it('cambio directo de cuenta (sin logout): sin permisos se retira al instante; con permisos vuelve', async () => {
    await w.signIn('adminC');
    expect(w.button()).toBeTruthy();
    const pending = w.signIn('userD');
    expect(w.button()).toBeNull();                   // retirado antes incluso de consultar el rol de userD
    await pending;
    expect(w.button()).toBeNull();
    await w.signIn('spotterA');
    expect(w.button()).toBeTruthy();
    expect(w.document.body.find(e => e.id === 'btn-dev-editor' && e !== w.button())).toBeNull();   // sin duplicados
  });

  it('una comprobación lenta del usuario anterior no concede el botón al siguiente', async () => {
    w = makeWorld({ roles: ROLES, delays: { spotterA: 60 } });
    await settle();
    const slowA = w.signIn('spotterA');              // spotter con lectura lenta
    await sleep(5);
    await w.signIn('userB');                         // entra un usuario sin permisos mientras tanto
    await slowA; await settle();
    expect(w.auth.currentUser.uid).toBe('userB');
    expect(w.button()).toBeNull();
  });

  it('una comprobación lenta negativa no retira el botón del usuario con permisos que entró después', async () => {
    w = makeWorld({ roles: ROLES, delays: { userB: 60 } });
    await settle();
    const slowB = w.signIn('userB');
    await sleep(5);
    await w.signIn('adminC');
    await slowB; await settle();
    expect(w.auth.currentUser.uid).toBe('adminC');
    expect(w.button()).toBeTruthy();
  });
});
