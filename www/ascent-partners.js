// ================== COMPAÑEROS DE CORDADA ==================
// Etiquetar compañeros al registrar un ascenso (dentro o fuera de una sesión de escalada), avisarles con una
// notificación y dejar que lo confirmen: al confirmar se les abre el formulario de ascenso ya rellenado y el
// ascenso queda en SU registro (escrito por ellos mismos: las reglas solo dejan crear ascensos propios).
//
// Modelo:
//  - ascents/{id}.companions: uids etiquetados (máx. 10, entre las personas que sigues)
//  - users/{compañero}/notifications/ascent_tag_{autor}_{ascentId}: type 'ascent_tag', status ausente | 'accepted' | 'declined'
//    y tag { schoolId, schoolName, routeId, routeName, grade, sector, style, date (AAAA-MM-DD), climbType, schoolCity }
//  - ascents/{id del compañero}.taggedBy / sourceAscentId: de dónde viene el ascenso confirmado
//  - users/{autor}/notifications/ascent_tag_ok_{compañero}_{ascentId}: aviso de vuelta al confirmar

const KX_PARTNERS_MAX = 10;

const KruxPartners = (() => {
  let followed = null, followedUid = null;
  let picked = new Set();         // compañeros elegidos en el formulario de ascenso
  let pickedBefore = [];          // los que ya tenía el ascenso que se edita (no se vuelven a avisar)

  const me = () => (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) || null;
  const toast = (msg, type = 'info', opts) => { if (typeof showToast === 'function') showToast(msg, type, opts); };
  const esc = (s) => (typeof kxEsc === 'function' ? kxEsc(s) : String(s == null ? '' : s));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const isoDay = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    if (isNaN(x)) return '';
    const p = n => String(n).padStart(2, '0');
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };

  // ---------- Personas que sigues (candidatas a compañero) ----------
  async function loadFollowed() {
    const u = me();
    if (!u) return [];
    if (followed && followedUid === u.uid) return followed;
    try {
      const snap = await db.collection('users').doc(u.uid).collection('following').get();
      const docs = await Promise.all(snap.docs.slice(0, 60).map(d => db.collection('users').doc(d.id).get()));
      followed = docs.filter(d => d.exists).map(d => {
        const x = d.data();
        return { id: d.id, name: x.displayName || x.username || x.name || 'Usuario' };
      }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
      followedUid = u.uid;
    } catch (e) {
      console.warn('[Compañeros] No se pudo cargar a quién sigues:', e);
      return [];
    }
    return followed;
  }

  // ---------- Aviso a los etiquetados ----------
  // doc: el ascenso tal como se guarda (kxAscentDoc). only: limitar a estos uids (al editar, los recién añadidos)
  async function notifyTagged(ascentId, doc, only) {
    const u = me();
    if (!u || !ascentId || !doc || typeof createNotification !== 'function') return;
    const list = (only || doc.companions || []).filter(id => id && id !== u.uid).slice(0, KX_PARTNERS_MAX);
    if (!list.length) return;
    const tag = {
      schoolId: doc.schoolId || '', schoolName: doc.schoolName || '',
      routeId: doc.routeId != null ? String(doc.routeId) : '', routeName: doc.routeName || '',
      grade: doc.grade || '', sector: doc.sector || '', style: doc.style || 'redpoint',
      date: isoDay(doc.date), climbType: doc.climbType || 'outdoor', schoolCity: doc.schoolCity || ''
    };
    const text = `te ha añadido como compañero en <strong>${esc(tag.routeName)}</strong>${tag.grade ? ` (${esc(tag.grade)})` : ''}`;
    await Promise.all(list.map(uid => createNotification(uid, 'ascent_tag', text, { resourceId: ascentId, ascentId, tag })
      .catch(e => console.warn('[Compañeros] Aviso no enviado:', e))));
  }

  // ---------- Confirmar / rechazar (desde la notificación) ----------
  function confirm(n) {
    const t = n && n.tag;
    if (!t || !t.routeId) { toast('Esta etiqueta ya no tiene los datos de la vía', 'error'); return; }
    if (typeof openAscentModal !== 'function') return;
    openAscentModal(t.schoolId, t.schoolName, t.routeId, t.routeName, t.grade, t.sector, { fromTag: true });
    const form = document.getElementById('ascent-form');
    if (!form) return;
    form.dataset.tagNotification = n.id;
    form.dataset.tagFrom = n.fromUserId || '';
    form.dataset.tagFromName = n.fromUserName || '';
    form.dataset.tagAscent = n.ascentId || '';
    const date = document.getElementById('ascent-date');
    if (date && t.date && t.date <= date.max) date.value = t.date;
    const city = document.getElementById('ascent-school-city');
    if (city) city.value = t.schoolCity || '';
    const type = document.getElementById('ascent-climb-type');
    if (type) type.value = t.climbType || 'outdoor';
    // El estilo de quien te etiqueta es solo un punto de partida: cada uno elige el suyo
    if (typeof kxSetAscentStyle === 'function') kxSetAscentStyle(t.style === 'project' ? 'project' : 'redpoint');
    const title = document.getElementById('ascent-modal-title');
    if (title) title.textContent = 'Confirmar ascenso';
    const note = document.getElementById('ascent-tag-note');
    if (note) {
      note.textContent = `${n.fromUserName || 'Tu compañero'} te ha añadido en esta vía. Revisa la fecha y tu estilo: se guardará en tu registro.`;
      note.hidden = false;
    }
    const group = document.getElementById('ascent-partners-group');
    if (group) group.hidden = true;   // quien confirma no etiqueta de vuelta (ya recibe el aviso de confirmación)
    const scroller = document.querySelector('#ascent-modal .modal-content');
    if (scroller) scroller.scrollTop = 0;   // el aviso de arriba tiene que verse
  }

  async function setStatus(notificationId, status, extra = {}) {
    const u = me();
    if (!u || !notificationId) return;
    await db.collection('users').doc(u.uid).collection('notifications').doc(notificationId)
      .update({ status, read: true, respondedAt: firebase.firestore.FieldValue.serverTimestamp(), ...extra });
  }

  async function decline(n) {
    try {
      await setStatus(n.id, 'declined');
      toast('Etiqueta rechazada: no se añade a tu registro', 'info');
    } catch (e) {
      console.error('[Compañeros] Error al rechazar:', e);
      toast('No se pudo rechazar la etiqueta', 'error');
    }
  }

  // Tras guardar el ascenso confirmado: marca la notificación y avisa a quien te etiquetó
  async function confirmed(form, ascentId) {
    const nid = form.dataset.tagNotification;
    if (!nid) return;
    const from = form.dataset.tagFrom, src = form.dataset.tagAscent;
    try { await setStatus(nid, 'accepted', ascentId ? { confirmedAscentId: ascentId } : {}); } catch (e) { console.warn('[Compañeros] Notificación sin marcar:', e); }
    if (from && src && typeof createNotification === 'function') {
      const route = document.getElementById('ascent-route-name')?.value || '';
      createNotification(from, 'ascent_tag_ok', `ha confirmado que escalasteis juntos <strong>${esc(route)}</strong>`, { resourceId: `ok_${src}`, ascentId: src })
        .catch(() => {});
    }
  }

  // Datos extra que el formulario añade al ascenso (compañeros y procedencia de una etiqueta)
  function formExtras(form) {
    const out = {};
    if (form.dataset.tagNotification) {
      if (form.dataset.tagFrom) out.taggedBy = form.dataset.tagFrom;
      if (form.dataset.tagAscent) out.sourceAscentId = form.dataset.tagAscent;
    } else {
      out.companions = [...picked];
    }
    return out;
  }

  // ---------- Selector en el formulario de ascenso (fuera de la sesión) ----------
  function label() {
    const btn = document.getElementById('ascent-partners-label');
    if (btn) btn.textContent = picked.size ? plural(picked.size, 'compañero', 'compañeros') : 'Añadir compañeros';
  }
  async function renderPicker() {
    const box = document.getElementById('ascent-partners');
    if (!box) return;
    box.innerHTML = '<p class="kxs-empty">Cargando…</p>';
    const list = await loadFollowed();
    box.dataset.ready = '1';
    box.innerHTML = list.length
      ? list.map(u => `<label class="kxs-peer"><input type="checkbox" value="${esc(u.id)}" data-ascent-peer ${picked.has(u.id) ? 'checked' : ''}><span>${esc(u.name)}</span></label>`).join('')
      : '<p class="kxs-empty">Aún no sigues a nadie. Podrás elegir compañeros entre las personas que sigues.</p>';
  }
  function resetForm(companions = []) {
    picked = new Set((companions || []).slice(0, KX_PARTNERS_MAX));
    pickedBefore = [...picked];
    const box = document.getElementById('ascent-partners');
    const btn = document.getElementById('ascent-partners-btn');
    if (box) { box.hidden = true; box.innerHTML = ''; delete box.dataset.ready; }
    if (btn) btn.setAttribute('aria-expanded', 'false');
    const group = document.getElementById('ascent-partners-group');
    if (group) group.hidden = false;
    const note = document.getElementById('ascent-tag-note');
    if (note) { note.hidden = true; note.textContent = ''; }
    const form = document.getElementById('ascent-form');
    if (form) ['tagNotification', 'tagFrom', 'tagFromName', 'tagAscent'].forEach(k => delete form.dataset[k]);
    label();
  }
  // Al editar: los compañeros que no estaban antes (son los únicos a los que hay que avisar)
  const addedSinceOpen = () => [...picked].filter(id => !pickedBefore.includes(id));

  function bindForm() {
    const btn = document.getElementById('ascent-partners-btn');
    const box = document.getElementById('ascent-partners');
    if (!btn || !box || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const open = box.hidden;
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open && !box.dataset.ready) renderPicker();
    });
    box.addEventListener('change', (e) => {
      const peer = e.target.closest('[data-ascent-peer]');
      if (!peer) return;
      if (peer.checked) {
        if (picked.size >= KX_PARTNERS_MAX) { peer.checked = false; toast(`Máximo ${KX_PARTNERS_MAX} compañeros`, 'info'); return; }
        picked.add(peer.value);
      } else picked.delete(peer.value);
      label();
    });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindForm); else bindForm();
  }

  return { loadFollowed, notifyTagged, confirm, decline, confirmed, formExtras, resetForm, addedSinceOpen, MAX: KX_PARTNERS_MAX };
})();

if (typeof window !== 'undefined') window.KruxPartners = KruxPartners;
