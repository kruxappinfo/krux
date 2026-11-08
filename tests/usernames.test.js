// Nombres de usuario (usernames.js): formato, sugerencias y texto de las menciones.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { kxNormalizeUsername, kxValidateUsername, kxUsernameBase, kxUsernameCandidates, kxMentionLabel } = require('../usernames.js');

describe('formato del nombre de usuario', () => {
  it('normaliza: minúsculas, sin @ ni espacios alrededor', () => {
    expect(kxNormalizeUsername('  @Jaime.Lillo ')).toBe('jaime.lillo');
  });
  it('acepta letras, números, punto y guion bajo', () => {
    ['jaime', 'jaime.lillo', 'jaime_99', 'j4m'].forEach(u => expect(kxValidateUsername(u)).toBeNull());
  });
  it('rechaza lo que no cumple', () => {
    expect(kxValidateUsername('')).toMatch(/Escribe/);
    expect(kxValidateUsername('ab')).toMatch(/Mínimo/);
    expect(kxValidateUsername('a'.repeat(31))).toMatch(/Máximo/);
    expect(kxValidateUsername('jaime lillo')).toMatch(/Solo letras/);
    expect(kxValidateUsername('josé')).toMatch(/Solo letras/);
    expect(kxValidateUsername('.jaime')).toMatch(/punto/);
    expect(kxValidateUsername('jaime.')).toMatch(/punto/);
    expect(kxValidateUsername('jai..me')).toMatch(/dos puntos/);
    expect(kxValidateUsername('12345')).toMatch(/una letra/);
    expect(kxValidateUsername('admin')).toMatch(/no está disponible/);
  });
});

describe('sugerencias', () => {
  it('a partir del nombre, sin tildes ni eñes', () => {
    expect(kxUsernameBase('Jaime Lillo')).toBe('jaime.lillo');
    expect(kxUsernameBase('Begoña Martínez-Ruiz')).toBe('begona.martinez.ruiz');
  });
  it('sin nombre, a partir del correo; si no sirve nada, «escalador»', () => {
    expect(kxUsernameBase('', 'climber_88@gmail.com')).toBe('climber_88');
    expect(kxUsernameBase('😀', '')).toBe('escalador');
  });
  it('candidatas válidas y distintas, empezando por la base', () => {
    const c = kxUsernameCandidates('Jaime Lillo', '', 12345);
    expect(c[0]).toBe('jaime.lillo');
    expect(c).toContain('jaimelillo');
    expect(new Set(c).size).toBe(c.length);
    c.forEach(u => expect(kxValidateUsername(u)).toBeNull());
  });
});

describe('menciones', () => {
  it('usan el @usuario y, en menciones antiguas, el nombre', () => {
    expect(kxMentionLabel({ uid: 'a', displayName: 'Jaime Lillo', username: 'jaime.lillo' })).toBe('jaime.lillo');
    expect(kxMentionLabel({ uid: 'a', displayName: 'Jaime Lillo' })).toBe('Jaime Lillo');
  });
});
