import "@fontsource-variable/fraunces";
import "@fontsource-variable/ibm-plex-sans";
import type { FeatureCollection, Geometry } from "geojson";
import { AttributionControl, Map as Mapa, NavigationControl, setWorkerUrl, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre procesa el mapa en un hilo aparte (worker). Al empaquetar la app, Vite debe incluir ese
// archivo por separado y MapLibre necesita saber dónde quedó; sin esto, el mapa no se dibuja.
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./estilo.css";
import { BOGOTA, claseDe, clasificar, etiquetas, expresionColor, numero, type Clases } from "./escala";

// Mapa base en grises, gratuito y sin clave, hecho con datos de OpenStreetMap: deja que los datos resalten.
const ESTILO_BASE = "https://tiles.openfreemap.org/styles/positron";
const DATOS = `${import.meta.env.BASE_URL}data`;
const PROPIEDAD = "hurtos_km2";
const OPACIDAD = 0.72;
const TINTA = "#14213d";
const celular = window.matchMedia("(max-width: 720px)");

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

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

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

activarHoja();

mapa.on("load", async () => {
  let sectores: FeatureCollection<Geometry, Sector>;
  try {
    const [respuesta, meta] = await Promise.all([fetch(`${DATOS}/sectores.geojson`), leerMeta()]);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    sectores = await respuesta.json();
    if (meta) $("anio").textContent = String(meta.anio);
  } catch {
    $("escala").innerHTML = '<p class="cargando">No se pudieron cargar los datos. Intenta de nuevo más tarde.</p>';
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
        "line-color": ["case", ["boolean", ["feature-state", "activo"], false], TINTA, "#ffffff"],
        "line-width": ["case", ["boolean", ["feature-state", "activo"], false], 2, 0.35],
      },
    },
    debajoDe,
  );

  dibujarEscala(clases);
  $("cifra-sectores").textContent = numero(sectores.features.length);
  $("cifra-llamadas").textContent = numero(sectores.features.reduce((suma, f) => suma + f.properties.hurtos, 0));
  medirHoja();
  activarFicha(clases);
  // En el celular los créditos arrancan plegados en el botón (i): están también en el panel.
  if (celular.matches) document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
});

async function leerMeta(): Promise<Meta | null> {
  try {
    const respuesta = await fetch(`${DATOS}/meta.json`);
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null;
  }
}

/** Escala en barra: un tramo por clase y, debajo, los valores donde cambia de color. */
function dibujarEscala(clases: Clases): void {
  const textos = etiquetas(clases.cortes);
  const barra = document.createElement("div");
  barra.className = "escala-barra";
  barra.setAttribute("role", "list");
  barra.append(
    ...clases.colores.map((color, i) => {
      const tramo = document.createElement("span");
      tramo.className = "escala-tramo";
      tramo.dataset.clase = String(i);
      tramo.style.backgroundColor = color;
      tramo.style.opacity = String(OPACIDAD);
      tramo.setAttribute("role", "listitem");
      tramo.setAttribute("aria-label", `${textos[i]} llamadas por km²`);
      return tramo;
    }),
  );
  const valores = document.createElement("div");
  valores.className = "escala-valores";
  valores.setAttribute("aria-hidden", "true");
  valores.style.setProperty("--clases", String(clases.colores.length));
  valores.append(
    ...clases.cortes.map((corte, i) => {
      const valor = document.createElement("span");
      valor.style.gridColumn = String(i + 2);
      valor.textContent = numero(corte);
      return valor;
    }),
  );
  const extremos = document.createElement("div");
  extremos.className = "escala-extremos";
  extremos.setAttribute("aria-hidden", "true");
  extremos.innerHTML = "<span>Menos llamadas</span><span>Más llamadas</span>";
  $("escala").replaceChildren(barra, valores, extremos);
}

