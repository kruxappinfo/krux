// ================== BLOQUES DE ROCÓDROMO ==================
// Foto de un bloque o vía de rocódromo con sus presas marcadas. Se registra con el ascenso de rocódromo
// (#ascent-modal en modo rocódromo) y se guarda en users/{uid}/gym_blocks/{id}: privado, salvo que se publique en el feed.
// El marcado es asistido: al tocar una presa se calcula su contorno por color (varita mágica sobre la propia foto,
// sin servidor ni IA) y se corrige a mano (agrandar, reducir, círculo, borrar).
// Foto: gym-blocks/{uid}/{id}.jpg (JPEG de 1600 px como máximo). Contornos en coordenadas 0..1 de la foto.

const KXB_TYPES = [
  { key: 'start', label: 'Inicio', color: '#2BD46B' },
  { key: 'hand', label: 'Mano', color: '#4FB3FF' },
  { key: 'foot', label: 'Pie', color: '#FFD23F' },
  { key: 'top', label: 'Top', color: '#FF4D8D' }
];
const KXB_COLORS = [
  { key: 'amarillo', label: 'Amarillo', hex: '#F2CC2E' },
  { key: 'naranja', label: 'Naranja', hex: '#F08A24' },
  { key: 'rojo', label: 'Rojo', hex: '#D93A32' },
  { key: 'rosa', label: 'Rosa', hex: '#F06EAA' },
  { key: 'morado', label: 'Morado', hex: '#7E4AB8' },
  { key: 'azul', label: 'Azul', hex: '#2F6FD6' },
  { key: 'verde', label: 'Verde', hex: '#2FA65A' },
  { key: 'negro', label: 'Negro', hex: '#26282B' },
  { key: 'blanco', label: 'Blanco', hex: '#F4F4F1' },
  { key: 'gris', label: 'Gris', hex: '#9A9FA3' },
  { key: 'marron', label: 'Marrón', hex: '#8A5A33' }
];
const KXB_MAX_HOLDS = 60;
const KXB_PHOTO_SIDE = 1600;
const KXB_ANALYSIS_SIDE = 720;
const KXB_THUMB_SIDE = 480;
const KXB_MAX_FORM = 8;   // bloques en un mismo registro
const KXB_TOL_DEFAULT = 16;
// Una presa no ocupa más del 2,5 % de la foto: lo que sea mayor es un panel, un volumen pintado o el muro (en algunas fotos
// un panel rojo y las presas rosas tienen el mismo tono para la cámara: solo el tamaño los separa)
const KXB_HOLD_MAX = 0.025;

Object.assign(KX_ICON_PATHS, {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
});

const kxbType = (k) => KXB_TYPES.find(t => t.key === k) || KXB_TYPES[1];
const kxbColor = (k) => KXB_COLORS.find(c => c.key === k) || null;

// ============================================
// ANÁLISIS DE LA FOTO (funciones puras: tests/gym-blocks.test.js)
// ============================================

// sRGB (0..255) → CIELAB, con tabla para la parte lineal
const KXB_LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; t[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return t;
})();
function kxbLabOf(r, g, b) {
  const R = KXB_LIN[r], G = KXB_LIN[g], B = KXB_LIN[b];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
  const y = f(R * 0.2126 + G * 0.7152 + B * 0.0722);
  const z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Imagen RGBA → tres planos Lab, con un desenfoque 3×3 previo (la textura del muro y el magnesio meten ruido)
function kxbLabImage(rgba, w, h) {
  const n = w * h;
  const blur = new Uint8ClampedArray(n * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4; r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; c++;
        }
      }
      const o = (y * w + x) * 3; blur[o] = r / c; blur[o + 1] = g / c; blur[o + 2] = b / c;
    }
  }
  const L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
  const C = new Float32Array(n), H = new Float32Array(n);   // saturación y tono (ángulo en a/b)
  for (let i = 0; i < n; i++) {
    const lab = kxbLabOf(blur[i * 3], blur[i * 3 + 1], blur[i * 3 + 2]);
    L[i] = lab[0]; A[i] = lab[1]; B[i] = lab[2];
    C[i] = Math.hypot(lab[1], lab[2]); H[i] = Math.atan2(lab[2], lab[1]);
  }
  return { w, h, L, A, B, C, H, rgb: blur };
}

// ¿El píxel i es del color de la semilla? Presas de color: se compara el TONO, que apenas cambia con la sombra, el brillo
// o el magnesio (la luz y la saturación sí cambian mucho dentro de una misma presa). Presas grises/blancas/negras: no
// tienen tono, cuenta la luz. tol (6..34, el deslizador «Contorno») → margen de tono de 7° a 42°.
const KXB_NEUTRAL_CHROMA = 12;
function kxbNearFn(img, seed, tol) {
  const { L, A, B, C, H } = img;
  const cs = Math.hypot(seed[1], seed[2]);
  if (cs < KXB_NEUTRAL_CHROMA) {
    const tol2 = tol * tol;
    return (i) => {
      const dl = L[i] - seed[0], da = A[i] - seed[1], db = B[i] - seed[2];
      return dl * dl + da * da + db * db <= tol2;
    };
  }
  const hs = Math.atan2(seed[2], seed[1]);
  const hueTol = tol * 1.25 * Math.PI / 180;
  const cMin = Math.max(7, 0.3 * cs);   // por debajo, el «tono» del muro es ruido
  return (i) => {
    if (C[i] < cMin || Math.abs(L[i] - seed[0]) > 55) return false;
    let d = Math.abs(H[i] - hs);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return d <= hueTol;
  };
}

// Máscara binaria engordada 1 px (vecindad de 8): une los trozos de una presa que separa una raya de magnesio o un tornillo
function kxbDilate(m, w, h) {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!m[i]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) out[yy * w + xx] = 1; }
      }
    }
  }
  return out;
}

// Relleno por color desde (sx, sy) dentro de una ventana alrededor del toque. leak: se ha escapado al muro.
// mean: color Lab medio de los píxeles de la presa (para repetir con el color de toda la presa y no solo del toque).
function kxbFlood(img, sx, sy, seed, tol) {
  const { w, h, L, A, B } = img;
  const near = kxbNearFn(img, seed, tol);
  const R = Math.round(0.28 * Math.max(w, h));
  const x0 = Math.max(0, sx - R), x1 = Math.min(w - 1, sx + R), y0 = Math.max(0, sy - R), y1 = Math.min(h - 1, sy + R);
  const ww = x1 - x0 + 1, wh = y1 - y0 + 1;
  const raw = new Uint8Array(ww * wh);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (near(y * w + x)) raw[(y - y0) * ww + (x - x0)] = 1;
  const grown = kxbDilate(raw, ww, wh);
  const cap = Math.round(KXB_HOLD_MAX * w * h);
  const mask = new Uint8Array(w * h);
  const queue = new Int32Array(ww * wh);
  let head = 0, tail = 0, area = 0, n = 0, sl = 0, sa = 0, sb = 0;
  let bx0 = sx, bx1 = sx, by0 = sy, by1 = sy;
  const lsx = sx - x0, lsy = sy - y0;
  if (!grown[lsy * ww + lsx]) return { leak: false, mask, area: 0, bbox: [sx, sy, sx, sy], mean: null };
  const visited = new Uint8Array(ww * wh);
  visited[lsy * ww + lsx] = 1; queue[tail++] = lsy * ww + lsx;
  while (head < tail) {
    const k = queue[head++];
    const lx = k % ww, ly = (k - lx) / ww, x = lx + x0, y = ly + y0, i = y * w + x;
    mask[i] = 1; area++;
    if (area > cap) return { leak: true };
    if (raw[k]) { n++; sl += L[i]; sa += A[i]; sb += B[i]; }
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    if (lx > 0 && grown[k - 1] && !visited[k - 1]) { visited[k - 1] = 1; queue[tail++] = k - 1; }
    if (lx < ww - 1 && grown[k + 1] && !visited[k + 1]) { visited[k + 1] = 1; queue[tail++] = k + 1; }
    if (ly > 0 && grown[k - ww] && !visited[k - ww]) { visited[k - ww] = 1; queue[tail++] = k - ww; }
    if (ly < wh - 1 && grown[k + ww] && !visited[k + ww]) { visited[k + ww] = 1; queue[tail++] = k + ww; }
  }
  return { leak: false, mask, area, bbox: [bx0, by0, bx1, by1], mean: n ? [sl / n, sa / n, sb / n] : null };
}

// Recorte de la máscara con 2 px de margen: rellena agujeros (brillos, tornillo) y engorda 1 px (el trazo queda por fuera)
// val: valor de la presa en la máscara (1 en el relleno; su etiqueta en la detección del bloque entero)
function kxbCleanMask(mask, w, bbox, val = 1, grow = true) {
  const [bx0, by0, bx1, by1] = bbox;
  const ox = bx0 - 2, oy = by0 - 2, lw = bx1 - bx0 + 5, lh = by1 - by0 + 5;
  const m = new Uint8Array(lw * lh);
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (mask[y * w + x] === val) m[(y - oy) * lw + (x - ox)] = 1;
  // Fuera = lo alcanzable desde el borde sin pisar la presa; el resto es la presa con sus agujeros tapados
  const out = new Uint8Array(lw * lh);
  const q = new Int32Array(lw * lh);
  let head = 0, tail = 0;
  const push = (i) => { if (!out[i] && !m[i]) { out[i] = 1; q[tail++] = i; } };
  for (let x = 0; x < lw; x++) { push(x); push((lh - 1) * lw + x); }
  for (let y = 0; y < lh; y++) { push(y * lw); push(y * lw + lw - 1); }
  while (head < tail) {
    const i = q[head++], x = i % lw, y = (i - x) / lw;
    if (x > 0) push(i - 1); if (x < lw - 1) push(i + 1); if (y > 0) push(i - lw); if (y < lh - 1) push(i + lw);
  }
  const filled = new Uint8Array(lw * lh);
  for (let i = 0; i < filled.length; i++) filled[i] = out[i] ? 0 : 1;
  if (!grow) return { m: filled, lw, lh, ox, oy };
  const grown = new Uint8Array(lw * lh);
  for (let y = 1; y < lh - 1; y++) {
    for (let x = 1; x < lw - 1; x++) {
      const i = y * lw + x;
      if (filled[i] || filled[i - 1] || filled[i + 1] || filled[i - lw] || filled[i + lw]
        || filled[i - lw - 1] || filled[i - lw + 1] || filled[i + lw - 1] || filled[i + lw + 1]) grown[i] = 1;
    }
  }
  return { m: grown, lw, lh, ox, oy };
}

