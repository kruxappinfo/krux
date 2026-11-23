#!/usr/bin/env python3
# ================== FOTOS DE VÍA SIN routeId: PLAN Y VERIFICACIÓN (SOLO LECTURA) ==================
# Contexto: algunos documentos antiguos de `route-photos` (fotos de 2025) no tienen `routeId` y se identifican solo por escuela + nombre de la vía.
# Esta herramienta NUNCA escribe: ni en Firestore ni en Storage ni en disco fuera de la carpeta de salida. Solo calcula un PLAN y, después de una
# migración hecha por una persona, VERIFICA que lo único que cambió fue `routeId`. Procedimiento completo: docs/security-phase0/ROUTEID-MIGRATION.md.
#
#   plan    Lee los documentos (GET) y los GeoJSON locales y clasifica cada documento SIN routeId:
#             unico         → exactamente UNA vía de esa escuela se llama igual (y tiene id entero): único caso migrable
#             ambiguo       → varias vías de la escuela con ese nombre: NO se migra (no se puede saber cuál es)
#             sin_coincidencia → ninguna vía con ese nombre: NO se migra (la vía ya no existe o nunca existió en el mapa)
#             sin_datos     → falta schoolId o routeName, o la escuela no tiene GeoJSON conocido: NO se migra
#           Los documentos que ya tienen routeId se omiten (idempotencia: un segundo plan sobre datos migrados no propone nada).
#   verify  Compara una instantánea ANTERIOR (la que guarda `plan`) con el estado actual: mismos documentos, mismos campos y valores, salvo `routeId`
#           en los documentos «unico» (que debe ser exactamente el planificado). Cualquier otra diferencia es un fallo.
#
# Uso:
#   python3 scripts/route-photos-routeid-plan.py plan                       # lee Firestore real con la sesión de gcloud (solo GET)
#   python3 scripts/route-photos-routeid-plan.py verify --plan <plan.json>  # tras migrar
# Pruebas: --docs-file <json> sustituye la lectura de Firestore (formato REST de «documents.list»); ver tests/route-photos-routeid-plan.test.js.
# Los planes y las instantáneas se guardan fuera del repositorio (~/krux-backups/route-photos-routeid) y NO se suben a git: contienen uids.

import argparse
import hashlib
import json
import os
import subprocess
import sys
import urllib.request

PROJECT_DEFAULT = 'climbmaps-80cae'
# Mismo mapa que migrate-route-ids.html (la carpeta de Toledo se escribe allí «Toledo_vias»; en el repositorio es «Toledo_Vias»)
SCHOOLS = {
    'valeria': 'Cartografia/Valeria/Valeria_Vias.geojson',
    'sanmartin': 'Cartografia/San Martin de ValdeIglesias/SM_Vias.geojson',
    'mora': 'Cartografia/Mora/Mora_Vias.geojson',
    'cuenca': 'Cartografia/Cuenca/Cuenca_Vias.geojson',
    'toledo': 'Cartografia/Toledo/Toledo_Vias.geojson',
}


def fval(fields, key):
    v = fields.get(key)
    if v is None:
        return None
    for t in ('stringValue', 'integerValue', 'doubleValue', 'booleanValue', 'timestampValue'):
        if t in v:
            return v[t]
    return None


def load_routes(root, school_files):
    """{schoolId: {nombre: [id,...]}} solo con ids ENTEROS (en JSON, 234 y 234.0 son el mismo entero para JavaScript)."""
    out = {}
    for school, rel in school_files.items():
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            continue
        with open(p, encoding='utf-8') as f:
            feats = json.load(f).get('features', [])
        names = {}
        for ft in feats:
            pr = ft.get('properties', {})
            rid, name = pr.get('id'), pr.get('nombre')
            if isinstance(rid, bool) or not isinstance(rid, (int, float)) or rid != int(rid) or not name:
                continue
            names.setdefault(name, []).append(int(rid))
        out[school] = names
    return out


def classify(doc, routes):
    fields = doc.get('fields', {})
    if 'routeId' in fields and fval(fields, 'routeId') not in (None, ''):
        return None   # ya tiene routeId: no se toca
    school, name = fval(fields, 'schoolId'), fval(fields, 'routeName')
    if not school or not name or school not in routes:
        return {'clase': 'sin_datos', 'motivo': 'falta schoolId o routeName, o la escuela no tiene GeoJSON'}
    ids = routes[school].get(name, [])
    if len(ids) == 0:
        return {'clase': 'sin_coincidencia', 'motivo': f'ninguna vía de «{school}» se llama «{name}»'}
    if len(set(ids)) > 1 or len(ids) > 1:
        return {'clase': 'ambiguo', 'motivo': f'{len(ids)} vías de «{school}» se llaman «{name}»: ids {sorted(set(ids))}'}
    return {'clase': 'unico', 'routeId': ids[0]}


