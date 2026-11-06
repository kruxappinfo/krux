# Auditoría del sistema visual de KRUX

Fecha: 5 nov 2026 · Estado: Fase 0 (tokens) aplicada, sin cambios visibles · Referencia viva: [`index.html`](index.html)

## 1. Tokens

| Familia | Dónde | Estado |
|---|---|---|
| `--kx-*` | `app_2.css` (bloque «Marca KRUX») | Sistema vigente. 826 usos. Se ha ampliado en la Fase 0 |
| `--bg-*`, `--accent-*`, `--shadow-*`, `--radius-*`, `--transition-*` | `app_2.css`, primer `:root` | Legado índigo. `--bg-primary` y `--text-primary` ya se redefinen a la marca |
| `--tr-*`, `--xb` | Entrena | Cinco valores casi idénticos a la marca pero no iguales (ver §5) |
| `--gym-color` (`#534AB7`) | Rocódromos | Identidad propia de gimnasios; decisión pendiente |

Valores escritos a mano: unos 2.000 usos de color (320 tonos), 214 sombras distintas, 12 radios frecuentes, 45 tamaños de letra, 114 degradados.

## 2. Colores escritos a mano, por función

| Función | Usos | Tonos | Criterio |
|---|---|---|---|
| Neutros (blanco y grises) | 1.068 | 103 | Escala fría tipo Tailwind (`#9ca3af`, `#6b7280`, `#f3f4f6`, `#e5e7eb`…) frente a la marca cálida. Candidatos a migrar por sección, con comparación visual |
| Texto oscuro frío (`#374151`, `#111827`, `#1f2937`, `#1a1a2e`) | ~175 | 8 | Igual que arriba; se migran con el texto |
| Verdes de estado (`#10b981` ×51, `#059669`, `#22c55e`) | 150 | 39 | Equivalen a `--kx-success` pero no son iguales. Revisar uno a uno |
| Rojos de estado (`#ef4444`, `#dc2626`) | 101 | 27 | Equivalen a `--kx-danger` |
| Ámbar (`#f59e0b`, `#d97706`…) | 104 | 43 | Equivalen a `--kx-warning` |
| **Grados** | 16 + tabla JS | — | **No tocar.** Fuente única: `getGradeColor` |
| Marca | 62 | 16 | Ya correcta |
| Índigo/violeta (legado) | 125 | 16 | Ver §3 |
| Herramientas técnicas (`route-drawing.css`: 183 usos, 40 tonos) | — | — | Funcionales (colores de trazado y selección). Fuera de la migración automática |

## 3. Índigo/violeta visible hoy (escaneo del DOM renderizado, 390 px)

Las secciones principales (Social, Entrena, Actividad, Perfil, mapa y fichas) **no muestran índigo** en su estado normal. Sigue visible en:

- Perfil: fondo degradado violeta del avatar cuando la foto falla (aparece como la píldora «Profile»).
- Editar perfil: botón de envío con degradado.
- Spotter: cabecera de introducción con degradado.
- Administración: cabecera con degradado y spinner.
- Entrena: cabecera de la sesión (`session-hero`).
- Rocódromos: botón GPS del selector (color propio `#534AB7`).
- Toasts informativos (`--kx-toast-accent: #5B6BE6`).

Reglas legado ocultas (hoy sin efecto visible o solo en estados poco frecuentes): `.ml-popup-header`, `.chat-modal-header`, `.chat-message.sent`, `.btn-primary`, `.pwa-install-banner`, `.secbs-view-btn`, `.ml-sector-view-btn`, `.profile-btn.primary`, entre otras. Las revisará cada fase de su sección.

## 4. Variables sin definir

`--border-light` (10 usos) y `--bg-tertiary` (10 usos) pertenecen a estilos antiguos de Actividad y hoy no se aplican. También `--text-success`, `--primary-color` y `--accent-color` (1 uso cada una). Se resolverán al llegar a Actividad y Perfil.

## 5. Casi duplicados de Entrena (para unificar a la vista, en su fase)