// Borde exterior de la máscara (seguimiento de Moore, sentido horario)
const KXB_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const KXB_DY = [0, 1, 1, 1, 0, -1, -1, -1];
function kxbTrace(m, lw, lh) {
  let sx = -1, sy = -1;
  for (let i = 0; i < m.length; i++) if (m[i]) { sx = i % lw; sy = (i - sx) / lw; break; }
  if (sx < 0) return [];
  const dirOf = (dx, dy) => { for (let d = 0; d < 8; d++) if (KXB_DX[d] === dx && KXB_DY[d] === dy) return d; return 0; };
  const pts = [[sx, sy]];
  let cx = sx, cy = sy, back = 4;
  const limit = 4 * lw * lh + 16;
  for (let it = 0; it < limit; it++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (back + k) & 7, x = cx + KXB_DX[d], y = cy + KXB_DY[d];
      if (x >= 0 && y >= 0 && x < lw && y < lh && m[y * lw + x]) { found = d; break; }
    }
    if (found < 0) break;
    const pd = (found + 7) & 7;
    const pbx = cx + KXB_DX[pd], pby = cy + KXB_DY[pd];
    const nx = cx + KXB_DX[found], ny = cy + KXB_DY[found];
    if (cx === sx && cy === sy && pts.length > 2 && nx === pts[1][0] && ny === pts[1][1]) break;
    back = dirOf(pbx - nx, pby - ny);
    cx = nx; cy = ny;
    pts.push([cx, cy]);
  }
  if (pts.length > 1 && pts[pts.length - 1][0] === sx && pts[pts.length - 1][1] === sy) pts.pop();
  return pts;
}

// Ramer–Douglas–Peucker (polilínea abierta)
function kxbRdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Polígono cerrado: se parte por el punto más lejano al primero y se simplifica cada mitad
function kxbSimplify(pts, eps) {
  if (pts.length < 4) return pts.slice();
  let far = 0, farD = -1;
  pts.forEach((p, i) => { const d = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (d > farD) { farD = d; far = i; } });
  const a = kxbRdp(pts.slice(0, far + 1), eps);
  const b = kxbRdp(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

// Círculo (16 puntos, en 0..1) alrededor de un punto: lo que se marca cuando la varita no distingue la presa
function kxbCircle(nx, ny, w, h, rPx) {
  const out = [];
  const r = rPx || 0.025 * Math.max(w, h);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push(+((nx * w + Math.cos(a) * r) / w).toFixed(4), +((ny * h + Math.sin(a) * r) / h).toFixed(4));
  }
  return out;
}

// Color medio alrededor del toque (5×5)
function kxbSeed(img, sx, sy) {
  const { w, h, L, A, B, rgb } = img;
  let l = 0, a = 0, b = 0, r = 0, g = 0, bl = 0, c = 0;
  for (let y = Math.max(0, sy - 2); y <= Math.min(h - 1, sy + 2); y++) {
    for (let x = Math.max(0, sx - 2); x <= Math.min(w - 1, sx + 2); x++) {
      const i = y * w + x;
      l += L[i]; a += A[i]; b += B[i]; r += rgb[i * 3]; g += rgb[i * 3 + 1]; bl += rgb[i * 3 + 2]; c++;
    }
  }
  return { lab: [l / c, a / c, b / c], rgb: [r / c, g / c, bl / c] };
}

// Contorno de la presa tocada en (nx, ny) ∈ 0..1. ok = false: no se distinguía y se devuelve un círculo.
function kxbSegment(img, nx, ny, tol = KXB_TOL_DEFAULT) {
  const { w, h } = img;
  const sx = Math.min(w - 1, Math.max(0, Math.round(nx * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.round(ny * h)));
  const seed = kxbSeed(img, sx, sy);
  const minArea = Math.max(24, Math.round(0.00005 * w * h));
  let res = kxbFlood(img, sx, sy, seed.lab, tol);
  for (const f of [0.65, 0.45, 0.3]) { if (!res.leak) break; res = kxbFlood(img, sx, sy, seed.lab, tol * f); }
  if (!res.leak && res.area < minArea) {
    const wider = kxbFlood(img, sx, sy, seed.lab, tol * 1.5);
    if (!wider.leak && wider.area >= minArea) res = wider;
  }
  // Segunda pasada con el color medio de lo encontrado: si se tocó un brillo o una sombra, ahora sale la presa entera
  if (!res.leak && res.area >= minArea && res.mean) {
    const again = kxbFlood(img, sx, sy, res.mean, tol);
    if (!again.leak && again.area >= res.area) res = again;
  }
  const circle = (reason) => ({ ok: false, reason, p: kxbCircle(nx, ny, w, h), rgb: seed.rgb });
  if (res.leak) return circle('leak');
  if (res.area < minArea) return circle('small');
  const p = kxbContour(res.mask, w, h, res.bbox, 1, false);
  return p ? { ok: true, p, rgb: seed.rgb } : circle('small');
}

// Contorno simplificado (en 0..1) de la zona de la máscara con valor val, o null si no sale un polígono
function kxbContour(mask, w, h, bbox, val, grow = true) {
  const { m, lw, lh, ox, oy } = kxbCleanMask(mask, w, bbox, val, grow);
  const pts = kxbTrace(m, lw, lh);
  if (pts.length < 3) return null;
  let eps = Math.max(0.8, 0.0015 * Math.max(w, h));
  let simple = kxbSimplify(pts, eps);
  while (simple.length > 48) { eps *= 1.4; simple = kxbSimplify(pts, eps); }
  if (simple.length < 3) return null;
  const p = [];
  simple.forEach(([x, y]) => { p.push(+((x + ox + 0.5) / w).toFixed(4), +((y + oy + 0.5) / h).toFixed(4)); });
  return p;
}

// Zonas de la foto del color de la semilla (máscara engordada 1 px para unir trozos de una misma presa)
function kxbColorZones(img, seedLab, tol) {
  const { w, h, L, A, B, rgb } = img;
  const N = w * h;
  const near = kxbNearFn(img, seedLab, tol);
  const raw = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (near(i)) raw[i] = 1;
  const grown = kxbDilate(raw, w, h);
  const labels = new Int32Array(N);
  const queue = new Int32Array(N);
  const zones = [];
  let next = 0;
  for (let start = 0; start < N; start++) {
    if (!grown[start] || labels[start]) continue;
    const lab = ++next;
    let head = 0, tail = 0, area = 0, n = 0, cx = 0, cy = 0, r = 0, g = 0, b = 0, sl = 0, sa = 0, sb = 0, sxx = 0, syy = 0, sxy = 0;
    let bx0 = w, bx1 = 0, by0 = h, by1 = 0;
    labels[start] = lab; queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w, y = (i - x) / w;
      area++; cx += x; cy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (raw[i]) { n++; r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; sl += L[i]; sa += A[i]; sb += B[i]; }
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
      if (x > 0 && grown[i - 1] && !labels[i - 1]) { labels[i - 1] = lab; queue[tail++] = i - 1; }
      if (x < w - 1 && grown[i + 1] && !labels[i + 1]) { labels[i + 1] = lab; queue[tail++] = i + 1; }
      if (y > 0 && grown[i - w] && !labels[i - w]) { labels[i - w] = lab; queue[tail++] = i - w; }
      if (y < h - 1 && grown[i + w] && !labels[i + w]) { labels[i + w] = lab; queue[tail++] = i + w; }
    }
    // Alargamiento por los ejes principales (momentos de segundo orden): una franja o una cinta, aunque vaya en diagonal
    const mx = cx / area, my = cy / area;
    const vxx = sxx / area - mx * mx, vyy = syy / area - my * my, vxy = sxy / area - mx * my;
    const tr = vxx + vyy, det = Math.sqrt(Math.max(0, (vxx - vyy) * (vxx - vyy) + 4 * vxy * vxy));
    const elong = Math.sqrt(Math.max(1e-6, (tr + det) / 2) / Math.max(1e-6, (tr - det) / 2));
    const pix = n;   // píxeles del color de verdad (area es la zona engordada 1 px)
    n = n || 1;
    zones.push({ lab, area, pix, elong, bbox: [bx0, by0, bx1, by1], c: [mx, my], rgb: [r / n, g / n, b / n], mean: [sl / n, sa / n, sb / n] });
  }
  return { labels, zones };
}

// Zona en el punto tocado o, si cae justo en un borde, en sus 3 px alrededor
function kxbZoneAt(labels, zones, w, h, sx, sy) {
  for (let r = 0; r <= 3; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const l = labels[y * w + x];
      if (l > 0) return zones.find(z => z.lab === l) || null;
    }
  }
  return null;
}

// Presas de la misma vía o bloque: forman una cadena con separaciones parecidas. Se unen todas las candidatas por su
// vecina más cercana (árbol de mínima distancia, desde la tocada) y se corta donde el salto es mucho mayor que lo
// normal en esa foto: lo que queda al otro lado son otras vías o paredes. En horizontal pesa más (las vías de al lado
// están a los lados). La distancia es el hueco entre presas, no entre centros: una presa grande no queda «lejos».
const KXB_CHAIN = { aniso: 1.5, k: 2.5, floor: 0.05 };
function kxbChain(zones, si, S) {
  const n = zones.length;
  if (n <= 2) return zones.map((_, i) => i);
  const rad = zones.map(z => Math.sqrt(z.area / Math.PI));
  const gap = (i, j) => Math.max(0, Math.hypot((zones[i].c[0] - zones[j].c[0]) * KXB_CHAIN.aniso, zones[i].c[1] - zones[j].c[1]) - rad[i] - rad[j]);
  const inTree = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1);
  const order = [], len = new Float64Array(n);
  best[si] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (u < 0 || best[i] < best[u])) u = i;
    inTree[u] = 1; order.push(u); len[u] = best[u];
    for (let i = 0; i < n; i++) if (!inTree[i]) { const d = gap(u, i); if (d < best[i]) { best[i] = d; parent[i] = u; } }
  }
  const steps = order.slice(1).map(i => len[i]).sort((a, b) => a - b);
  const median = steps[Math.floor(steps.length / 2)];
  const cut = Math.max(KXB_CHAIN.k * median, KXB_CHAIN.floor * S);
  const ok = new Uint8Array(n);
  ok[si] = 1;
  order.slice(1).forEach(i => { ok[i] = ok[parent[i]] && len[i] <= cut ? 1 : 0; });
  return order.filter(i => ok[i]);
}

