#!/usr/bin/env python3
# Resume la salida JSON de una suite (stdin) para run-phase0.sh: una línea con el recuento y, en modo `proposal`, una línea por fallo (máx. 12).
# Si no hay JSON (la suite murió), imprime «SIN RESULTADO» con el final de su stderr (variable de entorno ERRF).
import json, os, sys

t = sys.stdin.read()
try:
    d = json.loads(t[t.find('{'):])
    repro = sum(1 for x in d.get('defectosConocidos', []) if x.startswith('REPRODUCIDO'))
    print('  ', d['archivo'], '[', d['modo'], ']', d['resumen'], '| fallos:', len(d['fallos']), '| defectos conocidos reproducidos:', repro)
    for f in (d['fallos'][:12] if d['modo'] == 'proposal' else []):
        print('      FALLO:', f.get('label'), '| esperado:', f.get('policy'), '| obtenido:', f.get('got'), '|',
              f.get('errorInesperado') or f.get('error') or '', '| a los', f.get('atMs'), 'ms')
except Exception:
    try:
        err = open(os.environ.get('ERRF', os.devnull)).read()[-400:]
    except OSError:
        err = ''
    print('  SIN RESULTADO', t[-300:], '| stderr:', err)
