// Historial de datos de vía: qué se registra al escribir, cómo queda el documento y cómo se deshace un cambio
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KX_RD_DELETE, kxRdPlan, kxRdApply, kxRdRestoreChanges, kxRdFieldLabel } = require('../route-datos.js');

describe('kxRdPlan', () => {
  it('un dato nuevo sin nada anterior no lleva «from»', () => {
    expect(kxRdPlan({}, { exp1: 8 })).toEqual({ exp1: { to: 8 } });
    expect(kxRdPlan(null, { exp1: 8 })).toEqual({ exp1: { to: 8 } });
  });

  it('corregir un dato guarda el valor anterior', () => {
    expect(kxRdPlan({ exp1: 8, long1: 20 }, { exp1: 10 })).toEqual({ exp1: { to: 10, from: 8 } });
  });

  it('ignora lo que no cambia', () => {
    expect(kxRdPlan({ exp1: 8, estilo: 'Placa' }, { exp1: 8, estilo: 'Placa' })).toEqual({});
    expect(kxRdPlan({}, { exp1: KX_RD_DELETE })).toEqual({});
  });

  it('quitar el dato propio no lleva «to» y recuerda lo que había', () => {
    expect(kxRdPlan({ long2: 25 }, { long2: KX_RD_DELETE })).toEqual({ long2: { from: 25 } });
  });

  it('borrar con null (sin dato) es un valor y no lo mismo que quitarlo', () => {
    expect(kxRdPlan({}, { exp1: null })).toEqual({ exp1: { to: null } });
    expect(kxRdPlan({ exp1: null }, { exp1: KX_RD_DELETE })).toEqual({ exp1: { from: null } });
    expect(kxRdPlan({ exp1: null }, { exp1: null })).toEqual({});
  });

  it('las claves con f_ se comparan con el mapa fix', () => {
    const prev = { exp1: 5, fix: { nombre: 'Vieja', grado1: '6a' } };
    expect(kxRdPlan(prev, { f_nombre: 'Nueva', f_grado1: '6a', f_descripcion: 'Texto' }))
      .toEqual({ f_nombre: { to: 'Nueva', from: 'Vieja' }, f_descripcion: { to: 'Texto' } });
  });

  it('un campo de fix no se confunde con el de primer nivel del mismo nombre', () => {
    expect(kxRdPlan({ estilo: 'Placa' }, { f_estilo: 'Fisura' })).toEqual({ f_estilo: { to: 'Fisura' } });
  });
});

describe('kxRdApply', () => {
  it('aplica valores y quitas sin tocar el resto ni el original', () => {
    const prev = { exp1: 8, long1: 20, fix: { nombre: 'Vieja' } };
    const out = kxRdApply(prev, { exp1: { to: 10, from: 8 }, long1: { from: 20 }, f_grado1: { to: '6b' } });
    expect(out).toEqual({ exp1: 10, fix: { nombre: 'Vieja', grado1: '6b' } });
    expect(prev).toEqual({ exp1: 8, long1: 20, fix: { nombre: 'Vieja' } });
  });

  it('quita fix cuando se queda vacío', () => {
    expect(kxRdApply({ fix: { nombre: 'x' } }, { f_nombre: { from: 'x' } })).toEqual({});
  });
});

describe('kxRdRestoreChanges', () => {
  it('vuelve al valor anterior y quita el dato si no había', () => {
    const changes = kxRdRestoreChanges({ exp1: { to: 10, from: 8 }, long1: { to: 30 }, f_nombre: { to: 'N', from: 'V' } });
    expect(changes).toEqual({ exp1: 8, long1: KX_RD_DELETE, f_nombre: 'V' });
  });

  it('deshacer y rehacer devuelve el documento original', () => {
    const start = { exp1: 8, fix: { nombre: 'Vieja' } };
    const entries = kxRdPlan(start, { exp1: 12, long1: 40, f_nombre: 'Nueva' });
    const after = kxRdApply(start, entries);
    expect(after).toEqual({ exp1: 12, long1: 40, fix: { nombre: 'Nueva' } });
    const undo = kxRdPlan(after, kxRdRestoreChanges(entries));
    expect(kxRdApply(after, undo)).toEqual(start);
  });
});

describe('kxRdFieldLabel', () => {
  it('nombra el campo y la variante', () => {
    expect(kxRdFieldLabel('exp1')).toBe('Expreses');
    expect(kxRdFieldLabel('long2')).toBe('Metros (variante 2)');
    expect(kxRdFieldLabel('estilo')).toBe('Estilo');
    expect(kxRdFieldLabel('f_grado3')).toBe('Grado (variante 3)');
    expect(kxRdFieldLabel('f_nombre')).toBe('Nombre');
    expect(kxRdFieldLabel('f_descripcion')).toBe('Descripción');
  });
});
