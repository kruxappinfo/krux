# Inventario de Storage y reglas propuestas (Fase 0c)

Fuente: listado de solo lectura del bucket `climbmaps-80cae.firebasestorage.app` (2026-11-14) + lectura del código (`grep` de `storage.ref(...)`).
Reglas propuestas: **`storage.rules`** (raíz del repositorio; idéntica a `storage.rules.phase0c.proposal`; archivo completo, sin comodín). Reglas desplegadas hoy: `storage.rules.previous` (copia exacta, ruleset `16df6449…`) y `storage.rules.DEPLOYED-snapshot`. Despliegue y recuperación: `STORAGE-DEPLOY.md`.
**Nada de esto está desplegado.** «Hoy» = lo que permite el comodín `match /{allPaths=**} { allow read, write: if request.auth != null }`.

| Carpeta | Objetos | Quién lee | Quién sube | Quién modifica | Quién borra | Tamaño máx. | MIME | Documento Firestore |
|---|---|---|---|---|---|---|---|---|
| `profile-photos/{uid}/{ms}_{nombre}` | 7 | Público | Dueño | Dueño | Dueño | sin límite (igual que hoy; el cliente reduce a 640 px) | sin límite | `users/{uid}.photoURL` |
| `posts/{uid}/{ms}_{i}_{nombre}` | 25 | Público | Dueño | Dueño | Dueño (la app solo lo ejecuta el autor del post) | sin límite (el cliente limita vídeos a 300 MB) | sin límite (fotos y vídeos) | `posts/{id}` (`photos`, `media`, `video(s)`, `poster`) |
| `sector-images/{escuela}/{sector}/{img_…}.jpg` y `sector-images/{escuela}/{sector}.jpg` (antigua) | 199 | Público | Admin, spotter, super-admin | Admin, spotter, super-admin | Admin, spotter, super-admin | < 15 MB (el cliente comprime todo lo que supera 2 MB) | jpeg, jpg, png, webp | `sector_images/{escuela}_{sector}.images[]` (`storagePath`) |
| `route-photos/{escuela}/{uid}/{id}.{jpg\|png\|webp}` (nueva) | 0 | Público | Autor (carpeta con su uid) **y solo si existe su documento** `route-photos/{id}` (mismo autor, mismo `storagePath`) de hace **< 5 min** | Nadie (subir encima = `create` y exige `resource == null`; `update: false`) | Autor **solo con su documento existente** y mientras `request.time < uploadedAt + 12 h` y `< timeCreated + 12 h` (hora del **servidor**; el plazo cuenta desde que el servidor acepta el documento), admin y super-admin siempre; spotter sin privilegios | < 5 MB | jpeg/jpg, png, webp (la extensión debe coincidir con el tipo) | `route-photos/{id}` con id `{escuela}_{vía}_{16 car.}`, `storagePath`, `uploadedBy`, `uploadedAt == request.time`; marca `route-photo-tombstones/{id}` al borrarlo |
| `route-photos/{escuela}/{archivo}` (antigua) | 5 | Público | Nadie | Nadie | Admin y super-admin | — | — | `route-photos/{uid}_{vía}_{ms}` (sin `storagePath`) |
| `gym-photos/{uid}/{gymId}_{ms}.{ext}` | 4 | Usuario con sesión | Dueño | Nadie | Admin y super-admin | < 15 MB | jpeg, jpg, png, webp | `gym_info/{id}` (`photoUrl`, `storagePath`) |
| **cualquier otra ruta** (incl. `profile-banners/`, `exercises/`, `train/`, raíz) | 0 | Nadie | Nadie | Nadie | Nadie | — | — | — |

## Qué cambia respecto a hoy
- **Hoy** cualquier usuario con sesión podía leer, escribir y **borrar cualquier objeto de cualquier carpeta**. Con la propuesta: perfil, posts y gym-photos solo su dueño (gym-photos: borra un admin); sector-images solo admin/spotter; route-photos según la política de 12 h.
- `profile-banners/` existía en las reglas pero ningún código ni objeto la usa: queda denegada.
- Los clientes actuales siguen funcionando salvo la subida y el borrado de fotos de vía **con el código antiguo**; el cliente nuevo (`route-photos.js`) funciona con las reglas actuales y con las nuevas, y ninguna compilación conocida pinta los botones (ver `STORAGE-DEPLOY.md` §7).
- Los permisos de lectura solo afectan al SDK; las URL de descarga con `?token=` se sirven sin consultar las reglas.

## Lo que NO se puede garantizar solo con reglas
- Que el documento de Firestore apunte a un archivo que existe (Firestore no lee Storage).
- Límite de tamaño/tipo en `posts/` y `profile-photos/` (no se añade para no romper vídeos de hasta 300 MB ni formatos que el cliente aún sube); endurecimiento opcional posterior.
- Que `firestore.get()` desde Storage esté autorizado en el proyecto real (no verificado; solo el emulador).
