#!/usr/bin/env python3
# ================== BACKUP LOCAL DE FIRESTORE ==================
# Descarga todas las colecciones (y subcolecciones) de Firestore a JSON en local.
# Usa la sesión de gcloud (gcloud auth login) — no necesita dependencias.
#
# Uso:  python3 scripts/backup-firestore.py [carpeta_destino]
# Por defecto guarda en ~/krux-backups/firestore-AAAA-MM-DD_HHMM/
# Las copias NO deben subirse al repo (contienen datos de usuarios).
# Incluyen datos personales sensibles: perfil de entrenamiento y evaluación mental (users/{uid}/training_profile,
# mental_profile y mental_session_logs). Guárdalas solo en local y no las compartas.

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime

PROJECT = 'climbmaps-80cae'
BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'


def get_token():
    out = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True)
    token = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ''
    if not token:
        sys.exit('Sin token de gcloud. Ejecuta: gcloud auth login')
    return token


def request(token, url, body=None):
    # Los IDs de documento pueden tener espacios o acentos (p. ej. 'mora_Oeste 14')
    url = urllib.parse.quote(url, safe=':/?&=()%')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method='POST' if body is not None else 'GET')
    req.add_header('Authorization', f'Bearer {token}')
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def list_collection_ids(token, parent_url):
    ids, page = [], None
    while True:
        body = {'pageSize': 300}
        if page:
            body['pageToken'] = page
        res = request(token, f'{parent_url}:listCollectionIds', body)
        ids += res.get('collectionIds', [])
        page = res.get('nextPageToken')
        if not page:
            return ids


def list_documents(token, collection_url):
    docs, page = [], None
    while True:
        url = f'{collection_url}?pageSize=300' + (f'&pageToken={urllib.parse.quote(page)}' if page else '')
        res = request(token, url)
        docs += res.get('documents', [])
        page = res.get('nextPageToken')
        if not page:
            return docs


def dump_collection(token, collection_url, path, out, counts):
    docs = list_documents(token, collection_url)
    out[path] = docs
    counts[path] = len(docs)
    for doc in docs:
        doc_url = f"https://firestore.googleapis.com/v1/{doc['name']}"
        doc_path = doc['name'].split('/documents/', 1)[1]
        for sub in list_collection_ids(token, doc_url):
            dump_collection(token, f'{doc_url}/{sub}', f'{doc_path}/{sub}', out, counts)


def main():
    stamp = datetime.now().strftime('%Y-%m-%d_%H%M')
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(f'~/krux-backups/firestore-{stamp}')
    os.makedirs(dest, exist_ok=True)
    token = get_token()

    counts = {}
    for root in list_collection_ids(token, BASE):
        out = {}
        dump_collection(token, f'{BASE}/{root}', root, out, counts)
        with open(os.path.join(dest, f'{root}.json'), 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False)
        print(f'  {root}: {sum(len(v) for v in out.values())} docs')

    with open(os.path.join(dest, '_resumen.json'), 'w', encoding='utf-8') as f:
        json.dump({'proyecto': PROJECT, 'fecha': stamp, 'colecciones': counts}, f, ensure_ascii=False, indent=2)
    print(f'Copia guardada en {dest} ({sum(counts.values())} documentos)')


if __name__ == '__main__':
    main()
