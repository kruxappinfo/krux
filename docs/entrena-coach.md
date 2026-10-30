# Entrena — perfil del escalador, entrenamiento mental y recomendaciones

Estado: **fase 1 de 6 cerrada (30-oct-2026), en `dev`, desactivada por defecto** (`KRUX_COACH`). Las reglas de Firestore
necesarias están en el repositorio pero **no desplegadas** (producción sigue con las de `bf87b96`). La fase 2 no está iniciada.
Ver el apartado «Cierre de la fase 1» al final.

## 1. Interruptor

`window.KRUX_COACH` (en `train-coach-ui.js`) está **apagado por defecto**.
- `?coach=1` lo enciende en este navegador (se recuerda en `localStorage['krux.coach']`).
- `?coach=0` lo apaga.
Apagado, no se ve nada (ni tarjeta, ni menú) y no se lee ni escribe nada.

## 2. Datos (solo el propietario puede leerlos)

```
users/{uid}/training_profile/current   perfil del escalador (puede estar a medias)
users/{uid}/mental_profile/current     respuestas de la evaluación mental inicial
```

**training_profile/current** (`schemaVersion` 1): `status` (`in_progress`|`completed`|`skipped`), `step` (1–6),
`goalPrimary`, `goalsSecondary[≤2]`, `experience`, `daysPerWeek`, `minutesPerSession`, `modality`, `environment`,
`rockFrequency`/`rockPriority` (solo con «ambos» entornos), `equipment[]`, `equipmentOther` (≤60), `completedAt`,
`grades{ sport{usualFrom,usualTo,max,target}, boulder{…} }`.
- Dos escalas **separadas**: francesa (deportiva) y Fontainebleau (bloque, solo si se elige bloque o ambas).
- El grado habitual (rango desde–hasta), el máximo encadenado y el objetivo son tres datos distintos.
- **No se guarda ningún nivel derivado**: el recomendador usará los datos declarados y explicará sus criterios.

**mental_profile/current**: `answers{ fear, confidence, focus, frustration, pressure }`, cada una 1–5, `'unknown'`
(«No lo sé») o `'skip'` («Prefiero no responder»). Sin puntuación global ni etiquetas.

## 3. Reglas de Firestore propuestas (no desplegadas)

Añaden dos subcolecciones bajo `users/{userId}`; todo lo demás queda igual.
- Lectura, borrado y escritura: **solo el propietario**. Ningún otro usuario (ni seguidores) puede leer ni listar.
- Documento único (`current`); `updatedAt == request.time`; `hasOnly` en todas las claves, incluidas las de cada escala.
- Rangos: días 1–7, minutos 20–240, paso 1–6, ≤2 objetivos secundarios, ≤6 materiales, texto de «otro material» ≤60.
- Grados validados por formato de cada escala (`6a+` deportiva; `6B+` bloque) o `unknown`.
- Un perfil `completed` exige los campos imprescindibles y `completedAt`.
- Evaluación mental: cada respuesta ∈ {1,2,3,4,5,'unknown','skip'}; sin claves extra (no se acepta una puntuación).
- Probadas con `tests/integration/rules/profile-rules-matrix.cjs` (59 casos, contra el emulador).

**Orden de despliegue:** desplegar las reglas antes de publicar una versión con `?coach=1`. Con el interruptor apagado
no hay dependencia.

## 4. Comportamiento

- **Onboarding** de 6 pasos (objetivo · nivel y experiencia · grado objetivo · disponibilidad · modalidad y entorno · material).
  Una pregunta principal por pantalla, barra de progreso, atrás/adelante conservando respuestas, guardado en cada paso.
- Se puede **saltar** («Saltar» o «Ahora no») y completar después desde el menú de Entrena («Mi perfil de escalador»).
  No bloquea Entrena. Completado, no vuelve a mostrarse; al terminar se enseña un resumen.
