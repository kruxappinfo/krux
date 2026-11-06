# Inventario de componentes compartidos

Fecha: 5 nov 2026 · Actualizado el 6 nov 2026 · Fase 3: gráfico de grados integrado · Vista interactiva: [`componentes.html`](componentes.html) · Datos: [`inventario.json`](inventario.json)

Este documento se genera desde `inventario.json`. La prueba `tests/design-inventory.test.js` contrasta cada afirmación con el código real: si una pantalla adopta o deja de usar un componente, o aparece un constructor nuevo sin inventariar, la suite falla.

## Resumen

| Estado | Componentes |
|---|---|
| Integrado | 9 |
| Integrado en parte | 7 |
| Construido, sin integrar | 10 |
| Por construir | 2 |
| **Total** | **28** |

- **Integrado:** la app lo usa hoy tal como está definido.
- **Integrado en parte:** la app lo usa en algunas pantallas; el resto conserva versiones propias.
- **Construido, sin integrar:** construido y documentado en el catálogo; ninguna pantalla lo usa todavía.
- **Por construir:** previsto en el plan, aún no existe.

## Fundamentos

| Componente | Estado | Dónde vive | Uso hoy | Pendiente |
|---|---|---|---|---|
| Tokens de diseño (--kx-*) | Integrado | app_2.css | Toda la app: paleta, texto, espacio, radios, sombras, movimiento y tintas semánticas. | Quedan unos 2.000 colores sueltos, que se migran por sección sin sustituir los de grados, gráficos ni herramientas técnicas. **Fase 6** |
| Familia de iconos KRUX (88) | Construido, sin integrar | design/krux-icons.js | Ninguno: aprobada, pero la app no la carga. | Sustituir PNG y emojis (unos 180) sección a sección, nunca en masa. **Fases 4 y 6** |
| Iconos de trazo para fichas (kxIcon) | Integrado en parte | map-ui.js | Fichas del mapa (cabecera, etiqueta, botones). | Se sustituirán por la familia KRUX cuando se integre. **Fase 4** |

## Controles

| Componente | Estado | Dónde vive | Uso hoy | Pendiente |
|---|---|---|---|---|
| Botón (.kx-btn: píldora, 4 variantes, 3 tamaños) | Integrado en parte | app_2.css · map-ui.js | Pies de las fichas de escuela y sector, botones de la ficha de escuela en el popup de escritorio, Notificaciones, Notificar y reintentos de Buscar y Chat (2 de 185 botones del HTML principal, más los generados desde app_3.js y maplibre-map.js). | Los demás botones conservan clases propias por sección. **Fase 6, sección a sección** |
| Filtro (chip) | Integrado | app_2.css | Buscar, Notificaciones y motivos de Notificar. | — |
| Selector segmentado con paso a chips | Construido, sin integrar | app_2.css · map-ui.js | Ninguno. | Sustituye al menos diez versiones propias: Actividad, Entrena, Perfil, Social, administración y recorte de vídeo. **Fase 6, sección a sección** |
| Campo de texto (.kx-field suelto) | Integrado en parte | app_2.css | Notificar (3 de 67 controles de formulario del HTML principal). | El resto de controles tienen estilos propios. **Fase 6, Formularios y menús** |
| Campo con etiqueta, ayuda y error (.kx-formrow) | Construido, sin integrar | app_2.css · map-ui.js | Ninguno. | Adoptarlo primero en Notificar y después en los formularios de Perfil, Entrena y Spotter. **Fase 6, Formularios y menús** |
| Etiqueta de estado o atributo (.kx-tag, 6 tonos) | Integrado en parte | app_2.css · map-ui.js | Tipo de roca de la ficha de escuela, en la hoja móvil y en el popup de escritorio. | Acceso, restricción y exposición del sector; insignias de Entrena y Actividad. **Fases 4 y 6** |
| Botón de cierre (.kx-close) | Integrado | app_2.css · map-ui.js | Cabecera de las tres fichas del mapa. | — |
| Acción en rejilla (.kx-act) | Construido, sin integrar | app_2.css · map-ui.js | Ninguno. | Registrar ascenso, proyecto, comentarios y compartir en la ficha de vía. **Fase 4** |
| Acción en lista (.kx-lact) | Construido, sin integrar | app_2.css · map-ui.js | Ninguno. | Notificar un problema, Ver en el sector, acciones de administración. **Fase 4** |

## Superficies

| Componente | Estado | Dónde vive | Uso hoy | Pendiente |
|---|---|---|---|---|
| Hoja inferior de panel (.kx-sheet) | Integrado | app_2.css | Mensajes, Notificaciones, Buscar y Notificar. Comparte tirador, sombra y fondo con la hoja de fichas mediante tokens. | — |
| Hoja de ficha del mapa (.kx-msheet + KXMapSheet) | Integrado | app_2.css · map-ui.js | Fichas de escuela, sector y vía; dos alturas reales en escuela y sector. | — |
| Hoja inferior unificada (un solo controlador) | Por construir | — | Hoy hay dos controladores: el de paneles y KXMapSheet. | Unificar al terminar las fichas, conservando las dos alturas. **Fase 4** |
| Carcasa de popup de MapLibre (.kx-mpop) | Integrado | app_2.css · maplibre-map.js | Popups de escuela, sector y vía en escritorio: carcasa, cierre y Escape. | El contenido interior sigue siendo el antiguo y distinto en cada uno. **Fase 4** |
| Popup común (.kx-pop: cabecera, contenido, acciones) | Construido, sin integrar | app_2.css · map-ui.js | Ninguno. | Sustituye al contenido antiguo de los popups, con tres anchos. **Fase 4** |
| Modal centrado compartido | Por construir | — | Hoy hay 33 modales por identificador, 11 con la clase .modal, y otras superficies propias (administración, editor de trazados, spotter, fotos). | Definir una carcasa común y migrarlos uno a uno. **Fases 5 y 6** |

