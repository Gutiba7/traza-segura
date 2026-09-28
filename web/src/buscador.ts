// Búsqueda de lugares con Photon (servicio gratuito de Komoot con datos de OpenStreetMap).
// Solo se envía lo que la persona escribe; la ruta se calcula en el teléfono.
import type { Punto } from "./grafo";

const PHOTON = "https://photon.komoot.io";
/** Zona urbana de Bogotá (oeste, sur, este, norte): coincide con la del grafo. */
export const ZONA = [-74.23, 4.47, -73.99, 4.84] as const;

export interface Lugar {
  nombre: string;
  detalle: string;
  punto: Punto;
}

interface Propiedades {
  name?: string;
  street?: string;
  housenumber?: string;
  district?: string;
  locality?: string;
}

interface RespuestaPhoton {
  features: { geometry: { coordinates: Punto }; properties: Propiedades }[];
}

export function dentroDeBogota([lon, lat]: Punto): boolean {
  return lon >= ZONA[0] && lon <= ZONA[2] && lat >= ZONA[1] && lat <= ZONA[3];
}

/** Nombre corto y detalle (barrio, ciudad) de un resultado de Photon, sin repetir partes. */
export function describir(p: Propiedades): { nombre: string; detalle: string } {
  const calle = [p.street, p.housenumber].filter(Boolean).join(" # ");
  const nombre = p.name || calle || "Lugar sin nombre";
  const localidad = p.district?.replace(/^Localidad\s+/i, "");
  const partes = [p.name && calle ? calle : "", p.locality, localidad];
  const detalle = [...new Set(partes.filter((x): x is string => Boolean(x) && x !== nombre))].join(", ");
  return { nombre, detalle: detalle || "Bogotá" };
}

export async function buscarLugares(texto: string, cerca: Punto, senal?: AbortSignal): Promise<Lugar[]> {
  const url = new URL("/api/", PHOTON);
  url.searchParams.set("q", texto);
  url.searchParams.set("limit", "6");
  url.searchParams.set("bbox", ZONA.join(","));
  url.searchParams.set("lon", cerca[0].toFixed(4));
  url.searchParams.set("lat", cerca[1].toFixed(4));
  const respuesta = await fetch(url, { signal: senal });
  if (!respuesta.ok) throw new Error(`Photon respondió ${respuesta.status}`);
  const datos = (await respuesta.json()) as RespuestaPhoton;
  const vistos = new Set<string>();
  return datos.features
    .map((f) => ({ ...describir(f.properties), punto: f.geometry.coordinates }))
    .filter((l) => dentroDeBogota(l.punto))
    .filter((l) => {
      const clave = `${l.nombre}|${l.detalle}`;
      if (vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
}

/** Nombre de la calle o lugar más cercano a un punto tocado en el mapa. */
export async function nombrarPunto(punto: Punto, senal?: AbortSignal): Promise<string | null> {
  try {
    const url = new URL("/reverse", PHOTON);
    url.searchParams.set("lon", punto[0].toFixed(5));
    url.searchParams.set("lat", punto[1].toFixed(5));
    url.searchParams.set("limit", "1");
    const respuesta = await fetch(url, { signal: senal });
    if (!respuesta.ok) return null;
    const datos = (await respuesta.json()) as RespuestaPhoton;
    const p = datos.features[0]?.properties;
    if (!p) return null;
    // Se prefiere la dirección ("Calle 11 # 8-24") al nombre de un negocio cercano.
    return [p.street, p.housenumber].filter(Boolean).join(" # ") || p.name || null;
  } catch {
    return null;
  }
}
