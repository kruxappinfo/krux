// ================== KRUX PROGRESO POR SECTOR ==================
// Cálculo de «Tu exploración» (ficha de sector): vías únicas encadenadas por el usuario frente al total del sector.
// Lógica pura, sin DOM ni Firebase: la ficha le pasa las vías del sector y cómo saber si una vía está encadenada.

// Estilos que no cuentan como encadenada (igual que «Vías encadenadas» de la ficha de escuela)
const KX_NOT_SENT_STYLES = new Set(['project']);

function kxIsSendStyle(style) {
  return !KX_NOT_SENT_STYLES.has(String(style || '').toLowerCase());
}

// routes: [{ id, name }] del sector (puede traer duplicados: misma vía en varias capas)
// isSent(route): true si el usuario la ha encadenado
// → { total, sent, pending, pct, state }  state: 'no-routes' | 'empty' | 'progress' | 'complete'
function kxSectorProgress(routes, isSent) {
  const unique = new Map();
  (routes || []).forEach(r => {
    if (!r || r.id == null || r.id === '') return;
    const key = String(r.id);
    if (!unique.has(key)) unique.set(key, r);
  });
  const total = unique.size;
  if (!total) return { total: 0, sent: 0, pending: 0, pct: null, state: 'no-routes' };
  let sent = 0;
  unique.forEach(r => { if (isSent(r)) sent++; });
  // Redondeo al entero más próximo, sin dar 0 % con alguna vía hecha ni 100 % con vías pendientes
  let pct = Math.round((sent / total) * 100);
  if (sent > 0 && pct === 0) pct = 1;
  if (sent < total && pct === 100) pct = 99;
  const state = sent === 0 ? 'empty' : sent === total ? 'complete' : 'progress';
  return { total, sent, pending: total - sent, pct, state };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kxSectorProgress, kxIsSendStyle };
}
