#!/usr/bin/env python3
# ================== OPTIMIZAR FOTOS YA SUBIDAS A STORAGE ==================
# Las fotos subidas antes de la optimización (app_3.js: kxPrepareImageForUpload) pesan hasta 5 MB
# y se sirven con "Cache-Control: private, max-age=0", así que el navegador no las guarda.
#
# Paso 1  --cache    Cache-Control de un año en todas las imágenes. Solo cambia ese campo:
#                    no toca el contenido ni los tokens de descarga, y es reversible.
# Paso 2  --resize   Reduce las fotos JPEG pesadas (lado largo 1600 px; 640 px en profile-photos).
#                    Guarda ANTES una copia local de cada original y puede deshacerse con --restore.
#                    Conserva el nombre del objeto y su token, así que las URL guardadas en
#                    Firestore siguen funcionando.
#
# Uso (siempre simula primero; no cambia nada sin --apply):
#   python3 scripts/storage-optimize.py --cache                  # simulación
#   python3 scripts/storage-optimize.py --cache --apply
#   python3 scripts/storage-optimize.py --resize --limit 3       # simulación de 3 fotos
#   python3 scripts/storage-optimize.py --resize --limit 3 --apply   # prueba real con 3 (revisa el resultado)
#   python3 scripts/storage-optimize.py --resize --apply
#   python3 scripts/storage-optimize.py --restore ~/krux-backups/storage-originals-AAAA-MM-DD_HHMM --apply
#
# Requiere la sesión de gcloud (gcloud auth login) y la herramienta `sips` de macOS. Sin dependencias.
# Las copias locales contienen fotos de usuarios: NO subirlas al repositorio.

import argparse
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime

BUCKET = os.environ.get('KRUX_BUCKET', 'climbmaps-80cae.firebasestorage.app')
API = os.environ.get('KRUX_STORAGE_API', 'https://storage.googleapis.com')
PREFIXES = ['posts/', 'route-photos/', 'profile-photos/', 'sector-images/']
CACHE_CONTROL = 'public,max-age=31536000,immutable'
MIN_BYTES = 800 * 1024          # por debajo de esto no merece la pena tocar la foto
MIN_SAVING = 0.30               # solo se reemplaza si el nuevo pesa al menos un 30 % menos
IMAGE_TYPES = ('image/jpeg', 'image/jpg')


def get_token():
    if os.environ.get('KRUX_TOKEN'):
        return os.environ['KRUX_TOKEN']
    out = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True)
    lines = [l for l in out.stdout.strip().splitlines() if l.strip()]
    if not lines:
        sys.exit('Sin token de gcloud. Ejecuta: gcloud auth login')
    return lines[-1]


def request(token, method, url, body=None, headers=None, raw=False):
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('Authorization', f'Bearer {token}')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = resp.read()
            return data if raw else (json.loads(data) if data else {})
    except urllib.error.HTTPError as e:
        sys.exit(f'Error HTTP {e.code} en {method} {url.split("?")[0]}: {e.read().decode("utf-8", "replace")[:300]}')


def object_url(name, query=''):
    return f'{API}/storage/v1/b/{BUCKET}/o/{urllib.parse.quote(name, safe="")}{query}'


def list_objects(token):
    for prefix in PREFIXES:
        page = None
        while True:
            q = {'prefix': prefix, 'maxResults': 1000, 'fields': 'nextPageToken,items(name,size,contentType,cacheControl,generation,metadata)'}
            if page:
                q['pageToken'] = page
            data = request(token, 'GET', f'{API}/storage/v1/b/{BUCKET}/o?' + urllib.parse.urlencode(q))
            for item in data.get('items', []):
                if not item['name'].endswith('/'):
                    yield item
            page = data.get('nextPageToken')
            if not page:
                break


def multipart(metadata, content, content_type):
    boundary = 'krux' + uuid.uuid4().hex
    head = (f'--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(metadata)}\r\n'
            f'--{boundary}\r\nContent-Type: {content_type}\r\n\r\n').encode()
    return head + content + f'\r\n--{boundary}--'.encode(), f'multipart/related; boundary={boundary}'


def upload_replace(token, item, content, content_type):
    """Sube `content` con el mismo nombre. Conserva token de descarga, tipo y Cache-Control.
    ifGenerationMatch evita pisar el objeto si alguien lo cambió mientras tanto."""
    meta = {'name': item['name'], 'contentType': content_type, 'cacheControl': CACHE_CONTROL}
    if item.get('metadata'):
        meta['metadata'] = item['metadata']  # incluye firebaseStorageDownloadTokens
    body, ctype = multipart(meta, content, content_type)
    q = urllib.parse.urlencode({'uploadType': 'multipart', 'ifGenerationMatch': item['generation']})
    return request(token, 'POST', f'{API}/upload/storage/v1/b/{BUCKET}/o?{q}', body, {'Content-Type': ctype})


def human(n):
    return f'{n / 1048576:.2f} MB'


