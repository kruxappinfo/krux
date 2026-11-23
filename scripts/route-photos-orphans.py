#!/usr/bin/env python3
# ================== DOCUMENTOS HUÉRFANOS DE FOTOS DE VÍA: INFORME, PLAN, ARCHIVADO Y RESTAURACIÓN ==================
# Un «documento huérfano» es un documento de la colección route-photos de Firestore cuyo archivo de Storage ya no existe (o nunca llegó).
# Diseño y garantías: docs/security-phase0/STORAGE-ORPHANS-PROPOSAL.md. Herramienta LOCAL, con las credenciales de gcloud de un administrador. Solo biblioteca estándar.
#
#   report   (capa 2, SOLO LECTURA)   Clasifica cada documento: seguro / huerfano_probable / huerfano_confirmado / indeterminado. No escribe nada, en ningún sitio.
#   plan     (capa 3, solo local)     Con un informe y una lista de ids elegidos A MANO, prepara un lote «pendiente de aprobación». No escribe nada en Firebase.
#   apply    (capa 3)                 Por defecto SIMULA. Con --approve <hash> y la frase de confirmación, ARCHIVA cada documento (copia íntegra en route-photos-archive) y borra SOLO ese
#                                     documento, con su marca permanente, en una única operación atómica. Nunca toca Storage ni ninguna otra colección.
#   restore  (capa 3)                 Por defecto SIMULA. Con --apply y la frase, recrea el documento tal cual desde route-photos-archive y retira su marca.
#   selftest                          Comprueba, sin red, las protecciones del propio script.
#
# GARANTÍAS (se comprueban en tests/integration/rules/phase0/route-photos-orphans-tool.cjs y tests/route-photos-orphans.test.js):
#   · Nunca se borra ni modifica un archivo de Storage: toda petición a Storage que no sea GET se rechaza antes de enviarla.
#   · Solo se escribe en route-photos (borrar el documento elegido), route-photo-tombstones y route-photos-archive (crear). Cualquier otra ruta se rechaza antes de enviarla.
#     No se lee ni se escribe ninguna colección de trazados, sectores, rutas, ascensos ni usuarios.
#   · Los casos indeterminados y los documentos recientes NUNCA se archivan ni se borran.
#   · Todo lote exige: informe con el id como huerfano_confirmado (dos comprobaciones separadas), hash de aprobación, frase de confirmación, copia previa de la colección y
#     re-verificación de cada documento (sin cambios y archivo todavía ausente) justo antes de tocarlo.
#
# Uso (siempre empieza por report):
#   python3 scripts/route-photos-orphans.py report
#   python3 scripts/route-photos-orphans.py report --previous ~/krux-backups/route-photos-orphans/report-AAAA.json     # ≥10 min después: confirma
#   python3 scripts/route-photos-orphans.py plan --report INFORME.json --ids ids.txt
#   python3 scripts/route-photos-orphans.py apply --batch LOTE.json                                                      # simulación
#   python3 scripts/route-photos-orphans.py apply --batch LOTE.json --approve <hash> --confirm-text "ARCHIVAR N DOCUMENTOS"
#   python3 scripts/route-photos-orphans.py restore --id ID [--apply --confirm-text "RESTAURAR ID"]
# Los informes y copias contienen datos de usuarios (uid, nombres): NO subirlos al repositorio.

import argparse
import copy
import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

TOOL = 'route-photos-orphans'
VERSION = 1
PROJECT_DEFAULT = 'climbmaps-80cae'
COL_PHOTOS, COL_TOMB, COL_ARCHIVE = 'route-photos', 'route-photo-tombstones', 'route-photos-archive'
ID_RE = re.compile(r'^[A-Za-z0-9_-]{1,200}$')
NEW_ID_RE = re.compile(r'^[A-Za-z0-9_-]+_\d+_[a-z0-9]{16}$')
MAX_BATCH = 50
DEFAULT_LIMIT = 5


class Refused(Exception):
    """Operación rechazada por una de las protecciones del script (nunca se llega a enviar)."""


# ---------------------------------------------------------------------------------------------------------------------
# PROTECCIONES: toda petición pasa por Guard.check() ANTES de enviarse
# ---------------------------------------------------------------------------------------------------------------------
def doc_path(name):
    """'projects/P/databases/(default)/documents/col/id' -> (col, id)."""
    m = re.match(r'^projects/[^/]+/databases/\(default\)/documents/([^/]+)/([^/]+)$', name)
    if not m:
        raise Refused(f'ruta de documento no permitida: {name}')
    return m.group(1), m.group(2)


