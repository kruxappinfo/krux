#!/usr/bin/env python3
# ================== MODELO 3D DE UNA ZONA (visor terrain-3d.js) ==================
# Prepara los dos ficheros que el visor 3D carga de una vez para mover la cámara sin esperar teselas:
#   tiles/<zona>/3d/height.webp  cotas del MDT05 del IGN en una sola imagen (Terrain-RGB, WebP sin pérdida)
#   tiles/<zona>/3d/base.webp    ortofoto PNOA del IGN de toda la zona a baja resolución
# El detalle de la ortofoto lo pide el visor al PNOA según se acerca la cámara.
#
# La zona se divide en bloques = teselas de zoom BLOCK_ZOOM; cada bloque lleva SEG tramos de malla por lado.
#
# Uso:   python3 scripts/generate-terrain3d.py pedriza
# Requiere: numpy y opencv-python (como generate-dem-tiles.py, del que reutiliza la descarga del MDT)
# Salida: los dos ficheros y, por pantalla, el bloque para KX_TERRAIN_3D (maplibre-config.js)

import importlib.util
import math
import os
import sys

import cv2
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location('demtiles', os.path.join(ROOT, 'scripts', 'generate-dem-tiles.py'))
dem_tiles = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dem_tiles)

BLOCK_ZOOM = 15   # un bloque de malla = una tesela de este zoom (~930 m de lado a 40° N)
SEG = 192         # tramos de malla por lado de bloque (~4,8 m: el paso del MDT05)
BASE_PX = 256     # píxeles de ortofoto base por bloque (= la tesela PNOA de BLOCK_ZOOM)
PNOA = 'https://tms-pnoa-ma.idee.es/1.0.0/pnoa-ma/{z}/{x}/{y}.jpeg'  # TMS: la fila cuenta desde el sur


def main():
    zone = sys.argv[1] if len(sys.argv) > 1 else 'pedriza'
    if zone not in dem_tiles.ZONES:
        sys.exit(f'Zona desconocida: {zone}. Zonas: {", ".join(dem_tiles.ZONES)}')
    w, s, e, n = dem_tiles.ZONES[zone]['bbox']
    z = BLOCK_ZOOM
    bx0, bx1 = int(dem_tiles.lon2x(w, z)), int(dem_tiles.lon2x(e, z))
    by0, by1 = int(dem_tiles.lat2y(n, z)), int(dem_tiles.lat2y(s, z))
    nx, ny = bx1 - bx0 + 1, by1 - by0 + 1
    print(f'Zona {zone}: {nx}x{ny} bloques z{z} (x {bx0}-{bx1}, y {by0}-{by1})')

    # MDT: el mismo rectángulo UTM (y la misma caché) que generate-dem-tiles.py
    zm = dem_tiles.MIN_ZOOM
    tx0, tx1 = int(dem_tiles.lon2x(w, zm)), int(dem_tiles.lon2x(e, zm))
    ty0, ty1 = int(dem_tiles.lat2y(n, zm)), int(dem_tiles.lat2y(s, zm))
    lon0, lon1 = dem_tiles.x2lon(tx0, zm), dem_tiles.x2lon(tx1 + 1, zm)
    lat1, lat0 = float(dem_tiles.y2lat(ty0, zm)), float(dem_tiles.y2lat(ty1 + 1, zm))
    cE, cN = dem_tiles.to_utm30(np.array([lon0, lon1, lon0, lon1]), np.array([lat0, lat0, lat1, lat1]))
    E0 = math.floor((cE.min() - 200) / 1000) * 1000
    E1 = math.ceil((cE.max() + 200) / 1000) * 1000
    N0 = math.floor((cN.min() - 200) / 1000) * 1000
    N1 = math.ceil((cN.max() + 200) / 1000) * 1000
    dem = dem_tiles.download_dem(E0, N0, E1, N1, os.path.join(ROOT, '.cache', 'mdt05', zone))
    dem = cv2.GaussianBlur(dem, (0, 0), 0.8)  # quita el escalonado de 1 m del MDT en metros enteros

    # Cotas en los vértices de la malla: (nx*SEG+1) x (ny*SEG+1), uniformes en Web Mercator
    W, H = nx * SEG + 1, ny * SEG + 1
    lon = dem_tiles.x2lon(bx0 + np.arange(W) / SEG, z)[None, :].repeat(H, 0)
    lat = dem_tiles.y2lat(by0 + np.arange(H) / SEG, z)[:, None].repeat(W, 1)
    E, N = dem_tiles.to_utm30(lon, lat)
    h = dem_tiles.bilinear(dem, E0, N1, E, N)
    out_dir = os.path.join(ROOT, 'tiles', zone, '3d')
    os.makedirs(out_dir, exist_ok=True)
    hp = os.path.join(out_dir, 'height.webp')
    cv2.imwrite(hp, dem_tiles.encode_terrain_rgb(h), [cv2.IMWRITE_WEBP_QUALITY, 101])  # >100 = sin pérdida
    print(f'height.webp {W}x{H}, {os.path.getsize(hp) / 1e6:.1f} MB, cotas {h.min():.0f}-{h.max():.0f} m')

    # Ortofoto base: las teselas PNOA de BLOCK_ZOOM en un solo mosaico
    cache = os.path.join(ROOT, '.cache', 'pnoa', zone)
    os.makedirs(cache, exist_ok=True)
    base = np.zeros((ny * BASE_PX, nx * BASE_PX, 3), np.uint8)
    for j in range(ny):
        for i in range(nx):
            x, y = bx0 + i, by0 + j
            path = os.path.join(cache, f'{z}_{x}_{y}.jpeg')
            if not os.path.exists(path):
                with open(path, 'wb') as fh:
                    fh.write(dem_tiles.fetch(PNOA.format(z=z, x=x, y=2 ** z - 1 - y)))
            tile = cv2.imread(path, cv2.IMREAD_COLOR)
            if tile is None or tile.shape[:2] != (256, 256):
                raise RuntimeError(f'Tesela PNOA inesperada: {path}')
            base[j * BASE_PX:(j + 1) * BASE_PX, i * BASE_PX:(i + 1) * BASE_PX] = cv2.resize(tile, (BASE_PX, BASE_PX))
    bp = os.path.join(out_dir, 'base.webp')
    cv2.imwrite(bp, base, [cv2.IMWRITE_WEBP_QUALITY, 86])
    print(f'base.webp {base.shape[1]}x{base.shape[0]}, {os.path.getsize(bp) / 1e6:.1f} MB')

    print('Bloque para KX_TERRAIN_3D (maplibre-config.js):')
    print(f"  {zone}: {{ path: 'tiles/{zone}/3d', zoom: {z}, x0: {bx0}, y0: {by0}, nx: {nx}, ny: {ny}, seg: {SEG}, "
          f"basePx: {BASE_PX}, minH: {math.floor(h.min())}, maxH: {math.ceil(h.max())} }},")


if __name__ == '__main__':
    main()
