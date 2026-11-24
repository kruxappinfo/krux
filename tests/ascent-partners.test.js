// Compañeros de cordada: aviso a los etiquetados y datos que el formulario añade al ascenso (ascent-partners.js)
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function world({ uid = 'yo' } = {}) {
  const sent = [];
  const elements = {};
  const form = { dataset: {} };
  const ctx = vm.createContext({
    console, Date, Math, JSON, Promise, Set,
    firebase: { auth: () => ({ currentUser: uid ? { uid } : null }), firestore: { FieldValue: { serverTimestamp: () => 'ts' } } },
    db: {},
    kxEsc: (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    createNotification: async (to, type, text, data) => { sent.push({ to, type, text, data }); },
    document: { readyState: 'complete', getElementById: (id) => (id === 'ascent-form' ? form : elements[id] || null), addEventListener() {} },
    window: {}
  });
  vm.runInContext(readFileSync(new URL('../ascent-partners.js', import.meta.url), 'utf8'), ctx, { filename: 'ascent-partners.js' });
  return { P: vm.runInContext('KruxPartners', ctx), sent, form };
}

const doc = (over = {}) => ({
  schoolId: 'pena-bermeja', schoolName: 'Peña Bermeja', routeId: 42, routeName: 'La Raja', grade: '6a+', sector: 'Placa',
  style: 'onsight', date: new Date(2026, 10, 22, 12), companions: ['ana', 'luis'], ...over
});

describe('aviso a los compañeros etiquetados', () => {
  it('avisa a cada compañero con los datos de la vía y la fecha del día', async () => {
    const { P, sent } = world();
    await P.notifyTagged('asc1', doc());
    expect(sent.map(s => s.to)).toEqual(['ana', 'luis']);
    expect(sent[0].type).toBe('ascent_tag');
    expect(sent[0].data).toMatchObject({ resourceId: 'asc1', ascentId: 'asc1' });
    expect(sent[0].data.tag).toMatchObject({ schoolId: 'pena-bermeja', routeId: '42', routeName: 'La Raja', grade: '6a+', style: 'onsight', date: '2026-11-22' });
  });

  it('nunca se avisa a sí mismo y como mucho a 10', async () => {
    const { P, sent } = world();
    await P.notifyTagged('asc1', doc({ companions: ['yo', ...Array.from({ length: 14 }, (_, i) => `u${i}`)] }));
    expect(sent).toHaveLength(10);
    expect(sent.some(s => s.to === 'yo')).toBe(false);
  });

  it('al editar solo avisa a los recién añadidos', async () => {
    const { P, sent } = world();
    await P.notifyTagged('asc1', doc(), ['luis']);
    expect(sent.map(s => s.to)).toEqual(['luis']);
  });

  it('escapa el nombre de la vía en el texto', async () => {
    const { P, sent } = world();
    await P.notifyTagged('asc1', doc({ routeName: '<img src=x>' }));
    expect(sent[0].text).not.toContain('<img');
  });

  it('sin compañeros o sin sesión iniciada no envía nada', async () => {
    const a = world();
    await a.P.notifyTagged('asc1', doc({ companions: [] }));
    expect(a.sent).toHaveLength(0);
    const b = world({ uid: null });
    await b.P.notifyTagged('asc1', doc());
    expect(b.sent).toHaveLength(0);
  });
});

describe('datos que el formulario añade al ascenso', () => {
  it('un ascenso normal lleva los compañeros elegidos', () => {
    const { P } = world();
    P.resetForm(['ana']);
    expect(P.formExtras({ dataset: {} })).toEqual({ companions: ['ana'] });
    expect(P.addedSinceOpen()).toEqual([]);
  });

  it('un ascenso confirmado desde una etiqueta guarda quién etiquetó y no etiqueta de vuelta', () => {
    const { P } = world();
    const extras = P.formExtras({ dataset: { tagNotification: 'n1', tagFrom: 'jaime', tagAscent: 'asc1' } });
    expect(extras).toEqual({ taggedBy: 'jaime', sourceAscentId: 'asc1' });
  });
});