def check_writes(writes, mode):
    """Valida una lista de escrituras de Firestore. mode: 'apply' | 'restore'. Rechaza todo lo que no esté expresamente permitido."""
    allowed = {
        # (colección, operación) -> condición obligatoria
        'apply': {(COL_ARCHIVE, 'create'), (COL_PHOTOS, 'delete'), (COL_TOMB, 'create')},
        'restore': {(COL_PHOTOS, 'create'), (COL_TOMB, 'delete'), (COL_ARCHIVE, 'mark')},
    }
    if mode not in allowed:
        raise Refused(f'modo de escritura desconocido: {mode}')
    if not writes or len(writes) > 3:
        raise Refused('lote de escrituras vacío o demasiado grande')
    seen = set()
    for w in writes:
        kinds = [k for k in ('update', 'delete') if k in w]
        extra = set(w) - {'update', 'delete', 'currentDocument', 'updateMask'}
        if len(kinds) != 1 or extra:
            raise Refused(f'escritura mal formada: {sorted(w)}')
        name = w['update']['name'] if 'update' in w else w['delete']
        col, doc_id = doc_path(name)
        if not ID_RE.match(doc_id):
            raise Refused(f'id no permitido: {doc_id}')
        cur = w.get('currentDocument', {})
        if 'update' in w:
            if cur.get('exists') is False and 'updateMask' not in w:
                op = 'create'
            elif col == COL_ARCHIVE and cur.get('exists') is True and set(w.get('updateMask', {}).get('fieldPaths', [])) <= {'restoredAt', 'restoredBy'} and w.get('updateMask'):
                op = 'mark'
            else:
                raise Refused('toda creación exige la precondición exists:false (no se sobrescribe nada); solo se puede marcar restoredAt/restoredBy en el archivo')
        else:
            op = 'delete'
            if col == COL_PHOTOS and not cur.get('updateTime'):
                raise Refused('el borrado de un documento exige la precondición updateTime (solo si no ha cambiado desde que se leyó)')
            if col == COL_TOMB and cur.get('exists') is not True:
                raise Refused('retirar una marca exige la precondición exists:true')
            if col not in (COL_PHOTOS, COL_TOMB):
                raise Refused(f'no se puede borrar en {col}')
        if (col, op) not in allowed[mode]:
            raise Refused(f'operación no permitida en este modo: {op} en {col}')
        seen.add((col, doc_id, op))
    ids = {d for _, d, _ in seen}
    if len(ids) != 1:
        raise Refused('cada operación atómica debe afectar a un único id de foto')
    # El lote ha de estar COMPLETO: sin una de las piezas se rompería la garantía (p. ej. borrar el documento sin su marca permitiría recrear el id).
    ops = {(c, o) for c, _, o in seen}
    if len(seen) != len(writes):
        raise Refused('operaciones repetidas en el lote')
    if mode == 'apply':
        need = {(COL_ARCHIVE, 'create'), (COL_PHOTOS, 'delete'), (COL_TOMB, 'create')}
        if ops != need:
            raise Refused('el lote de archivado debe ser exactamente: copia en route-photos-archive + borrado del documento + marca permanente')
    else:
        need = {(COL_PHOTOS, 'create'), (COL_ARCHIVE, 'mark')}
        if not need <= ops or ops - need - {(COL_TOMB, 'delete')}:
            raise Refused('el lote de restauración debe recrear el documento y marcar la copia (y, si existe, retirar su marca)')
    return True


class Guard:
    """Única puerta de salida de red del script."""

    def __init__(self, firestore_host, storage_host, project, allow_writes=None):
        self.fs, self.st, self.project = firestore_host.rstrip('/'), storage_host.rstrip('/'), project
        self.allow_writes = allow_writes   # None = solo lectura | 'apply' | 'restore'
        self.sent = []                      # registro de peticiones (para las pruebas)

    def check(self, method, url, body=None):
        is_storage = url.startswith(self.st) and not url.startswith(self.fs)
        if is_storage:
            if method != 'GET':
                raise Refused(f'Storage es solo lectura: {method} rechazado')
            return
        if not url.startswith(self.fs):
            raise Refused(f'destino no permitido: {url[:60]}')
        if method == 'GET':
            col = re.search(r'/documents/([^/?]+)', url)
            if col and col.group(1) not in (COL_PHOTOS, COL_TOMB, COL_ARCHIVE):
                raise Refused(f'colección no permitida para lectura: {col.group(1)}')
            return
        if method == 'POST' and url.split('?')[0].endswith('/documents:commit'):
            if self.allow_writes is None:
                raise Refused('modo de solo lectura: escritura rechazada')
            check_writes((body or {}).get('writes', []), self.allow_writes)
            return
        raise Refused(f'método no permitido: {method} {url[:60]}')


