// ================== VISOR 3D DE RELIEVE ==================
// Vista 3D propia de una escuela (hoy La Pedriza), aparte del mapa MapLibre. Carga de una vez el relieve
// MDT05 y la ortofoto PNOA del IGN de toda la zona (scripts/generate-terrain3d.py) y los pinta como una
// sola maqueta con Three.js: cámara orbital libre, sin huecos ni teselas a medio cargar al moverse.
// El detalle de la ortofoto se pide al PNOA solo para los bloques cercanos a la cámara.
//
// Uso (maplibre-map.js: kxOpenTerrainViewer):
//   kxTerrain3D.open('pedriza', { container, center, zoom, bearing, sectors, onSector, onClose })
// Zonas disponibles: KX_TERRAIN_3D (maplibre-config.js). Three.js se descarga al abrir, no con la app.

const kxTerrain3D = (() => {
  // ============================================
  // CONFIGURACIÓN
  // ============================================
  const THREE_URL = 'https://unpkg.com/three@0.160.1/build/three.min.js';
  // PNOA en TMS (la fila cuenta desde el sur). CC-BY 4.0 scne.es
  const pnoaUrl = (z, x, y) => `https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/${z}/${x}/${(1 << z) - 1 - y}.jpeg`;
  const EARTH = 40075016.686;

  const MAX_DPR = 2;
  const FOV = 45;
  const MAX_POLAR = Math.PI / 2 - 0.035;   // ~88°: casi a ras de suelo
  const START_POLAR = 1.08;                // ~62°
  const MIN_DIST = 60, MAX_DIST = 11000;   // m entre la cámara y el punto que mira
  const CAM_CLEARANCE = 12;                // m mínimos de la cámara sobre el terreno
  const SKIRT = 60;                        // m de faldón bajo cada bloque: tapa las juntas entre niveles de malla

  // Malla: tramos por lado de bloque según la distancia a la cámara (m)
  const LODS = [
    { seg: 192, within: 900, keep: 12 },
    { seg: 96, within: 2600, keep: 40 },
    { seg: 48, within: Infinity, keep: Infinity }
  ];
  // Ortofoto de detalle: zoom PNOA según la distancia (m), con tope de bloques a la vez (memoria de vídeo)
  const DETAIL = [
    { z: 18, within: 650, max: 3, keep: 4 },
    { z: 17, within: 2600, max: 10, keep: 14 }
  ];
  const DETAIL_PARALLEL = 2;               // bloques descargando detalle a la vez
  const TILE_PARALLEL = 8;                 // teselas a la vez dentro de un bloque

  // Sectores
  const LINE_STEP = 4;                     // m entre puntos al ceñir la línea al relieve
  const LINE_LIFT = 3;                     // m que flota la línea sobre la roca
  const LINE_WIDTH = 4, CASING_WIDTH = 6.5; // px
  const PATH_WIDTH = 2.6, PATH_CASING_WIDTH = 4.4; // px: caminos de acceso, más finos que los sectores
  const LABEL_MAX_DIST = 3500, LABEL_MAX = 26;
  const TAP_RADIUS = 22;                   // px

  const SKY_ZENITH = '#78aee0', SKY_HORIZON = '#dfe8ee';

  let S = null;        // estado del visor abierto
  let threeLoading = null;

  // ============================================
  // CARGA
  // ============================================
  function available(schoolId) {
    if (typeof KX_TERRAIN_3D === 'undefined' || !KX_TERRAIN_3D[schoolId]) return false;
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) { return false; }
  }

  function loadThree() {
    if (window.THREE) return Promise.resolve();
    if (!threeLoading) {
      threeLoading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = THREE_URL;
        s.crossOrigin = 'anonymous';   // respuesta CORS: el service worker puede guardarla para uso sin conexión
        s.onload = () => (window.THREE ? resolve() : reject(new Error('Three.js no se inicializó')));
        s.onerror = () => { threeLoading = null; s.remove(); reject(new Error('No se pudo descargar Three.js')); };
        document.head.appendChild(s);
      });
    }
    return threeLoading;
  }

  function loadImage(url, cors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('No se pudo cargar ' + url));
      img.src = url;
    });
  }

  // Cotas: una imagen Terrain-RGB -> Float32Array de (nx*seg+1) x (ny*seg+1), fila 0 = norte
  async function loadHeights(cfg) {
    const W = cfg.nx * cfg.seg + 1, H = cfg.ny * cfg.seg + 1;
    const url = cfg.path + '/height.webp';
    let src;
    try {
      const blob = await (await fetch(url)).blob();
      src = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch (e) {
      src = await loadImage(url);
    }
    if (src.width !== W || src.height !== H) throw new Error('height.webp no cuadra con KX_TERRAIN_3D');
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, W, H).data;
    if (src.close) src.close();
    canvas.width = canvas.height = 0;
    const h = new Float32Array(W * H);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0, j = 0; i < h.length; i++, j += 4) {
      const v = -10000 + (px[j] * 65536 + px[j + 1] * 256 + px[j + 2]) * 0.1;
      h[i] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // Si el navegador alteró los píxeles al decodificar, las cotas salen disparatadas: mejor el 3D del mapa
    if (lo < cfg.minH - 50 || hi > cfg.maxH + 50) throw new Error('Cotas fuera de rango: ' + lo + '..' + hi);
    return { data: h, W, H };
  }

  // ============================================
  // GEOMETRÍA DEL TERRENO
  // ============================================
  // Coordenadas locales en metros: x al este, y arriba (cota - minH), z al sur; origen en el centro de la zona.
  function lngLatToLocal(lng, lat) {
    const g = S.grid;
    const n = Math.pow(2, g.zoom);
    const tx = (lng + 180) / 360 * n;
    const r = lat * Math.PI / 180;
    const ty = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    return [(tx - g.x0 - g.nx / 2) * g.tileM, (ty - g.y0 - g.ny / 2) * g.tileM];
  }

  function localToLngLat(x, z) {
    const g = S.grid;
    const n = Math.pow(2, g.zoom);
    const tx = x / g.tileM + g.x0 + g.nx / 2, ty = z / g.tileM + g.y0 + g.ny / 2;
    return [tx / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI];
  }

  // Altura del terreno (y local) en un punto; fuera de la zona, la del borde más cercano
  function heightAt(x, z) {
    const g = S.grid;
    let fc = (x + g.halfW) / g.cell, fr = (z + g.halfH) / g.cell;
    fc = fc < 0 ? 0 : fc > g.W - 1.001 ? g.W - 1.001 : fc;
    fr = fr < 0 ? 0 : fr > g.H - 1.001 ? g.H - 1.001 : fr;
    const c = fc | 0, r = fr | 0, a = fc - c, b = fr - r, i = r * g.W + c, d = g.data;
    return (d[i] * (1 - a) + d[i + 1] * a) * (1 - b) + (d[i + g.W] * (1 - a) + d[i + g.W + 1] * a) * b - g.minH;
  }

  // UV e índices de un bloque con `seg` tramos por lado (+ faldón). Iguales para todos los bloques del nivel.
  function lodTemplate(seg) {
    if (S.templates[seg]) return S.templates[seg];
    const n = seg + 1, verts = n * n + 4 * n;
    const uv = new Float32Array(verts * 2);
    for (let r = 0, k = 0; r < n; r++) for (let c = 0; c < n; c++) { uv[k++] = c / seg; uv[k++] = 1 - r / seg; }
    const idx = new Uint16Array(seg * seg * 6 + 4 * seg * 6);
    let t = 0;
    for (let r = 0; r < seg; r++) {
      for (let c = 0; c < seg; c++) {
        const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
        idx[t++] = a; idx[t++] = d; idx[t++] = b; idx[t++] = b; idx[t++] = d; idx[t++] = e;
      }
    }
    // Faldón: por cada lado, una copia de los vértices del borde hundida SKIRT metros
    const edges = [
      i => i,                      // norte
      i => seg * n + i,            // sur
      i => i * n,                  // oeste
      i => i * n + seg             // este
    ];
    const edgeOf = new Uint16Array(4 * n);
    edges.forEach((at, s) => {
      const base = n * n + s * n;
      for (let i = 0; i < n; i++) {
        const top = at(i);
        edgeOf[s * n + i] = top;
        uv[(base + i) * 2] = uv[top * 2]; uv[(base + i) * 2 + 1] = uv[top * 2 + 1];
        if (i < seg) {
          const a = top, b = at(i + 1), c = base + i, d = base + i + 1;
          idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d;
        }
      }
    });
    const T = THREE;
    return (S.templates[seg] = {
      uv: new T.BufferAttribute(uv, 2), index: new T.BufferAttribute(idx, 1), edgeOf, verts
    });
  }

  function buildGeometry(chunk, seg) {
    const g = S.grid, tpl = lodTemplate(seg), n = seg + 1, step = g.seg / seg;
    const pos = new Float32Array(tpl.verts * 3);
    const size = g.tileM, c0 = chunk.i * g.seg, r0 = chunk.j * g.seg;
    let k = 0;
    for (let r = 0; r < n; r++) {
      const row = (r0 + r * step) * g.W + c0;
      for (let c = 0; c < n; c++) {
        pos[k++] = c / seg * size;
        pos[k++] = g.data[row + c * step] - g.minH;
        pos[k++] = r / seg * size;
      }
    }
    for (let i = 0; i < tpl.edgeOf.length; i++) {
      const top = tpl.edgeOf[i] * 3;
      pos[k++] = pos[top]; pos[k++] = pos[top + 1] - SKIRT; pos[k++] = pos[top + 2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', tpl.uv);
    geo.setIndex(tpl.index);
    geo.boundingSphere = chunk.sphereLocal;
    return geo;
  }

  function buildChunks(baseImage) {
    const T = THREE, g = S.grid;
    const base = new T.Texture(baseImage);
    base.colorSpace = T.SRGBColorSpace;
    base.anisotropy = S.aniso;
    S.baseTexture = base;
    S.chunks = [];
    for (let j = 0; j < g.ny; j++) {
      for (let i = 0; i < g.nx; i++) {
        // Altura mínima y máxima del bloque: caja para medir distancias y esfera para el recorte de cámara
        let lo = Infinity, hi = -Infinity;
        for (let r = 0; r <= g.seg; r += 4) {
          const row = (j * g.seg + r) * g.W + i * g.seg;
          for (let c = 0; c <= g.seg; c += 4) {
            const v = g.data[row + c];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        lo -= g.minH + SKIRT; hi -= g.minH;
        const x0 = (i - g.nx / 2) * g.tileM, z0 = (j - g.ny / 2) * g.tileM;
        const half = g.tileM / 2, hy = (hi - lo) / 2;
        const chunk = {
          i, j, x0, z0, x1: x0 + g.tileM, z1: z0 + g.tileM, lo, hi,
          sphereLocal: new T.Sphere(new T.Vector3(half, lo + hy, half), Math.sqrt(half * half * 2 + hy * hy) + 2),
          geoms: {}, seg: 0, dist: 0, visible: true,
          tex: {}, have: 0, want: 0, loading: 0, failedAt: 0
        };
        chunk.sphere = chunk.sphereLocal.clone();
        chunk.sphere.center.x += x0; chunk.sphere.center.z += z0;
        // La ortofoto base es una sola imagen: cada bloque mira su recorte (misma textura en la tarjeta gráfica)
        const tex = base.clone();
        tex.repeat.set(1 / g.nx, 1 / g.ny);
        tex.offset.set(i / g.nx, 1 - (j + 1) / g.ny);
        tex.needsUpdate = true;
        chunk.tex[0] = tex;
        chunk.material = new T.MeshBasicMaterial({ map: tex });
        const low = LODS[LODS.length - 1].seg;
        chunk.geoms[low] = buildGeometry(chunk, low);
        chunk.seg = low;
        chunk.mesh = new T.Mesh(chunk.geoms[low], chunk.material);
        chunk.mesh.position.set(x0, 0, z0);
        chunk.mesh.matrixAutoUpdate = false;
        chunk.mesh.updateMatrix();
        S.scene.add(chunk.mesh);
        S.chunks.push(chunk);
      }
    }
  }

  // Distancia de la cámara a la caja de cada bloque y si cae dentro del campo de visión
  function measureChunks() {
    const p = S.camera.position;
    S.frustum.setFromProjectionMatrix(S.projView.multiplyMatrices(S.camera.projectionMatrix, S.camera.matrixWorldInverse));
    for (const c of S.chunks) {
      const dx = p.x < c.x0 ? c.x0 - p.x : p.x > c.x1 ? p.x - c.x1 : 0;
      const dz = p.z < c.z0 ? c.z0 - p.z : p.z > c.z1 ? p.z - c.z1 : 0;
      const dy = p.y > c.hi ? p.y - c.hi : 0;
      c.dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      c.visible = S.frustum.intersectsSphere(c.sphere);
    }
  }

  // Ajusta la malla de cada bloque a su distancia. Construye como mucho dos mallas por fotograma.
  function updateLOD() {
    let budget = 2, pending = false;
    for (const c of S.chunks) {
      const want = (c.visible ? LODS.find(l => c.dist < l.within) : LODS[LODS.length - 1]).seg;
      if (want === c.seg) continue;
      if (!c.geoms[want]) {
        if (budget <= 0) { pending = true; continue; }
        budget--;
        c.geoms[want] = buildGeometry(c, want);
      }
      c.seg = want;
      c.mesh.geometry = c.geoms[want];
    }
    // Mallas finas que ya no se usan: se conservan las de los bloques más cercanos y se liberan las demás
    for (const lod of LODS) {
      if (lod.keep === Infinity) continue;
      const idle = S.chunks.filter(c => c.geoms[lod.seg] && c.seg !== lod.seg);
      const used = S.chunks.filter(c => c.seg === lod.seg).length;
      if (used + idle.length <= lod.keep) continue;
      idle.sort((a, b) => b.dist - a.dist);
      for (let k = 0; k < idle.length && used + idle.length - k > lod.keep; k++) {
        idle[k].geoms[lod.seg].dispose();
        delete idle[k].geoms[lod.seg];
      }
    }
    return pending;
  }

  // ============================================
  // ORTOFOTO DE DETALLE
  // ============================================
  function bestTexture(c) {
    return c.tex[18] || c.tex[17] || c.tex[0];
  }

  function updateDetail() {
    S.detailAt = performance.now();
    S.detailDirty = false;
    const near = S.chunks.filter(c => c.visible).sort((a, b) => a.dist - b.dist);
    for (const c of S.chunks) c.want = 0;
    for (const d of DETAIL) {
      let n = 0;
      for (const c of near) {
        if (n >= d.max || c.dist >= d.within) break;
        if (c.want < d.z) c.want = d.z;
        n++;
      }
    }
    // Texturas de detalle que sobran: se guardan las más cercanas hasta el tope y se sueltan las demás
    for (const d of DETAIL) {
      const held = S.chunks.filter(c => c.tex[d.z]);
      if (held.length <= d.keep) continue;
      held.sort((a, b) => (a.want >= d.z) - (b.want >= d.z) || b.dist - a.dist);
      for (let k = 0; k < held.length - d.keep; k++) {
        const c = held[k];
        if (c.want >= d.z) break;
        c.tex[d.z].dispose();
        delete c.tex[d.z];
        c.material.map = bestTexture(c);
      }
    }
    pumpDetail();
  }

  function pumpDetail() {
    if (!S) return;
    const now = performance.now();
    while (S.detailActive < DETAIL_PARALLEL) {
      let next = null, level = 0;
      for (const c of S.chunks) {
        if (!c.want || c.loading || (c.failedAt && now - c.failedAt < 30000)) continue;
        // Primero el zoom 17 (16 teselas, rápido); el 18 solo cuando el bloque ya tiene el 17
        const z = !c.tex[17] && !c.tex[18] ? 17 : c.want === 18 && !c.tex[18] ? 18 : 0;
        if (z && (!next || c.dist < next.dist)) { next = c; level = z; }
      }
      if (!next) return;
      loadDetail(next, level);
    }
  }

  async function loadDetail(chunk, z) {
    const state = S, g = S.grid;
    chunk.loading = z;
    state.detailActive++;
    const n = 1 << (z - g.zoom);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = n * 256;
    const ctx = canvas.getContext('2d');
    const tiles = [];
    for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) tiles.push([tx, ty]);
    let ok = true;
    const wanted = () => S === state && chunk.want >= (z === 17 ? 17 : 18);
    const worker = async () => {
      while (tiles.length && ok && wanted()) {
        const [tx, ty] = tiles.pop();
        try {
          const img = await loadImage(pnoaUrl(z, (g.x0 + chunk.i) * n + tx, (g.y0 + chunk.j) * n + ty), true);
          ctx.drawImage(img, tx * 256, ty * 256, 256, 256);
        } catch (e) { ok = false; }
      }
    };
    await Promise.all(Array.from({ length: TILE_PARALLEL }, worker));
    if (S !== state) return;
    chunk.loading = 0;
    state.detailActive--;
    if (!ok) chunk.failedAt = performance.now();
    if (ok && wanted() && !tiles.length) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = state.aniso;
      tex.onUpdate = () => { canvas.width = canvas.height = 0; };   // ya está en la tarjeta gráfica: se suelta la copia
      chunk.tex[z] = tex;
      chunk.material.map = bestTexture(chunk);
      invalidate();
    }
    pumpDetail();
  }

  // ============================================
  // CIELO
  // ============================================
  function buildSky() {
    const T = THREE;
    const mat = new T.ShaderMaterial({
      side: T.BackSide, depthTest: false, depthWrite: false, fog: false,
      uniforms: { zenith: { value: new T.Color(SKY_ZENITH) }, horizon: { value: new T.Color(SKY_HORIZON) } },
      vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: [
        'uniform vec3 zenith; uniform vec3 horizon; varying vec3 vDir;',
        'void main() {',
        '  float h = normalize(vDir).y;',
        '  vec3 c = mix(horizon, zenith, smoothstep(0.0, 0.5, h));',
        '  gl_FragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);',
        '}'
      ].join('\n')
    });
    S.sky = new T.Mesh(new T.SphereGeometry(1, 24, 12), mat);
    S.sky.renderOrder = -1;
    S.sky.frustumCulled = false;
    S.scene.add(S.sky);
    S.scene.fog = new T.Fog(new T.Color(SKY_HORIZON), 5000, 32000);
  }

  // ============================================
  // SECTORES
  // ============================================
  // Línea de ancho fijo en píxeles: cada tramo es un rectángulo que el sombreador abre en pantalla,
  // con extremos redondos para que los tramos casen entre sí.
  function lineMaterial(width, bias, white) {
    const T = THREE;
    return new T.ShaderMaterial({
      side: T.DoubleSide, fog: false,
      uniforms: { uRes: { value: new T.Vector2(1, 1) }, uWidth: { value: width }, uBias: { value: bias }, uBiasK: { value: bias * 0.0013 }, uWhite: { value: white ? 1 : 0 } },
      vertexShader: [
        'attribute vec3 iA; attribute vec3 iB; attribute vec3 iColor;',
        'uniform vec2 uRes; uniform float uWidth; uniform float uBias; uniform float uBiasK; uniform float uWhite;',
        'varying vec3 vColor; varying vec3 vLine;',
        // Acerca el punto a la cámara (sin moverlo en pantalla) para que la línea no se hunda en la roca;
        // crece con la distancia, y más en el color que en el borde, para que de lejos no se pisen
        'vec4 toClip(vec3 p) {',
        '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
        '  float d = length(mv.xyz);',
        '  mv.xyz *= 1.0 - min(0.5, (uBias + d * uBiasK) / d);',
        '  return projectionMatrix * mv;',
        '}',
        'void main() {',
        '  vColor = mix(iColor, vec3(1.0), uWhite);',
        '  vec4 a = toClip(iA), b = toClip(iB);',
        '  if (a.w < 0.05 || b.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }',
        '  vec2 sa = a.xy / a.w * uRes * 0.5, sb = b.xy / b.w * uRes * 0.5;',
        '  vec2 dir = sb - sa; float len = length(dir);',
        '  dir = len > 1e-4 ? dir / len : vec2(1.0, 0.0);',
        '  vec2 nrm = vec2(-dir.y, dir.x);',
        '  float hw = uWidth * 0.5;',
        '  vec4 p = mix(a, b, position.y);',
        '  float along = position.y * 2.0 - 1.0;',
        '  p.xy += (nrm * position.x * hw + dir * along * hw) / (uRes * 0.5) * p.w;',
        '  vLine = vec3(position.x * hw, position.y < 0.5 ? -hw : len + hw, len);',
        '  gl_Position = p;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uWidth; varying vec3 vColor; varying vec3 vLine;',
        'void main() {',
        '  float hw = uWidth * 0.5;',
        '  float over = vLine.y < 0.0 ? vLine.y : max(vLine.y - vLine.z, 0.0);',
        '  if (length(vec2(vLine.x, over)) > hw) discard;',
        '  gl_FragColor = vec4(vColor, 1.0);',
        '}'
      ].join('\n')
    });
  }

  function buildSectors(list) {
    const T = THREE;
    const A = [], B = [], C = [];
    const color = new T.Color();
    S.sectors = [];
    for (const item of list || []) {
      const geom = item.feature && item.feature.geometry;
      const lines = !geom ? [] : geom.type === 'MultiLineString' ? geom.coordinates
        : geom.type === 'LineString' ? [geom.coordinates] : [];
      const pts = [];        // puntos ceñidos al relieve (para tocar la línea)
      let anchor = null, longest = 0;
      // El color va tal cual al lienzo (sRGB): sin pasar por el espacio lineal de Three
      color.set(item.color || '#ffffff');
      const rgb = [color.r, color.g, color.b].map(v => Math.pow(v, 1 / 2.2));
      for (const line of lines) {
        const path = [];
        let length = 0;
        for (let i = 0; i < line.length; i++) {
          const [x, z] = lngLatToLocal(line[i][0], line[i][1]);
          if (!isFinite(x) || !isFinite(z)) continue;
          if (path.length) {
            const p = path[path.length - 1];
            const d = Math.hypot(x - p[0], z - p[2]);
            const n = Math.max(1, Math.ceil(d / LINE_STEP));
            for (let k = 1; k <= n; k++) {
              const px = p[0] + (x - p[0]) * k / n, pz = p[2] + (z - p[2]) * k / n;
              path.push([px, heightAt(px, pz) + LINE_LIFT, pz]);
            }
            length += d;
          } else {
            path.push([x, heightAt(x, z) + LINE_LIFT, z]);
          }
        }
        for (let i = 1; i < path.length; i++) {
          A.push(path[i - 1][0], path[i - 1][1], path[i - 1][2]);
          B.push(path[i][0], path[i][1], path[i][2]);
          C.push(rgb[0], rgb[1], rgb[2]);
        }
        for (const p of path) pts.push(p);
        if (path.length && length >= longest) { longest = length; anchor = path[path.length >> 1]; }
      }
      if (!anchor) continue;
      S.sectors.push({
        item, pts, name: item.name || '',
        anchor: new T.Vector3(anchor[0], anchor[1] + 9, anchor[2]),
        el: null, w: 0, shown: false, sx: 0, sy: 0
      });
    }
    if (A.length) {
      const geo = new T.InstancedBufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
      geo.setIndex([0, 1, 2, 2, 1, 3]);
      geo.setAttribute('iA', new T.InstancedBufferAttribute(new Float32Array(A), 3));
      geo.setAttribute('iB', new T.InstancedBufferAttribute(new Float32Array(B), 3));
      geo.setAttribute('iColor', new T.InstancedBufferAttribute(new Float32Array(C), 3));
      geo.instanceCount = A.length / 3;
      S.lineMats = [lineMaterial(CASING_WIDTH, 3, true), lineMaterial(LINE_WIDTH, 6, false)];
      S.lineMats.forEach((mat, k) => {
        const mesh = new T.Mesh(geo, mat);
        mesh.frustumCulled = false;
        mesh.renderOrder = 1 + k;
        S.scene.add(mesh);
      });
      S.lineGeo = geo;
    }
    // Etiquetas: una píldora HTML por sector, colocada en cada fotograma sobre su punto del relieve
    const frag = document.createDocumentFragment();
    for (const s of S.sectors) {
      if (!s.name) continue;
      const el = document.createElement('div');
      el.className = 'kx-t3d-label';
      const dot = document.createElement('i');
      dot.style.background = s.item.color || '#fff';
      el.appendChild(dot);
      el.appendChild(document.createTextNode(s.name));
      frag.appendChild(el);
      s.el = el;
    }
    S.labelsEl.appendChild(frag);
    for (const s of S.sectors) if (s.el) s.w = s.el.offsetWidth;
  }

  // Caminos de acceso (GeoJSON de líneas): se ciñen al relieve como los sectores, sin etiqueta ni toque
  function buildPaths(features, color) {
    const T = THREE;
    const A = [], B = [], C = [];
    const c = new T.Color(color || '#F07A22');
    const rgb = [c.r, c.g, c.b].map(v => Math.pow(v, 1 / 2.2));
    for (const f of features || []) {
      const g = f && f.geometry;
      const lines = !g ? [] : g.type === 'MultiLineString' ? g.coordinates : g.type === 'LineString' ? [g.coordinates] : [];
      for (const line of lines) {
        let prev = null;
        for (const pt of line) {
          const [x, z] = lngLatToLocal(pt[0], pt[1]);
          if (!isFinite(x) || !isFinite(z)) { prev = null; continue; }
          if (!prev) { prev = [x, heightAt(x, z) + LINE_LIFT, z]; continue; }
          const d = Math.hypot(x - prev[0], z - prev[2]);
          const n = Math.max(1, Math.ceil(d / LINE_STEP));
          for (let k = 1; k <= n; k++) {
            const px = prev[0] + (x - prev[0]) * k / n, pz = prev[2] + (z - prev[2]) * k / n;
            const cur = [px, heightAt(px, pz) + LINE_LIFT, pz];
            A.push(prev[0], prev[1], prev[2]);
            B.push(cur[0], cur[1], cur[2]);
            C.push(rgb[0], rgb[1], rgb[2]);
            prev = cur;
          }
        }
      }
    }
    if (!A.length) return;
    const geo = new T.InstancedBufferGeometry();
    geo.setAttribute('position', new T.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    geo.setAttribute('iA', new T.InstancedBufferAttribute(new Float32Array(A), 3));
    geo.setAttribute('iB', new T.InstancedBufferAttribute(new Float32Array(B), 3));
    geo.setAttribute('iColor', new T.InstancedBufferAttribute(new Float32Array(C), 3));
    geo.instanceCount = A.length / 3;
    // Por debajo de los sectores (renderOrder 1 y 2) y con menos adelanto, para que no los tapen
    S.pathMats = [lineMaterial(PATH_CASING_WIDTH, 2, true), lineMaterial(PATH_WIDTH, 4, false)];
    S.pathMats.forEach((mat, k) => {
      const mesh = new T.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 0 + k * 0.1;
      S.scene.add(mesh);
    });
    S.pathGeo = geo;
  }

  // ¿Tapa el relieve la línea recta entre un punto y la cámara?
  function occluded(p) {
    const cam = S.camera.position;
    const dx = cam.x - p.x, dy = cam.y - p.y, dz = cam.z - p.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const n = Math.max(8, Math.min(160, Math.round(len / 12)));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (t * len < 12) continue;
      if (heightAt(p.x + dx * t, p.z + dz * t) > p.y + dy * t + 1) return true;
    }
    return false;
  }

  function updateLabels() {
    const v = S.v3, cam = S.camera.position, w = S.cssW, h = S.cssH;
    const cands = [];
    for (const s of S.sectors) {
      if (!s.el) continue;
      const d = cam.distanceTo(s.anchor);
      if (d < LABEL_MAX_DIST) {
        v.copy(s.anchor).project(S.camera);
        if (v.z > -1 && v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.05) {
          cands.push({ s, d, x: (v.x + 1) / 2 * w, y: (1 - v.y) / 2 * h });
        }
      }
      s.next = false;
    }
    cands.sort((a, b) => a.d - b.d);
    const boxes = [];
    for (const c of cands) {
      if (boxes.length >= LABEL_MAX) break;
      const hw = c.s.w / 2 + 4, x0 = c.x - hw, x1 = c.x + hw, y0 = c.y - 30, y1 = c.y;
      if (boxes.some(b => x0 < b[1] && x1 > b[0] && y0 < b[3] && y1 > b[2])) continue;
      if (occluded(c.s.anchor)) continue;
      boxes.push([x0, x1, y0, y1]);
      c.s.next = true; c.s.sx = c.x; c.s.sy = c.y;
    }
    for (const s of S.sectors) {
      if (!s.el) continue;
      if (s.next) s.el.style.transform = `translate3d(${s.sx.toFixed(1)}px, ${s.sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      if (s.next !== s.shown) { s.shown = s.next; s.el.classList.toggle('is-on', s.shown); }
    }
  }

  // Sector bajo un toque: primero su etiqueta, después el punto de línea más cercano que no tape el relieve
  function sectorAt(x, y) {
    for (const s of S.sectors) {
      if (s.shown && Math.abs(x - s.sx) < s.w / 2 + 6 && y > s.sy - 34 && y < s.sy + 6) return s;
    }
    const v = S.v3, w = S.cssW, h = S.cssH;
    const hits = [];
    for (const s of S.sectors) {
      let best = TAP_RADIUS, at = null;
      for (let i = 0; i < s.pts.length; i += 2) {
        const p = s.pts[i];
        v.set(p[0], p[1], p[2]).project(S.camera);
        if (v.z < -1 || v.z > 1) continue;
        const d = Math.hypot((v.x + 1) / 2 * w - x, (1 - v.y) / 2 * h - y);
        if (d < best) { best = d; at = p; }
      }
      if (at) hits.push({ s, d: best, at });
    }
    hits.sort((a, b) => a.d - b.d);
    for (const hit of hits) {
      if (!occluded({ x: hit.at[0], y: hit.at[1] + 2, z: hit.at[2] })) return hit.s;
    }
    return null;
  }

  // ============================================
  // CÁMARA
  // ============================================
  // La cámara orbita alrededor de un punto del terreno: rumbo (theta), inclinación (phi) y distancia.
  function clampView() {
    const c = S.cam, g = S.grid;
    c.phi = Math.max(0.02, Math.min(MAX_POLAR, c.phi));
    // En zonas pequeñas no se aleja tanto que la maqueta quede como una isla en el cielo
    c.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, 3 * Math.max(g.halfW, g.halfH), c.dist));
    c.x = Math.max(-g.halfW, Math.min(g.halfW, c.x));
    c.z = Math.max(-g.halfH, Math.min(g.halfH, c.z));
  }

  function placeCamera() {
    clampView();
    const c = S.cam, cam = S.camera;
    const sp = Math.sin(c.phi);
    cam.position.set(c.x + c.dist * sp * Math.sin(c.theta), c.y + c.dist * Math.cos(c.phi), c.z + c.dist * sp * Math.cos(c.theta));
    // Nunca bajo tierra: si una ladera se interpone, la cámara sube lo justo
    const floor = heightAt(cam.position.x, cam.position.z) + CAM_CLEARANCE;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.near = Math.max(2, Math.min(60, c.dist * 0.04));
    cam.far = c.dist + 40000;
    cam.updateProjectionMatrix();
    S.target.set(c.x, c.y, c.z);
    cam.lookAt(S.target);
    cam.updateMatrixWorld();
    S.sky.position.copy(cam.position);
    S.sky.scale.setScalar(cam.far * 0.9);
    S.sky.updateMatrixWorld();
    if (S.compassNeedle) S.compassNeedle.style.transform = `rotate(${(c.theta * 180 / Math.PI).toFixed(1)}deg)`;
  }

  // Metros de terreno que abarca un píxel a la distancia del punto que se mira
  function metersPerPixel() {
    return 2 * S.cam.dist * Math.tan(FOV * Math.PI / 360) / S.cssH;
  }

  function panBy(dx, dy) {
    const c = S.cam, m = metersPerPixel();
    const fx = -Math.sin(c.theta), fz = -Math.cos(c.theta);     // hacia delante sobre el suelo
    const f = dy * m / Math.max(Math.cos(c.phi), 0.3), r = -dx * m;
    c.x += fx * f - fz * r;
    c.z += fz * f + fx * r;
  }

  // Punto del terreno bajo un píxel de pantalla (o null si el rayo sale de la zona)
  function groundAt(x, y) {
    const g = S.grid, cam = S.camera;
    const dir = S.v3.set(x / S.cssW * 2 - 1, 1 - y / S.cssH * 2, 0.5).unproject(cam).sub(cam.position).normalize();
    const o = cam.position;
    let t = 0, prev = 0;
    while (t < 40000) {
      prev = t;
      t += Math.max(4, t * 0.01);
      const px = o.x + dir.x * t, py = o.y + dir.y * t, pz = o.z + dir.z * t;
      if (py < heightAt(px, pz)) {
        let a = prev, b = t;
        for (let k = 0; k < 10; k++) {
          const m = (a + b) / 2;
          if (o.y + dir.y * m < heightAt(o.x + dir.x * m, o.z + dir.z * m)) b = m; else a = m;
        }
        const hx = o.x + dir.x * b, hz = o.z + dir.z * b;
        if (Math.abs(hx) > g.halfW || Math.abs(hz) > g.halfH) return null;
        return { x: hx, z: hz };
      }
      if (py < -SKIRT && dir.y <= 0) return null;
    }
    return null;
  }

  function animateTo(to, ms) {
    const c = S.cam;
    const from = { x: c.x, z: c.z, dist: c.dist, phi: c.phi, theta: c.theta };
    const goal = Object.assign({}, from, to);
    // El rumbo gira por el lado corto
    goal.theta = from.theta + Math.atan2(Math.sin(goal.theta - from.theta), Math.cos(goal.theta - from.theta));
    S.anim = { from, goal, t0: performance.now(), ms };
    invalidate();
  }

  function stepAnim(now) {
    const a = S.anim;
    if (!a) return false;
    const t = Math.min(1, (now - a.t0) / a.ms), e = 1 - Math.pow(1 - t, 3);
    for (const k in a.goal) S.cam[k] = a.from[k] + (a.goal[k] - a.from[k]) * e;
    if (t >= 1) S.anim = null;
    return t < 1;
  }

  // Inercia al soltar: el giro y el desplazamiento se frenan solos
  function stepInertia(dt) {
    const i = S.inertia;
    if (!i.on) return false;
    const c = S.cam, k = Math.exp(-dt / 0.22);
    c.theta += i.theta * dt; c.phi += i.phi * dt;
    if (i.px || i.py) panBy(i.px * dt, i.py * dt);
    i.theta *= k; i.phi *= k; i.px *= k; i.py *= k;
    if (Math.abs(i.theta) + Math.abs(i.phi) < 0.02 && Math.abs(i.px) + Math.abs(i.py) < 8) i.on = false;
    return i.on;
  }

  // ============================================
  // GESTOS
  // ============================================
  // Táctil: un dedo gira e inclina; dos dedos mueven, acercan (pellizco) y giran (torsión).
  // Ratón: arrastrar gira; botón derecho o Mayús + arrastrar mueve; la rueda acerca.
  function bindControls() {
    const el = S.canvas, pts = new Map(), I = S.inertia;
    let mode = '', moved = false, down = null, last = null, pinch = null, lastTap = null, lastMoveAt = 0;

    const pos = e => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const twoFingers = () => {
      const [a, b] = Array.from(pts.values());
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, span: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    };
    const track = (name, value, dt) => { I[name] = I[name] * 0.6 + (value / dt) * 0.4; };

    S.on(el, 'pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button === 1) return;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* puntero ya suelto */ }
      const p = pos(e);
      pts.set(e.pointerId, p);
      S.anim = null;
      I.on = false; I.theta = I.phi = I.px = I.py = 0;
      hideHint();
      if (pts.size === 1) {
        mode = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey) ? 'pan' : 'orbit';
        moved = false; down = { x: p.x, y: p.y, t: performance.now() }; last = p;
      } else if (pts.size === 2) {
        moved = true; pinch = twoFingers();
      }
      lastMoveAt = performance.now();
      el.classList.add('is-dragging');
    });

    S.on(el, 'pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = pos(e), c = S.cam, now = performance.now();
      const dt = Math.max(0.004, (now - lastMoveAt) / 1000);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        if (!moved && Math.hypot(p.x - down.x, p.y - down.y) < 8) return;
        if (!moved) { moved = true; last = p; return; }
        const dx = p.x - last.x, dy = p.y - last.y;
        last = p;
        if (mode === 'pan') {
          panBy(dx, dy);
          track('px', dx, dt); track('py', dy, dt);
        } else {
          const k = 1.7 * Math.PI / S.cssH;
          c.theta -= dx * k; c.phi -= dy * k;
          track('theta', -dx * k, dt); track('phi', -dy * k, dt);
        }
      } else if (pts.size === 2) {
        const g = twoFingers();
        panBy(g.x - pinch.x, g.y - pinch.y);
        track('px', g.x - pinch.x, dt); track('py', g.y - pinch.y, dt);
        if (g.span > 10 && pinch.span > 10) c.dist *= pinch.span / g.span;
        c.theta += Math.atan2(Math.sin(g.ang - pinch.ang), Math.cos(g.ang - pinch.ang));
        pinch = g;
      } else {
        return;
      }
      lastMoveAt = now;
      invalidate();
    });

    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      const now = performance.now();
      if (pts.size === 1) {
        // De dos dedos a uno: el que queda sigue girando sin dar un salto
        last = Array.from(pts.values())[0];
        mode = 'orbit';
        I.px = I.py = 0;
        return;
      }
      if (pts.size) return;
      el.classList.remove('is-dragging');
      if (!moved && e.type === 'pointerup' && now - down.t < 400) {
        const p = pos(e);
        const sector = sectorAt(p.x, p.y);
        if (sector) { lastTap = null; openSector(sector); return; }
        if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 36) {
          // Doble toque: acerca hacia ese punto del relieve
          lastTap = null;
          const hit = groundAt(p.x, p.y);
          animateTo(Object.assign({ dist: S.cam.dist * 0.5 }, hit || {}), 380);
        } else {
          lastTap = { x: p.x, y: p.y, t: now };
        }
        return;
      }
      if (moved && now - lastMoveAt < 90) { I.on = true; invalidate(); }
    };
    S.on(el, 'pointerup', up);
    S.on(el, 'pointercancel', up);

    S.on(el, 'wheel', e => {
      e.preventDefault();
      S.anim = null; I.on = false;
      hideHint();
      const unit = e.deltaMode === 1 ? 32 : 1;
      S.cam.dist *= Math.exp(e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015));
      invalidate();
    }, { passive: false });
    S.on(el, 'contextmenu', e => e.preventDefault());
    // iOS: sin esto el pellizco intenta ampliar la página entera
    S.on(el, 'gesturestart', e => e.preventDefault());
    S.on(document, 'keydown', e => { if (e.key === 'Escape' && S && !S.root.hidden) close(); });
  }

  function openSector(s) {
    if (!S.opts.onSector) return;
    const [lng, lat] = localToLngLat(s.anchor.x, s.anchor.z);
    try { S.opts.onSector(s.item, { lng, lat }); } catch (e) { console.error('[3D] Error al abrir el sector:', e); }
  }

  // ============================================
  // FOTOGRAMA
  // ============================================
  function invalidate() {
    if (S && !S.raf) S.raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    if (!S) return;
    S.raf = 0;
    const dt = Math.min(0.05, (now - (S.lastFrame || now)) / 1000) || 0.016;
    S.lastFrame = now;
    let again = stepAnim(now);
    again = stepInertia(dt) || again;
    // El punto que se mira sigue el relieve con suavidad (sin botes al cruzar cortados)
    clampView();
    const c = S.cam, ground = heightAt(c.x, c.z);
    if (Math.abs(ground - c.y) > 0.3) { c.y += (ground - c.y) * Math.min(1, dt * 8); again = true; } else c.y = ground;
    placeCamera();
    measureChunks();
    again = updateLOD() || again;
    const key = `${c.x.toFixed(0)}|${c.z.toFixed(0)}|${c.dist.toFixed(0)}|${c.phi.toFixed(2)}|${c.theta.toFixed(2)}`;
    if (key !== S.viewKey) { S.viewKey = key; S.detailDirty = true; }
    if (S.detailDirty) {
      if (now - S.detailAt > 250) updateDetail(); else again = true;
    }
    S.renderer.render(S.scene, S.camera);
    updateLabels();
    if (!again) S.lastFrame = 0;
    if (again) invalidate();
  }

  function resize() {
    if (!S || !S.renderer) return;
    const w = S.root.clientWidth, h = S.root.clientHeight;
    if (!w || !h) return;
    S.cssW = w; S.cssH = h;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    S.renderer.setPixelRatio(dpr);
    S.renderer.setSize(w, h, false);
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    for (const m of S.lineMats || []) m.uniforms.uRes.value.set(w * dpr, h * dpr);
    (S.lineMats || []).forEach((m, k) => { m.uniforms.uWidth.value = (k ? LINE_WIDTH : CASING_WIDTH) * dpr; });
    for (const m of S.pathMats || []) m.uniforms.uRes.value.set(w * dpr, h * dpr);
    (S.pathMats || []).forEach((m, k) => { m.uniforms.uWidth.value = (k ? PATH_WIDTH : PATH_CASING_WIDTH) * dpr; });
    invalidate();
  }

  // ============================================
  // INTERFAZ
  // ============================================
  function buildDom(container, name) {
    const root = document.createElement('div');
    root.id = 'kx-t3d';
    root.className = 'kx-t3d is-loading';
    root.setAttribute('role', 'application');
    root.setAttribute('aria-label', 'Vista 3D' + (name ? ' de ' + name : ''));
    root.innerHTML = [
      '<canvas class="kx-t3d-canvas"></canvas>',
      '<div class="kx-t3d-labels" aria-hidden="true"></div>',
      '<button type="button" class="kx-t3d-btn kx-t3d-close" aria-label="Volver al mapa">',
      '  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '  <span>Mapa</span>',
      '</button>',
      '<button type="button" class="kx-t3d-btn kx-t3d-compass" aria-label="Orientar al norte">',
      '  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3l4 9H8z" fill="#D9482B"/><path d="M12 21l-4-9h8z" fill="currentColor" opacity=".35"/></svg>',
      '</button>',
      '<div class="kx-t3d-loading" role="status"><span class="kx-t3d-spinner" aria-hidden="true"></span><span>Cargando relieve…</span></div>',
      '<div class="kx-t3d-hint" aria-hidden="true"></div>',
      '<div class="kx-t3d-attrib">MDT05 · PNOA © <a href="https://www.ign.es/" target="_blank" rel="noopener">IGN</a></div>'
    ].join('');
    container.appendChild(root);
    return root;
  }

  function hideHint() {
    if (S && S.hintEl) { S.hintEl.classList.remove('is-on'); S.hintEl = null; }
  }

  // ============================================
  // ABRIR / CERRAR
  // ============================================
  async function open(schoolId, opts) {
    if (S) return;
    const cfg = KX_TERRAIN_3D[schoolId];
    const listeners = [];
    const state = S = {
      opts: opts || {}, cfg, listeners,
      on(target, type, fn, o) { target.addEventListener(type, fn, o); listeners.push([target, type, fn, o]); },
      root: buildDom(opts.container, opts.name),
      templates: {}, chunks: [], sectors: [], detailActive: 0, detailAt: 0, detailDirty: true, viewKey: '',
      inertia: { on: false, theta: 0, phi: 0, px: 0, py: 0 }, anim: null, raf: 0, lastFrame: 0
    };
    S.canvas = S.root.querySelector('canvas');
    S.labelsEl = S.root.querySelector('.kx-t3d-labels');
    S.on(S.root.querySelector('.kx-t3d-close'), 'click', () => close());

    try {
      const [, heights, baseImage] = await Promise.all([loadThree(), loadHeights(cfg), loadImage(cfg.path + '/base.webp')]);
      if (S !== state) return;   // se cerró mientras cargaba
      const T = THREE;
      const lat0 = Math.atan(Math.sinh(Math.PI * (1 - 2 * (cfg.y0 + cfg.ny / 2) / Math.pow(2, cfg.zoom)))) * 180 / Math.PI;
      const tileM = EARTH * Math.cos(lat0 * Math.PI / 180) / Math.pow(2, cfg.zoom);
      S.grid = {
        data: heights.data, W: heights.W, H: heights.H, zoom: cfg.zoom, x0: cfg.x0, y0: cfg.y0, nx: cfg.nx, ny: cfg.ny,
        seg: cfg.seg, minH: cfg.minH, tileM, cell: tileM / cfg.seg, halfW: cfg.nx * tileM / 2, halfH: cfg.ny * tileM / 2
      };

      S.renderer = new T.WebGLRenderer({ canvas: S.canvas, antialias: true, powerPreference: 'high-performance' });
      S.aniso = Math.min(8, S.renderer.capabilities.getMaxAnisotropy());
      S.scene = new T.Scene();
      S.camera = new T.PerspectiveCamera(FOV, 1, 2, 50000);
      S.camera.matrixAutoUpdate = true;
      S.target = new T.Vector3();
      S.v3 = new T.Vector3();
      S.frustum = new T.Frustum();
      S.projView = new T.Matrix4();
      buildSky();
      buildChunks(baseImage);
      buildSectors(opts.sectors);
      buildPaths(opts.paths, opts.pathColor);

      // Arranca donde estaba el mapa: mismo centro, mismo rumbo y una distancia equivalente a su zoom
      const [x, z] = lngLatToLocal(opts.center[0], opts.center[1]);
      S.cssW = S.root.clientWidth || 360; S.cssH = S.root.clientHeight || 640;
      const mpp = EARTH * Math.cos(opts.center[1] * Math.PI / 180) / (512 * Math.pow(2, opts.zoom || 15));
      const dist = (S.cssH / 2) / Math.tan(FOV * Math.PI / 360) * mpp;
      S.cam = { x, z, y: 0, dist: Math.max(250, Math.min(6000, dist)), phi: 0.35, theta: -(opts.bearing || 0) * Math.PI / 180 };
      clampView();
      S.cam.y = heightAt(S.cam.x, S.cam.z);

      S.compassNeedle = S.root.querySelector('.kx-t3d-compass svg');
      S.on(S.root.querySelector('.kx-t3d-compass'), 'click', () => animateTo({ theta: 0 }, 450));
      S.on(S.canvas, 'webglcontextlost', e => {
        e.preventDefault();
        console.warn('[3D] El navegador retiró el contexto gráfico: se cierra el visor');
        close();
      });
      bindControls();
      if (window.ResizeObserver) { S.ro = new ResizeObserver(resize); S.ro.observe(S.root); }
      S.on(window, 'resize', resize);
      resize();

      S.root.classList.remove('is-loading');
      const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      S.hintEl = S.root.querySelector('.kx-t3d-hint');
      S.hintEl.textContent = touch
        ? 'Un dedo gira e inclina · Dos dedos mueven y acercan'
        : 'Arrastra para girar · Mayús + arrastrar para mover · Rueda para acercar';
      S.hintEl.classList.add('is-on');
      setTimeout(() => { if (S === state) hideHint(); }, 6000);
      animateTo({ phi: START_POLAR }, 900);
    } catch (e) {
      if (S === state) close(true);
      throw e;
    }
  }

  function close(silent) {
    if (!S) return;
    const state = S;
    S = null;
    if (state.raf) cancelAnimationFrame(state.raf);
    for (const [t, type, fn, o] of state.listeners) t.removeEventListener(type, fn, o);
    if (state.ro) state.ro.disconnect();
    let center = null;
    if (state.grid && state.cam) {
      S = state; center = localToLngLat(state.cam.x, state.cam.z); S = null;
    }
    try {
      for (const c of state.chunks) {
        for (const k in c.geoms) c.geoms[k].dispose();
        for (const k in c.tex) c.tex[k].dispose();
        c.material.dispose();
      }
      if (state.baseTexture) state.baseTexture.dispose();
      if (state.lineGeo) state.lineGeo.dispose();
      for (const m of state.lineMats || []) m.dispose();
      if (state.pathGeo) state.pathGeo.dispose();
      for (const m of state.pathMats || []) m.dispose();
      if (state.sky) { state.sky.geometry.dispose(); state.sky.material.dispose(); }
      if (state.renderer) { state.renderer.dispose(); state.renderer.forceContextLoss(); }
    } catch (e) { console.warn('[3D] Error al liberar el visor:', e); }
    state.root.remove();
    if (!silent && state.opts.onClose) {
      try { state.opts.onClose(center); } catch (e) { console.error('[3D] Error al cerrar el visor:', e); }
    }
  }

  return { available, open, close, isOpen: () => !!S };
})();
