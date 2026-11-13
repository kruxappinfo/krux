#!/usr/bin/env python3
# ================== TESELAS DE RELIEVE (MDT05 IGN) ==================
# Descarga el MDT de 5 m del IGN (WCS INSPIRE, CC-BY 4.0) para una zona y lo convierte en teselas
# raster-dem de MapLibre (codificación Mapbox Terrain-RGB, 512 px, WebP sin pérdida), del mismo
# formato que las de MapTiler: maplibre-map.js las sirve en la zona y fuera usa MapTiler.
#
# Uso:   python3 scripts/generate-dem-tiles.py pedriza
# Requiere: numpy y opencv-python (pip install numpy opencv-python-headless)
# Salida: tiles/<zona>/dem/{z}/{x}/{y}.webp y, por pantalla, el bloque para KX_LOCAL_DEM (maplibre-config.js)

import math
import os
import sys
import time
import urllib.request

import cv2
import numpy as np

# Zonas: bbox [oeste, sur, este, norte] en grados. Se cubren enteras las teselas de MIN_ZOOM que la tocan.
ZONES = {
    'pedriza': {'bbox': [-3.9257, 40.7327, -3.8267, 40.7891]},
    'patones': {'bbox': [-3.462, 40.876, -3.424, 40.898]},  # Pontón de la Oliva y el cañón del Lozoya
}
MIN_ZOOM, MAX_ZOOM = 13, 14
TILE = 512
WCS = ('https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage'
       '&COVERAGEID=Elevacion25830_5&SUBSET=x({x0},{x1})&SUBSET=y({y0},{y1})&FORMAT=image/tiff')
CELL = 5.0      # m, paso del MDT05
CHUNK = 4000    # m por lado de cada petición al WCS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------- Web Mercator ----------
def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * 2 ** z


def lat2y(lat, z):
    r = np.radians(lat)
    return (1.0 - np.log(np.tan(r) + 1.0 / np.cos(r)) / math.pi) / 2.0 * 2 ** z


def x2lon(x, z):
    return x / 2 ** z * 360.0 - 180.0


def y2lat(y, z):
    return np.degrees(np.arctan(np.sinh(math.pi * (1.0 - 2.0 * y / 2 ** z))))