# ---------------------------------------------------------------------------------------------------------------------
# Conexión
# ---------------------------------------------------------------------------------------------------------------------
class Api:
    def __init__(self, args, allow_writes=None):
        self.emulator = bool(args.emulator)
        self.project = args.project
        self.bucket = args.bucket
        if self.emulator:
            self.fs_host, self.st_host = args.firestore_host, args.storage_host
            self.headers = {'Authorization': 'Bearer owner'}
            self.account = 'emulator'
        else:
            self.fs_host, self.st_host = 'https://firestore.googleapis.com', 'https://storage.googleapis.com'
            token = subprocess.run(['gcloud', 'auth', 'print-access-token'], capture_output=True, text=True).stdout.strip()
            if not token:
                sys.exit('No hay sesión de gcloud (gcloud auth login).')
            self.headers = {'Authorization': f'Bearer {token}', 'x-goog-user-project': self.project}
            acc = subprocess.run(['gcloud', 'config', 'get-value', 'account'], capture_output=True, text=True).stdout.strip()
            self.account = acc or 'desconocida'
        self.guard = Guard(self.fs_host, self.st_host, self.project, allow_writes)
        self.base = f'{self.fs_host}/v1/projects/{self.project}/databases/(default)/documents'

    def _req(self, method, url, body=None):
        self.guard.check(method, url, body)
        self.guard.sent.append((method, url.split('?')[0].replace(self.fs_host, 'FS').replace(self.st_host, 'ST')))
        data = json.dumps(body).encode() if body is not None else None
        h = dict(self.headers)
        if data:
            h['Content-Type'] = 'application/json'
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method=method), timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else {})
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, {'error': raw[:200].decode('utf-8', 'replace')}
        except Exception as e:   # red caída: se trata como indeterminado por quien llama
            return 0, {'error': str(e)}

    # --- lecturas
    def list_docs(self, col):
        docs, token = [], None
        while True:
            url = f'{self.base}/{col}?pageSize=300' + (f'&pageToken={urllib.parse.quote(token)}' if token else '')
            st, j = self._req('GET', url)
            if st != 200:
                raise RuntimeError(f'No se pudo listar {col}: HTTP {st} {str(j)[:120]}')
            docs += j.get('documents', [])
            token = j.get('nextPageToken')
            if not token:
                return docs

    def get_doc(self, col, doc_id):
        st, j = self._req('GET', f'{self.base}/{col}/{urllib.parse.quote(doc_id, safe="")}')
        return st, j

    def list_objects(self):
        names, token = set(), None
        while True:
            url = f'{self.st_host}/storage/v1/b/{self.bucket}/o?prefix=route-photos/&maxResults=1000' + (f'&pageToken={urllib.parse.quote(token)}' if token else '')
            st, j = self._req('GET', url)
            if st != 200:
                raise RuntimeError(f'No se pudo listar Storage: HTTP {st} {str(j)[:120]}')
            names |= {i['name'] for i in j.get('items', [])}
            token = j.get('nextPageToken')
            if not token:
                return names

    def object_status(self, path):
        """'existe' | 'ausente' | 'indeterminado' (cualquier otra respuesta)."""
        st, _ = self._req('GET', f'{self.st_host}/storage/v1/b/{self.bucket}/o/{urllib.parse.quote(path, safe="")}')
        return 'existe' if st == 200 else 'ausente' if st == 404 else 'indeterminado'

    # --- escritura atómica (solo desde apply / restore)
    def commit(self, writes):
        st, j = self._req('POST', f'{self.base}:commit', {'writes': writes})
        return st, j


# ---------------------------------------------------------------------------------------------------------------------
# Utilidades de datos
# ---------------------------------------------------------------------------------------------------------------------
def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def iso(dt):
    return dt.strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def parse_ts(s):
    if not s:
        return None
    m = re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?Z$', s)
    if not m:
        return None
    frac = (m.group(2) or '.0')[1:7].ljust(6, '0')
    return datetime.datetime.strptime(m.group(1) + '.' + frac, '%Y-%m-%dT%H:%M:%S.%f').replace(tzinfo=datetime.timezone.utc)


def fval(fields, key):
    v = (fields or {}).get(key)
    if not v:
        return None
    for k in ('stringValue', 'integerValue', 'timestampValue', 'booleanValue'):
        if k in v:
            return v[k]
    return None


def canon_hash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')).hexdigest()


def path_from_url(url):
    """Ruta del objeto contenida en una URL de descarga (sin el token). None si no se puede."""
    m = re.search(r'/o/([^?]+)', url or '')
    return urllib.parse.unquote(m.group(1)) if m else None


def derive(fields):
    """-> (formato, ruta, motivo_si_indeterminado). formato: 'nuevo' | 'antiguo' | None."""
    sp, school, fn, url = fval(fields, 'storagePath'), fval(fields, 'schoolId'), fval(fields, 'filename'), fval(fields, 'photoUrl')
    if sp:
        path, fmt = sp, 'nuevo'
    elif school and fn:
        path, fmt = f'route-photos/{school}/{fn}', 'antiguo'
    else:
        return None, None, 'faltan datos para derivar la ruta del archivo'
    if not path.startswith('route-photos/'):
        return None, None, 'ruta fuera de route-photos/'
    up = path_from_url(url)
    if up is None or up != path:
        return None, None, 'la ruta de photoUrl no coincide con la ruta derivada'
    return fmt, path, None


def out_dir(args):
    d = os.path.expanduser(args.out)
    os.makedirs(d, exist_ok=True)
    return d


def stamp():
    n = now_utc()
    return n.strftime('%Y%m%d-%H%M%S') + f'{n.microsecond // 1000:03d}'   # milisegundos: dos informes seguidos nunca comparten nombre


