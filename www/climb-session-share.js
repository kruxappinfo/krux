// ================== KRUX — SESIONES DE ESCALADA: COMPARTIR ==================
// Imagen para historias de Instagram (1080×1920, con fondo o transparente para ponerla sobre una foto),
// compartir esa imagen desde la app o el navegador, y la publicación de la sesión en el feed con su tarjeta propia.
// Sin DOM propio: climb-session-ui.js muestra las vistas y app_3.js pinta la tarjeta del feed.

const KXS_SHARE_COLORS = {
  forest: '#153E35', forestDeep: '#0F2F28', chalk: '#F7F6F0', sage: '#DCE9DF', coral: '#FF8D67', white: '#FFFFFF'
};
const KXS_POST_TRACK_POINTS = 150;   // puntos del recorrido que se guardan en la publicación (tarjeta del feed)

// ============================================
// DATOS (puros)
// ============================================

// Cifras de la sesión que comparten la imagen y la publicación
function kxsShareFigures(session, entries) {
  const st = session.stats || kxsStats(entries || []);
  const active = session.activeMs || kxsActiveMs(session);
  const kc = st.kcal && st.kcal.total != null ? st.kcal : kxsEstimateKcal({ entries: entries || [], activeMs: active, track: session.track || [] });
  const gps = session.gps || {};
  return {
    kind: session.type === 'gym' ? 'gym' : 'rock',
    schoolName: session.schoolName || '', startedAt: session.startedAt, activeMs: active,
    routes: st.routes || 0, sends: st.sends || 0, meters: st.meters || 0, maxGrade: st.maxGrade || '',
    kcal: kc.total || 0, distanceM: gps.enabled && gps.distanceM > 0 ? Math.round(gps.distanceM) : 0,
    gradeCounts: st.gradeCounts || {}
  };
}

// Recorrido reducido para la publicación (arrays planos: Firestore no admite arrays anidados)
function kxsPostTrack(points) {
  if (!points || points.length < 2) return null;
  const pts = kxsDownsample(points, KXS_POST_TRACK_POINTS);
  return { lng: pts.map(p => Math.round(p.lng * 1e5) / 1e5), lat: pts.map(p => Math.round(p.lat * 1e5) / 1e5) };
}

// Datos de la publicación del feed (type: 'climb_session'). Es una copia: si luego se borra la sesión, la publicación
// se sigue viendo igual.
function kxsPostData(session, entries, track) {
  const f = kxsShareFigures(session, entries);
  const t = kxsPostTrack(track || session.track || []);
  return {
    sessionId: session.id, schoolId: session.schoolId || '', schoolName: f.schoolName,
    ...(f.kind === 'gym' ? { kind: 'gym' } : {}),
    startedAt: f.startedAt, activeMs: f.activeMs, routes: f.routes, sends: f.sends, meters: f.meters,
    maxGrade: f.maxGrade, kcal: f.kcal, distanceM: f.distanceM, gradeCounts: f.gradeCounts,
    ...(t ? { track: t } : {})
  };
}

// Proyecta un recorrido {lng,lat} a coordenadas de pantalla dentro de una caja (equirrectangular, sin deformar)
function kxsFitTrack(points, w, h, pad) {
  if (!points || points.length < 2) return [];
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const k = Math.cos(lat0 * Math.PI / 180);
  const xy = points.map(p => [p.lng * k, -p.lat]);
  const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-9;
  const s = Math.min((w - 2 * pad) / (maxX - minX || span), (h - 2 * pad) / (maxY - minY || span));
  const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
  return xy.map(([x, y]) => [ox + (x - minX) * s, oy + (y - minY) * s]);
}

// Grados de mayor a menor dificultad con su número de vías (para la franja de colores)
function kxsGradeStrip(gradeCounts) {
  const rank = typeof kxGradeRank === 'function' ? kxGradeRank : () => 0;
  return Object.entries(gradeCounts || {}).filter(([, n]) => n > 0).sort((a, b) => rank(b[0]) - rank(a[0]));
}

const kxsFmtKm = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