## Contenido de fichas

| Componente | Estado | Dónde vive | Uso hoy | Pendiente |
|---|---|---|---|---|
| Cabecera de ficha (.kx-fhead) | Integrado | app_2.css · map-ui.js | Fichas de escuela, sector y vía (a través de kxSheetDragHTML). | — |
| Sección con título y separador (.kx-fsec / .kx-fsecs) | Construido, sin integrar | app_2.css · map-ui.js | Ninguna. | Contenido de las fichas rediseñadas. **Fase 4** |
| Fila de dato (.kx-irow, pulsable opcional) | Construido, sin integrar | app_2.css · map-ui.js | Ninguna. | Acceso, exposición y estado en las fichas; filas de Perfil y Actividad. **Fases 4 y 6** |
| Franja de datos técnicos (.kx-stat) | Construido, sin integrar | app_2.css · map-ui.js | Ninguna. | Tipo, express y metros de la ficha de vía. **Fase 4** |

## Datos y gráficos

| Componente | Estado | Dónde vive | Uso hoy | Pendiente |
|---|---|---|---|---|
| Gráfico de barras interactivo por grado (.kx-gchart) | Integrado | app_2.css · map-ui.js | Ficha y popup de sector (móvil y escritorio). «Ver las N vías» filtra el mapa por ese grado. La ficha de escuela conserva su donut y su tiempo originales (decisión del 6 nov). | — |
| Píldora del filtro de un grado en el mapa (.kx-gfocus) | Integrado | app_2.css · map-ui.js · maplibre-map.js | «Ver las N vías» desde el gráfico de una ficha de sector filtra el mapa por el grado y el sector. La píldora indica el grado activo; tocarla vuelve al gráfico y la ✕ quita el filtro. | — |

## Estados y avisos

| Componente | Estado | Dónde vive | Uso hoy | Pendiente |
|---|---|---|---|---|
| Estados vacío, error y sin sesión (.kx-state) | Integrado en parte | app_2.css · map-ui.js | Carga y error del gráfico de grados (kxGradeChartStateHTML). Buscar, Chat y Social conservan los suyos. | Fichas del mapa; Actividad sin sesión; Buscar, Chat y Social. **Fases 4 y 6** |
| Esqueletos de carga (.kx-skel) | Integrado en parte | app_2.css · map-ui.js | Carga del gráfico de grados. | Carga de gráficos, filas, datos técnicos y fotografías. **Fases 4 y 6** |
| Estado de una acción (.kx-status) | Construido, sin integrar | app_2.css · map-ui.js | Ninguno. | Guardando, guardado y fallo en formularios y fichas. **Fases 4 y 6** |
| Aviso (showToast, .kx-toast) | Integrado en parte | user-features.js · app_2.css | Toda la app principal (17 archivos); showSectorToast, showRDToast y showDevToast ya lo llaman. | Las tres páginas de administración definen su propio showToast. **Fase 6, Administración** |
## Retirados

| Qué | Por qué | Fecha |
|---|---|---|
| Barras por grado de la ficha móvil de escuela (renderBarChart) y del sector (renderGradeChart) | Recortaban grados en móvil y contaban solo lo dibujado; el sector usa ahora el gráfico interactivo y la escuela recupera su donut | 2026-11-06 |
| kxGradeBarsHTML | Construido en la Fase 1 del mapa y nunca integrado; lo sustituye kxGradeChartHTML | 2026-11-06 |
| kxGradeDonutHTML (constructor de la Fase 1 del mapa) | Nunca se integró; la ficha de escuela usa su donut original (renderDonutChart) | 2026-11-06 |

## Qué se integra en cada fase

- **Fase 4 · Fichas del mapa:** Iconos de trazo para fichas (kxIcon); Acción en rejilla (.kx-act); Acción en lista (.kx-lact); Hoja inferior unificada (un solo controlador); Carcasa de popup de MapLibre (.kx-mpop); Popup común (.kx-pop: cabecera, contenido, acciones); Sección con título y separador (.kx-fsec / .kx-fsecs); Franja de datos técnicos (.kx-stat)
- **Fase 5 · Visor de fotos y editor de trazados:** —
- **Fase 6 · Resto de la app:** Tokens de diseño (--kx-*); Botón (.kx-btn: píldora, 4 variantes, 3 tamaños); Selector segmentado con paso a chips; Campo de texto (.kx-field suelto); Campo con etiqueta, ayuda y error (.kx-formrow); Aviso (showToast, .kx-toast)

## Decisiones vigentes

- Botón único `.kx-btn` (píldora, peso 600; tamaño grande en los pies de hoja). Jerarquía por color, no por forma.
- Etiquetas, chips y acciones nunca recortan texto: pasan a otra línea. Las franjas técnicas dividen los valores largos por palabras, sin guiones.
- Títulos de ficha y popup con mayúscula inicial; mayúsculas completas solo en etiquetas pequeñas de sección. La ficha de escuela de la app, todavía en mayúsculas, se cambia en la Fase 4.
- «Eliminar sector»: icono rojo y texto en tinta normal.
- Hoja inferior unificada: Fase 4. Avisos de las páginas de administración: Fase 6.
- La hoja de diseño es interna: `build-www.sh` no copia `design/` y una prueba lo vigila.