| `--tr-*` | Valor | Marca equivalente |
|---|---|---|
| `--tr-fill` | `#F0F1EC` | `--kx-stone-card #F3F4F1` |
| `--tr-ink-2` | `#4E5954` | `--kx-ink-2 #44504A` |
| `--tr-ink-3` | `#67716C` | `--kx-ink-3 #5A665F` |
| `--tr-line` | `rgba(32,43,39,.08)` | `--kx-line rgba(32,41,35,.09)` |
| `--tr-amber-ink` | `#85570A` | `--kx-warning #9A6412` |

Ya alineados en la Fase 0 (valores idénticos): `--tr-surface`, `--tr-red`, `--tr-ease`.

## 6. Iconografía

- Cuatro estilos mezclados: SVG de trazo (siete grosores, el 80 % a 2), PNG de color (`placa`, `mosq`, `cuerda`, `permitido`, `prohibido`, `sol`, `sombra`, `sol tarde`), PNG del tiempo (`icons/weather/*`) y emojis.
- Emojis como iconos de interfaz: unos 180, sobre todo en `dev-route-editor.js`, `maplibre-map.js`, `user-features.js`, `index.html` y `admin.js`.
- Tiempo, hoja móvil de escuela: `getWeatherIconName` devuelve `clear-day`, `drizzle` y `thunderstorm`, que no existen. Esos días caen al icono de respaldo (parcialmente nuboso). El escritorio usa otra función y no se ve afectado.
- `index.html`, línea 376: etiqueta `<p … id="profile-category" 🧗‍♂️" Escalador</p>` mal formada (falta `>`). No se ha tocado.

## 7. Componentes duplicados

- Contenedores de modal y hoja: `.modal`, `.bottom-sheet`, `.kx-sheet`, `.kx-msheet`, `admin-modal-overlay`, `rd-modal-overlay`, `dev-route-modal-overlay`, más los modales de subir y borrar fotos.
  - Cifras verificadas el 5 nov 2026 (`tests/design-inventory.test.js`): 33 modales por identificador en `index.html`, de los que 11 usan la clase `.modal`. La cifra de «38 `.modal`» que di en la primera auditoría era errónea.
- Avisos: `showToast` definido cuatro veces (`user-features`, `admin`, `admin-routes`, `admin-users`), más `showSectorToast`, `showRDToast` y `showDevToast`.
- Gráficos de grados: `renderGradeChart`, `renderBarChart`, `renderDonutChart`, `loadSchoolStats` y los de `map-ui.js`.
- Ficha de vía: el mismo HTML en cuatro sitios (hoja, popup, variante, vía de spotter).
- Regla global `button { box-shadow; background }`: obliga a anular estilos sección por sección.

## 8. Fase 0: resultado

- Tokens añadidos (solo suman): fondos suaves de estado, grises de hover, escala de espacio hasta 8, `--kx-touch`, radios `xs` y `sheet`, sombra de hoja, movimiento (`--kx-dur-fast`, `--kx-dur`, `--kx-dur-slow`, `--kx-ease-in`), pesos y cifra destacada.
- El bloque de fichas del mapa usa tokens en lugar de colores sueltos.
- Verificación: estilos calculados idénticos sobre 182.621 elementos en 80 vistas (móvil y escritorio, incluidos todos los modales), contra el CSS previo reconstruido. Banco de capturas: 0,000 % de diferencia en móvil.
- Pruebas: `tests/design-tokens.test.js` (tokens definidos y paleta de marca) y colores de grado intactos.

## 9. Fase 2: componentes compartidos (primer bloque)

Catálogo vivo: [`componentes.html`](componentes.html), con el CSS real de la app y los constructores de `map-ui.js`.

- **Fugas corregidas del trabajo del mapa sin commit:**
  - La segunda regla `.kx-btn` (52 px, radio 16, peso 700) cambiaba los botones de fuera del mapa: «Marcar todas como leídas», «Enviar» de Notificar y los «Reintentar» de Buscar y Chat. Ahora va acotada a fichas y popups con `:where()`, sin sumar especificidad. Esos botones vuelven a ser idénticos al commit.
  - `@keyframes kxShimmer` se redefinía con otro recorrido y afectaba a los esqueletos de carga de toda la app. Ahora se llama `kxSkelShimmer`.