// Duración corta para la tarjeta del feed: «4:05 h» / «45 min»
function kxsShortDuration(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  return min >= 60 ? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h` : `${min} min`;
}

// Las cifras que se muestran: siempre duración y vías; luego lo que haya. compact: textos cortos (tarjeta del feed)
function kxsShareStats(f, max = 6, { compact = false } = {}) {
  const out = [
    { label: 'Duración', value: compact ? kxsShortDuration(f.activeMs) : kxsFormatDuration(f.activeMs) },
    f.kind === 'gym'
      ? { label: f.routes === 1 ? 'Ascenso' : 'Ascensos', value: String(f.routes) }
      : { label: f.routes === 1 ? 'Vía' : 'Vías', value: String(f.routes) }
  ];
  if (f.meters > 0) out.push({ label: 'Metros', value: `${f.meters} m` });
  if (f.maxGrade) out.push({ label: compact ? 'Máx.' : 'Grado máx.', value: f.maxGrade });
  if (f.kcal > 0) out.push({ label: 'kcal (est.)', value: String(f.kcal) });
  if (f.distanceM > 0) out.push({ label: 'Recorrido', value: kxsFmtKm(f.distanceM) });
  if (out.length < max) out.push({ label: f.kind === 'gym' ? 'Encadenados' : 'Encadenadas', value: String(f.sends) });
  return out.slice(0, max);
}

// ============================================
// IMAGEN PARA HISTORIAS (canvas 1080×1920)
// ============================================
function kxsStoryFont() {
  const css = typeof getComputedStyle === 'function' ? getComputedStyle(document.body).getPropertyValue('--kx-font') : '';
  return (css && css.trim()) || "'Manrope', 'Inter', system-ui, sans-serif";
}

async function kxsStoryCanvas(session, entries, { transparent = false } = {}) {
  const W = 1080, H = 1920, C = KXS_SHARE_COLORS;
  const f = kxsShareFigures(session, entries);
  const font = kxsStoryFont();
  try { if (document.fonts) await Promise.all(['800 96px Manrope', '600 40px Manrope'].map(x => document.fonts.load(x))); } catch (e) { /* tipografía del sistema */ }

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const ink = transparent ? C.white : C.chalk;
  const soft = transparent ? 'rgba(255,255,255,0.82)' : C.sage;
  const shadow = (on) => { g.shadowColor = on && transparent ? 'rgba(0,0,0,0.45)' : 'transparent'; g.shadowBlur = on && transparent ? 18 : 0; };

  if (!transparent) {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, C.forest); bg.addColorStop(1, C.forestDeep);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // Curvas de nivel suaves: un guiño a la cartografía de KRUX
    g.strokeStyle = 'rgba(220,233,223,0.07)'; g.lineWidth = 3;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      for (let x = -20; x <= W + 20; x += 20) {
        const y = 180 + i * 125 + Math.sin(x / 170 + i * 0.9) * 38 + Math.sin(x / 61 + i) * 9;
        if (x === -20) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
    }
  }

  const text = (str, x, y, size, weight, color, align = 'left', spacing = 0) => {
    g.font = `${weight} ${size}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
    if ('letterSpacing' in g) g.letterSpacing = `${spacing}px`;
    shadow(true); g.fillText(str, x, y); shadow(false);
    if ('letterSpacing' in g) g.letterSpacing = '0px';
  };
  const fit = (str, size, weight, maxW) => {   // reduce el tamaño hasta que quepa en una línea
    let s = size;
    g.font = `${weight} ${s}px ${font}`;
    while (s > 44 && g.measureText(str).width > maxW) { s -= 4; g.font = `${weight} ${s}px ${font}`; }
    return s;
  };

  // Cabecera
  text('KRUX', 80, 150, 58, 800, ink, 'left', 6);
  text(f.kind === 'gym' ? 'SESIÓN DE ROCÓDROMO' : 'SESIÓN DE ROCA', W - 80, 146, 30, 700, soft, 'right', 4);

  // Escuela y fecha
  const title = f.schoolName || 'Sesión de escalada';
  text(title, 80, 330, fit(title, 104, 800, W - 160), 800, ink);
  text(kxsDate(f.startedAt), 80, 400, 40, 600, soft);

  // Recorrido o, sin GPS, el grado máximo en grande
  const box = { x: 80, y: 470, w: W - 160, h: 640 };
  const pts = kxsFitTrack(session.track || [], box.w, box.h, 40);
  if (pts.length > 1) {
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = transparent ? C.white : C.coral; g.lineWidth = 12;
    shadow(true);
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(box.x + x, box.y + y) : g.moveTo(box.x + x, box.y + y))); g.stroke();
    shadow(false);
    const dot = ([x, y], fill, ring) => { g.beginPath(); g.arc(box.x + x, box.y + y, 18, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); g.lineWidth = 7; g.strokeStyle = ring; g.stroke(); };
    dot(pts[0], ink, transparent ? C.white : C.forest);
    dot(pts[pts.length - 1], transparent ? C.white : C.coral, transparent ? C.white : C.chalk);
  } else if (f.maxGrade) {
    text(f.maxGrade, W / 2, box.y + box.h / 2 + 110, 330, 800, ink, 'center');
    text('GRADO MÁXIMO ENCADENADO', W / 2, box.y + box.h / 2 + 200, 34, 700, soft, 'center', 4);
  }

  // Cifras: rejilla de 2 columnas
  const stats = kxsShareStats(f, 6);
  const colW = (W - 160) / 2, top = 1160, rowH = 176;
  stats.forEach((s, i) => {
    const x = 80 + (i % 2) * colW, y = top + Math.floor(i / 2) * rowH;
    text(s.value, x, y + 92, fit(s.value, 92, 800, colW - 70), 800, ink);
    text(s.label.toUpperCase(), x, y + 142, 30, 700, soft, 'left', 3);
  });

  // Franja de grados (colores de grado de KRUX), de más difícil a más fácil
  const strip = kxsGradeStrip(f.gradeCounts);
  const total = strip.reduce((s, [, n]) => s + n, 0);
  if (total > 0 && typeof kxGradeColor === 'function') {
    let x = 80; const y = H - 190, w = W - 160, h = 26, gap = 6;
    const usable = w - gap * (strip.length - 1);
    strip.forEach(([grade, n]) => {
      const sw = Math.max(18, usable * (n / total));
      g.fillStyle = kxGradeColor(grade);
      g.beginPath(); (g.roundRect ? g.roundRect(x, y, sw, h, 13) : g.rect(x, y, sw, h)); g.fill();
      x += sw + gap;
    });
  }
  text('krux · registra tus ascensos', W / 2, H - 80, 30, 600, soft, 'center', 2);
  return cv;
}