// Bloque entero: las presas del color de la tocada que forman su misma vía o bloque (en los rocódromos se definen por
// el color). Se descartan el ruido (manchas pequeñas), los paneles o el muro (más del 5 % de la foto), las líneas
// finas (cinta, juntas) y lo que queda lejos de la cadena. La más alta queda como Top. neutral: presa gris/blanca/negra.
function kxbSegmentAll(img, nx, ny, tol = KXB_TOL_DEFAULT) {
  const { w, h } = img;
  const sx = Math.min(w - 1, Math.max(0, Math.round(nx * w)));
  const sy = Math.min(h - 1, Math.max(0, Math.round(ny * h)));
  const seed = kxbSeed(img, sx, sy);
  if (Math.hypot(seed.lab[1], seed.lab[2]) < KXB_NEUTRAL_CHROMA) return { ok: false, neutral: true, holds: [] };
  const N = w * h, S = Math.max(w, h);
  const cap = Math.round(KXB_HOLD_MAX * N);
  const minArea = Math.max(24, Math.round(0.00005 * N));
  let pass = kxbColorZones(img, seed.lab, tol);
  let sz = kxbZoneAt(pass.labels, pass.zones, w, h, sx, sy);
  if (!sz || sz.area > cap || sz.pix < minArea) return { ok: false, holds: [] };
  // Segunda pasada con el color medio de la presa tocada (no el del punto exacto, que puede ser un brillo o una sombra)
  const again = kxbColorZones(img, sz.mean, tol);
  const sz2 = kxbZoneAt(again.labels, again.zones, w, h, sx, sy);
  if (sz2 && sz2.area <= cap && sz2.area >= sz.area) { pass = again; sz = sz2; }
  const minKeep = Math.max(minArea, Math.round(sz.pix * 0.04));
  // Tampoco mucho mayor que la presa tocada (un panel del mismo tono que quepa en el 2,5 %)
  const maxKeep = Math.min(cap, Math.max(6 * sz.area, Math.round(0.008 * N)));
  const chroma = (z) => Math.hypot(z.mean[1], z.mean[2]);
  const cSeed = chroma(sz);
  // Cada presa es de un solo color: su tono MEDIO debe estar muy cerca del de la tocada. El margen amplio de kxbNearFn
  // es para el contorno (sombras, brillos); aquí separa colores vecinos (rojo/naranja, verde/lima, azul/morado).
  const hueOf = (z) => Math.atan2(z.mean[2], z.mean[1]);
  const hSeed = hueOf(sz);
  const hueMax = Math.max(6, 0.55 * tol * 1.25) * Math.PI / 180;
  const hueOk = (z) => { let d = Math.abs(hueOf(z) - hSeed); if (d > Math.PI) d = 2 * Math.PI - d; return d <= hueMax; };
  let cands = pass.zones.filter(z => {
    if (z === sz) return true;
    if (z.area > maxKeep || z.pix < minKeep) return false;
    if (chroma(z) < 0.45 * cSeed) return false;                               // apagada: gris con un matiz, no del color
    if (!hueOk(z)) return false;                                              // color vecino
    const bw = z.bbox[2] - z.bbox[0] + 1, bh = z.bbox[3] - z.bbox[1] + 1;
    if (z.area / (bw * bh) < 0.22) return false;                              // líneas y formas huecas
    if (z.elong > 5) return false;                                              // franjas, cintas y tiras (también en diagonal)
    return true;
  });
  if (cands.length > 300) cands = [sz].concat(cands.filter(z => z !== sz).sort((a, b) => b.area - a.area).slice(0, 299));
  const chain = kxbChain(cands, cands.indexOf(sz), S).slice(0, KXB_MAX_HOLDS).map(i => cands[i]);
  const holds = [];
  chain.forEach(z => {
    const p = kxbContour(pass.labels, w, h, z.bbox, z.lab, false);
    if (p) holds.push({ p, s: [+(z.c[0] / w).toFixed(4), +(z.c[1] / h).toFixed(4)], rgb: z.rgb, seed: z === sz, y: z.c[1] });
  });
  if (holds.length) {
    const top = holds.reduce((a, b) => (b.y < a.y ? b : a));
    holds.forEach(hh => { hh.t = hh === top && holds.length > 1 ? 'top' : 'hand'; delete hh.y; });
  }
  return { ok: holds.length > 1, holds };
}

// Punto dentro de un polígono plano [x0, y0, x1, y1, …]
function kxbInside(p, x, y) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Escala un contorno alrededor de su centro
function kxbScale(p, f) {
  let cx = 0, cy = 0;
  const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; }
  cx /= n; cy /= n;
  return p.map((v, i) => +((i % 2 ? cy + (v - cy) * f : cx + (v - cx) * f)).toFixed(4));
}

function kxbCentroid(p) {
  let cx = 0, cy = 0;
  for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; }
  return [cx / (p.length / 2), cy / (p.length / 2)];
}

// Trazado suave (curvas por los puntos medios) en unidades de la foto
function kxbPathD(p, W, H) {
  const n = p.length / 2;
  if (n < 3) return '';
  const pt = (i) => [p[(i % n) * 2] * W, p[(i % n) * 2 + 1] * H];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const f = (v) => v.toFixed(1);
  let s = pt(n - 1), c = pt(0), m = mid(s, c);
  let d = `M${f(m[0])} ${f(m[1])}`;
  for (let i = 0; i < n; i++) {
    const a = pt(i), b = pt(i + 1), mm = mid(a, b);
    d += ` Q${f(a[0])} ${f(a[1])} ${f(mm[0])} ${f(mm[1])}`;
  }
  return d + 'Z';
}

// Color de presa más parecido (Lab) a la mediana de los colores tocados
function kxbSuggestColor(rgbs) {
  if (!rgbs || !rgbs.length) return null;
  const med = [0, 1, 2].map(k => { const v = rgbs.map(c => c[k]).sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)]); });
  const lab = kxbLabOf(med[0], med[1], med[2]);
  let best = null, bestD = Infinity;
  KXB_COLORS.forEach(c => {
    const hx = parseInt(c.hex.slice(1), 16);
    const l2 = kxbLabOf((hx >> 16) & 255, (hx >> 8) & 255, hx & 255);
    const d = Math.hypot((lab[0] - l2[0]) * 0.6, lab[1] - l2[1], lab[2] - l2[2]);
    if (d < bestD) { bestD = d; best = c.key; }
  });
  return best;
}

// Solo lo que se guarda de cada presa: tipo, contorno y punto tocado
function kxbCleanHolds(holds) {
  return (holds || []).slice(0, KXB_MAX_HOLDS).map(h => ({
    t: KXB_TYPES.some(t => t.key === h.t) ? h.t : 'hand',
    p: (h.p || []).slice(0, 200).map(v => +Math.min(1.2, Math.max(-0.2, Number(v) || 0)).toFixed(4)),
    s: Array.isArray(h.s) ? h.s.slice(0, 2).map(v => +(Number(v) || 0).toFixed(4)) : kxbCentroid(h.p || [0, 0]).map(v => +v.toFixed(4))
  })).filter(h => h.p.length >= 6);
}

// ============================================
// DIBUJO: capa SVG de presas (ficha, miniaturas) e imagen para el feed
// ============================================
// fit: 'meet' (foto entera) o 'slice' (recortada como object-fit: cover). href: la foto va dentro del propio SVG
// (así las presas siempre caen encima de su sitio, sea cual sea el tamaño).
function kxbOverlaySVG(holds, W, H, { sel = -1, sw = 2.5, dim = true, uid = 'm', fit = 'meet', href = '' } = {}) {
  const paths = (holds || []).map(h => kxbPathD(h.p, W, H));
  const mask = dim && paths.length
    ? `<defs><mask id="kxb-${uid}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${paths.map(d => `<path d="${d}" fill="#000"/>`).join('')}</mask></defs>
       <rect width="${W}" height="${H}" fill="rgba(8,12,10,.5)" mask="url(#kxb-${uid})"/>`
    : '';
  const strokes = (holds || []).map((h, i) => {
    const t = kxbType(h.t);
    const isSel = i === sel;
    return `<path d="${paths[i]}" fill="${isSel ? 'rgba(255,255,255,.18)' : 'none'}" stroke="rgba(0,0,0,.55)" stroke-width="${sw * 2.2}" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`
      + `<path d="${paths[i]}" fill="none" stroke="${t.color}" stroke-width="${isSel ? sw * 1.6 : sw}" vector-effect="non-scaling-stroke" stroke-linejoin="round"${isSel ? ' stroke-dasharray="6 4"' : ''}/>`;
  }).join('');
  const photo = href ? `<image href="${kxEsc(href)}" width="${W}" height="${H}" preserveAspectRatio="none"/>` : '';
  return `<svg class="kxb-ov" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid ${fit}" aria-hidden="true">${photo}${mask}${strokes}</svg>`;
}

function kxbTracePath(ctx, p, W, H) {
  const n = p.length / 2;
  const pt = (i) => [p[(i % n) * 2] * W, p[(i % n) * 2 + 1] * H];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m = mid(pt(n - 1), pt(0));
  ctx.beginPath();
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) { const a = pt(i), mm = mid(a, pt(i + 1)); ctx.quadraticCurveTo(a[0], a[1], mm[0], mm[1]); }
  ctx.closePath();
}

// Foto con las presas marcadas, para publicarla (JPEG)
async function kxbBakeImage(src, holds) {
  const W = src.width, H = src.height;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(src, 0, 0, W, H);
  const dim = document.createElement('canvas');
  dim.width = W; dim.height = H;
  const d = dim.getContext('2d');
  d.fillStyle = 'rgba(8,12,10,.5)';
  d.fillRect(0, 0, W, H);
  d.globalCompositeOperation = 'destination-out';
  d.fillStyle = '#000';   // opaco: el recorte quita el velo entero sobre cada presa
  holds.forEach(h => { kxbTracePath(d, h.p, W, H); d.fill(); });
  g.drawImage(dim, 0, 0);
  dim.width = dim.height = 0;
  const sw = Math.max(3, Math.round(Math.max(W, H) / 320));
  g.lineJoin = 'round';
  holds.forEach(h => {
    kxbTracePath(g, h.p, W, H);
    g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = sw * 2.2; g.stroke();
    g.strokeStyle = kxbType(h.t).color; g.lineWidth = sw; g.stroke();
  });
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.86));
  cv.width = cv.height = 0;
  if (!blob) throw new Error('imagen');
  return blob;
}

