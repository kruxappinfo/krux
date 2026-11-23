// Servidor LOCAL que imita lo mínimo de la API de Reglas de Firebase (firebaserules.googleapis.com v1) que usa scripts/rules-rollback-rehearsal.sh.
// Es estricto con la forma de las peticiones según el documento de descubrimiento de la API (UpdateReleaseRequest: release + updateMask opcional; Release: name + rulesetName),
// pero NO demuestra el comportamiento de la API real: eso solo lo hace el ensayo en un proyecto de pruebas (ver STORAGE-DEPLOY.md §6.1).
const http = require('node:http');
const crypto = require('node:crypto');

function start() {
  const rulesets = new Map(), releases = new Map(), log = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      log.push(`${req.method} ${req.url}`);
      if (!/^Bearer .+/.test(req.headers.authorization || '')) return send(401, { error: 'sin credenciales' });
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch (_) { return send(400, { error: 'JSON no válido' }); }
      const m = req.url.match(/^\/v1\/projects\/([^/]+)\/(rulesets|releases)(?:\/(.+))?$/);
      if (!m) return send(404, { error: 'ruta' });
      const [, proj, kind, rest] = m;
      if (kind === 'rulesets') {
        if (req.method === 'POST' && !rest) {
          const f = body.source && body.source.files;
          if (!Array.isArray(f) || f.length !== 1 || typeof f[0].content !== 'string' || typeof f[0].name !== 'string') return send(400, { error: 'source.files' });
          const id = crypto.randomUUID();
          const rs = { name: `projects/${proj}/rulesets/${id}`, source: { files: [{ name: f[0].name, content: f[0].content }] }, createTime: new Date().toISOString() };
          rulesets.set(rs.name, rs); return send(200, rs);
        }
        if (req.method === 'GET' && rest) { const rs = rulesets.get(`projects/${proj}/rulesets/${rest}`); return rs ? send(200, rs) : send(404, { error: 'ruleset' }); }
        if (req.method === 'DELETE' && rest) {   // como la API real: un ruleset en uso por un release no se puede borrar
          const name = `projects/${proj}/rulesets/${rest}`;
          if (!rulesets.has(name)) return send(404, { error: 'ruleset' });
          if ([...releases.values()].some(r => r.rulesetName === name)) return send(400, { error: 'ruleset en uso por un release' });
          rulesets.delete(name); return send(200, {});
        }
        return send(405, { error: 'método' });
      }
      const mustExist = n => rulesets.has(n);
      if (req.method === 'POST' && !rest) {
        if (!body.name || !body.rulesetName || Object.keys(body).some(k => !['name', 'rulesetName'].includes(k))) return send(400, { error: 'Release' });
        if (!mustExist(body.rulesetName)) return send(400, { error: 'el ruleset no existe' });
        if (releases.has(body.name)) return send(409, { error: 'ya existe' });
        const r = { name: body.name, rulesetName: body.rulesetName, updateTime: new Date().toISOString() }; releases.set(r.name, r); return send(200, r);
      }
      const name = `projects/${proj}/releases/${rest}`;
      if (req.method === 'GET' && rest) { const r = releases.get(name); return r ? send(200, r) : send(404, { error: 'release' }); }
      if (req.method === 'DELETE' && rest) { return releases.delete(name) ? send(200, {}) : send(404, { error: 'release' }); }
      if (req.method === 'PATCH' && rest) {
        if (!releases.has(name)) return send(404, { error: 'release' });
        const rel = body.release;
        if (!rel || Object.keys(body).some(k => !['release', 'updateMask'].includes(k)) || rel.name !== name || !rel.rulesetName) return send(400, { error: 'UpdateReleaseRequest' });
        if (!mustExist(rel.rulesetName)) return send(400, { error: 'el ruleset no existe' });
        const r = { name, rulesetName: rel.rulesetName, updateTime: new Date().toISOString() }; releases.set(name, r); return send(200, r);
      }
      return send(405, { error: 'método' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, log, releases, rulesets, close: () => new Promise(r => server.close(r)) })));
}
module.exports = { start };