/** Ficha de un sector: sigue al mouse en computador y queda fija arriba en el celular. */
function activarFicha(clases: Clases): void {
  const ficha = $("ficha");
  const textos = etiquetas(clases.cortes);
  let activo: string | number | undefined;

  const marcar = (id: string | number | undefined, clase?: number) => {
    if (activo !== undefined) mapa.setFeatureState({ source: "sectores", id: activo }, { activo: false });
    activo = id;
    if (activo !== undefined) mapa.setFeatureState({ source: "sectores", id: activo }, { activo: true });
    document.querySelectorAll<HTMLElement>(".escala-tramo").forEach((tramo) => {
      tramo.classList.toggle("activo", clase !== undefined && tramo.dataset.clase === String(clase));
    });
  };

  const mostrar = (evento: MapLayerMouseEvent) => {
    const sector = evento.features?.[0];
    if (!sector) return;
    const p = sector.properties as Sector;
    const clase = claseDe(p.hurtos_km2, clases.cortes);
    marcar(sector.id, clase);

    const rotulo = elemento("p", "ficha-rotulo", "Sector catastral");
    const nombre = elemento("p", "ficha-nombre", p.nombre || "Sin nombre");
    const cifras = elemento("p", "ficha-cifras");
    cifras.append(elemento("strong", "", numero(p.hurtos)), " llamadas por hurto");
    const densidad = elemento("p", "ficha-cifras");
    const area = p.area_km2.toLocaleString("es-CO", { maximumFractionDigits: 2 });
    densidad.append(elemento("strong", "", numero(p.hurtos_km2)), ` por km² · ${area} km²`);
    const nivel = elemento("p", "ficha-nivel");
    const muestra = elemento("span", "ficha-muestra");
    muestra.style.backgroundColor = clases.colores[clase];
    nivel.append(muestra, `${textos[clase]} por km²`);
    ficha.replaceChildren(rotulo, nombre, cifras, densidad, nivel);
    ficha.hidden = false;

    ficha.classList.toggle("anclada", celular.matches);
    if (celular.matches) {
      ficha.style.transform = "";
    } else {
      const x = Math.min(evento.originalEvent.clientX + 16, window.innerWidth - ficha.offsetWidth - 12);
      const y = Math.min(evento.originalEvent.clientY + 16, window.innerHeight - ficha.offsetHeight - 12);
      ficha.style.transform = `translate(${Math.max(12, x)}px, ${Math.max(12, y)}px)`;
    }
  };

  const ocultar = () => {
    marcar(undefined);
    ficha.hidden = true;
  };

  mapa.on("mousemove", "sectores", mostrar);
  mapa.on("click", "sectores", mostrar);
  mapa.on("mouseenter", "sectores", () => (mapa.getCanvas().style.cursor = "pointer"));
  mapa.on("mouseleave", "sectores", () => {
    mapa.getCanvas().style.cursor = "";
    if (!celular.matches) ocultar();
  });
  mapa.on("click", (evento) => {
    if (!mapa.queryRenderedFeatures(evento.point, { layers: ["sectores"] }).length) ocultar();
  });
  mapa.on("dragstart", () => {
    if (!celular.matches) ocultar();
  });
}

/** En el celular, el panel es una hoja que asoma abajo y se despliega con la manija. */
function activarHoja(): void {
  const hoja = $("hoja");
  const asa = $<HTMLButtonElement>("asa");
  asa.addEventListener("click", () => {
    const abierta = hoja.classList.toggle("abierta");
    asa.setAttribute("aria-expanded", String(abierta));
    asa.querySelector(".solo-lectores")!.textContent = abierta ? "Mostrar menos información" : "Mostrar más información";
    if (!abierta) hoja.scrollTop = 0;
  });
  window.addEventListener("resize", medirHoja);
  celular.addEventListener("change", medirHoja);
  medirHoja();
}

/** Calcula cuánto asoma la hoja en el celular (hasta la escala) y deja ese espacio libre en el mapa. */
function medirHoja(): void {
  const raiz = document.documentElement;
  if (!celular.matches) {
    raiz.style.removeProperty("--asomar");
    mapa.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    return;
  }
  const resumen = $("resumen");
  const asomar = Math.round(resumen.offsetTop + resumen.offsetHeight + 16);
  raiz.style.setProperty("--asomar", `${asomar}px`);
  mapa.setPadding({ top: 0, right: 0, bottom: asomar, left: 0 });
}

function elemento<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase = "", texto?: string) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}
