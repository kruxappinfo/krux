#!/usr/bin/env python3
# ================== INFORME DE MIGRACIÓN DE PLANES (SOLO LECTURA) ==================
# Cuenta cuántos usuarios y documentos afectaría la migración de Entrena a planes múltiples
# y detecta conflictos ANTES de activar la nueva arquitectura. No escribe nada en Firestore.
#
# Uso:  python3 scripts/informe-migracion-planes.py [--json informe.json]
# Usa la sesión de gcloud (gcloud auth login). Con FIRESTORE_EMULATOR_HOST (y FIRESTORE_PROJECT)
# apunta al emulador local, sin credenciales.
#
# Qué mira:
#   users/{uid}/training_plan/active     documento antiguo (no se modifica nunca)
#   users/{uid}/training_state/current   marcador de migración
#   users/{uid}/training_plans/*         planes nuevos
#   users/{uid}/training_sessions/*      solo se cuentan (no se leen sus datos)

import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

PROJECT = os.environ.get('FIRESTORE_PROJECT', 'climbmaps-80cae')
EMULATOR = os.environ.get('FIRESTORE_EMULATOR_HOST')
ROOT = (f'http://{EMULATOR}' if EMULATOR else 'https://firestore.googleapis.com') + f'/v1/projects/{PROJECT}/databases/(default)/documents'
LEGACY_PLAN_ID = 'legacy-active'


def token():
    if EMULATOR:
        return 'owner'  # el emulador acepta este token y no aplica reglas
    out = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True)
    t = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else ''
    if not t:
        sys.exit('Sin token de gcloud. Ejecuta: gcloud auth login')
    return t


def post(tk, body):
    req = urllib.request.Request(urllib.parse.quote(ROOT, safe=':/()') + ':runQuery', data=json.dumps(body).encode(), method='POST')
    req.add_header('Authorization', f'Bearer {tk}')
    req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def collection_group(tk, collection_id):
    """Todos los documentos de una colección, de cualquier usuario (paginado)."""
    docs, offset, page = [], 0, 300
    while True:
        rows = post(tk, {'structuredQuery': {'from': [{'collectionId': collection_id, 'allDescendants': True}], 'limit': page, 'offset': offset}})
        batch = [r['document'] for r in rows if 'document' in r]
        docs += batch
        if len(batch) < page:
            return docs
        offset += page


def uid_of(doc):
    # .../documents/users/{uid}/{colección}/{id}
    parts = doc['name'].split('/documents/', 1)[1].split('/')
    return parts[1] if parts[0] == 'users' else None


def field(doc, name):
    return (doc.get('fields') or {}).get(name)


def seconds(ts):
    if not ts or 'timestampValue' not in ts:
        return None
    from datetime import datetime
    return datetime.fromisoformat(ts['timestampValue'].replace('Z', '+00:00')).timestamp()


def main():
    tk = token()
    legacy = {uid_of(d): d for d in collection_group(tk, 'training_plan') if d['name'].endswith('/training_plan/active')}
    states = {uid_of(d): d for d in collection_group(tk, 'training_state') if d['name'].endswith('/training_state/current')}
    plans = {}
    for d in collection_group(tk, 'training_plans'):
        plans.setdefault(uid_of(d), []).append(d)
    sessions = {}
    for d in collection_group(tk, 'training_sessions'):
        sessions[uid_of(d)] = sessions.get(uid_of(d), 0) + 1

    report = {'proyecto': PROJECT, 'emulador': bool(EMULATOR), 'usuarios_con_plan_antiguo': len(legacy), 'a_migrar': [], 'ya_migrados': [],
              'sin_plan_antiguo_con_planes_nuevos': [], 'conflictos': [], 'cambios_posteriores_a_la_migracion': [], 'migracion_interrumpida': []}

    for uid, doc in legacy.items():
        state = states.get(uid)
        migrated_at = field(state, 'migratedAt') if state else None
        legacy_plan = next((p for p in plans.get(uid, []) if p['name'].endswith('/' + LEGACY_PLAN_ID)), None)
        if migrated_at:
            report['ya_migrados'].append(uid)
            t_old, t_mig = seconds(field(doc, 'updatedAt')), seconds(migrated_at)
            if t_old and t_mig and t_old > t_mig + 1:
                report['cambios_posteriores_a_la_migracion'].append(uid)
        elif legacy_plan is not None:
            origin = field(legacy_plan, 'migratedFrom')
            if origin and origin.get('stringValue') == 'training_plan/active':
                report['migracion_interrumpida'].append(uid)   # se completará sola (solo el marcador)
            else:
                report['conflictos'].append({'uid': uid, 'motivo': f'ya existe training_plans/{LEGACY_PLAN_ID} y no procede de la migración'})
        else:
            report['a_migrar'].append(uid)

    for uid, ps in plans.items():
        if uid not in legacy:
            report['sin_plan_antiguo_con_planes_nuevos'].append(uid)

    summary = {
        'usuarios con plan antiguo': len(legacy),
        'se migrarían': len(report['a_migrar']),
        'ya migrados': len(report['ya_migrados']),
        'migración interrumpida (se completa sola)': len(report['migracion_interrumpida']),
        'CONFLICTOS (requieren revisión manual)': len(report['conflictos']),
        'con cambios hechos con la app antigua tras migrar': len(report['cambios_posteriores_a_la_migracion']),
        'usuarios solo con planes nuevos': len(report['sin_plan_antiguo_con_planes_nuevos']),
        'sesiones históricas (no se tocan)': sum(sessions.values()),
    }
    print('\nINFORME DE MIGRACIÓN DE PLANES (solo lectura)' + (' — EMULADOR' if EMULATOR else ''))
    print('=' * 60)
    for k, v in summary.items():
        print(f'  {k:<55}{v}')
    print('=' * 60)
    for c in report['conflictos']:
        print(f"  Conflicto: {c['uid']}: {c['motivo']}")
    if '--json' in sys.argv:
        out = sys.argv[sys.argv.index('--json') + 1]
        with open(out, 'w') as f:
            json.dump({'resumen': summary, **report}, f, indent=2, ensure_ascii=False)
        print(f'\nDetalle guardado en {out} (contiene identificadores de usuario: no subir al repositorio)')
    print('\nEste informe no ha escrito nada en Firestore.')


if __name__ == '__main__':
    main()
