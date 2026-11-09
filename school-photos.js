// ================== KRUX FOTOGRAFÍAS DE ESCUELAS ==================
// Configuración centralizada de la imagen de la cabecera de la ficha de escuela.
// Para añadir una foto real: copia el PNG/WebP recortado (fondo transparente) en assets/schools/
// y añade una entrada en KX_SCHOOL_PHOTOS con el id de la escuela (el de SCHOOL_MARKERS). No hace falta tocar la ficha.
//
// Campos de cada entrada (todos opcionales salvo src):
//   src       ruta de la imagen (PNG o WebP con transparencia)
//   width     ancho máximo de la imagen dentro de la cabecera (CSS: '62%', '240px')
//   height    alto de la zona de la imagen (CSS: '200px')
//   position  object-position de la imagen ('right top', '80% 20%')
//   offsetX   desplazamiento horizontal (CSS, '0px'; negativo hacia la izquierda)
//   offsetY   desplazamiento vertical (CSS, '0px'; negativo hacia arriba)
//   credit    autoría de la foto (se muestra en el texto alternativo)

const KX_SCHOOL_PHOTOS = {
  toledo: { src: 'assets/schools/toledo.webp', width: '52%', height: '130px', position: 'right top' },
  sanmartin: { src: 'assets/schools/sanmartin.webp', width: '60%', height: '150px', position: 'right top' },
  mora: { src: 'assets/schools/mora.webp', width: '40%', height: '190px', position: 'right top' },
};

// Sin foto real: ilustración genérica según el tipo de roca. Nunca se presenta como foto de la escuela
// (el texto alternativo lo dice). Se pueden sustituir por imágenes generadas con IA dejando la misma clave.
const KX_SCHOOL_GENERIC_PHOTOS = {
  caliza: { src: 'assets/schools/generic/caliza.svg', width: '58%', height: '176px', position: 'right top' },
  granito: { src: 'assets/schools/generic/granito.svg', width: '58%', height: '176px', position: 'right top' },
  default: { src: 'assets/schools/generic/roca.svg', width: '58%', height: '176px', position: 'right top' }
};

// Clave normalizada de un tipo de roca («Granito» → «granito», «Caliza » → «caliza»)
function kxSchoolRockKey(rockType) {
  return String(rockType || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Imagen de la cabecera de una escuela: { src, alt, generic, width, height, position, offsetX, offsetY } o null
function kxSchoolPhoto(school) {
  if (!school) return null;
  const own = school.id && KX_SCHOOL_PHOTOS[school.id];
  if (own && own.src) {
    return { width: '62%', height: '196px', position: 'right top', offsetX: '0px', offsetY: '0px', ...own, generic: false,
      alt: `Fotografía de ${school.nombre || 'la escuela'}${own.credit ? ` (${own.credit})` : ''}` };
  }
  const rock = kxSchoolRockKey(school.rockType);
  const gen = KX_SCHOOL_GENERIC_PHOTOS[rock] || KX_SCHOOL_GENERIC_PHOTOS.default;
  if (!gen || !gen.src) return null;
  return { offsetX: '0px', offsetY: '0px', ...gen, generic: true,
    alt: `Ilustración genérica de ${rock && KX_SCHOOL_GENERIC_PHOTOS[rock] ? `una pared de ${rock}` : 'una pared de escalada'}; no es una fotografía de ${school.nombre || 'la escuela'}` };
}

// Fotos propias de un sector (ficha de sector). Clave: «idEscuela/nombre del sector» en minúsculas.
// Mismos campos que KX_SCHOOL_PHOTOS. Ejemplo: 'mora/central': { src: 'assets/sectors/mora-central.webp' }
const KX_SECTOR_PHOTOS = {};

function kxSectorPhotoKey(schoolId, sectorName) {
  return `${schoolId || ''}/${String(sectorName || '').toLowerCase().trim()}`;
}

// Imagen de la cabecera de un sector: la suya si existe; si no, la de su escuela (foto o ilustración),
// con un texto alternativo que no la presenta como foto del sector.
function kxSectorPhoto(school, sectorName) {
  const name = sectorName || 'el sector';
  const own = KX_SECTOR_PHOTOS[kxSectorPhotoKey(school && school.id, sectorName)];
  if (own && own.src) {
    return { width: '58%', height: '176px', position: 'right top', offsetX: '0px', offsetY: '0px', ...own, generic: false,
      alt: `Fotografía del sector ${name}${own.credit ? ` (${own.credit})` : ''}` };
  }
  const base = kxSchoolPhoto(school);
  if (!base) return null;
  if (base.generic) return { ...base, alt: base.alt.replace(/no es una fotografía de .*$/, `no es una fotografía del sector ${name}`) };
  return { ...base, generic: true, alt: `Fotografía de la escuela ${school.nombre || ''}; no es una fotografía del sector ${name}`.replace(/\s+;/, ';') };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { kxSchoolPhoto, kxSchoolRockKey, kxSectorPhoto, kxSectorPhotoKey, KX_SCHOOL_PHOTOS, KX_SCHOOL_GENERIC_PHOTOS, KX_SECTOR_PHOTOS };
}
