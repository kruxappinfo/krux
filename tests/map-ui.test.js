// Componentes compartidos de las fichas del mapa (map-ui.js): constructores HTML y
// decisión de altura de las hojas inferiores. Se carga el archivo tal cual en un contexto aislado.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../map-ui.js', import.meta.url), 'utf8');
// Colores originales de grado (extracto de getGradeColor) para comprobar que no se alteran
const GRADE_COLORS = { '5a': '#D9F99D', '6a': '#FEF08A', '6b': '#FDE047', '7a': '#F87171' };

function load() {
  const ctx = vm.createContext({
    console,
    getGradeColor: g => GRADE_COLORS[g] || '#000000',
    sortGrades: gs => [...gs].sort()
  });
  vm.runInContext(SRC, ctx, { filename: 'map-ui.js' });
  return name => vm.runInContext(name, ctx);
}
const get = load();

describe('constructores de las fichas', () => {
  it('escapan el texto (nombres de vías y sectores vienen de datos de usuarios)', () => {
    const html = get('kxHeaderHTML')({ title: '<img src=x onerror=alert(1)>', titleId: 'a"b' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('id="a&quot;b"');
  });

  it('la cabecera conserva el id que rellena la lógica existente y trae botón de cierre', () => {
    const html = get('kxHeaderHTML')({ title: 'Hoz', titleId: 'bs-school-name', upper: true });
    expect(html).toContain('id="bs-school-name"');
    expect(html).toContain('is-upper');
    expect(html).toMatch(/<button type="button" class="kx-close" data-kx-close aria-label="Cerrar">/);
    expect(get('kxHeaderHTML')({ title: 'x', close: false })).not.toContain('kx-close');
  });

  it('un dato técnico ausente es un botón atenuado; uno presente no es pulsable', () => {
    const missing = get('kxStatTileHTML')({ icon: 'link', label: 'Express', missing: true, attrs: { onclick: "f(1,'v','express')" } });
    expect(missing).toMatch(/^<button class="kx-stat is-missing" type="button"/);
    expect(missing).toContain('onclick="f(1,&#39;v&#39;,&#39;express&#39;)"');
    const present = get('kxStatTileHTML')({ icon: 'link', value: '9', label: 'Express' });
    expect(present).toMatch(/^<div class="kx-stat"/);
    expect(present).toContain('>9<');
  });

  it('las acciones muestran el contador solo cuando lo hay (0 incluido)', () => {
    const t = get('kxActionTileHTML');
    expect(t({ icon: 'messageCircle', label: 'Comentarios' })).not.toContain('kx-act-badge');
    expect(t({ icon: 'messageCircle', label: 'Comentarios', badge: 3 })).toContain('<span class="kx-act-badge">3</span>');
    expect(t({ icon: 'check', label: 'Ascenso', primary: true })).toContain('kx-act is-primary');
  });

  it('los iconos son SVG de trazo; un nombre desconocido no genera nada', () => {
    expect(get('kxIcon')('x')).toMatch(/^<svg class="kx-ic" [^>]*stroke="currentColor"[^>]*aria-hidden="true"/);
    expect(get('kxIcon')('no-existe')).toBe('');
  });

  it('atributos false/null se omiten y true queda como atributo booleano', () => {
    expect(get('kxAttrs')({ id: 'a', hidden: true, disabled: false, title: null })).toBe(' id="a" hidden');
  });
});

describe('gráficos por grado', () => {
  it('el gráfico usa exactamente el color original de cada grado', () => {
    const html = get('kxGradeChartHTML')(get('kxGradeStats')({ '6a': 10, '5a': 2, '7a': 5 }));
    for (const g of ['5a', '6a', '7a']) expect(html).toContain(`--c:${GRADE_COLORS[g]}`);
    expect(html.indexOf('data-grade="5a"')).toBeLessThan(html.indexOf('data-grade="6a"'));
  });

  it('sin vías muestra estado vacío, no un gráfico vacío ni datos inventados', () => {
    for (const data of [{}, null, { '6a': 0 }]) {
      const html = get('kxGradeChartHTML')(get('kxGradeStats')(data));
      expect(html).toContain('kx-state-empty');
      expect(html).not.toContain('kx-gbar');
    }
  });

  it('carga y error del gráfico con la misma cabecera; el error permite reintentar', () => {
    expect(get('kxGradeChartStateHTML')('loading')).toMatch(/aria-busy="true"[\s\S]*Cargando…[\s\S]*kx-skel-bars/);
    expect(get('kxGradeChartStateHTML')('error')).toMatch(/kx-state-error[\s\S]*data-kx-retry/);
  });

  it('error con reintento opcional', () => {
    expect(get('kxErrorHTML')({})).not.toContain('kx-state-retry');
    expect(get('kxErrorHTML')({ retryAttrs: { 'data-retry': 'stats' } })).toContain('data-retry="stats"');
  });
});

describe('hojas inferiores: altura al soltar', () => {
  const snap = args => get('kxResolveSheetSnap')(args);
  const H = 776, summaryY = 350;

  it('soltar cerca de cada posición la mantiene', () => {
    expect(snap({ y: 20, vy: 0, H, summaryY })).toBe('expanded');
    expect(snap({ y: 330, vy: 0, H, summaryY })).toBe('summary');
  });

  it('un gesto rápido hacia arriba desde el resumen expande; hacia abajo desde arriba vuelve al resumen', () => {
    expect(snap({ y: 300, vy: -0.8, H, summaryY })).toBe('expanded');
    expect(snap({ y: 60, vy: 0.7, H, summaryY })).toBe('summary');
  });

  it('bajar del resumen lo suficiente (o con fuerza) cierra', () => {
    expect(snap({ y: summaryY + 130, vy: 0, H, summaryY })).toBe('closed');
    expect(snap({ y: summaryY + 30, vy: 1.2, H, summaryY })).toBe('closed');
    expect(snap({ y: summaryY + 30, vy: 0.1, H, summaryY })).toBe('summary');
  });

  it('una hoja de una sola altura vuelve o se cierra', () => {
    expect(snap({ y: 40, vy: 0, H: 640, summaryY: null })).toBe('expanded');
    expect(snap({ y: 150, vy: 0, H: 640, summaryY: null })).toBe('closed');
    expect(snap({ y: 40, vy: 1.1, H: 640, summaryY: null })).toBe('closed');
  });

  it('el resumen muestra hasta el elemento de referencia más el pie, dentro de límites', () => {
    const peek = get('kxSummaryPeek');
    expect(peek({ peekBottom: 300, footH: 80, vh: 844 })).toBe(392);
    expect(peek({ peekBottom: 40, footH: 0, vh: 844 })).toBe(220);              // mínimo
    expect(peek({ peekBottom: 900, footH: 80, vh: 844 })).toBe(Math.round(844 * 0.62)); // máximo
  });
});

describe('controles compartidos (Fase 2)', () => {
  it('el segmentado marca solo la opción elegida y escapa etiquetas', () => {
    const html = get('kxSegmentedHTML')({
      label: 'Periodo',
      value: 'mes',
      items: [{ value: 'semana', label: 'Semana' }, { value: 'mes', label: 'Mes', count: 12 }, { value: 'x', label: '<b>' }]
    });
    expect(html).toContain('role="group" aria-label="Periodo"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-value="mes" aria-pressed="true">Mes<span class="kx-seg-count">12<\/span>/);
    expect(html).not.toContain('<b>');
  });

  it('el campo enlaza etiqueta, ayuda y error con el control', () => {
    const html = get('kxFieldHTML')({ id: 'f-name', label: 'Nombre', help: 'Como aparece en la reseña', error: 'Obligatorio', optional: true });
    expect(html).toContain('<label class="kx-label" for="f-name">Nombre <span class="kx-label-optional">(opcional)</span></label>');
    expect(html).toContain('aria-describedby="f-name-help f-name-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<p class="kx-field-error" id="f-name-error">/);
  });

  it('sin error, el aviso queda oculto y el control no se marca inválido', () => {
    const html = get('kxFieldHTML')({ id: 'f2', label: 'Notas', type: 'textarea', value: '<script>' });
    expect(html).toContain('kx-field--area');
    expect(html).not.toContain('aria-invalid');
    expect(html).toMatch(/id="f2-error" hidden/);
    expect(html).not.toContain('<script>');
  });

  it('el desplegable selecciona el valor actual', () => {
    const html = get('kxFieldHTML')({ id: 's', label: 'Grado', type: 'select', value: '6a+', options: [{ value: '6a', label: '6a' }, { value: '6a+', label: '6a+' }] });
    expect(html).toContain('kx-field--select');
    expect(html).toContain('<option value="6a+" selected>');
    expect(html).not.toContain('<option value="6a" selected>');
  });

  it('los estados de acción se anuncian y llevan su icono', () => {
    const status = get('kxStatusHTML');
    expect(status({ state: 'pending', text: 'Guardando' })).toMatch(/kx-status-pending" role="status"><span>Guardando/);
    expect(status({ state: 'done', text: 'Guardado' })).toContain('<path d="M20 6 9 17l-5-5"/>');
    expect(status({ state: 'error', text: 'Falló' })).toContain('kx-status-error');
  });
});

describe('botón único', () => {
  const btn = (o) => get('kxButtonHTML')(o);
  it('usa .kx-btn con variante de color y tamaño', () => {
    expect(btn({ label: 'Ir', variant: 'secondary', size: 'lg' })).toMatch(/class="kx-btn kx-btn--secondary kx-btn--lg"/);
    expect(btn({ label: 'Ir' })).toMatch(/class="kx-btn kx-btn--primary"/);
    expect(btn({ label: 'Ir', variant: 'ghost' })).toMatch(/kx-btn--tertiary/);
    expect(btn({ label: 'Ir', icon: 'pen', size: 'sm' })).toMatch(/kx-btn--sm.*width="16"/);
  });
});

describe('segmentado, campos y popup (Fase 2, segundo bloque)', () => {
  it('el segmentado deshabilita opciones sueltas o el grupo entero', () => {
    const one = get('kxSegmentedHTML')({ value: 'a', items: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B', disabled: true }] });
    expect(one).toMatch(/data-value="b" aria-pressed="false" disabled>/);
    expect(one).not.toMatch(/data-value="a"[^>]*disabled/);
    const all = get('kxSegmentedHTML')({ value: 'a', disabled: true, items: [{ value: 'a', label: 'A' }] });
    expect(all).toContain('aria-disabled="true"');
    expect(all).toMatch(/data-value="a" aria-pressed="true" disabled>/);
  });

  it('el campo admite deshabilitado y obligatorio sin perder la etiqueta', () => {
    const html = get('kxFieldHTML')({ id: 'g', label: 'Grado', disabled: true, required: true });
    expect(html).toMatch(/<input class="kx-field" type="text" id="g" required disabled/);
    expect(html).toContain('<label class="kx-label" for="g">Grado</label>');
  });

  it('el popup tiene cabecera con cierre, contenido y acciones, y se etiqueta con su título', () => {
    const html = get('kxPopoverHTML')({
      size: 'lg',
      header: { title: 'Rocas <Rojas>', titleId: 'p-title' },
      body: '<p>Contenido</p>',
      actions: get('kxButtonHTML')({ label: 'Ver sector', size: 'lg' })
    });
    expect(html).toMatch(/^<div class="kx-pop kx-pop--lg" role="dialog" tabindex="-1" aria-labelledby="p-title">/);
    expect(html).toContain('<div class="kx-pop-head"><header class="kx-fhead">');
    expect(html).toContain('data-kx-close aria-label="Cerrar"');
    expect(html).toContain('<div class="kx-pop-body"><p>Contenido</p></div>');
    expect(html).toContain('<div class="kx-pop-foot"><button type="button" class="kx-btn kx-btn--primary kx-btn--lg">');
    expect(html).toContain('Rocas &lt;Rojas&gt;');
  });

  it('sin acciones no se pinta un pie vacío; el tamaño medio no lleva modificador', () => {
    const html = get('kxPopoverHTML')({ header: { title: 'X' }, body: 'y' });
    expect(html).not.toContain('kx-pop-foot');
    expect(html).toMatch(/^<div class="kx-pop" role="dialog"/);
  });
});

describe('etiquetas, filas, datos, acciones y estados (Fase 2, tercer bloque)', () => {
  it('la etiqueta existente no cambia de marcado y admite relleno de énfasis', () => {
    const tag = get('kxTagHTML');
    expect(tag({ icon: 'mountain', textId: 'bs-rock-type', text: 'Caliza' }))
      .toMatch(/^<span class="kx-tag kx-tone-neutral"><svg class="kx-ic"[^>]*>.*<\/svg><span id="bs-rock-type">Caliza<\/span><\/span>$/);
    expect(tag({ text: 'Prohibido', tone: 'danger', solid: true })).toContain('class="kx-tag kx-tone-danger kx-tag--solid"');
  });

  it('la fila pulsable es un botón con flecha; la normal sigue siendo un div', () => {
    const row = get('kxInfoRowHTML');
    expect(row({ label: 'Fotos', value: '6', action: true })).toMatch(/^<button class="kx-irow kx-tone-neutral kx-irow--action" type="button"[\s\S]*kx-irow-chev[\s\S]*<\/button>$/);
    expect(row({ label: 'Exposición', value: 'Sol' })).toMatch(/^<div class="kx-irow kx-tone-neutral">[\s\S]*<\/div>$/);
    expect(row({ label: 'Exposición', value: 'Sol' })).not.toContain('kx-irow-chev');
  });

  it('el dato técnico distingue ausente, pulsable y normal', () => {
    const stat = get('kxStatTileHTML');
    expect(stat({ value: '11', label: 'Express' })).toMatch(/^<div class="kx-stat">/);
    expect(stat({ label: 'Metros', missing: true })).toMatch(/^<button class="kx-stat is-missing" type="button">[\s\S]*Añadir/);
    expect(stat({ value: '25 m', label: 'Metros', action: true })).toMatch(/^<button class="kx-stat is-action" type="button">/);
  });

  it('las acciones se marcan, se deshabilitan y se ocupan con atributos accesibles', () => {
    const act = get('kxActionTileHTML');
    expect(act({ icon: 'bookmark', label: 'Proyecto', active: true })).toContain('aria-pressed="true"');
    expect(act({ icon: 'bookmark', label: 'Proyecto', disabled: true })).toMatch(/ disabled>/);
    const busy = act({ icon: 'check', label: 'Ascenso', busy: true });
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('Ascenso');            // conserva su etiqueta
    expect(get('kxListActionHTML')({ icon: 'pen', label: 'Editar', disabled: true })).toContain(' disabled');
  });

  it('el vacío y el aviso de sesión ofrecen una salida cuando se les da', () => {
    expect(get('kxEmptyHTML')({ text: 'Sin fotos', action: { label: 'Añadir', attrs: { id: 'x' } } })).toMatch(/kx-btn kx-btn--secondary kx-btn--sm" id="x"/);
    expect(get('kxEmptyHTML')({ text: 'Sin fotos' })).not.toContain('kx-btn');
    expect(get('kxSignInNoticeHTML')({ action: { label: 'Iniciar sesión' } })).toMatch(/kx-btn kx-btn--tertiary kx-btn--sm/);
    expect(get('kxSkeletonHTML')('rows').match(/<div><span><\/span><span><\/span><\/div>/g)).toHaveLength(3);
  });
});
