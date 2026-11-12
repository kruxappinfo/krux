// Bonificación a spotters al aprobar una propuesta: reglas de puntos y texto del aviso
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { KX_SPOTTER_POINTS, kxSpotterAward, kxApprovalMessage } = require('../spotter-approval.js');

describe('kxSpotterAward', () => {
  const pending = { createdBy: 'spotter-1' };

  it('da los puntos de cada tipo de propuesta a su autor spotter', () => {
    expect(kxSpotterAward('pending_routes', pending, 'admin-1', true)).toEqual({ points: 10, reason: null });
    expect(kxSpotterAward('pending_poi', pending, 'admin-1', true).points).toBe(5);
    expect(kxSpotterAward('pending_sectors', pending, 'admin-1', true).points).toBe(15);
    expect(kxSpotterAward('pending_schools', pending, 'admin-1', true).points).toBe(15);
  });

  it('no bonifica dos veces la misma propuesta', () => {
    const again = { createdBy: 'spotter-1', pointsAwarded: 10 };
    expect(kxSpotterAward('pending_routes', again, 'admin-1', true)).toEqual({ points: 0, reason: 'ya-bonificada' });
  });

  it('no bonifica a quien aprueba su propia propuesta', () => {
    expect(kxSpotterAward('pending_routes', pending, 'spotter-1', true).reason).toBe('autor-aprueba');
  });

  it('no bonifica si el autor ya no es spotter o no consta', () => {
    expect(kxSpotterAward('pending_routes', pending, 'admin-1', false).reason).toBe('autor-no-spotter');
    expect(kxSpotterAward('pending_routes', {}, 'admin-1', true).reason).toBe('sin-autor');
    expect(kxSpotterAward('pending_routes', null, 'admin-1', true).reason).toBe('sin-autor');
  });

  it('ignora colecciones sin puntos', () => {
    expect(kxSpotterAward('posts', pending, 'admin-1', true)).toEqual({ points: 0, reason: 'sin-puntos' });
  });

  it('los puntos caben en lo que permiten las reglas de Firestore (5, 10 o 15)', () => {
    Object.values(KX_SPOTTER_POINTS).forEach(p => expect([5, 10, 15]).toContain(p));
  });
});

describe('kxApprovalMessage', () => {
  it('añade los puntos concedidos en una segunda línea', () => {
    expect(kxApprovalMessage('Vía aprobada', { points: 10, reason: null })).toBe('Vía aprobada\n+10 pts para quien la propuso');
  });

  it('avisa cuando no se pudieron sumar por permisos', () => {
    expect(kxApprovalMessage('Vía aprobada', { points: 0, reason: 'sin-permiso' })).toBe('Vía aprobada\nNo se pudieron sumar los puntos');
  });

  it('deja el mensaje tal cual cuando no toca bonificar', () => {
    expect(kxApprovalMessage('Vía aprobada', { points: 0, reason: 'autor-aprueba' })).toBe('Vía aprobada');
    expect(kxApprovalMessage('Vía aprobada', undefined)).toBe('Vía aprobada');
  });
});