// ============================================
// FOTO: preparar (girada según EXIF, 1600 px, JPEG) y cargar
// ============================================
async function kxbPreparePhoto(file) {
  const source = await kxLoadImageSource(file);
  const jpeg = async (side, quality) => {
    const scale = Math.min(1, side / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.imageSmoothingQuality = 'high';
    g.drawImage(source.src, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', quality));
    cv.width = cv.height = 0;   // libera memoria (iOS limita los lienzos vivos)
    if (!blob) throw new Error('imagen');
    return { blob, w, h };
  };
  try {
    const full = await jpeg(KXB_PHOTO_SIDE, 0.82);
    const thumb = await jpeg(KXB_THUMB_SIDE, 0.74);   // para las listas: no se descargan las fotos grandes
    return { ...full, thumb: thumb.blob };
  } finally {
    source.close();
  }
}

async function kxbDecode(blob) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(blob); } catch (_) { /* se usa <img> */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function kxbAnalyse(src) {
  const W = src.width || src.naturalWidth, H = src.height || src.naturalHeight;
  const s = Math.min(1, KXB_ANALYSIS_SIDE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  cv.width = cv.height = 0;
  return kxbLabImage(data, w, h);
}

// ============================================
// EDITOR: marcar presas a pantalla completa
// ============================================
const KruxBlockEditor = (() => {
  let root = null, resolveFn = null;
  let blob = null, url = '', W = 0, H = 0, img = null, src = null;
  // sel: presa seleccionada. picked: la ha tocado la persona (no es la que se acaba de añadir); solo entonces los botones
  // de tipo cambian esa presa: si no, eligen el tipo de las siguientes
  let holds = [], sel = -1, picked = false, type = 'hand', tol = KXB_TOL_DEFAULT, undo = [];
  let group = null;
  let armed = false;
  let drawMode = false, stroke = null;   // dibujo a mano: se rodea la presa con el dedo  // la persona ha elegido un tipo: tocar una presa marcada se lo pone (si no, solo la selecciona)   // toque que detectó el bloque entero ({ nx, ny }): el deslizador lo vuelve a calcular
  let s = 1, tx = 0, ty = 0, bw = 0, bh = 0;
  const pointers = new Map();
  let gesture = null;

  const toast = (m, t = 'info') => { if (typeof showToast === 'function') showToast(m, t); };

  function ensure() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'kxb-ed hidden';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'kxb-ed-title');
    root.innerHTML = `
      <header class="kxb-ed-head">
        <button type="button" class="kxb-ed-link" data-kxb="cancel">Cancelar</button>
        <div class="kxb-ed-title"><strong id="kxb-ed-title">Marca las presas</strong><span id="kxb-ed-count" aria-live="polite"></span></div>
        <button type="button" class="kxb-ed-done" data-kxb="done">Listo</button>
      </header>
      <div class="kxb-ed-stage" id="kxb-ed-stage">
        <div class="kxb-ed-canvas" id="kxb-ed-canvas"><img alt="Foto del bloque" draggable="false"><div class="kxb-ed-ov"></div><svg class="kxb-ed-live" preserveAspectRatio="none" aria-hidden="true"><polyline/></svg></div>
        <button type="button" class="kxb-ed-fab kxb-ed-drawbtn" data-kxb="draw" aria-pressed="false" aria-label="Dibujar una presa a mano">${kxIcon('pen', { size: 20 })}</button>
        <div class="kxb-ed-zoom">
          <button type="button" class="kxb-ed-fab" data-kxb="zin" aria-label="Ampliar">${kxIcon('zoomIn', { size: 20 })}</button>
          <button type="button" class="kxb-ed-fab" data-kxb="zout" aria-label="Reducir la vista">${kxIcon('zoomOut', { size: 20 })}</button>
        </div>
        <p class="kxb-ed-hint" id="kxb-ed-hint" aria-live="polite">Toca una presa del bloque: se marcarán todas las de su color.</p>
      </div>
      <div class="kxb-ed-tools">
        <div class="kxb-ed-types" role="radiogroup" aria-label="Tipo de presa">
          ${KXB_TYPES.map(t => `<button type="button" class="kxb-ed-type" role="radio" data-kxb-type="${t.key}" style="--c:${t.color}"><span class="kxb-dot" aria-hidden="true"></span>${t.label}</button>`).join('')}
        </div>
        <div class="kxb-ed-sel" id="kxb-ed-sel" hidden>
          <button type="button" class="kxb-ed-act" data-kxb="smaller">${kxIcon('zoomOut', { size: 18 })}<span>Reducir</span></button>
          <button type="button" class="kxb-ed-act" data-kxb="bigger">${kxIcon('zoomIn', { size: 18 })}<span>Agrandar</span></button>
          <button type="button" class="kxb-ed-act" data-kxb="circle">${kxIcon('circle', { size: 18 })}<span>Círculo</span></button>
          <button type="button" class="kxb-ed-act kxb-ed-act--danger" data-kxb="del">${kxIcon('trash', { size: 18 })}<span>Borrar</span></button>
        </div>
        <div class="kxb-ed-row">
          <label class="kxb-ed-tol"><span>Contorno</span><small>Ajustado</small><input type="range" id="kxb-ed-tol" min="6" max="34" step="1" value="${KXB_TOL_DEFAULT}" aria-label="Ajuste del contorno: ajustado o amplio"><small>Amplio</small></label>
          <button type="button" class="kxb-ed-act" data-kxb="undo" aria-label="Deshacer">${kxIcon('undo', { size: 18 })}<span>Deshacer</span></button>
        </div>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.querySelector('#kxb-ed-tol').addEventListener('change', onTol);
    const stage = root.querySelector('#kxb-ed-stage');
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', onUp);
    stage.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', () => { if (!root.classList.contains('hidden')) fit(); });
    document.addEventListener('keydown', (e) => {
      if (root.classList.contains('hidden')) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(null); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel >= 0 && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); act('del'); }
    });
  }

  function count() {
    const n = holds.length;
    root.querySelector('#kxb-ed-count').textContent = n ? `${n} ${n === 1 ? 'presa' : 'presas'}` : 'Ninguna presa';
  }

  function paint() {
    // El zoom es una transformación CSS: el trazo se divide por la escala para verse siempre igual de fino
    root.querySelector('.kxb-ed-ov').innerHTML = kxbOverlaySVG(holds, W, H, { sel, sw: 2.5 / s, dim: true, uid: 'ed' });
    root.querySelector('#kxb-ed-canvas').style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    const selType = sel >= 0 && picked ? holds[sel].t : type;
    root.querySelectorAll('[data-kxb-type]').forEach(b => {
      const on = b.dataset.kxbType === selType;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    root.querySelector('#kxb-ed-sel').hidden = sel < 0;
    root.querySelector('[data-kxb="undo"]').disabled = !undo.length;
    count();
  }

  function fit() {
    const stage = root.querySelector('#kxb-ed-stage');
    const r = stage.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    bw = W * k; bh = H * k;
    const c = root.querySelector('#kxb-ed-canvas');
    c.style.width = `${bw}px`; c.style.height = `${bh}px`;
    s = 1; tx = (r.width - bw) / 2; ty = (r.height - bh) / 2;
    paint();
  }

  function clampPan() {
    const r = root.querySelector('#kxb-ed-stage').getBoundingClientRect();
    const cw = bw * s, ch = bh * s;
    tx = cw <= r.width ? (r.width - cw) / 2 : Math.min(0, Math.max(r.width - cw, tx));
    ty = ch <= r.height ? (r.height - ch) / 2 : Math.min(0, Math.max(r.height - ch, ty));
  }

  function zoomAt(f, cx, cy) {
    const ns = Math.min(8, Math.max(1, s * f));
    const px = (cx - tx) / s, py = (cy - ty) / s;
    s = ns; tx = cx - px * s; ty = cy - py * s;
    clampPan(); paint();
  }

  const local = (e) => { const r = root.querySelector('#kxb-ed-stage').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  function onDown(e) {
    if (e.target.closest('button')) return;
    e.preventDefault();
    root.querySelector('#kxb-ed-stage').setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      const p = local(e);
      gesture = { kind: drawMode ? 'draw' : 'tap', x0: p.x, y0: p.y, tx0: tx, ty0: ty, t0: Date.now() };
      if (drawMode) { stroke = [norm(p.x, p.y)]; liveStroke(); }
    } else if (pointers.size === 2) {
      stroke = null; liveStroke();   // dos dedos: se amplía, no se dibuja
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: s, px: ((a.x + b.x) / 2 - tx) / s, py: ((a.y + b.y) / 2 - ty) / s };
    }
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, local(e));
    if (gesture.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      s = Math.min(8, Math.max(1, gesture.s0 * d / gesture.d0));
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      tx = mx - gesture.px * s; ty = my - gesture.py * s;
      clampPan(); paint();
      return;
    }
    const p = local(e);
    if (gesture.kind === 'draw') {
      if (!stroke) return;
      const q = norm(p.x, p.y), last = stroke[stroke.length - 1];
      if (Math.hypot((q[0] - last[0]) * bw * s, (q[1] - last[1]) * bh * s) >= 2) { stroke.push(q); liveStroke(); }
      return;
    }
    if (gesture.kind === 'tap' && Math.hypot(p.x - gesture.x0, p.y - gesture.y0) > 8) gesture.kind = 'pan';
    if (gesture.kind === 'pan') {
      tx = gesture.tx0 + (p.x - gesture.x0); ty = gesture.ty0 + (p.y - gesture.y0);
      clampPan(); paint();
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (gesture && gesture.kind === 'draw' && pointers.size === 0) {
      const moved = Math.hypot(p.x - gesture.x0, p.y - gesture.y0);
      if (e.type === 'pointerup' && stroke && stroke.length >= 6 && moved >= 0) finishStroke();
      else if (e.type === 'pointerup' && (!stroke || stroke.length < 6)) tap(p.x, p.y);
      stroke = null; liveStroke();
    }
    if (gesture && gesture.kind === 'tap' && e.type === 'pointerup' && pointers.size === 0) tap(p.x, p.y);
    if (pointers.size === 0) gesture = null;
    else if (gesture && gesture.kind === 'pinch') gesture = { kind: 'done' };
  }

  function onWheel(e) {
    e.preventDefault();
    const p = local(e);
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y);
  }

  const norm = (x, y) => [(x - tx) / (bw * s), (y - ty) / (bh * s)];

  function liveStroke() {
    const svg = root.querySelector('.kxb-ed-live');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const pl = svg.querySelector('polyline');
    pl.setAttribute('points', stroke ? stroke.map(([x, y]) => `${(x * W).toFixed(1)},${(y * H).toFixed(1)}`).join(' ') : '');
    pl.setAttribute('stroke', kxbType(type).color);
    pl.setAttribute('stroke-width', String((2.5 / s) * (W / Math.max(1, bw))));
  }

  // Trazo a mano → presa: se cierra, se simplifica y se añade con el tipo elegido
  function finishStroke() {
    const pts = stroke.map(([x, y]) => [Math.min(1, Math.max(0, x)) * W, Math.min(1, Math.max(0, y)) * H]);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
    if (Math.max(x1 - x0, y1 - y0) < 0.008 * Math.max(W, H)) return;   // un garabato diminuto
    if (holds.length >= KXB_MAX_HOLDS) { toast(`Como máximo ${KXB_MAX_HOLDS} presas por bloque`, 'warning'); return; }
    const simple = kxbSimplify(pts, Math.max(1.5, 0.003 * Math.max(W, H)));
    if (simple.length < 3) return;
    const p = [];
    simple.forEach(([x, y]) => p.push(+(x / W).toFixed(4), +(y / H).toFixed(4)));
    snapshot();
    holds.push({ t: type, p, s: kxbCentroid(p).map(v => +v.toFixed(4)), auto: false });
    sel = holds.length - 1; picked = false;
    root.querySelector('#kxb-ed-hint').textContent = `Presa dibujada como ${kxbType(type).label}. Dibuja la siguiente o pulsa el lápiz para volver a tocar presas.`;
    paint();
  }

  function setDraw(on) {
    drawMode = on;
    const b = root.querySelector('[data-kxb="draw"]');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
    root.querySelector('#kxb-ed-stage').classList.toggle('is-drawing', on);
    root.querySelector('#kxb-ed-hint').textContent = on
      ? 'Rodea la presa con el dedo para dibujarla. Con dos dedos amplías. Pulsa el lápiz otra vez para salir.'
      : 'Toca una presa para marcarla o selecciónala para cambiarla.';
  }

  function snapshot() {
    undo.push(JSON.stringify(holds));
    if (undo.length > 40) undo.shift();
  }

  function analysis() {
    if (!src.lab) src.lab = kxbAnalyse(img);
    return src.lab;
  }

  function tap(x, y) {
    const nx = (x - tx) / (bw * s), ny = (y - ty) / (bh * s);
    if (nx < 0 || ny < 0 || nx > 1 || ny > 1) { sel = -1; paint(); return; }
    for (let i = holds.length - 1; i >= 0; i--) {
      if (kxbInside(holds[i].p, nx, ny)) {
        // Con un tipo elegido (Inicio, Top, Pie…), tocar una presa ya marcada le pone ese tipo
        // (queda seleccionada para Agrandar/Borrar, pero elegir otro tipo después no la cambia: prepara la siguiente)
        if (armed && holds[i].t !== type) { setType(i, type); sel = i; picked = false; paint(); return; }
        const again = sel === i && picked;
        sel = again ? -1 : i; picked = !again;
        if (!again) root.querySelector('#kxb-ed-hint').textContent = 'Presa seleccionada: cambia su tipo o su tamaño, o bórrala. Tócala otra vez para soltarla.';
        paint();
        return;
      }
    }
    if (drawMode) return;   // dibujando: tocar fuera de una presa no marca nada
    if (holds.length >= KXB_MAX_HOLDS) { toast(`Como máximo ${KXB_MAX_HOLDS} presas por bloque`, 'warning'); return; }
    // Sin presas todavía: se busca el bloque entero por el color de la presa tocada
    if (!holds.length && detectGroup(nx, ny)) return;
    let r;
    try {
      r = kxbSegment(analysis(), nx, ny, tol);
    } catch (err) {
      console.warn('[Bloques] No se pudo analizar la foto:', err);
      r = { ok: false, p: kxbCircle(nx, ny, W, H) };
    }
    snapshot();
    holds.push({ t: type, p: r.p, s: [+nx.toFixed(4), +ny.toFixed(4)], rgb: r.rgb, auto: r.ok });
    sel = holds.length - 1; picked = false;
    root.querySelector('#kxb-ed-hint').textContent = r.ok
      ? 'Presa marcada. Si el contorno no encaja, cambia «Contorno» o usa Agrandar, Reducir o Círculo.'
      : 'No se distinguía la presa del muro: se ha marcado un círculo. Ajústalo con Agrandar o Reducir.';
    paint();
  }

  // Bloque entero desde un toque. Devuelve false si no hay al menos dos presas de ese color (se marca solo la tocada).
  function detectGroup(nx, ny, { replace = false } = {}) {
    let r;
    try { r = kxbSegmentAll(analysis(), nx, ny, tol); } catch (err) { console.warn('[Bloques] Detección del bloque:', err); return false; }
    const hint = root.querySelector('#kxb-ed-hint');
    if (!r.ok) {
      if (replace) { hint.textContent = 'Con este ajuste no se distinguen otras presas de ese color. Prueba a moverlo hacia «Amplio».'; return true; }
      if (r.neutral) hint.textContent = 'Las presas grises, blancas o negras no se distinguen bien del muro: márcalas una a una.';
      group = null;
      return false;
    }
    snapshot();
    const manual = replace ? holds.filter(h => !h.g) : [];
    holds = manual.concat(r.holds.slice(0, KXB_MAX_HOLDS - manual.length).map(h => ({ t: h.t, p: h.p, s: h.s, rgb: h.rgb, auto: true, g: 1, ...(h.t === 'top' ? { autoTop: true } : {}) })));
    group = { nx, ny };
    sel = -1; picked = false;
    const n = r.holds.length;
    hint.textContent = `${n} presas del mismo color; la más alta es el Top. Elige «Inicio» o «Top» y toca las presas para marcarlas. Toca las que falten para añadirlas.`;
    paint();
    return true;
  }

  const typeLabel = (k) => kxbType(k).label;
  function setType(i, k) {
    snapshot();
    // Un Top marcado a mano sustituye al que puso la detección (la presa más alta)
    if (k === 'top') holds.forEach((o, j) => { if (j !== i && o.autoTop) { o.t = 'hand'; delete o.autoTop; } });
    holds[i].t = k;
    delete holds[i].autoTop;
    root.querySelector('#kxb-ed-hint').textContent = `Presa marcada como ${typeLabel(k)}. Toca otras para marcarlas igual, o elige otro tipo.`;
  }

  function onTol(e) {
    tol = Number(e.target.value) || KXB_TOL_DEFAULT;
    // Sin presa seleccionada: se recalcula el bloque entero con el nuevo ajuste (las añadidas a mano se quedan)
    if (sel < 0 || !picked) { if (group) { sel = -1; detectGroup(group.nx, group.ny, { replace: true }); } return; }
    const h = holds[sel];
    if (!h.s) return;
    const r = kxbSegment(analysis(), h.s[0], h.s[1], tol);
    snapshot();
    h.p = r.p; h.auto = r.ok; if (r.rgb) h.rgb = r.rgb;
    paint();
  }

  function act(a) {
    if (a === 'undo') { if (undo.length) { holds = JSON.parse(undo.pop()); sel = -1; picked = false; if (!holds.some(h => h.g)) group = null; paint(); } return; }
    if (a === 'draw') { setDraw(!drawMode); return; }
    if (a === 'zin' || a === 'zout') {
      const r = root.querySelector('#kxb-ed-stage').getBoundingClientRect();
      zoomAt(a === 'zin' ? 1.5 : 1 / 1.5, r.width / 2, r.height / 2);
      return;
    }
    if (sel < 0) return;
    const h = holds[sel];
    snapshot();
    if (a === 'del') { holds.splice(sel, 1); sel = -1; picked = false; }
    else if (a === 'bigger') h.p = kxbScale(h.p, 1.15);
    else if (a === 'smaller') h.p = kxbScale(h.p, 0.87);
    else if (a === 'circle') {
      const c = h.s || kxbCentroid(h.p);
      // Mismo tamaño aproximado que el contorno anterior
      let r = 0;
      for (let i = 0; i < h.p.length; i += 2) r = Math.max(r, Math.hypot((h.p[i] - c[0]) * W, (h.p[i + 1] - c[1]) * H));
      h.p = kxbCircle(c[0], c[1], W, H, Math.max(8, r * 0.85));
      h.auto = false;
    }
    paint();
  }

  function onClick(e) {
    const t = e.target.closest('[data-kxb-type]');
    if (t) {
      const k = t.dataset.kxbType;
      if (sel >= 0 && picked) { if (holds[sel].t !== k) setType(sel, k); }
      else {
        sel = -1;
        armed = true;
        if (holds.length && k !== 'hand') root.querySelector('#kxb-ed-hint').textContent = `Toca las presas que quieras marcar como ${typeLabel(k)}.`;
      }
      type = k;
      paint();
      return;
    }
    const b = e.target.closest('[data-kxb]');
    if (!b) return;
    const a = b.dataset.kxb;
    if (a === 'cancel') return finish(null);
    if (a === 'done') {
      if (!holds.length) { toast('Toca al menos una presa del bloque', 'info'); return; }
      return finish(holds);
    }
    act(a);
  }

  function finish(result) {
    root.classList.add('hidden');
    document.body.classList.remove('kxb-ed-open');
    const out = result ? { holds: kxbCleanHolds(result), color: kxbSuggestColor(result.filter(h => h.auto && h.t !== 'foot' && h.rgb).map(h => h.rgb)) } : null;
    const fn = resolveFn;
    resolveFn = null;
    if (url) { URL.revokeObjectURL(url); url = ''; }
    if (src && src.bmp && src.bmp.close) src.bmp.close();
    src = null; img = null; blob = null; holds = []; undo = [];
    if (fn) fn(out);
  }

  // blob: foto ya preparada (JPEG). holds: presas guardadas (para editar). Devuelve { holds, color } o null si se cancela.
  async function open({ blob: b, holds: initial = [], title = '' }) {
    ensure();
    root.querySelector('#kxb-ed-title').textContent = title || 'Marca las presas';
    if (resolveFn) finish(null);
    blob = b;
    const bmp = await kxbDecode(b);
    W = bmp.width || bmp.naturalWidth; H = bmp.height || bmp.naturalHeight;
    img = bmp;
    src = { bmp, lab: null };
    url = URL.createObjectURL(b);
    const im = root.querySelector('#kxb-ed-canvas img');
    im.src = url;
    holds = (initial || []).map(h => ({ ...h, p: h.p.slice(), auto: false }));
    sel = -1; picked = false; undo = []; type = 'hand'; tol = KXB_TOL_DEFAULT; group = null; armed = false; stroke = null;
    root.querySelector('#kxb-ed-tol').value = String(tol);
    setDraw(false);
    root.querySelector('#kxb-ed-hint').textContent = holds.length
      ? 'Toca una presa para cambiarla o toca otra nueva para añadirla.'
      : 'Toca una presa del bloque: se marcarán todas las de su color. Pellizca para ampliar.';
    root.classList.remove('hidden');
    document.body.classList.add('kxb-ed-open');
    fit();
    // El análisis de la foto se prepara en cuanto se ve el editor (así el primer toque es inmediato)
    setTimeout(() => { try { if (src) analysis(); } catch (_) {} }, 60);
    root.querySelector('[data-kxb="done"]').focus({ preventScroll: true });
    return new Promise(res => { resolveFn = res; });
  }

  return { open, isOpen: () => !!root && !root.classList.contains('hidden'), close: () => finish(null) };
})();

// ============================================
// DATOS: Firestore + Storage
// ============================================
const KruxGymBlocksData = {
  col(uid) { return db.collection('users').doc(uid).collection('gym_blocks'); },

  async list(uid, { gymId = null, limit = 60 } = {}) {
    const col = this.col(uid);
    const snap = gymId ? await col.where('gymId', '==', gymId).limit(limit).get() : await col.orderBy('createdAt', 'desc').limit(limit).get();
    const out = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const ms = (b) => (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0);
    return out.sort((a, b) => ms(b) - ms(a) || String(b.date || '').localeCompare(String(a.date || '')));
  },

  async uploadPhoto(uid, blockId, blob, thumb) {
    const put = async (path, b) => {
      const ref = storage.ref(path);
      await ref.put(b, { contentType: 'image/jpeg', cacheControl: 'private,max-age=31536000' });
      return ref.getDownloadURL();
    };
    const path = `gym-blocks/${uid}/${blockId}.jpg`;
    const [url, thumbUrl] = await Promise.all([put(path, blob), thumb ? put(`gym-blocks/${uid}/${blockId}_t.jpg`, thumb) : '']);
    return { path, url, thumbUrl: thumbUrl || url };
  },

  async save(uid, blockId, data, { create = false } = {}) {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    const doc = { ...data, userId: uid, updatedAt: ts, ...(create ? { createdAt: ts } : {}) };
    await this.col(uid).doc(blockId).set(doc, { merge: !create });
  },

  async remove(uid, block) {
    const del = async (path) => { try { await storage.ref(path).delete(); } catch (e) { if (e.code !== 'storage/object-not-found') throw e; } };
    if (block.photoPath) await Promise.all([del(block.photoPath), del(block.photoPath.replace(/\.jpg$/, '_t.jpg'))]);
    await this.col(uid).doc(block.id).delete();
  }
};

// Ascensión del feed a partir de un bloque guardado (mismo formato que ascentToPostData)
function kxbPostAscent(block) {
  const a = {
    ascentId: block.ascentId, routeId: block.ascentRouteId || block.name || block.ascentId, routeName: block.name || 'Vía sin nombre',
    grade: block.grade, style: block.style, schoolId: block.gymId, schoolName: block.gymName,
    date: block.date ? new Date(`${block.date}T12:00:00`).toISOString() : null
  };
  Object.keys(a).forEach(k => { if (a[k] === undefined || a[k] === null || a[k] === '') delete a[k]; });
  return a;
}

// Publicar bloques: se abre el compositor del feed con las fotos ya marcadas, la ubicación y las ascensiones, para
// escribir, quitar o añadir fotos antes de publicar. blobs: fotos ya en el móvil (si no, se descargan).
async function kxbShare(blocks, blobs = []) {
  if (typeof kxOpenComposerWith !== 'function') throw new Error('compositor');
  const files = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const src = blobs[i] || await (await fetch(b.photoUrl)).blob();
    const bmp = await kxbDecode(src);
    // Con dibujo y sin él: en el feed se alterna con el ojo
    try { files.push({ file: new File([await kxbBakeImage(bmp, b.holds || [])], `bloque_${i + 1}.jpg`, { type: 'image/jpeg' }), plain: new File([src], `bloque_${i + 1}_limpia.jpg`, { type: 'image/jpeg' }) }); }
    finally { if (bmp.close) bmp.close(); }
  }
  const ascents = blocks.map(kxbPostAscent).filter(a => a.ascentId && a.routeName);
  const gym = blocks[0] && blocks[0].gymName;
  const uid = (firebase.auth().currentUser || {}).uid;
  return kxOpenComposerWith({
    files, ascents,
    location: gym ? { name: gym, ...(blocks[0].gymId ? { schoolId: blocks[0].gymId } : {}) } : null,
    onPublished: (postId) => {
      blocks.forEach(b => { b.postId = postId; KruxGymBlocksData.save(uid, b.id, { postId }).catch(e => console.warn('[Bloques] No se pudo anotar la publicación:', e)); });
      if (window.KruxGymBlocks) setTimeout(() => KruxGymBlocks.renderActivity(), 600);
    }
  });
}

// ============================================
// INTERFAZ
// ============================================
const KruxGymBlocks = (() => {
  // Bloques del formulario de registro. Se pueden registrar varios de una vez: el primero va con el ascenso del
  // formulario (su grado es el del formulario) y cada uno de los demás crea su propio ascenso con su grado, con la
  // misma fecha, rocódromo, estilo y compañeros. Ids fijados al subir: un reintento no duplica nada.
  let form = { items: [], share: false };
  let seq = 0;
  const me = () => (firebase.auth().currentUser || {}).uid || null;
  const toast = (m, t = 'info', o) => { if (typeof showToast === 'function') showToast(m, t, o); };
  const esc = (v) => kxEsc(v);
  const typeLabel = (t) => (t === 'boulder' ? 'Boulder' : 'Vía indoor');
  const STYLE_LABEL = { redpoint: 'Redpoint', onsight: 'A vista', flash: 'Flash', toprope: 'Top rope', project: 'Intento' };
  const mainGrade = () => document.getElementById('gm-grade-select');
  const gtype = () => (document.getElementById('ascent-climb-type')?.value === 'boulder' ? 'boulder' : 'via');

  function freeItems() { form.items.forEach(it => it.url && URL.revokeObjectURL(it.url)); }

  function resetForm() {
    freeItems();
    form = { items: [], share: false };
    ['gm-block-file', 'gm-block-cam'].forEach(id => { const i = document.getElementById(id); if (i) i.value = ''; });
    renderSlot();
  }

  function slotEl() { return document.getElementById('gm-block-slot'); }

  const pickHTML = (more) => `<div class="kxb-pick${more ? ' kxb-pick--more' : ''}">
      <button type="button" class="kxb-add" data-kxb-form="cam">
        <span class="kxb-add-ic">${kxIcon('camera', { size: more ? 18 : 22 })}</span>
        <span class="kxb-add-txt"><strong>${more ? 'Cámara' : 'Hacer foto'}</strong></span>
      </button>
      <button type="button" class="kxb-add" data-kxb-form="pick">
        <span class="kxb-add-ic">${kxIcon('images', { size: more ? 18 : 22 })}</span>
        <span class="kxb-add-txt"><strong>${more ? 'Galería' : 'Subir de la galería'}</strong></span>
      </button>
      ${more ? '' : '<p class="kxb-pick-note">Marca las presas y se guarda con tu ascenso. Puedes elegir varias fotos a la vez: un bloque por foto. Solo lo ves tú.</p>'}
    </div>`;

  function itemHTML(it, i, many) {
    const n = it.holds.length;
    const opts = mainGrade() ? mainGrade().innerHTML : '';
    return `<div class="kxb-item" data-kxb-item="${it.key}">
        <div class="kxb-prev">
          <button type="button" class="kxb-prev-img" data-kxb-form="edit" aria-label="Editar las presas del bloque ${i + 1}">
            <img src="${esc(it.url)}" alt="">${kxbOverlaySVG(it.holds, it.w, it.h, { sw: 1.6, uid: `form${it.key}`, fit: 'slice' })}
          </button>
          <div class="kxb-prev-side">
            <strong>${many ? `Bloque ${i + 1} · ` : ''}${n} ${n === 1 ? 'presa' : 'presas'}</strong>
            ${many ? `<label class="kxb-grade-pick"><span>Grado</span><select data-kxb-grade aria-label="Grado del bloque ${i + 1}">${opts}</select></label>` : ''}
            <button type="button" class="kxb-mini" data-kxb-form="edit">${kxIcon('pen', { size: 16 })}Editar presas</button>
            <button type="button" class="kxb-mini kxb-mini--danger" data-kxb-form="clear">${kxIcon('trash', { size: 16 })}Quitar</button>
          </div>
        </div>
        <div class="kxb-colors" role="radiogroup" aria-label="Color de las presas del bloque ${i + 1}">
          <span class="kxb-colors-lbl">Color de las presas</span>
          <div class="kxb-colors-row">${KXB_COLORS.map(c => `<button type="button" class="kxb-sw${it.color === c.key ? ' is-on' : ''}" role="radio" aria-checked="${it.color === c.key}" data-kxb-color="${c.key}" style="--c:${c.hex}" title="${c.label}" aria-label="${c.label}"></button>`).join('')}</div>
        </div>
      </div>`;
  }

  function renderSlot() {
    const slot = slotEl();
    if (!slot) return;
    const items = form.items;
    if (!items.length) { slot.innerHTML = pickHTML(false); return; }
    const many = items.length > 1;
    slot.innerHTML = `<div class="kxb-items">${items.map((it, i) => itemHTML(it, i, many)).join('')}</div>
      ${items.length < KXB_MAX_FORM ? `<p class="kxb-more-lbl">Añadir otro bloque</p>${pickHTML(true)}` : ''}
      ${many ? `<p class="kxb-pick-note">Se guardará un ascenso por bloque, con la fecha, el estilo y los compañeros del formulario.</p>` : ''}
      <label class="kxb-share">
        <input type="checkbox" id="gm-block-share"${form.share ? ' checked' : ''}>
        <span><strong>Publicar en el feed</strong><small>Al guardar se abre la publicación con ${many ? 'las fotos' : 'la foto'} y las presas marcadas para que añadas texto. Si no, solo lo ves tú.</small></span>
      </label>`;
    // Grado de cada bloque (el primero, el del formulario)
    slot.querySelectorAll('[data-kxb-grade]').forEach(sel => {
      const it = itemOf(sel);
      sel.value = it === form.items[0] ? (mainGrade() ? mainGrade().value : '') : it.grade;
    });
  }

  const itemOf = (el) => { const k = el.closest('[data-kxb-item]'); return k ? form.items.find(it => String(it.key) === k.dataset.kxbItem) : null; };

  // Una o varias fotos: cada una pasa por el editor; cancelar una la salta y sigue con la siguiente
  async function pickFiles(files) {
    const list = [...(files || [])].filter(f => /^image\//i.test(f.type || '') || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name || ''));
    if (!list.length) { if (files && files.length) toast('Elige una foto', 'warning'); return; }
    const room = KXB_MAX_FORM - form.items.length;
    if (list.length > room) toast(`Como máximo ${KXB_MAX_FORM} bloques por registro`, 'warning');
    const todo = list.slice(0, Math.max(0, room));
    for (let i = 0; i < todo.length; i++) {
      let prepared;
      try {
        prepared = await kxbPreparePhoto(todo[i]);
      } catch (e) {
        console.warn('[Bloques] No se pudo abrir la foto:', e);
        toast('No se pudo abrir una de las fotos', 'error');
        continue;
      }
      const res = await KruxBlockEditor.open({ blob: prepared.blob, holds: [], title: todo.length > 1 ? `Bloque ${i + 1} de ${todo.length}` : '' });
      if (!res) continue;
      form.items.push({
        key: ++seq, blob: prepared.blob, thumb: prepared.thumb, w: prepared.w, h: prepared.h, url: URL.createObjectURL(prepared.blob),
        holds: res.holds, color: res.color || null, grade: mainGrade() ? mainGrade().value : ''
      });
      renderSlot();
    }
  }

  async function editItem(it) {
    const res = await KruxBlockEditor.open({ blob: it.blob, holds: it.holds });
    if (!res) return;
    it.holds = res.holds;
    it.uploaded = null; it.savedHolds = null;
    if (!it.color && res.color) it.color = res.color;
    renderSlot();
  }

  function bindForm() {
    const group = document.getElementById('gm-block-group');
    if (!group || group._kxbWired) return;
    group._kxbWired = true;
    const input = document.getElementById('gm-block-file');
    const cam = document.getElementById('gm-block-cam');
    if (input) input.multiple = true;
    [input, cam].forEach(el => el && el.addEventListener('change', () => { const f = [...(el.files || [])]; el.value = ''; pickFiles(f); }));
    group.addEventListener('click', (e) => {
      const c = e.target.closest('[data-kxb-color]');
      if (c) { const it = itemOf(c); if (it) { it.color = it.color === c.dataset.kxbColor ? null : c.dataset.kxbColor; renderSlot(); } return; }
      const b = e.target.closest('[data-kxb-form]');
      if (!b) return;
      const a = b.dataset.kxbForm;
      if (a === 'pick' || a === 'cam') { if (!me()) { toast('Inicia sesión para guardar bloques', 'info'); return; } (a === 'cam' && cam ? cam : input).click(); return; }
      const it = itemOf(b);
      if (!it) return;
      if (a === 'edit') editItem(it);
      else if (a === 'clear') { if (it.url) URL.revokeObjectURL(it.url); form.items = form.items.filter(x => x !== it); renderSlot(); }
    });
    group.addEventListener('change', (e) => {
      if (e.target.id === 'gm-block-share') { form.share = e.target.checked; return; }
      if (e.target.matches('[data-kxb-grade]')) {
        const it = itemOf(e.target);
        if (!it) return;
        // El primer bloque usa el grado del formulario: los dos selectores van a la par
        if (form.items[0] === it && mainGrade()) mainGrade().value = e.target.value;
        else it.grade = e.target.value;
      }
    });
    // Vía indoor / Boulder cambia la escala de grados de todos los bloques
    document.getElementById('gm-type-seg')?.addEventListener('click', () => setTimeout(() => {
      const opts = mainGrade() ? [...mainGrade().options].map(o => o.value) : [];
      form.items.forEach((it, i) => { if (i && !opts.includes(it.grade)) it.grade = mainGrade().value; });
      renderSlot();
    }, 0));
    mainGrade()?.addEventListener('change', () => { if (form.items.length > 1) renderSlot(); });
  }

  // Al abrir «Nueva sesión rocódromo»
  function attach({ pickPhoto = false } = {}) {
    bindForm();
    resetForm();
    document.getElementById('gm-block-group')?.classList.remove('hidden');
    // Desde «Registrar bloque»: se lleva la vista a la foto para elegir cámara o galería
    if (pickPhoto) setTimeout(() => document.getElementById('gm-block-group')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 120);
  }

  function detach() {
    freeItems();
    form = { items: [], share: false };
    document.getElementById('gm-block-group')?.classList.add('hidden');
    renderSlot();
  }

  const hasPending = () => form.items.some(it => it.holds && it.holds.length);

  // Nombre del ascenso de los bloques 2 y siguientes: «Boulder amarillo» (o «Boulder 2» sin color)
  const extraName = (it, i, type) => `${type === 'boulder' ? 'Boulder' : 'Vía'} ${it.color ? kxbColor(it.color).label.toLowerCase() : i + 1}`;

  // Antes de guardar el ascenso: sube las fotos y crea los bloques (el primero con el id del ascenso del formulario)
  async function beforeAscentSave(ascentData) {
    if (!hasPending()) return null;
    const uid = me();
    if (!uid) throw Object.assign(new Error('auth'), { code: 'auth' });
    if (typeof kxIsOffline === 'function' && kxIsOffline()) throw Object.assign(new Error('offline'), { code: 'kxb/offline' });
    const type = ascentData.climbType === 'boulder' ? 'boulder' : 'via';
    // Sin nombre de vía: el ascenso se llama por su tipo y color («Boulder amarillo») en vez de «Vía sin nombre»
    if (ascentData.routeName === 'Vía sin nombre' && form.items[0]) ascentData.routeName = extraName(form.items[0], 0, type);
    form.base = { ...ascentData };
    for (let i = 0; i < form.items.length; i++) {
      const it = form.items[i];
      if (!it.blockId) it.blockId = KruxGymBlocksData.col(uid).doc().id;
      if (i === 0) { if (!it.ascentId) it.ascentId = ascentData.id || db.collection('ascents').doc().id; ascentData.id = it.ascentId; }
      else if (!it.ascentId) it.ascentId = db.collection('ascents').doc().id;
      if (!it.routeId) it.routeId = i === 0 ? String(ascentData.routeId || '') : `gym_${Date.now()}_${i}`;
      const name = i === 0 ? ascentData.routeName || '' : extraName(it, i, type);
      if (!it.uploaded) it.uploaded = await KruxGymBlocksData.uploadPhoto(uid, it.blockId, it.blob, it.thumb);
      const data = {
        gymId: String(ascentData.schoolId || '').slice(0, 200),
        gymName: String(ascentData.schoolName || '').slice(0, 200),
        ascentId: it.ascentId,
        ascentRouteId: it.routeId.slice(0, 300),
        type,
        grade: String(i === 0 ? ascentData.grade || '' : it.grade || ascentData.grade || '').slice(0, 12),
        name: String(name).slice(0, 120),
        color: it.color || '',
        date: String(ascentData.date || '').slice(0, 10),
        style: String(ascentData.style || '').slice(0, 20),
        photoPath: it.uploaded.path,
        photoUrl: it.uploaded.url,
        thumbUrl: it.uploaded.thumbUrl,
        w: it.w, h: it.h,
        holds: kxbCleanHolds(it.holds)
      };
      await KruxGymBlocksData.save(uid, it.blockId, data, { create: true });
      it.saved = { id: it.blockId, userId: uid, ...data };
    }
    return form.items[0].blockId;
  }

  // Después de guardar el ascenso del formulario: ascensos de los demás bloques, limpieza y, si se pidió, el
  // compositor del feed con todas las fotos. Devuelve cuántos bloques se guardaron.
  async function afterAscentSave() {
    const items = form.items.filter(it => it.saved);
    if (!items.length) return 0;
    const base = form.base || {};
    let failed = 0;
    for (let i = 1; i < items.length; i++) {
      const it = items[i], b = it.saved;
      if (it.ascentLogged) continue;
      const ok = typeof logAscent === 'function' && await logAscent({ ...base, id: it.ascentId, grade: b.grade, routeId: b.ascentRouteId, routeName: b.name });
      if (ok) it.ascentLogged = true; else failed++;
    }
    if (failed) toast(`${failed === 1 ? 'Un ascenso' : `${failed} ascensos`} de los bloques no se pudo guardar`, 'warning', { detail: 'Los bloques sí están guardados en «Mis bloques».' });
    const blocks = items.map(it => it.saved), blobs = items.map(it => it.blob), share = form.share;
    detach();
    refreshAll();
    if (share) {
      kxbShare(blocks, blobs).catch((e) => {
        console.error('[Bloques] No se pudo preparar la publicación:', e);
        toast('Los bloques se han guardado, pero no se pudo preparar la publicación', 'warning', { detail: 'Puedes publicarlos desde «Mis bloques».' });
      });
    }
    return items.length;
  }

  // ---------- Lista: «Mis bloques» (Actividad › Rocódromo) y tarjeta de la ficha del rocódromo ----------
  function thumbHTML(b) {
    const gc = typeof kxGradeColor === 'function' ? kxGradeColor(b.grade) : '#9CA3AF';
    const col = kxbColor(b.color);
    return `<button type="button" class="kxb-thumb" data-kxb-open="${esc(b.id)}" aria-label="${esc(`${typeLabel(b.type)} ${b.grade || ''} en ${b.gymName || 'rocódromo'}`)}">
        <span class="kxb-thumb-img"><img src="${esc(b.thumbUrl || b.photoUrl)}" alt="" loading="lazy">${kxbOverlaySVG(b.holds, b.w || 1000, b.h || 1000, { sw: 1.3, uid: `t${esc(b.id)}`, fit: 'slice' })}</span>
        <span class="kxb-thumb-meta">
          <span class="kxb-grade" style="--g:${gc}">${esc(b.grade || '¿?')}</span>
          ${col ? `<span class="kxb-sw kxb-sw--sm" style="--c:${col.hex}" aria-hidden="true"></span>` : ''}
          ${b.postId ? `<span class="kxb-thumb-pub" title="Publicado en el feed">${kxIcon('share', { size: 13 })}</span>` : ''}
        </span>
      </button>`;
  }

  let cache = [];

  async function renderActivity() {
    const el = document.getElementById('gym-blocks-wrap');
    if (!el) return;
    const uid = me();
    if (!uid) { el.innerHTML = ''; return; }
    el.innerHTML = `<article class="ax-panel kxb-panel"><header class="ax-panel-head"><h2 class="ax-h2">Mis bloques</h2></header>${kxSkeletonHTML('lines')}</article>`;
    try {
      cache = await KruxGymBlocksData.list(uid);
    } catch (e) {
      console.warn('[Bloques] No se pudieron cargar:', e);
      cache = [];
    }
    el.innerHTML = `<article class="ax-panel kxb-panel">
        <header class="ax-panel-head kxb-panel-head"><h2 class="ax-h2">Mis bloques${cache.length ? ` <span class="kxb-count">${cache.length}</span>` : ''}</h2>
          <button type="button" class="kxb-mini kxb-mini--primary" data-kxb-new="1">${kxIcon('camera', { size: 16 })}Registrar bloque</button></header>
        ${cache.length
          ? `<div class="kxb-grid">${cache.map(thumbHTML).join('')}</div>`
          : '<p class="ax-empty kxb-empty">Haz una foto del bloque al registrarlo y marca sus presas: aquí tendrás todos tus bloques, solo para ti.</p>'}
      </article>`;
  }

  // Tarjeta en la ficha del rocódromo (gym-info.js): sitio y datos se rellenan después
  function gymCardHTML(gym) {
    return `<section class="kxg-card kxb-gymcard" data-kxb-gym="${esc(gym.id)}">
        <div class="kxg-card-head"><span class="kxg-card-ic">${kxIcon('camera', { size: 18 })}</span><h3 class="kxg-card-title">Tus bloques aquí</h3>
          <button type="button" class="kxb-mini kxb-mini--primary" data-kxb-new="1" data-kxb-gym-id="${esc(gym.id)}" data-kxb-gym-name="${esc(gym.nombre || '')}">${kxIcon('plus', { size: 16 })}Registrar bloque</button></div>
        <div class="kxb-gymcard-body"><p class="kxg-none">Haz una foto del bloque, marca sus presas y guárdalo con tu ascenso. Solo lo ves tú.</p></div>
      </section>`;
  }

  // La ficha se vuelve a pintar a menudo (fotos, instalaciones): la lista de cada rocódromo se reutiliza un minuto
  const byGym = new Map();
  async function hydrateGymCard(scope, gym) {
    const card = scope.querySelector(`[data-kxb-gym="${CSS.escape(String(gym.id))}"]`);
    const uid = me();
    if (!card || !uid) return;
    try {
      const key = `${uid}|${gym.id}`;
      const hit = byGym.get(key);
      if (!hit || Date.now() - hit.at > 60000) byGym.set(key, { at: Date.now(), list: KruxGymBlocksData.list(uid, { gymId: String(gym.id), limit: 30 }) });
      const list = await byGym.get(key).list;
      list.forEach(b => { if (!cache.some(c => c.id === b.id)) cache.push(b); });
      if (!list.length) return;
      card.querySelector('.kxb-gymcard-body').innerHTML = `<div class="kxb-strip">${list.map(thumbHTML).join('')}</div>`;
    } catch (e) {
      byGym.clear();
      console.warn('[Bloques] Ficha del rocódromo:', e);
    }
  }

  function refreshAll() {
    byGym.clear();
    renderActivity();
    if (window.KruxGymSheet && document.querySelector('[data-kxb-gym]')) {
      document.querySelectorAll('[data-kxb-gym]').forEach(card => {
        hydrateGymCard(card.parentElement, { id: card.dataset.kxbGym });
      });
    }
  }

  // ---------- Visor de un bloque ----------
  let viewer = null, current = null, showMarks = true;

  function ensureViewer() {
    if (viewer) return;
    viewer = document.createElement('div');
    viewer.className = 'kxb-view hidden';
    viewer.setAttribute('role', 'dialog');
    viewer.setAttribute('aria-modal', 'true');
    viewer.setAttribute('aria-labelledby', 'kxb-view-title');
    document.body.appendChild(viewer);
    viewer.addEventListener('click', onViewerClick);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && viewer && !viewer.classList.contains('hidden') && !KruxBlockEditor.isOpen()) closeViewer(); });
  }

  function renderViewer() {
    const b = current;
    const gc = typeof kxGradeColor === 'function' ? kxGradeColor(b.grade) : '#9CA3AF';
    const col = kxbColor(b.color);
    const date = b.date ? new Date(`${b.date}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const counts = KXB_TYPES.map(t => [t, (b.holds || []).filter(h => h.t === t.key).length]).filter(([, n]) => n);
    viewer.innerHTML = `
      <header class="kxb-view-head">
        <button type="button" class="kxb-ed-link kxb-view-back" data-kxv="close" aria-label="Cerrar">${kxIcon('x', { size: 22 })}</button>
        <div class="kxb-ed-title"><strong id="kxb-view-title">${esc(b.name || typeLabel(b.type))}</strong><span>${esc(b.gymName || 'Rocódromo')}</span></div>
        <button type="button" class="kxb-ed-link" data-kxv="marks" aria-pressed="${showMarks}" aria-label="${showMarks ? 'Ver la foto sin marcas' : 'Ver las presas marcadas'}">${kxIcon('eye', { size: 22 })}</button>
      </header>
      <div class="kxb-view-stage">
        <div class="kxb-view-photo" role="img" aria-label="Foto del bloque${b.name ? ' ' + esc(b.name) : ''}${showMarks ? ` con ${(b.holds || []).length} presas marcadas` : ''}">${kxbOverlaySVG(showMarks ? b.holds : [], b.w || 1000, b.h || 1000, { sw: 2.4, uid: 'view', href: b.photoUrl })}</div>
      </div>
      <div class="kxb-view-info">
        <div class="kxb-view-tags">
          <span class="kxb-grade kxb-grade--lg" style="--g:${gc}">${esc(b.grade || '¿?')}</span>
          <span class="kxb-tag">${esc(typeLabel(b.type))}</span>
          ${col ? `<span class="kxb-tag"><span class="kxb-sw kxb-sw--sm" style="--c:${col.hex}" aria-hidden="true"></span>${esc(col.label)}</span>` : ''}
          ${b.style ? `<span class="kxb-tag">${esc(STYLE_LABEL[b.style] || b.style)}</span>` : ''}
          ${date ? `<span class="kxb-tag kxb-tag--soft">${esc(date)}</span>` : ''}
        </div>
        ${counts.length ? `<ul class="kxb-legend">${counts.map(([t, n]) => `<li style="--c:${t.color}"><span class="kxb-dot" aria-hidden="true"></span>${t.label} <b>${n}</b></li>`).join('')}</ul>` : ''}
        <div class="kxb-view-actions">
          <button type="button" class="kxb-btn kxb-btn--ghost" data-kxv="edit" aria-label="Editar las presas">${kxIcon('pen', { size: 18 })}Editar</button>
          ${b.postId
            ? `<span class="kxb-btn kxb-btn--done">${kxIcon('check', { size: 18 })}Publicado</span>`
            : `<button type="button" class="kxb-btn kxb-btn--primary" data-kxv="share" aria-label="Publicar en el feed">${kxIcon('share', { size: 18 })}Publicar</button>`}
          <button type="button" class="kxb-btn kxb-btn--danger" data-kxv="delete" aria-label="Borrar bloque">${kxIcon('trash', { size: 18 })}</button>
        </div>
        <p class="kxb-view-note">${b.postId ? 'La publicación del feed es independiente: borrarla no borra el bloque, ni al revés.' : 'Solo tú ves este bloque.'}</p>
      </div>`;
  }

  function openViewer(id) {
    const b = cache.find(x => x.id === id);
    if (!b) return;
    ensureViewer();
    current = b; showMarks = true;
    renderViewer();
    viewer.classList.remove('hidden');
    document.body.classList.add('kxb-view-open');
    viewer.querySelector('[data-kxv="close"]').focus({ preventScroll: true });
  }

  function closeViewer() {
    if (!viewer) return;
    viewer.classList.add('hidden');
    document.body.classList.remove('kxb-view-open');
    current = null;
  }

  async function confirmAbove(msg, title, ok) {
    const m = document.getElementById('confirm-modal');
    m?.classList.add('kx-above');
    try { return await showConfirm(msg, title, ok); } finally { m?.classList.remove('kx-above'); }
  }

  let busy = false;
  async function onViewerClick(e) {
    const b = e.target.closest('[data-kxv]');
    if (!b || !current || busy) return;
    const a = b.dataset.kxv;
    const uid = me();
    if (a === 'close') return closeViewer();
    if (a === 'marks') { showMarks = !showMarks; renderViewer(); return; }
    if (!uid) return;
    if (a === 'edit') {
      busy = true;
      try {
        const blob = await (await fetch(current.photoUrl)).blob();
        busy = false;
        const res = await KruxBlockEditor.open({ blob, holds: current.holds || [] });
        if (!res) return;
        busy = true;
        await KruxGymBlocksData.save(uid, current.id, { holds: res.holds });
        current.holds = res.holds;
        renderViewer();
        toast('Presas actualizadas', 'success');
        renderActivity();
      } catch (err) {
        console.error('[Bloques] Editar:', err);
        toast('No se pudieron guardar las presas', 'error');
      } finally { busy = false; }
      return;
    }
    if (a === 'share') {
      // Se abre el compositor del feed con la foto marcada: ahí se escribe y se publica (o se cierra sin publicar)
      busy = true;
      b.disabled = true;
      b.innerHTML = 'Preparando…';
      const block = current;
      try {
        await kxbShare([block]);
        closeViewer();
      } catch (err) {
        console.error('[Bloques] Publicar:', err);
        toast('No se pudo preparar la publicación', 'error');
        if (current) renderViewer();
      } finally { busy = false; }
      return;
    }
    if (a === 'delete') {
      if (!await confirmAbove('Se borrará el bloque con su foto y sus presas. El ascenso registrado se conserva.', 'Borrar bloque', 'Borrar')) return;
      busy = true;
      try {
        await KruxGymBlocksData.remove(uid, current);
        cache = cache.filter(x => x.id !== current.id);
        closeViewer();
        toast('Bloque borrado', 'success');
        refreshAll();
      } catch (err) {
        console.error('[Bloques] Borrar:', err);
        toast('No se pudo borrar el bloque', 'error');
      } finally { busy = false; }
    }
  }

  // Clics globales: abrir un bloque o registrar uno nuevo (desde Actividad o desde la ficha del rocódromo)
  document.addEventListener('click', (e) => {
    const o = e.target.closest('[data-kxb-open]');
    if (o) { e.preventDefault(); openViewer(o.dataset.kxbOpen); return; }
    const n = e.target.closest('[data-kxb-new]');
    if (n) {
      e.preventDefault();
      if (!me()) { toast('Inicia sesión para registrar bloques', 'info'); if (typeof openLoginModal === 'function') openLoginModal(); return; }
      if (typeof openNewGymAscent !== 'function') return;
      openNewGymAscent({ gymId: n.dataset.kxbGymId || '', gymName: n.dataset.kxbGymName || '', gtype: 'boulder', pickPhoto: true });
    }
  });

  // Atrás de Android: cierra primero el editor y luego el visor
  function handleBack() {
    if (KruxBlockEditor.isOpen()) { KruxBlockEditor.close(); return true; }
    if (viewer && !viewer.classList.contains('hidden')) { closeViewer(); return true; }
    return false;
  }

  return { attach, detach, hasPending, beforeAscentSave, afterAscentSave, renderActivity, gymCardHTML, hydrateGymCard, openViewer, handleBack };
})();

window.KruxGymBlocks = KruxGymBlocks;
window.KruxBlockEditor = KruxBlockEditor;