# ---------- ETRS89 geográficas -> UTM 30N (GRS80, serie de Krüger) ----------
def to_utm30(lon, lat):
    a, f = 6378137.0, 1 / 298.257222101
    k0, lon0 = 0.9996, math.radians(-3.0)
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64)
    al = [n / 2 - 2 * n ** 2 / 3 + 5 * n ** 3 / 16, 13 * n ** 2 / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    e = math.sqrt(f * (2 - f))
    phi, lam = np.radians(lat), np.radians(lon) - lon0
    t = np.sinh(np.arctanh(np.sin(phi)) - e * np.arctanh(e * np.sin(phi)))
    xi = np.arctan2(t, np.cos(lam))
    eta = np.arctanh(np.sin(lam) / np.sqrt(1 + t ** 2))
    E = eta + sum(al[j] * np.cos(2 * (j + 1) * xi) * np.sinh(2 * (j + 1) * eta) for j in range(3))
    N = xi + sum(al[j] * np.sin(2 * (j + 1) * xi) * np.cosh(2 * (j + 1) * eta) for j in range(3))
    return 500000.0 + k0 * A * E, k0 * A * N


# ---------- Descarga del MDT ----------
def fetch(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read()
        except Exception as e:  # el servicio del IGN corta a veces: reintento con espera
            if i == tries - 1:
                raise
            print('  reintento:', e)
            time.sleep(3 * (i + 1))


def download_dem(E0, N0, E1, N1, cache_dir):
    """Mosaico del MDT05 en [E0,E1]x[N0,N1] (UTM 30N). Fila 0 = norte."""
    cols, rows = int(round((E1 - E0) / CELL)), int(round((N1 - N0) / CELL))
    dem = np.zeros((rows, cols), np.float32)
    os.makedirs(cache_dir, exist_ok=True)
    for y0 in range(int(N0), int(N1), CHUNK):
        for x0 in range(int(E0), int(E1), CHUNK):
            x1, y1 = min(x0 + CHUNK, int(E1)), min(y0 + CHUNK, int(N1))
            path = os.path.join(cache_dir, f'{x0}_{y0}_{x1}_{y1}.tif')
            if not os.path.exists(path):
                print(f'  MDT05 {x0},{y0} -> {x1},{y1}')
                data = fetch(WCS.format(x0=x0, x1=x1, y0=y0, y1=y1))
                with open(path, 'wb') as fh:
                    fh.write(data)
            a = cv2.imread(path, cv2.IMREAD_UNCHANGED)
            if a is None or a.shape != (int(round((y1 - y0) / CELL)), int(round((x1 - x0) / CELL))):
                raise RuntimeError(f'Respuesta inesperada del WCS en {path}: {None if a is None else a.shape}')
            r0, c0 = int(round((N1 - y1) / CELL)), int(round((x0 - E0) / CELL))
            dem[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    if dem.min() <= -1000 or dem.max() > 3000:
        raise RuntimeError(f'Cotas fuera de rango ({dem.min()}..{dem.max()}): huecos en el MDT')
    return dem


# ---------- Teselas ----------
def bilinear(dem, E0, N1, E, N):
    # Centro de la celda (0,0) en (E0 + CELL/2, N1 - CELL/2)
    fx = np.clip((E - E0) / CELL - 0.5, 0, dem.shape[1] - 1.001)
    fy = np.clip((N1 - N) / CELL - 0.5, 0, dem.shape[0] - 1.001)
    i, j = fx.astype(np.int32), fy.astype(np.int32)
    a, b = fx - i, fy - j
    return (dem[j, i] * (1 - a) * (1 - b) + dem[j, i + 1] * a * (1 - b)
            + dem[j + 1, i] * (1 - a) * b + dem[j + 1, i + 1] * a * b)


def encode_terrain_rgb(h):
    # Mapbox Terrain-RGB: h = -10000 + (R*65536 + G*256 + B) * 0.1
    v = np.clip(np.round((h + 10000.0) * 10.0), 0, 2 ** 24 - 1).astype(np.uint32)
    r, g, b = (v >> 16) & 255, (v >> 8) & 255, v & 255
    return np.dstack([b, g, r]).astype(np.uint8)  # OpenCV escribe en BGR


def main():
    zone = sys.argv[1] if len(sys.argv) > 1 else 'pedriza'
    if zone not in ZONES:
        sys.exit(f'Zona desconocida: {zone}. Zonas: {", ".join(ZONES)}')
    w, s, e, n = ZONES[zone]['bbox']

    # Teselas de MIN_ZOOM que tocan la zona; las de zooms mayores son sus hijas
    z = MIN_ZOOM
    tx0, tx1 = int(lon2x(w, z)), int(lon2x(e, z))
    ty0, ty1 = int(lat2y(n, z)), int(lat2y(s, z))
    lon0, lon1 = x2lon(tx0, z), x2lon(tx1 + 1, z)
    lat1, lat0 = float(y2lat(ty0, z)), float(y2lat(ty1 + 1, z))

    # Rectángulo UTM que contiene esas teselas (con un margen de 200 m)
    cE, cN = to_utm30(np.array([lon0, lon1, lon0, lon1]), np.array([lat0, lat0, lat1, lat1]))
    E0 = math.floor((cE.min() - 200) / 1000) * 1000
    E1 = math.ceil((cE.max() + 200) / 1000) * 1000
    N0 = math.floor((cN.min() - 200) / 1000) * 1000
    N1 = math.ceil((cN.max() + 200) / 1000) * 1000
    print(f'Zona {zone}: teselas z{z} x {tx0}-{tx1}, y {ty0}-{ty1}; MDT UTM {E0},{N0} -> {E1},{N1}')

    dem = download_dem(E0, N0, E1, N1, os.path.join(ROOT, '.cache', 'mdt05', zone))
    # El MDT viene en metros enteros: un suavizado leve quita el escalonado de 1 m en el sombreado
    dem = cv2.GaussianBlur(dem, (0, 0), 0.8)

    out_dir = os.path.join(ROOT, 'tiles', zone, 'dem')
    ranges, total, size = {}, 0, 0
    for z in range(MIN_ZOOM, MAX_ZOOM + 1):
        k = 2 ** (z - MIN_ZOOM)
        xs, ys = range(tx0 * k, (tx1 + 1) * k), range(ty0 * k, (ty1 + 1) * k)
        ranges[z] = [xs[0], xs[-1], ys[0], ys[-1]]
        # A menos zoom cada píxel abarca más terreno: se promedia antes de muestrear
        m_px = 40075016.686 * math.cos(math.radians((s + n) / 2)) / (2 ** z * TILE)
        src = cv2.GaussianBlur(dem, (0, 0), 0.5 * m_px / CELL) if m_px > 1.5 * CELL else dem
        for x in xs:
            for y in ys:
                p = (np.arange(TILE) + 0.5) / TILE
                lon = x2lon(x + p, z)[None, :].repeat(TILE, 0)
                lat = y2lat(y + p, z)[:, None].repeat(TILE, 1)
                E, N = to_utm30(lon, lat)
                rgb = encode_terrain_rgb(bilinear(src, E0, N1, E, N))
                path = os.path.join(out_dir, str(z), str(x), f'{y}.webp')
                os.makedirs(os.path.dirname(path), exist_ok=True)
                cv2.imwrite(path, rgb, [cv2.IMWRITE_WEBP_QUALITY, 101])  # >100 = sin pérdida
                total += 1
                size += os.path.getsize(path)
    print(f'{total} teselas, {size / 1e6:.1f} MB en tiles/{zone}/dem')
    print('Bloque para KX_LOCAL_DEM (maplibre-config.js):')
    print(f"  {{ path: 'tiles/{zone}/dem', zooms: {{ " +
          ', '.join(f'{z}: {r}' for z, r in ranges.items()) + ' } },')


if __name__ == '__main__':
    main()
