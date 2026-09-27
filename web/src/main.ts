import type { FeatureCollection, Geometry } from "geojson";
import { AttributionControl, Map as Mapa, NavigationControl, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre procesa el mapa en un hilo aparte (worker). Al empaquetar la app, Vite debe incluir ese
// archivo por separado y MapLibre necesita saber dónde quedó; sin esto, el mapa no se dibuja.
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./estilo.css";
import { BOGOTA, clasificar, etiquetas, expresionColor, numero, type Clases } from "./escala";

// Mapa base gratuito y sin clave, hecho con datos de OpenStreetMap.
const ESTILO_BASE = "https://tiles.openfreemap.org/styles/liberty";
const DATOS = `${import.meta.env.BASE_URL}data`;
const PROPIEDAD = "hurtos_km2";
const OPACIDAD = 0.65;

interface Sector {
  id: string;
  nombre: string;
  area_km2: number;
  hurtos: number;
  hurtos_km2: number;
}

interface Meta {
  anio: number;
  fuente: string;
}

setWorkerUrl(urlWorker);

const mapa = new Mapa({
  container: "mapa",
  style: ESTILO_BASE,
  center: BOGOTA.centro,
  zoom: 11,
  maxBounds: BOGOTA.limites,
  attributionControl: false,
});
mapa.addControl(new NavigationControl({ showCompass: false }), "top-right");
mapa.addControl(new AttributionControl({ compact: true }), "bottom-right");

mapa.on("load", async () => {
  const leyenda = document.getElementById("leyenda")!;
  let sectores: FeatureCollection<Geometry, Sector>;
  try {
    const [respuesta, meta] = await Promise.all([fetch(`${DATOS}/sectores.geojson`), leerMeta()]);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    sectores = await respuesta.json();
    if (meta) {
      document.getElementById("anio")!.textContent = String(meta.anio);
      document.getElementById("fuente")!.textContent = `Fuente: ${meta.fuente}.`;
    }
  } catch {
    leyenda.textContent = "Los datos todavía no están disponibles en esta versión.";
    return;
  }

  const clases = clasificar(sectores.features.map((f) => f.properties[PROPIEDAD]));
  // Las zonas se dibujan debajo de los nombres de calles y barrios del mapa base.
  const debajoDe = mapa.getStyle().layers.find((capa) => capa.type === "symbol")?.id;
  mapa.addSource("sectores", {
    type: "geojson",
    data: sectores,
    promoteId: "id",
    attribution: "Datos: Secretaría Distrital de Seguridad (CC BY-SA 4.0)",
  });
  mapa.addLayer(
    {
      id: "sectores",
      type: "fill",
      source: "sectores",
      paint: { "fill-color": expresionColor(PROPIEDAD, clases), "fill-opacity": OPACIDAD },
    },
    debajoDe,
  );
  mapa.addLayer(
    {
      id: "sectores-borde",
      type: "line",
      source: "sectores",
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "activo"], false], "#0b0b0b", "#ffffff"],
        "line-width": ["case", ["boolean", ["feature-state", "activo"], false], 2, 0.5],
      },
    },
    debajoDe,
  );
  dibujarLeyenda(leyenda, clases);
  activarDetalle();
});

async function leerMeta(): Promise<Meta | null> {
  try {
    const respuesta = await fetch(`${DATOS}/meta.json`);
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null;
  }
}

function dibujarLeyenda(contenedor: HTMLElement, clases: Clases): void {
  contenedor.replaceChildren(
    ...etiquetas(clases.cortes).map((texto, i) => {
      const fila = document.createElement("div");
      fila.className = "leyenda-fila";
      fila.setAttribute("role", "listitem");
      const muestra = document.createElement("span");
      muestra.className = "muestra";
      muestra.style.backgroundColor = clases.colores[i];
      muestra.style.opacity = String(OPACIDAD);
      const etiqueta = document.createElement("span");
      etiqueta.textContent = texto;
      fila.append(muestra, etiqueta);
      return fila;
    }),
  );
}

/** Muestra el detalle de un sector al pasar el mouse o al tocarlo en el celular. */
function activarDetalle(): void {
  const detalle = document.getElementById("detalle")!;
  let activo: string | number | undefined;

  const marcar = (id: string | number | undefined) => {
    if (activo !== undefined) mapa.setFeatureState({ source: "sectores", id: activo }, { activo: false });
    activo = id;
    if (activo !== undefined) mapa.setFeatureState({ source: "sectores", id: activo }, { activo: true });
  };

  const mostrar = (evento: MapLayerMouseEvent) => {
    const sector = evento.features?.[0];
    if (!sector) return;
    marcar(sector.id);
    const p = sector.properties as Sector;
    const titulo = document.createElement("strong");
    titulo.textContent = p.nombre || "Sector sin nombre";
    const linea1 = document.createElement("span");
    linea1.textContent = `${numero(p.hurtos)} llamadas por hurto`;
    const linea2 = document.createElement("span");
    linea2.textContent = `${numero(p.hurtos_km2)} por km² · ${p.area_km2.toLocaleString("es-CO")} km²`;
    detalle.replaceChildren(titulo, linea1, linea2);
    detalle.hidden = false;
    const x = Math.min(evento.point.x + 14, window.innerWidth - detalle.offsetWidth - 8);
    const y = Math.min(evento.point.y + 14, window.innerHeight - detalle.offsetHeight - 8);
    detalle.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  };

  const ocultar = () => {
    marcar(undefined);
    detalle.hidden = true;
  };

  mapa.on("mousemove", "sectores", mostrar);
  mapa.on("click", "sectores", mostrar);
  mapa.on("mouseenter", "sectores", () => (mapa.getCanvas().style.cursor = "pointer"));
  mapa.on("mouseleave", "sectores", () => {
    mapa.getCanvas().style.cursor = "";
    ocultar();
  });
  mapa.on("movestart", ocultar);
}