// ============================================
// COMPARTIR LA IMAGEN
// ============================================
// App nativa: archivo temporal (Filesystem) + hoja de compartir (Share) → Instagram › Historia.
// Navegador: Web Share con archivo si existe; si no, se descarga la imagen. Devuelve 'shared' | 'saved' | 'cancelled'.
async function kxsShareImage(canvas, { filename = 'krux-sesion.png', title = 'Mi sesión de escalada en KRUX' } = {}) {
  const cap = window.Capacitor;
  const P = cap && cap.isNativePlatform && cap.isNativePlatform() ? cap.Plugins || {} : {};
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('imagen');
  const cancelled = (e) => e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''));
  try {
    if (P.Filesystem && P.Share) {
      const data = canvas.toDataURL('image/png').split(',')[1];
      const res = await P.Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
      await P.Share.share({ title, files: [res.uri] });
      return 'shared';
    }
    const file = new File([blob], filename, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return 'shared';
    }
  } catch (e) {
    if (cancelled(e)) return 'cancelled';
    console.warn('[sesión] compartir:', e);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

// ============================================
// PUBLICACIÓN EN EL FEED
// ============================================
async function kxsPublishSession(session, entries, track, text) {
  const user = firebase.auth().currentUser;
  if (!user) throw Object.assign(new Error('auth'), { code: 'auth' });
  const content = String(text || '').trim().slice(0, 2000);
  const post = {
    type: 'climb_session',
    userId: user.uid,
    userName: user.displayName || 'Usuario',
    userPhoto: (typeof kxAuthorPhoto === 'function' ? await kxAuthorPhoto(user.uid) : '') || user.photoURL || '',
    likes: 0, liked: false, commentsCount: 0,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    climbSession: kxsPostData(session, entries, track),
    ...(content ? { content } : {}),
    ...(session.schoolName ? { location: { name: session.schoolName } } : {})
  };
  const ref = await db.collection('posts').add(post);
  return ref.id;
}

// Tarjeta de la sesión en el feed: recorrido (o grado máximo), cifras y franja de grados
function kxsFeedCardHTML(cs) {
  if (!cs) return '';
  const pts = cs.track && Array.isArray(cs.track.lng) ? cs.track.lng.map((lng, i) => ({ lng, lat: cs.track.lat[i] })) : [];
  const fitted = kxsFitTrack(pts, 320, 150, 14);
  const path = fitted.length > 1 ? fitted.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') : '';
  const f = { ...cs, schoolName: cs.schoolName || '' };
  const stats = kxsShareStats(f, 4, { compact: true });
  const strip = kxsGradeStrip(cs.gradeCounts);
  const total = strip.reduce((s, [, n]) => s + n, 0);
  const visual = path
    ? `<svg class="kxs-fc-map" viewBox="0 0 320 150" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path class="kxs-fc-contour" d="M-10 40 C60 20 120 60 190 38 S300 20 330 44 M-10 92 C70 70 140 112 210 90 S300 70 330 96 M-10 140 C80 118 150 158 220 136 S300 118 330 142"/>
        <path class="kxs-fc-route" d="${path}"/>
        <circle class="kxs-fc-start" cx="${fitted[0][0].toFixed(1)}" cy="${fitted[0][1].toFixed(1)}" r="5"/>
        <circle class="kxs-fc-end" cx="${fitted[fitted.length - 1][0].toFixed(1)}" cy="${fitted[fitted.length - 1][1].toFixed(1)}" r="5"/>
      </svg>`
    : `<div class="kxs-fc-hero">${cs.maxGrade ? `<strong style="--c:${kxGradeColor(cs.maxGrade)}">${kxEsc(cs.maxGrade)}</strong><small>Grado máximo</small>` : `<strong>${cs.routes || 0}</strong><small>${cs.kind === 'gym' ? (cs.routes === 1 ? 'Ascenso' : 'Ascensos') : (cs.routes === 1 ? 'Vía' : 'Vías')}</small>`}</div>`;
  return `<div class="kxs-fc">
      <div class="kxs-fc-top">
        <span class="kxs-fc-kicker">${cs.kind === 'gym' ? `${kxIcon('gym', { size: 14 })}Sesión de rocódromo` : `${kxIcon('mountain', { size: 14 })}Sesión de roca`}</span>
        <span class="kxs-fc-date">${kxEsc(cs.startedAt ? kxsDate(cs.startedAt) : '')}</span>
      </div>
      <div class="kxs-fc-title">${kxEsc(cs.schoolName || 'Sesión de escalada')}</div>
      ${visual}
      <dl class="kxs-fc-stats">${stats.map(s => `<div><dt>${kxEsc(s.label)}</dt><dd>${kxEsc(s.value)}</dd></div>`).join('')}</dl>
      ${total > 0 ? `<div class="kxs-fc-strip" role="img" aria-label="${kxEsc(strip.map(([gr, n]) => `${n} en ${gr}`).join(', '))}">${strip.map(([gr, n]) => `<span style="flex:${n};--c:${kxGradeColor(gr)}" title="${kxEsc(`${gr}: ${n}`)}"></span>`).join('')}</div>` : ''}
    </div>`;
}

if (typeof window !== 'undefined') {
  window.KruxSessionShare = { storyCanvas: kxsStoryCanvas, shareImage: kxsShareImage, publish: kxsPublishSession, feedCardHTML: kxsFeedCardHTML, postData: kxsPostData, fitTrack: kxsFitTrack };
}