- **Hojas inferiores:** `.kx-sheet` y `.kx-msheet` comparten `--kx-scrim`, `--kx-sheet-handle` y `--kx-shadow-sheet`, con los valores de las hojas ya publicadas. Solo cambian las fichas del mapa: fondo de 0,32 a 0,38 y sombra.
- **Piezas nuevas, todavía sin uso en la app:**
  - Tamaños de botón `--sm` y `--lg`, `--block` y botón ocupado (`aria-busy`).
  - Selector segmentado `.kx-seg`.
  - Campo completo: `.kx-formrow`, `.kx-label`, `.kx-help`, `.kx-field-error`, `.kx-field--area` y `.kx-field--select`.
  - Estados de acción `.kx-status`.
  - Constructores `kxSegmentedHTML`, `kxBindSegmented`, `kxFieldHTML` y `kxStatusHTML`.
- **Avisos:** ya unificados en la app (`showSectorToast`, `showRDToast` y `showDevToast` llaman a `showToast`). Las páginas de administración tienen el suyo propio y se tratan en la Fase 6.
- **Verificación:** estilos calculados de 182.621 elementos en 80 vistas. Fuera de las fichas del mapa no hay diferencias con el commit, salvo la ocultación de la barra inferior con la ficha abierta, que es intencionada.
- **Pruebas:** guardas en `tests/design-tokens.test.js` (una sola `.kx-btn` general, animaciones sin redefinir y tokens de hoja compartidos) y constructores en `tests/map-ui.test.js`.

## 10. Fase 2: botón único y avisos (aprobado el 5 nov 2026)

- **Botón:** un solo sistema `.kx-btn` (píldora, peso 600).
  - Variantes de color: principal, secundario, terciario (`--tertiary`, alias de `--ghost`) y destructivo.
  - Tamaños: `--sm` (36 px a la vista, 44 de área táctil), normal (44) y `--lg` (52).
  - Desaparece el sistema paralelo de las fichas (`.kx-btn-primary` y compañía).
  - Ya lo usan los pies de las fichas de escuela y sector y los de Notificaciones y Notificar, en tamaño grande.
  - El estado deshabilitado pasa a gris piedra para no confundirse con el secundario.
  - El resto de botones de la app no se ha migrado.
- **Avisos:** acentos con los tonos semánticos de la marca (`--kx-success`, `--kx-info`, `--kx-warning`, `--kx-danger`); el índigo heredado desaparece.
  - Glifo blanco sobre el icono: de 3,1–4,5:1 a 5,0–5,4:1.
  - Icono frente al fondo: entre 4,7 y 5,1:1.
  - Título: unos 14:1. Detalle: 5,6:1.
  - El aviso usa un triángulo, para distinguirse del error sin depender solo del color.
