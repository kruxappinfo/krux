// Compartir una sesión de escalada: datos de la publicación del feed, recorrido encajado y tarjeta (climb-session-share.js)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const RANK = ['5a', '5b', '6a', '6a+', '6b', '6c', '7a'];
function world() {
  const ctx = vm.createContext({
    console, Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 0,
    kxGradeRank: (g) => RANK.indexOf(g),
    kxGradeColor: (g) => `#${(RANK.indexOf(g) + 1) * 111111}`.slice(0, 7),
    kxEsc: (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    kxIcon: () => '<svg></svg>',
    kxsDate: () => '23 nov 2026',
    localStorage: { getItem: () => null, setItem() {} },
    window: { addEventListener() {} },
    document: { addEventListener() {}, visibilityState: 'visible' },
    navigator: { onLine: true }
  });
  for (const f of ['climb-session.js', 'climb-session-share.js']) {
    vm.runInContext(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  }
  return (name) => vm.runInContext(name, ctx);
}

const get = world();
const line = (n) => Array.from({ length: n }, (_, i) => ({ lng: -3.7 + i * 0.0001, lat: 40 + Math.sin(i / 5) * 0.0003, t: i * 5000 }));
const session = (over = {}) => ({
  id: 's1', schoolId: 'toledo', schoolName: 'Toledo', startedAt: 1_795_000_000_000, activeMs: 3 * 3600000,
  gps: { enabled: true, distanceM: 1850 }, stats: { routes: 3, sends: 2, meters: 70, maxGrade: '6c', gradeCounts: { '6a': 1, '6c': 1, '6b': 1 }, kcal: { total: 512 } },
  ...over
});

describe('datos de la publicación', () => {
  it('copia las cifras de la sesión y reduce el recorrido a 150 puntos como mucho', () => {
    const d = get('kxsPostData')(session(), [], line(900));
    expect(d).toMatchObject({ sessionId: 's1', schoolName: 'Toledo', routes: 3, sends: 2, meters: 70, maxGrade: '6c', kcal: 512, distanceM: 1850 });
    expect(d.track.lng.length).toBe(150);
    expect(d.track.lng.length).toBe(d.track.lat.length);
    expect(Array.isArray(d.track.lng[0])).toBe(false);                    // arrays planos (Firestore)
  });

  it('sin GPS no guarda recorrido ni distancia', () => {
    const d = get('kxsPostData')(session({ gps: { enabled: false, distanceM: 0 } }), [], []);
    expect(d.track).toBeUndefined();
    expect(d.distanceM).toBe(0);
  });
});

describe('recorrido encajado en una caja', () => {
  it('queda dentro de la caja con su margen y conserva el número de puntos', () => {
    const pts = get('kxsFitTrack')(line(40), 320, 150, 14);
    expect(pts).toHaveLength(40);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(13.9); expect(x).toBeLessThanOrEqual(306.1);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(150);
    }
  });
  it('con menos de 2 puntos no dibuja nada', () => {
    expect(get('kxsFitTrack')([{ lng: 0, lat: 0 }], 100, 100, 0)).toEqual([]);
  });
});

describe('cifras y tarjeta del feed', () => {
  it('siempre muestra duración y vías, y el resto solo si hay dato', () => {
    const stats = get('kxsShareStats');
    const full = stats({ activeMs: 3600000, routes: 2, sends: 1, meters: 40, maxGrade: '6b', kcal: 300, distanceM: 1200 }, 6);
    expect(full.map(s => s.label)).toEqual(['Duración', 'Vías', 'Metros', 'Grado máx.', 'kcal (est.)', 'Recorrido']);
    const bare = stats({ activeMs: 600000, routes: 1, sends: 0, meters: 0, maxGrade: '', kcal: 0, distanceM: 0 }, 4);
    expect(bare.map(s => s.label)).toEqual(['Duración', 'Vía', 'Encadenadas']);
  });

  it('la franja de grados va del más difícil al más fácil', () => {
    expect(get('kxsGradeStrip')({ '6a': 2, '7a': 1, '6b': 0 }).map(([g]) => g)).toEqual(['7a', '6a']);
  });

  it('la tarjeta pinta el recorrido si lo hay y, si no, el grado máximo; y escapa el texto', () => {
    const card = get('kxsFeedCardHTML');
    const withTrack = card(get('kxsPostData')(session(), [], line(30)));
    expect(withTrack).toContain('kxs-fc-route');
    expect(withTrack).toContain('Toledo');
    const noTrack = card(get('kxsPostData')(session({ gps: { enabled: false }, schoolName: '<b>X</b>' }), [], []));
    expect(noTrack).not.toContain('kxs-fc-route');
    expect(noTrack).toContain('Grado máximo');
    expect(noTrack).not.toContain('<b>X</b>');
  });
});
