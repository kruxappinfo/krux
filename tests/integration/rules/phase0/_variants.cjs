// Variantes de reglas que se PROPONEN pero no están en ningún archivo desplegable: se construyen en memoria a partir de la propuesta real (para probarlas en el emulador y con el motor real).
// Variante A1 (solo en memoria): se parte de la regla de borrado real de la propuesta y se le antepone la excepción de los documentos de formato antiguo.
function variantA1(text) {
  const start = text.indexOf('      allow delete: if isAuthenticated() && existsAfter(tombstonePath()) && (');
  if (start < 0) throw new Error('no se encontró la regla de borrado de route-photos');
  const end = text.indexOf(';\n', start) + 2;
  const variant = [
    "      allow delete: if isAuthenticated() && (",
    "        ((isAdmin() || isSuperAdmin()) && !('storagePath' in resource.data)) ||",
    "        (existsAfter(tombstonePath()) && (",
    "          isAdmin() || isSuperAdmin() ||",
    "          (resource.data.uploadedBy == request.auth.uid",
    "            && resource.data.get('uploadedAt', null) is timestamp",
    "            && request.time < resource.data.uploadedAt + duration.value(12, 'h')))));",
    ""].join('\n');
  return text.slice(0, start) + variant + text.slice(end);
}

module.exports = { variantA1 };
