# Entrena — múltiples planes: arquitectura, migración y puesta en marcha

Estado: **implementado en `dev`, desactivado por defecto**. Nada de esto afecta a usuarios reales hasta
que se despliegue `firestore.rules` y se active el interruptor (ver «Activación»).

## 1. Estructura

```
users/{uid}/training_plans/{planId}     un documento por plan (modelo en train-plans.js)
users/{uid}/training_state/current      { activePlanId, migratedAt, migratedFrom, updatedAt }
users/{uid}/training_sessions/{id}      historial (añade planId, planName, planRevision, planSessionId)
users/{uid}/training_plan/active        ESQUEMA ANTIGUO: solo lectura para la versión nueva
```

- El plan activo es un **puntero** (`activePlanId`): no puede haber dos activos.
- `status`: `ready` | `archived` | `trashed` (papelera recuperable). Borrado definitivo solo desde la papelera.
- `revision` sube 1 en cada guardado; las reglas rechazan una edición con una revisión antigua.
- El historial copia `planName` y la prescripción: no depende de que el plan exista.

## 2. Migración (perezosa, por usuario, idempotente)

Al iniciar sesión, una **transacción**:

1. Si `training_state/current.migratedAt` existe → no hace nada.
2. Si no hay `training_plan/active` → no hay nada que migrar (no se escribe nada; se vuelve a mirar en el próximo inicio hasta que el usuario cree un plan).
3. Si existe y no existe `training_plans/legacy-active` → crea ese plan (id **fijo**, ids de sesión deterministas)
   y el documento de estado con `activePlanId = legacy-active` y `migratedAt`.
4. Si `legacy-active` ya existe porque una migración anterior se interrumpió → solo completa el marcador.
5. Si `legacy-active` existe pero **no procede de la migración** → se detiene con un error recuperable
   (`kx/migration-conflict`): no se sobrescribe nada ni se elige una versión.

Garantías (probadas en el emulador): ejecutar la migración muchas veces, o desde varios dispositivos a la vez,
deja **un único plan**, sin reescribirlo; el documento antiguo y el historial no se modifican.

### Cambios hechos con una versión antigua después de migrar

La versión nueva **no escribe nunca** en `training_plan/active` ni lo sincroniza. Si una app antigua lo edita
después de migrar, la versión nueva lo detecta (`updatedAt` posterior a `migratedAt`) y ofrece
**importarlo como plan nuevo** (nunca sustituye al migrado).

### Informe previo (solo lectura)

Antes de migrar usuarios reales: `scripts/Personal/informe-migracion-planes.js` (lo ejecuta el administrador con
sus credenciales; no escribe nada) cuenta usuarios con plan antiguo, usuarios ya migrados y conflictos.

### Reversión

1. Poner `KRUX_MULTIPLAN` a `false` (o no desplegar la versión): la app vuelve a leer `training_plan/active`,
   que **nunca se modificó**.
2. Para deshacer los datos de un usuario: borrar `training_state/current` y `training_plans/legacy-active`.
   El historial no se toca en ningún caso. Los planes creados después de migrar solo existen en la estructura nueva.

## 3. Versiones antiguas de la app

Las versiones anteriores solo leen y escriben `training_plan/active`. **No son compatibles** con la nueva fuente
de verdad y no hay copia de compatibilidad (decisión de producto). Estrategia:

1. Publicar la web (se actualiza sola por el service worker) y las apps nativas con la versión nueva.
2. Esperar a que la adopción sea suficiente (el informe de solo lectura muestra cuántos documentos antiguos
   siguen cambiando).
3. Solo entonces desplegar la fase 2 de reglas (§5) para que el esquema antiguo pase a **solo lectura**.
4. Con aprobación expresa, un script ejecutado por el administrador podría eliminar los documentos antiguos
   (nunca antes de que no haya escrituras antiguas durante dos versiones consecutivas).

## 4. Activación (requiere aprobación expresa)

1. Revisar `firestore.rules` y desplegarlas (`firebase deploy --only firestore:rules`). **Las reglas nuevas no
   afectan al esquema antiguo** y pueden desplegarse antes que la app.
2. Ejecutar el informe de solo lectura y revisar conflictos.
3. Publicar la app con `window.KRUX_MULTIPLAN` activado por defecto (cambio de una línea en `app_3.js`).
4. Vigilar errores `kx/migration-conflict` y el contador de usuarios migrados.

Mientras tanto, para probar con el emulador: `?multiplan=1` en la URL o `localStorage['krux.multiplan']='1'`.

## 5. Reglas en dos pasos

- **Paso 1 (con la app nueva):** las reglas actuales del repositorio (esquema nuevo + esquema antiguo todavía escribible).
- **Paso 2 (cuando ya no haya clientes antiguos):** en `training_plan/{planId}` sustituir
  `allow read, delete: ...; allow create, update: ...` por `allow read: if isOwner(userId);` (solo lectura).