def read_firestore(project):
    token = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True).stdout.strip().splitlines()
    if not token:
        sys.exit('No hay sesión de gcloud (gcloud auth login).')
    docs, page = [], None
    while True:
        url = f'https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/route-photos?pageSize=300' + (f'&pageToken={page}' if page else '')
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {token[-1]}', 'x-goog-user-project': project}, method='GET')   # SOLO GET
        with urllib.request.urlopen(req, timeout=60) as r:
            j = json.load(r)
        docs += j.get('documents', [])
        page = j.get('nextPageToken')
        if not page:
            return docs


def snapshot(docs):
    return {d['name'].rsplit('/', 1)[-1]: d.get('fields', {}) for d in docs}


def canon(o):
    return hashlib.sha256(json.dumps(o, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def cmd_plan(a):
    docs = json.load(open(a.docs_file))['documents'] if a.docs_file else read_firestore(a.project)
    routes = load_routes(a.root, SCHOOLS)
    items, skipped = [], 0
    for d in docs:
        c = classify(d, routes)
        if c is None:
            skipped += 1
            continue
        i = d['name'].rsplit('/', 1)[-1]
        items.append({'id': i, 'schoolId': fval(d.get('fields', {}), 'schoolId'), 'routeName': fval(d.get('fields', {}), 'routeName'), 'updateTime': d.get('updateTime'), **c})
    plan = {'tool': 'route-photos-routeid-plan', 'project': a.project, 'documentos': len(docs), 'ya_con_routeId': skipped, 'items': items,
            'migrables': [x['id'] for x in items if x['clase'] == 'unico'], 'snapshot': snapshot(docs)}
    print(f"Documentos: {len(docs)} · ya con routeId: {skipped} · sin routeId: {len(items)}")
    for x in items:
        print(f"  [{x['clase']}] {x['id']} · {x.get('motivo') or 'routeId ' + str(x['routeId'])}")
    print(f"Migrables (coincidencia ÚNICA): {len(plan['migrables'])}")
    if a.out:
        os.makedirs(os.path.expanduser(a.out), exist_ok=True)
        path = os.path.join(os.path.expanduser(a.out), 'plan-' + canon(plan['snapshot'])[:12] + '.json')
        with open(path, 'x', encoding='utf-8') as f:   # nunca sobrescribe
            json.dump(plan, f, ensure_ascii=False, indent=1)
        print('Plan guardado en', path)
    return plan


def cmd_verify(a):
    plan = json.load(open(os.path.expanduser(a.plan)))
    now = snapshot(json.load(open(a.docs_file))['documents'] if a.docs_file else read_firestore(a.project))
    before, want = plan['snapshot'], {x['id']: x['routeId'] for x in plan['items'] if x['clase'] == 'unico'}
    problems = []
    if set(before) != set(now):
        problems.append(f'documentos distintos: faltan {sorted(set(before) - set(now))}, sobran {sorted(set(now) - set(before))}')
    for i in sorted(set(before) & set(now)):
        b, n = dict(before[i]), dict(now[i])
        if i in want:
            got = fval(n, 'routeId')
            if str(got) != str(want[i]):
                problems.append(f'{i}: routeId es {got}, debía ser {want[i]}')
            n.pop('routeId', None); b.pop('routeId', None)
        if b != n:
            problems.append(f'{i}: cambió algo más que routeId: ' + ', '.join(sorted(k for k in set(b) | set(n) if b.get(k) != n.get(k))))
    for i in set(before) & set(now):
        if i not in want and 'routeId' in now[i] and 'routeId' not in before[i]:
            problems.append(f'{i}: se le añadió un routeId no planificado')
    print('VERIFICACIÓN CORRECTA: solo cambió routeId en los documentos planificados' if not problems else 'VERIFICACIÓN FALLIDA:\n  ' + '\n  '.join(problems))
    return problems


def main():
    ap = argparse.ArgumentParser(description='Fotos de vía sin routeId: plan y verificación (solo lectura)')
    ap.add_argument('--project', default=PROJECT_DEFAULT)
    ap.add_argument('--root', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
    ap.add_argument('--docs-file', help='(pruebas) JSON en formato REST en lugar de leer Firestore')
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('plan'); p.add_argument('--out', default='~/krux-backups/route-photos-routeid')
    v = sub.add_parser('verify'); v.add_argument('--plan', required=True)
    a = ap.parse_args()
    if a.cmd == 'plan':
        cmd_plan(a)
    else:
        sys.exit(1 if cmd_verify(a) else 0)


if __name__ == '__main__':
    main()