def write_json(path, obj, overwrite=False):
    """Los informes, lotes y copias NUNCA se sobrescriben (creación exclusiva); solo el estado del lote se actualiza a propósito."""
    with open(path, 'w' if overwrite else 'x', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
    return path


# ---------------------------------------------------------------------------------------------------------------------
# report  (capa 2: SOLO LECTURA)
# ---------------------------------------------------------------------------------------------------------------------
def cmd_report(args):
    api = Api(args)   # allow_writes=None: cualquier escritura se rechaza
    now = now_utc()
    docs = api.list_docs(COL_PHOTOS)
    objects = api.list_objects()
    prev = None
    if args.previous:
        with open(os.path.expanduser(args.previous), encoding='utf-8') as f:
            prev = json.load(f)
        if prev.get('mode') != 'report' or prev.get('project') != args.project:
            sys.exit('--previous no es un informe de este proyecto')
    prev_by_id = {d['id']: d for d in (prev or {}).get('docs', [])}
    prev_at = parse_ts((prev or {}).get('generatedAt'))
    entries, referenced = [], set()
    for d in docs:
        doc_id = d['name'].rsplit('/', 1)[-1]
        fields = d.get('fields', {})
        fmt, path, why = derive(fields)
        ups = parse_ts(fval(fields, 'uploadedAt'))
        age_min = round((now - ups).total_seconds() / 60, 1) if ups else None
        e = {'id': doc_id, 'formato': fmt, 'ruta': path, 'edad_minutos': age_min, 'subidoPor': fval(fields, 'uploadedBy'), 'updateTime': d.get('updateTime')}
        if path:
            referenced.add(path)
        if why:
            e.update(clase='indeterminado', motivo=why)
        elif ups is None or age_min is None or age_min < -5:
            e.update(clase='indeterminado', motivo='uploadedAt ausente o en el futuro')
        else:
            listed = path in objects
            direct = api.object_status(path)
            chk = {'en': iso(now), 'listado': listed, 'consulta_directa': direct}
            e['comprobaciones'] = [chk]
            if direct == 'indeterminado' or (listed and direct == 'ausente'):
                e.update(clase='indeterminado', motivo='respuesta no concluyente de Storage (error, o el listado y la consulta directa se contradicen)')
            elif direct == 'existe':
                e.update(clase='seguro', **({} if listed else {'nota': 'no aparecía en el listado pero la consulta directa lo encuentra'}))
            else:   # ausente en el listado Y en la consulta directa
                need = args.min_age_new_minutes if fmt == 'nuevo' else args.min_age_legacy_hours * 60
                if age_min < need:
                    e.update(clase='indeterminado', motivo=f'documento reciente (< {need:g} min): el archivo aún podría llegar o la cola pendiente limpiarlo')
                else:
                    e.update(clase='huerfano_probable')
        # confirmación con un informe anterior (segunda comprobación separada)
        if e['clase'] == 'huerfano_probable' and prev_at is not None:
            p = prev_by_id.get(doc_id)
            gap = (now - prev_at).total_seconds() / 60
            if p and p.get('clase') in ('huerfano_probable', 'huerfano_confirmado') and p.get('ruta') == path:
                if gap >= args.min_gap_minutes:
                    e['clase'] = 'huerfano_confirmado'
                    e['comprobaciones'] = (p.get('comprobaciones') or [])[-1:] + e['comprobaciones']
                    e['separacion_minutos'] = round(gap, 1)
                else:
                    e['nota'] = f'segunda comprobación demasiado pronto ({gap:.1f} min < {args.min_gap_minutes} min)'
        entries.append(e)
    counts = {c: sum(1 for e in entries if e['clase'] == c) for c in ('seguro', 'huerfano_probable', 'huerfano_confirmado', 'indeterminado')}
    sin_doc = sorted(n for n in objects if n not in referenced)
    report = {'tool': TOOL, 'version': VERSION, 'mode': 'report', 'generatedAt': iso(now), 'project': args.project, 'bucket': args.bucket, 'emulator': api.emulator,
              'params': {'min_age_new_minutes': args.min_age_new_minutes, 'min_age_legacy_hours': args.min_age_legacy_hours, 'min_gap_minutes': args.min_gap_minutes},
              'previous': (prev or {}).get('generatedAt'), 'counts': {'documentos': len(docs), 'archivos': len(objects), **counts, 'archivos_sin_documento': len(sin_doc)},
              'docs': sorted(entries, key=lambda e: e['id']), 'archivos_sin_documento': sin_doc}
    path = write_json(os.path.join(out_dir(args), f'report-{stamp()}.json'), report)
    c = report['counts']
    print(f"Informe (SOLO LECTURA): {c['documentos']} documentos, {c['archivos']} archivos → seguros {c['seguro']} · huérfanos probables {c['huerfano_probable']} · "
          f"huérfanos confirmados {c['huerfano_confirmado']} · indeterminados {c['indeterminado']} · archivos sin documento {c['archivos_sin_documento']} (solo informativo)")
    for e in entries:
        if e['clase'] != 'seguro':
            print(f"  [{e['clase']}] {e['id']} · {e.get('motivo') or e.get('nota') or ''}")
    print(f'Informe guardado en {path}')
    print(f'Peticiones enviadas: {len(api.guard.sent)} (todas GET)')
    return report, path


# ---------------------------------------------------------------------------------------------------------------------
# plan  (capa 3: solo local; elige una persona)
# ---------------------------------------------------------------------------------------------------------------------
def read_ids(path):
    ids = []
    with open(os.path.expanduser(path), encoding='utf-8') as f:
        for line in f:
            t = line.split('#')[0].strip()
            if t:
                ids.append(t)
    return ids


def plan_hash(batch):
    core = {'batchId': batch['batchId'], 'report': batch['report'], 'items': batch['items']}
    return canon_hash(core)[:16]


def cmd_plan(args):
    api = Api(args)   # solo lectura
    rp = os.path.expanduser(args.report)
    with open(rp, encoding='utf-8') as f:
        raw = f.read()
    report = json.loads(raw)
    if report.get('mode') != 'report' or report.get('project') != args.project:
        sys.exit('El informe no es válido para este proyecto')
    by_id = {e['id']: e for e in report['docs']}
    ids = read_ids(args.ids)
    if not ids:
        sys.exit('La lista de ids está vacía')
    if len(ids) > MAX_BATCH or len(set(ids)) != len(ids):
        sys.exit(f'Máximo {MAX_BATCH} ids por lote y sin repetidos')
    bad = [(i, by_id.get(i, {}).get('clase', 'no figura en el informe')) for i in ids if i not in by_id or by_id[i]['clase'] != 'huerfano_confirmado']
    if bad:
        sys.exit('RECHAZADO: solo se pueden planificar documentos «huerfano_confirmado» (dos comprobaciones separadas). No aptos: ' + '; '.join(f'{i} ({c})' for i, c in bad))
    items = []
    for i in ids:
        if not ID_RE.match(i):
            sys.exit(f'id no válido: {i}')
        st, j = api.get_doc(COL_PHOTOS, i)
        if st != 200:
            sys.exit(f'No se pudo leer {i} (HTTP {st}); no se planifica')
        items.append({'id': i, 'ruta': by_id[i]['ruta'], 'updateTime': j.get('updateTime'), 'fieldsSha256': canon_hash(j.get('fields', {})), 'evidencia': by_id[i].get('comprobaciones', [])})
    batch = {'tool': TOOL, 'version': VERSION, 'batchId': stamp(), 'createdAt': iso(now_utc()), 'createdBy': api.account, 'project': args.project, 'emulator': api.emulator,
             'report': {'file': os.path.basename(rp), 'sha256': hashlib.sha256(raw.encode('utf-8')).hexdigest(), 'generatedAt': report['generatedAt']},
             'items': items, 'status': 'pendiente_de_aprobacion'}
    batch['planHash'] = plan_hash(batch)
    path = write_json(os.path.join(out_dir(args), f"batch-{batch['batchId']}.json"), batch)
    print(f"Lote preparado (NO se ha escrito nada en Firebase): {len(items)} documento(s). Lote: {path}")
    print(f"Hash de aprobación: {batch['planHash']}")
    print(f'Para simular: python3 {sys.argv[0]} apply --batch {path}')
    print(f"Para ejecutar (tras revisar): … apply --batch {path} --limit {len(items)} --approve {batch['planHash']} --confirm-text \"ARCHIVAR {len(items)} DOCUMENTOS\"")
    return batch, path


# ---------------------------------------------------------------------------------------------------------------------
# apply  (capa 3: archivar y borrar SOLO el documento, atómico, con aprobación)
# ---------------------------------------------------------------------------------------------------------------------
def ts_field(dt):
    return {'timestampValue': iso(dt)}


def doc_name(api, col, doc_id):
    return f'projects/{api.project}/databases/(default)/documents/{col}/{doc_id}'


def backup(api, d):
    data = {c: [{'name': x['name'], 'fields': x.get('fields', {}), 'createTime': x.get('createTime'), 'updateTime': x.get('updateTime')} for x in api.list_docs(c)] for c in (COL_PHOTOS, COL_TOMB)}
    return write_json(os.path.join(d, f'backup-{stamp()}.json'), {'tool': TOOL, 'at': iso(now_utc()), 'project': api.project, 'collections': data})


def cmd_apply(args):
    with open(os.path.expanduser(args.batch), encoding='utf-8') as f:
        batch = json.load(f)
    if batch.get('status') != 'pendiente_de_aprobacion' or batch.get('project') != args.project or plan_hash(batch) != batch.get('planHash'):
        sys.exit('RECHAZADO: el lote no es válido, está alterado o ya se aplicó')
    n = len(batch['items'])
    limit = args.limit if args.limit is not None else DEFAULT_LIMIT
    if not 1 <= limit <= MAX_BATCH:
        sys.exit(f'--limit debe estar entre 1 y {MAX_BATCH}')
    todo = batch['items'][:limit]
    phrase = f'ARCHIVAR {len(todo)} DOCUMENTOS'
    execute = bool(args.approve)
    if execute:
        if args.approve != batch['planHash']:
            sys.exit('RECHAZADO: el hash de aprobación no coincide con el del lote')
        typed = args.confirm_text
        if typed is None:
            if not sys.stdin.isatty():
                sys.exit(f'RECHAZADO: falta --confirm-text "{phrase}" (no hay terminal interactiva)')
            typed = input(f'Escribe exactamente «{phrase}» para continuar: ')
        if typed != phrase:
            sys.exit(f'RECHAZADO: la frase de confirmación debe ser exactamente «{phrase}»')
    api = Api(args, allow_writes='apply' if execute else None)
    print(f"{'EJECUCIÓN REAL' if execute else 'SIMULACIÓN (no se escribe nada)'}: {len(todo)} de {n} documento(s) del lote {batch['batchId']}")
    # el informe en que se basa no puede haber cambiado
    # (obligatorio: sin el informe original no se puede demostrar que el lote salió de dos comprobaciones; ni siquiera se simula)
    rname = batch['report'].get('file')
    if not rname or rname != os.path.basename(rname):
        sys.exit('RECHAZADO: el lote no identifica correctamente su informe')
    rpath = os.path.join(os.path.dirname(os.path.expanduser(args.batch)), rname)
    if not os.path.isfile(rpath):
        sys.exit(f'RECHAZADO: no se encuentra el informe original del lote ({rname}); debe estar en la misma carpeta que el lote. No se puede comprobar su integridad.')
    with open(rpath, encoding='utf-8') as f:
        if hashlib.sha256(f.read().encode('utf-8')).hexdigest() != batch['report']['sha256']:
            sys.exit('RECHAZADO: el informe del lote ha cambiado desde que se planificó')
    d = out_dir(args)
    if execute:
        print('Copia previa de route-photos y route-photo-tombstones:', backup(api, d))
    results = []
    for it in todo:
        i, res = it['id'], {'id': it['id']}
        st, j = api.get_doc(COL_PHOTOS, i)
        if st == 404:
            res.update(resultado='omitido', motivo='el documento ya no existe')
        elif st != 200:
            res.update(resultado='omitido', motivo=f'no se pudo leer (HTTP {st}): indeterminado')
        elif j.get('updateTime') != it['updateTime'] or canon_hash(j.get('fields', {})) != it['fieldsSha256']:
            res.update(resultado='omitido', motivo='el documento ha cambiado desde que se planificó')
        else:
            fmt, path, why = derive(j.get('fields', {}))
            direct = api.object_status(path) if path else 'indeterminado'
            if why or path != it['ruta']:
                res.update(resultado='omitido', motivo=why or 'la ruta derivada ya no coincide con la del lote')
            elif direct != 'ausente':
                res.update(resultado='omitido', motivo=f'el archivo no está confirmado como ausente ({direct})')
            elif not execute:
                res.update(resultado='simulado', motivo='se archivaría y se borraría solo el documento')
            else:
                when = now_utc()
                archive_fields = {'original': {'mapValue': {'fields': j.get('fields', {})}}, 'archivedAt': ts_field(when), 'archivedBy': {'stringValue': api.account},
                                  'reason': {'stringValue': 'huerfano_confirmado: archivo de Storage ausente'}, 'batchId': {'stringValue': batch['batchId']},
                                  'planHash': {'stringValue': batch['planHash']}, 'tool': {'stringValue': f'{TOOL} v{VERSION}'}, 'ruta': {'stringValue': path},
                                  'evidencia': {'stringValue': json.dumps(it.get('evidencia', []), ensure_ascii=False)}, 'originalUpdateTime': {'stringValue': it['updateTime']}}
                writes = [
                    {'update': {'name': doc_name(api, COL_ARCHIVE, i), 'fields': archive_fields}, 'currentDocument': {'exists': False}},
                    {'delete': doc_name(api, COL_PHOTOS, i), 'currentDocument': {'updateTime': it['updateTime']}},
                    {'update': {'name': doc_name(api, COL_TOMB, i), 'fields': {'deletedBy': {'stringValue': api.account}, 'deletedAt': ts_field(when)}}, 'currentDocument': {'exists': False}},
                ]
                cst, cj = api.commit(writes)   # atómico: o se hace todo o no se hace nada
                if cst != 200:
                    res.update(resultado='omitido', motivo=f'la operación atómica no se aplicó (HTTP {cst}): {str(cj)[:120]}')
                else:
                    ast, aj = api.get_doc(COL_ARCHIVE, i)
                    same = ast == 200 and aj.get('fields', {}).get('original', {}).get('mapValue', {}).get('fields', {}) == j.get('fields', {})
                    gst, _ = api.get_doc(COL_PHOTOS, i)
                    res.update(resultado='archivado' if same and gst == 404 else 'ERROR_VERIFICACION', motivo='copia íntegra en route-photos-archive; documento borrado; marca creada' if same else 'la copia releída no coincide: usar restore')
        results.append(res)
        print(f"  {res['id']}: {res['resultado']} — {res['motivo']}")
    summary = {'tool': TOOL, 'batchId': batch['batchId'], 'executed': execute, 'at': iso(now_utc()), 'by': api.account, 'results': results}
    print('Resultado guardado en', write_json(os.path.join(d, f"apply-{batch['batchId']}{'' if execute else '-simulacion'}.json"), summary))
    if not execute:
        print(f"Para ejecutar de verdad: … --limit {len(todo)} --approve {batch['planHash']} --confirm-text \"{phrase}\"")
    else:
        batch['status'] = 'aplicado'; batch['appliedAt'] = iso(now_utc())   # el hash del lote no incluye el estado
        write_json(os.path.expanduser(args.batch), batch, overwrite=True)
    return summary


# ---------------------------------------------------------------------------------------------------------------------
# restore  (capa 3: deshacer un archivado)
# ---------------------------------------------------------------------------------------------------------------------
def cmd_restore(args):
    if not ID_RE.match(args.id):
        sys.exit('id no válido')
    phrase = f'RESTAURAR {args.id}'
    execute = bool(args.apply)
    if execute and args.confirm_text != phrase:
        sys.exit(f'RECHAZADO: falta --confirm-text "{phrase}"')
    api = Api(args, allow_writes='restore' if execute else None)
    st, a = api.get_doc(COL_ARCHIVE, args.id)
    if st != 200:
        sys.exit(f'No existe copia archivada de {args.id} (HTTP {st})')
    if 'restoredAt' in a.get('fields', {}):
        sys.exit('Ese documento ya se restauró')
    original = a['fields']['original']['mapValue'].get('fields', {})
    if api.get_doc(COL_PHOTOS, args.id)[0] == 200:
        sys.exit('El documento ya existe en route-photos: no se sobrescribe nada')
    tomb_exists = api.get_doc(COL_TOMB, args.id)[0] == 200
    print(f"{'EJECUCIÓN REAL' if execute else 'SIMULACIÓN'}: se recrearía route-photos/{args.id} tal cual" + (' y se retiraría su marca' if tomb_exists else ''))
    if not execute:
        print(f'Para ejecutar: … restore --id {args.id} --apply --confirm-text "{phrase}"')
        return None
    writes = [{'update': {'name': doc_name(api, COL_PHOTOS, args.id), 'fields': original}, 'currentDocument': {'exists': False}}]
    if tomb_exists:
        writes.append({'delete': doc_name(api, COL_TOMB, args.id), 'currentDocument': {'exists': True}})
    writes.append({'update': {'name': doc_name(api, COL_ARCHIVE, args.id), 'fields': {'restoredAt': ts_field(now_utc()), 'restoredBy': {'stringValue': api.account}}},
                   'updateMask': {'fieldPaths': ['restoredAt', 'restoredBy']}, 'currentDocument': {'exists': True}})
    cst, cj = api.commit(writes)
    if cst != 200:
        sys.exit(f'No se pudo restaurar (HTTP {cst}): {str(cj)[:200]}')
    print('Restaurado. La copia en route-photos-archive se conserva (marcada como restaurada).')


# ---------------------------------------------------------------------------------------------------------------------
# selftest (sin red)
# ---------------------------------------------------------------------------------------------------------------------
def cmd_selftest(_args):
    P = 'projects/p/databases/(default)/documents'
    def must_refuse(fn, why):
        try:
            fn()
        except Refused:
            return
        raise AssertionError(f'NO se rechazó: {why}')
    g = Guard('http://fs', 'http://st', 'p')
    for m in ('POST', 'PUT', 'DELETE', 'PATCH'):
        must_refuse(lambda m=m: g.check(m, 'http://st/storage/v1/b/b/o/x'), f'{m} a Storage')
    must_refuse(lambda: g.check('POST', 'http://fs/v1/projects/p/databases/(default)/documents:commit', {'writes': [{'delete': f'{P}/route-photos/a', 'currentDocument': {'updateTime': 't'}}]}), 'escritura en modo solo lectura')
    must_refuse(lambda: g.check('GET', 'http://fs/v1/projects/p/databases/(default)/documents/sector_route_drawings?pageSize=1'), 'lectura de otra colección')
    must_refuse(lambda: g.check('GET', 'http://otro/x'), 'destino ajeno')
    ok_apply = [{'update': {'name': f'{P}/route-photos-archive/a', 'fields': {}}, 'currentDocument': {'exists': False}},
                {'delete': f'{P}/route-photos/a', 'currentDocument': {'updateTime': 't'}},
                {'update': {'name': f'{P}/route-photo-tombstones/a', 'fields': {}}, 'currentDocument': {'exists': False}}]
    assert check_writes(ok_apply, 'apply')
    for coll in ('sector_route_drawings', 'sector_images', 'users', 'pending_routes', 'ascents'):
        must_refuse(lambda c=coll: check_writes([{'delete': f'{P}/{c}/a', 'currentDocument': {'updateTime': 't'}}], 'apply'), f'borrar en {coll}')
        must_refuse(lambda c=coll: check_writes([{'update': {'name': f'{P}/{c}/a', 'fields': {}}, 'currentDocument': {'exists': False}}], 'apply'), f'crear en {coll}')
    must_refuse(lambda: check_writes([{'delete': f'{P}/route-photos/a'}], 'apply'), 'borrar sin precondición updateTime')
    must_refuse(lambda: check_writes([{'update': {'name': f'{P}/route-photos-archive/a', 'fields': {}}}], 'apply'), 'crear sin exists:false (sobrescribir)')
    must_refuse(lambda: check_writes([{'delete': f'{P}/route-photo-tombstones/a', 'currentDocument': {'exists': True}}], 'apply'), 'retirar una marca en apply')
    must_refuse(lambda: check_writes([{'delete': f'{P}/route-photos-archive/a', 'currentDocument': {'exists': True}}], 'restore'), 'borrar el archivo')
    must_refuse(lambda: check_writes([{'delete': f'{P}/route-photos/a', 'currentDocument': {'updateTime': 't'}}, {'delete': f'{P}/route-photos/b', 'currentDocument': {'updateTime': 't'}}], 'apply'), 'dos ids en una operación')
    must_refuse(lambda: check_writes([{'delete': f'{P}/route-photos/../x', 'currentDocument': {'updateTime': 't'}}], 'apply'), 'id con ..')
    must_refuse(lambda: check_writes([{'delete': f'{P}/route-photos/a/sub/b', 'currentDocument': {'updateTime': 't'}}], 'apply'), 'subcolecciones')
    # El lote ha de estar COMPLETO (archivo + borrado + marca): cualquier pieza que falte, sobre o se repita se rechaza
    arch, dele, tomb = ok_apply
    for label, partial in (('sin la copia archivada', [dele, tomb]), ('sin la marca permanente', [arch, dele]), ('sin el borrado del documento', [arch, tomb]),
                           ('solo el borrado', [dele]), ('con el borrado repetido', [arch, dele, dele, tomb]), ('con una escritura extra', [arch, dele, tomb, tomb])):
        must_refuse(lambda w=partial: check_writes(w, 'apply'), f'lote de archivado {label}')
    other = {'delete': f'{P}/route-photos/b', 'currentDocument': {'updateTime': 't'}}
    must_refuse(lambda: check_writes([arch, other, tomb], 'apply'), 'lote de archivado con ids distintos')
    ok_restore = [{'update': {'name': f'{P}/route-photos/a', 'fields': {}}, 'currentDocument': {'exists': False}},
                  {'delete': f'{P}/route-photo-tombstones/a', 'currentDocument': {'exists': True}},
                  {'update': {'name': f'{P}/route-photos-archive/a', 'fields': {}}, 'updateMask': {'fieldPaths': ['restoredAt', 'restoredBy']}, 'currentDocument': {'exists': True}}]
    assert check_writes(ok_restore, 'restore') and check_writes([ok_restore[0], ok_restore[2]], 'restore')   # la marca puede no existir
    for label, partial in (('sin recrear el documento', ok_restore[1:]), ('sin marcar la copia', ok_restore[:2]), ('solo la retirada de la marca', ok_restore[1:2]),
                           ('con una operación de archivado', [*ok_restore, arch])):
        must_refuse(lambda w=partial: check_writes(w, 'restore'), f'lote de restauración {label}')
    gw = Guard('http://fs', 'http://st', 'p', allow_writes='apply')
    gw.check('POST', 'http://fs/v1/projects/p/databases/(default)/documents:commit', {'writes': ok_apply})
    must_refuse(lambda: gw.check('DELETE', 'http://st/storage/v1/b/b/o/x'), 'DELETE a Storage incluso con escritura de Firestore permitida')
    must_refuse(lambda: gw.check('POST', 'http://fs/v1/projects/p/databases/(default)/documents/route-photos', {'writes': ok_apply}), 'POST que no es commit')
    # clasificación
    f = {'storagePath': {'stringValue': 'route-photos/s/u/x.jpg'}, 'photoUrl': {'stringValue': 'https://h/v0/b/b/o/route-photos%2Fs%2Fu%2Fx.jpg?alt=media'}}
    assert derive(f) == ('nuevo', 'route-photos/s/u/x.jpg', None)
    assert derive({'schoolId': {'stringValue': 's'}, 'filename': {'stringValue': 'f.jpeg'}, 'photoUrl': {'stringValue': 'https://h/o/route-photos%2Fs%2Ff.jpeg?alt=media&token=t'}}) == ('antiguo', 'route-photos/s/f.jpeg', None)
    assert derive({'storagePath': {'stringValue': 'route-photos/s/u/x.jpg'}, 'photoUrl': {'stringValue': 'https://h/o/route-photos%2Fotra.jpg'}})[2]
    assert derive({})[2] and derive({'storagePath': {'stringValue': 'sector-images/x.jpg'}})[2]
    assert parse_ts('2026-11-15T09:50:30.524123456Z').microsecond == 524123
    print('selftest OK: protecciones y clasificación correctas')


def main():
    ap = argparse.ArgumentParser(description='Documentos huérfanos de fotos de vía (ver cabecera del script).')
    ap.add_argument('--project', default=PROJECT_DEFAULT)
    ap.add_argument('--bucket', default=None, help='por defecto {proyecto}.firebasestorage.app')
    ap.add_argument('--out', default='~/krux-backups/route-photos-orphans', help='carpeta de informes, lotes y copias (fuera del repositorio)')
    ap.add_argument('--emulator', action='store_true', help='usar los emuladores locales (pruebas)')
    ap.add_argument('--firestore-host', default='http://127.0.0.1:8190')
    ap.add_argument('--storage-host', default='http://127.0.0.1:9199')
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('report'); r.add_argument('--previous'); r.add_argument('--min-age-new-minutes', type=float, default=10); r.add_argument('--min-age-legacy-hours', type=float, default=24); r.add_argument('--min-gap-minutes', type=float, default=10)
    p = sub.add_parser('plan'); p.add_argument('--report', required=True); p.add_argument('--ids', required=True)
    a = sub.add_parser('apply'); a.add_argument('--batch', required=True); a.add_argument('--approve'); a.add_argument('--confirm-text'); a.add_argument('--limit', type=int)
    s = sub.add_parser('restore'); s.add_argument('--id', required=True); s.add_argument('--apply', action='store_true'); s.add_argument('--confirm-text')
    sub.add_parser('selftest')
    args = ap.parse_args()
    if args.bucket is None:
        args.bucket = 'demo-krux-phase0.appspot.com' if args.emulator else f'{args.project}.firebasestorage.app'
    if args.emulator and args.project == PROJECT_DEFAULT:
        args.project = 'demo-krux-phase0'
    try:
        {'report': cmd_report, 'plan': cmd_plan, 'apply': cmd_apply, 'restore': cmd_restore, 'selftest': cmd_selftest}[args.cmd](args)
    except Refused as e:
        sys.exit(f'RECHAZADO por una protección del script: {e}')
    except RuntimeError as e:
        sys.exit(f'ERROR (no se ha clasificado ni tocado nada): {e}')


if __name__ == '__main__':
    main()