- **Evaluación mental** opcional (5 preguntas, escala 1–5 con extremos propios de cada pregunta, «No lo sé» y
  «Prefiero no responder»). Editable, repetible y borrable. Es contenido educativo y deportivo, no un diagnóstico.
- **Edición** desde el perfil: cada dato abre solo sus pasos; si un cambio deja el perfil incompleto (p. ej. pasar de
  deportiva a bloque) se pide lo que falta.
- **Tarjeta «Para ti»** en la pantalla principal (invitación, continuar, o resumen del perfil).

## 5. Sin conexión

Copia local por usuario (`localStorage['krux.coach.v1.{uid}']`) + cambios pendientes que se reenvían al volver la conexión
(`online`, volver a primer plano o tras cargar). La escritura es idempotente (mismo documento) y no duplica.
Al cerrar sesión se borra la copia local salvo que haya cambios sin enviar.
Limitación: la cola de esta fase es propia del perfil; los registros mentales por sesión (fase 4) usarán la cola de sesiones.

## 6. Privacidad y copias de seguridad

- Los datos del perfil y de la evaluación mental son personales: nunca se comparten, publican ni se usan en rankings.
- **Las copias de seguridad locales (`scripts/backup-firestore.py` → `~/krux-backups/`) vuelcan todas las subcolecciones de
  `users`, así que incluirán `training_profile` y `mental_profile` (y, en la fase 4, `mental_session_logs`).**
  No las subas al repositorio ni las compartas. La copia local de `localStorage` tampoco está cifrada.

## 7. Reversión

- Apagar `KRUX_COACH` (o no activarlo): la app vuelve a su estado anterior; no se modifica ningún dato existente.
- Borrar los datos de un usuario: borrar `training_profile/current` y `mental_profile/current` (el propietario puede
  hacerlo desde la consola; la interfaz permite borrar la evaluación mental).

## 8. Cierre de la fase 1

**Incluido en la fase 1 (todo en `dev`):** perfil del escalador y onboarding, evaluación mental inicial, tarjeta «Para ti»,
reglas del perfil y de la evaluación mental endurecidas (preparadas, sin desplegar), 27 contenidos mentales redactados
(`train-mental-data.js`, estado de revisión `pending`, sin cargar en la app), y la protección de la cola local descrita abajo.

**Funcionalidades protegidas frente a cierres, cortes de red y dos dispositivos** (probado con cierre en cada punto de la
sincronización, reapertura con y sin conexión, y dos dispositivos; una sola sesión por id, sin pérdidas ni duplicados):
- La sesión terminada se guarda en el dispositivo antes de cualquier operación de red, con id estable.
- El registro final (sensación, esfuerzo, notas y etiquetas) se guarda en la cola al pulsar «Guardar», junto a la sesión
  pendiente o como parche con el mismo id si la sesión ya estaba escrita.
- Nada sale de la cola hasta verificarlo en el servidor; si falla la verificación se reintenta con el mismo id.
- Sesiones antiguas sin registro final siguen siendo válidas.

**Modo clásico (`?multiplan=0`):** también tiene esa protección para sesiones y registros finales. Limitaciones: no hay
copia local del plan para arrancar sin conexión ni calendario con lo pendiente al abrir sin red. El modo solo se activa a mano
en la web (no hay botón; en la app nativa es prácticamente inalcanzable).

**Fuera de la fase 1 / pendiente:**
- Despliegue de las reglas de Firestore (startDate, perfil, evaluación mental, endurecimiento): requiere autorización expresa.
- Activación global de `KRUX_COACH`: sin decidir.
- Revisión profesional de los contenidos mentales.
- **Incidencia técnica abierta (no resuelta):** bloqueos intermitentes de 55–60 s en los canales de Firestore durante las pruebas
  de `multi` (`u7_detecta`, `u9_registroLegibleSinPlan`, «client is offline»), con causa de fondo sin identificar. Sin
  evidencia de que ocurra en producción. Diagnóstico y descartes en `tests/integration/README.md`. Se trata aparte de este cierre.
