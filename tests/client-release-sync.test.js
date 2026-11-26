// Coherencia de la publicación del cliente de fotos de vía (route-photos.js): las copias de raíz y de www/ deben ser idénticas y las dos subidas de versión
// (CACHE_VERSION del Service Worker y ?v= del <script> en index.html) deben hacerse JUNTAS: ni a medias ni solo en una de las dos carpetas.
// Estado: v306 / ?v=2 y v307 / ?v=3 (publicados); v308 / ?v=3 (push en la web), v309 a v346 / ?v=3 (datos de vía, popup, estilos, historial, croquis, libro de ascensiones y compartir por mensaje): el script de fotos no cambia. Cualquier otra combinación es un error.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const swVersion = f => (read(f).match(/const CACHE_VERSION = '(v\d+)'/) || [])[1];
const scriptV = f => (read(f).match(/<script defer src="\.\/route-photos\.js\?v=(\d+)"><\/script>/) || [])[1];

describe('publicación del cliente de fotos de vía: raíz y www/ sincronizadas', () => {
  it.each(['route-photos.js', 'sw.js', 'index.html'])('%s es idéntico en la raíz y en www/', (f) => {
    expect(read(f)).toBe(read(`www/${f}`));
  });
  it('sw.js precachea route-photos.js', () => {
    expect(read('sw.js')).toMatch(/'\.\/route-photos\.js'/);
  });
  it('la versión del Service Worker y el ?v= del script van juntos (v306 con ?v=2, v307 a v346 con ?v=3)', () => {
    const pair = `${swVersion('sw.js')}|${scriptV('index.html')}`;
    expect(['v306|2', 'v307|3', 'v308|3', 'v309|3', 'v310|3', 'v311|3', 'v312|3', 'v313|3', 'v314|3', 'v315|3', 'v316|3', 'v317|3', 'v318|3', 'v319|3', 'v320|3', 'v321|3', 'v322|3', 'v323|3', 'v324|3', 'v325|3', 'v326|3', 'v327|3', 'v328|3', 'v329|3', 'v330|3', 'v331|3', 'v332|3', 'v333|3', 'v334|3', 'v335|3', 'v336|3', 'v337|3', 'v338|3', 'v339|3', 'v340|3', 'v341|3', 'v342|3', 'v343|3', 'v344|3', 'v345|3', 'v346|3']).toContain(pair);
  });
  it('index.html carga route-photos.js una sola vez', () => {
    expect((read('index.html').match(/route-photos\.js/g) || []).length).toBe(1);
  });
});