# ---------------------------------------------------------------- paso 1
def run_cache(token, apply, limit):
    todo = [o for o in list_objects(token)
            if (o.get('contentType') or '').startswith('image/') and o.get('cacheControl') != CACHE_CONTROL]
    if limit:
        todo = todo[:limit]
    print(f'Imágenes sin la caché de un año: {len(todo)}')
    for o in todo[:8]:
        print(f'  · {o["name"]}  (ahora: {o.get("cacheControl") or "sin definir"})')
    if len(todo) > 8:
        print(f'  … y {len(todo) - 8} más')
    if not apply:
        print('\nSimulación: no se ha cambiado nada. Añade --apply para aplicarlo.')
        return
    for i, o in enumerate(todo, 1):
        request(token, 'PATCH', object_url(o['name']), json.dumps({'cacheControl': CACHE_CONTROL}).encode(),
                {'Content-Type': 'application/json'})
        print(f'[{i}/{len(todo)}] {o["name"]}')
    print('Hecho.')


# ---------------------------------------------------------------- paso 2
def sips_resize(src, dst, side):
    out = subprocess.run(['sips', '-Z', str(side), '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', src, '--out', dst],
                         capture_output=True, text=True)
    if out.returncode != 0 or not os.path.exists(dst):
        raise RuntimeError(out.stderr.strip() or 'sips falló')


def run_resize(token, apply, limit):
    candidates = [o for o in list_objects(token)
                  if (o.get('contentType') or '').lower() in IMAGE_TYPES and int(o.get('size', 0)) > MIN_BYTES]
    candidates.sort(key=lambda o: -int(o['size']))
    if limit:
        candidates = candidates[:limit]
    total = sum(int(o['size']) for o in candidates)
    print(f'Fotos JPEG de más de {human(MIN_BYTES)}: {len(candidates)} (total {human(total)})')
    for o in candidates[:10]:
        print(f'  · {human(int(o["size"])):>9}  {o["name"]}')
    if not apply:
        print('\nSimulación: no se ha cambiado nada. Añade --apply (empieza con --limit 3 para comprobar el resultado).')
        return

    stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
    backup = os.path.expanduser(f'~/krux-backups/storage-originals-{stamp}')
    os.makedirs(backup, exist_ok=True)
    manifest, saved = [], 0
    for i, o in enumerate(candidates, 1):
        name = o['name']
        side = 640 if name.startswith('profile-photos/') else 1600
        original = request(token, 'GET', object_url(name, '?alt=media'), raw=True)
        local = os.path.join(backup, name)
        os.makedirs(os.path.dirname(local), exist_ok=True)
        with open(local, 'wb') as f:
            f.write(original)                       # copia de seguridad ANTES de tocar nada
        manifest.append({'name': name, 'contentType': o['contentType'], 'cacheControl': o.get('cacheControl'),
                         'metadata': o.get('metadata'), 'generation': o['generation']})
        with open(os.path.join(backup, 'manifest.json'), 'w') as f:
            json.dump(manifest, f, indent=1)

        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, 'out.jpg')
            try:
                sips_resize(local, out, side)
            except RuntimeError as e:
                print(f'[{i}/{len(candidates)}] OMITIDA {name}: {e}')
                continue
            new = open(out, 'rb').read()
        if len(new) > len(original) * (1 - MIN_SAVING):
            print(f'[{i}/{len(candidates)}] sin ahorro suficiente, se deja como está: {name}')
            continue
        res = upload_replace(token, o, new, 'image/jpeg')
        # Comprobación: el token de descarga tiene que seguir igual, o las URL de Firestore se romperían
        old_tok = (o.get('metadata') or {}).get('firebaseStorageDownloadTokens')
        new_tok = (res.get('metadata') or {}).get('firebaseStorageDownloadTokens')
        if old_tok != new_tok:
            sys.exit(f'¡El token cambió en {name}! Detenido. Restaura con --restore {backup} --apply')
        saved += len(original) - len(new)
        print(f'[{i}/{len(candidates)}] {human(len(original))} → {human(len(new))}  {name}')
    print(f'\nAhorro total: {human(saved)}. Copias de los originales en: {backup}')


def run_restore(token, folder, apply):
    folder = os.path.expanduser(folder)
    manifest = json.load(open(os.path.join(folder, 'manifest.json')))
    print(f'Se restaurarán {len(manifest)} fotos desde {folder}')
    if not apply:
        print('Simulación: añade --apply para restaurar.')
        return
    for i, o in enumerate(manifest, 1):
        content = open(os.path.join(folder, o['name']), 'rb').read()
        current = request(token, 'GET', object_url(o['name'], '?fields=generation'))
        item = {'name': o['name'], 'generation': current['generation'], 'metadata': o.get('metadata')}
        res = upload_replace(token, item, content, o['contentType'])
        old_tok = (o.get('metadata') or {}).get('firebaseStorageDownloadTokens')
        new_tok = (res.get('metadata') or {}).get('firebaseStorageDownloadTokens')
        aviso = '' if old_tok == new_tok else '  ¡AVISO: el token de descarga no coincide!'
        print(f'[{i}/{len(manifest)}] restaurada {o["name"]}{aviso}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', action='store_true')
    ap.add_argument('--resize', action='store_true')
    ap.add_argument('--restore', metavar='CARPETA')
    ap.add_argument('--apply', action='store_true', help='aplica los cambios (sin esto solo simula)')
    ap.add_argument('--limit', type=int, default=0, help='procesa solo las N primeras')
    a = ap.parse_args()
    if not (a.cache or a.resize or a.restore):
        ap.error('elige --cache, --resize o --restore')
    token = get_token()
    if a.cache:
        run_cache(token, a.apply, a.limit)
    if a.resize:
        run_resize(token, a.apply, a.limit)
    if a.restore:
        run_restore(token, a.restore, a.apply)


if __name__ == '__main__':
    main()