- **Índigo pendiente, fuera de esta fase:** `--map-accent` (#5B6BE6, modos técnicos del mapa: 3D y seguimiento). Se revisa en la Fase 4.

## 11. Fase 2: segmentado, campos y popup de escritorio

Construidos y documentados en el catálogo; **todavía sin integrar en ninguna pantalla**.

- **Selector segmentado `.kx-seg`:**
  - Estados: normal, seleccionado, opción deshabilitada, grupo deshabilitado y foco por teclado (contorno interior verde bosque).
  - Las etiquetas nunca se recortan. Si no caben, `kxFitSegmented` lo convierte en chips en varias líneas (`.is-chips`) y lo recalcula al cambiar el ancho.
  - Las flechas saltan las opciones deshabilitadas.
  - Su contenedor debe permitir `min-width: 0`.
- **Campos `.kx-formrow`:**
  - Estados: normal, ayuda, foco (borde de 2 px y halo), error (borde rojo de 2 px, icono y texto, `aria-invalid`), deshabilitado (trama discontinua sobre gris piedra y etiqueta atenuada), desplegable y texto largo.
  - El borde tiene un contraste de 3:1.
  - `kxSetFieldError` muestra y retira el error.
  - El `.kx-field` suelto de Notificar no cambia.
- **Popup `.kx-pop`:**
  - Estructura: cabecera fija (título, datos y ✕), contenido desplazable y acciones fijas.
  - Tamaños: 280, 360 y 420 px. Límites: ancho de la pantalla menos 32 px, el ancho del contenedor y la altura disponible.
  - Los separadores solo aparecen al desplazar. Si las acciones no caben, pasan a otra línea.
  - Se cierra con ✕ o Escape (`kxBindPopover`).
  - Para usarlo en MapLibre: `className: 'kx-mpop kx-mpop--shell'`.
- **Verificado a 320, 390 y 1440 px, en el navegador:**
  - Sin desbordamiento horizontal ni etiquetas cortadas.
  - Paso a chips solo en móvil.
  - Teclado y validación en vivo correctos.
  - Sin errores de JavaScript.
- **Regresión:**
  - Estilos calculados de 182.621 elementos en 80 vistas sin cambios, salvo dos spinners animados.
  - `app_3.js`, `user-features.js` y `auth.js` idénticos al commit.
- **Títulos de popup (decisión del 5 nov 2026):** mayúscula inicial y el nombre tal como se escribe (Valeria, Pico de la Muela, El manantial), nunca en mayúsculas completas. Las mayúsculas completas quedan para las etiquetas pequeñas de sección («SECTORES»). Aplicado solo al catálogo. La hoja móvil de escuela de la app sigue con el nombre en mayúsculas hasta la Fase 4.

## 12. Fase 2: etiquetas, filas, datos técnicos, acciones y estados

Construidos y documentados en el catálogo; **todavía sin integrar**. La etiqueta de tipo de roca de la ficha de escuela es el único elemento de este bloque que la app usa hoy, y no ha cambiado (estilos calculados idénticos).

- **Contraste corregido:**
  - Texto de las etiquetas de éxito, aviso e información: 4,3–4,4:1, por debajo del mínimo. Ahora usan una tinta de texto algo más oscura (`--kx-success-ink`, `--kx-warning-ink`, `--kx-danger-ink`, `--kx-info-ink`): 4,8–4,9:1 sobre el fondo suave, el blanco y el blanco cálido. Los tonos base quedan para iconos y relleno.
  - Borde del dato técnico que falta: de 1,5:1 a 3:1.
- **Etiquetas:** seis tonos con icono, relleno de énfasis opcional (`--solid`) y texto largo que pasa a otra línea.
- **Filas y secciones:** valor largo que se parte; fila pulsable con flecha (`--action`); separador fino entre secciones consecutivas (`.kx-fsecs`).
- **Datos técnicos:** normal, ausente, pulsable, valor largo y cargando. El valor se ajusta al ancho del móvil y se divide por palabras, sin guiones; solo una palabra que no cabe sola se parte, como último recurso.
- **Acciones:** normal, principal, marcada, con contador, ocupada (conserva la etiqueta; solo el icono pasa a giro), deshabilitada (sin relleno y con contorno fino, no solo atenuada) y foco. En lista: normal, peligro y deshabilitada.
- **Estados:** esqueletos (líneas, barras, imagen, tarjetas y filas), vacío con y sin salida, error con reintento, sin sesión con y sin acción, y acción pendiente, hecha o fallida; además, carga parcial.
- **Fugas evitadas:** los botones nuevos reinician la sombra y el `white-space: nowrap` del botón global (el de las acciones hacía que «En proyectos» se pisara con «Comentar» a 320 px).


## 13. Cierre de la Fase 2: componentes compartidos

- **Estado:** 29 componentes inventariados (ver [`INVENTARIO.md`](INVENTARIO.md) y la sección final de [`componentes.html`](componentes.html)). 7 integrados, 5 integrados en parte, 14 construidos sin integrar y 3 por construir.
- **Verificable:** `design/inventario.json` es la única fuente de datos; `tests/design-inventory.test.js` contrasta cada estado con el código real y falla si aparece un constructor nuevo sin inventariar.
- **Decisiones que cierran el bloque:**
  - Franja técnica: valores largos por palabras, sin guiones (`hyphens: manual`).
  - «Eliminar sector»: icono rojo y texto en tinta normal.
  - Hoja inferior unificada: Fase 4. Avisos de administración: Fase 6.
- **Integración:** ningún componente construido en la Fase 2 se ha integrado en pantallas existentes, salvo el botón único en los pies de hoja y los tokens comunes de hoja (bloques 1 y 2).

## 14. Fase 3: auditoría de los gráficos de grados

### Gráficos actuales y usos reales
| Gráfico | Dónde | Datos | Problemas |
|---|---|---|---|
| Barras `renderBarChart` | Ficha de escuela, móvil (`#bs-bar-chart`) | GeoJSON + vías aprobadas de spotters | **Esconde grados:** se sale de su caja y recorta los extremos: 10 de los 20 grados de Valeria a 320 px, 8 a 390 y 6 a 430 (4b, 4c, 5a, 7c, 8a, 8b…). Cifra encima de cada barra. «no info» aparece como un grado más, el primero |
| Donut `renderDonutChart` | Ficha de escuela, móvil, vista ampliada | Los mismos | Repite la información de las barras; 20 sectores sin etiquetas, ilegible |
| Donut `loadSchoolStats` | Popup de escuela, escritorio | Los mismos | Igual que el anterior; total en el centro |
| Barras `renderGradeChart` | Ficha y popup de sector | Vías dibujadas en pantalla (`querySourceFeatures`) | Vacío con poco zoom (ya anotado); estilos en línea; etiquetas giradas; un «?» como grado |
| `kxGradeBarsHTML` / `kxGradeDonutHTML` | `map-ui.js` | — | Construidos en la Fase 1 del mapa, nunca integrados |

### Datos
- **Dos `sortGrades`** en `maplibre-map.js` (líneas 6314 y 7045); la segunda sobrescribe a la primera.
- `compareGrades` ordena mal: «4+» y «5+» quedan **antes** de 4a y 5a, y «no info» (sin número) **delante del 3**.
- **Vías sin grado:** la ficha de escuela las descarta sin avisar (Cuenca 33, Toledo 28, San Martín 18, Mora 9); la de sector las cuenta como «?».
- **Grados fuera de la tabla en los datos reales:** «no info» (Valeria), «5» y «4» (San Martín, Cuenca, Toledo) y «7?» (San Martín).
- Las vías de spotters se suman sin comprobar duplicados, y si la fuente del mapa ya está cargada se leen de la escuela que esté cargada.
- Hasta 25 grados distintos por escuela (San Martín). La Pedriza no tiene vías.

### Colores de grado (sin cambios)
- Validador de la guía de datos: 17 de los grados frecuentes quedan por debajo de 3:1 sobre el fondo (3, 5a y 6a, a 1,03–1,04:1); grados vecinos como 6a y 6a+ apenas se distinguen por color.
- Compensación sin tocar los colores: borde superior oscurecido en cada barra (≥ 3,5:1) y el grado siempre nombrado con texto (eje, lectura, tabla).

### Propuesta (catálogo, sin integrar)
- `kxGradeStats`: orden canónico (el de la tabla de colores, vigilado por una prueba), «sin grado» aparte, porcentaje sobre vías con grado, rango, mediana y grado con más vías.
- `kxGradeChartHTML` y `kxBindGradeChart`: un botón por grado; pulsar, arrastrar, flechas, Inicio, Fin y Escape; lectura con cifra exacta y porcentaje; acción «Ver las N vías»; tabla equivalente.
- Verificado a 320, 390 y 1440 px con eventos reales: sin desbordamiento ni solapes, la lectura no cambia de altura y las sumas coinciden con los GeoJSON.

### Integración (6 nov 2026): diseño aprobado
Decisiones del usuario: porcentaje sobre las vías con grado (las demás, aparte); «Ver las N vías» filtra el mapa actual; donut eliminado; orden de grados corregido por separado; familias de grados cuando no caben las etiquetas; resumen y vías sin grado conservados; el filtro activo debe verse y poder quitarse con facilidad.

- **Orden de grados corregido (arreglo independiente):** un único comparador (`kxCompareGrades`, en `map-ui.js`) con el orden de la tabla de colores, usado por el mapa, el perfil (grado máximo) y los gráficos. «4+» y «5+» quedan tras su familia, las mayúsculas dan igual y «no info» ya no cuenta como grado. Se retira el segundo `sortGrades` duplicado.
- **Un solo recuento para todos los gráficos:** `grado1` del GeoJSON completo de la escuela más las vías aprobadas de spotters; las vías sin grado aparte. El sector cuenta desde el GeoJSON completo (antes, desde lo dibujado en pantalla).
- **Integrado en:** ficha móvil de escuela (resumen, ahora hasta el eje de familias), popup de escuela de escritorio, ficha y popup de sector. La ficha móvil sustituye las barras y el donut; el popup, el donut.
- **Filtro de un grado:** `kxFocusGrade`. Cierra fichas y popups, acerca el mapa a la escuela si estaba lejos, muestra las vías de ese grado desde el zoom 12 (las demás, desde el de la escuela), las encuadra, aplica el mismo filtro a las vías de spotters y a los marcadores de variantes, y pone una píldora bajo el buscador (`.kx-gfocus`): tocarla vuelve al gráfico con el grado ya seleccionado; la ✕ quita el filtro. Mover el rango del filtro del mapa o pulsar «Todos» también lo retira, y al cambiar de escuela desaparece.
- **Retirados:** `renderBarChart`, `renderDonutChart`, `renderGradeChart`, `loadSchoolStats` (donut), `countRoutesByGradeForSector`, `kxGradeBarsHTML` y `kxGradeDonutHTML`, junto con sus estilos (52 reglas y dos animaciones, con cero diferencias de estilo calculado).
- **Corregidos de paso:** las vías de spotters de otra escuela ya no se cuentan en la actual; el filtro por grado ahora también afecta a las vías de spotters y a los marcadores de variantes, que antes lo ignoraban.
- **Verificación en la app real (390×844, 375×667, 430×932 y 1440×900):** gráfico, selección, filtro, píldora sin tapar el buscador, volver al gráfico y quitar el filtro. A 320×568 la ficha pasa a una sola altura porque el gráfico no cabe en un resumen.

### Rectificación (6 nov 2026): la ficha de escuela recupera su donut
Decisión del usuario: la ficha de escuela conserva el donut de grados y el bloque del tiempo originales; el gráfico interactivo queda en las fichas de sector.
- **Recuperado del código anterior (último commit), sin reescribir:** `renderDonutChart`, `loadBottomSheetStats` (sin la parte de barras), `hideSkeletonsShowCharts`, `loadSchoolStats` (popup de escritorio) y sus estilos, tarjeta y esqueleto incluidos. El tiempo no se había perdido: HTML, funciones y estilos eran idénticos a los anteriores.
- **Contenedor actualizado:** título con mayúscula inicial, etiqueta de roca con icono y botones del sistema común, en la hoja móvil y en el popup de escritorio. El donut y el tiempo no cambian de aspecto ni de datos.
- **Toque:** el donut respondía solo al ratón. Ahora tocar un segmento muestra su grado y sus vías, y tocar fuera vuelve al total (el aspecto no cambia).
- **Orden de grados:** el donut usa el comparador común, así que «4+» y «5+» ocupan ya su sitio correcto.
- **Retirado de nuevo:** solo el CSS y el código de las barras de la ficha de escuela.

### Ficha de escuela en móviles bajos (320×568)
- **Qué pasaba:** la hoja tiene una sola altura y el contenido (donut + tiempo) no cabe, así que se desplaza; al abrir, el tiempo aparecía cortado por el pie sin ninguna señal de que continuaba.
- **Qué se comprobó:** con arrastre táctil real el contenido se desplaza (108 px) y al final el tiempo queda a 32 px sobre el pie, también con el panel de previsión desplegado. El pie es fijo (fuera del área que se desplaza) y suma el área segura inferior (12 px + 34 px en iPhone con notch).
- **Cambio:** `kxBindScrollCue` marca la hoja con `.has-more` mientras el contenido continúa bajo el pie, y una sombra suave sobre el pie lo indica; desaparece al llegar al final y no aparece en la altura de resumen. Solo afecta a la ficha de escuela. El donut y la tarjeta del tiempo no cambian de tamaño ni de aspecto.
- **Sin cambios** en 375×667, 390×844 y 430×932 (hoja idéntica al píxel). Tamaños intermedios revisados (360×640, 360×740, 412×915, 414×736, 375×812): el donut nunca queda cortado por el pie.
