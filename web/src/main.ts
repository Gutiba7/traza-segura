import "@fontsource-variable/fraunces";
import "@fontsource-variable/ibm-plex-sans";
import type { Feature, FeatureCollection, Geometry, LineString } from "geojson";
import {
  AttributionControl,
  LngLatBounds,
  Map as Mapa,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre procesa el mapa en un hilo aparte (worker). Al empaquetar la app, Vite debe incluir ese
// archivo por separado y MapLibre necesita saber dónde quedó; sin esto, el mapa no se dibuja.
import urlWorker from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./estilo.css";
import { buscarLugares, dentroDeBogota, nombrarPunto, type Lugar } from "./buscador";
import { BOGOTA, CORTES_RIESGO, RAMPA, expresionColor, numero } from "./escala";
import { buscarRuta, descomprimir, distancia, leerGrafo, nodoCercano, resumir, type Grafo, type Punto, type Resumen } from "./grafo";
import {
  MODOS,
  PRIORIDADES,
  comparar,
  distanciaTexto,
  franja,
  lista,
  minutos,
  nivel,
  sectoresEvitados,
  veces,
  type Modo,
  type Prioridad,
} from "./textos";

// Mapa base en grises, gratuito y sin clave, hecho con datos de OpenStreetMap: deja que los datos resalten.
const ESTILO_BASE = "https://tiles.openfreemap.org/styles/positron";
const DATOS = `${import.meta.env.BASE_URL}data`;
const OPACIDAD_ZONAS = 0.5;
const opacidadZonas = (conRuta: boolean) =>
  ["interpolate", ["linear"], ["zoom"], 11, conRuta ? 0.4 : 0.55, 15, conRuta ? 0.22 : 0.32] as ExpressionSpecification;
const TINTA = "#14213d";
/** Velocidad para el trecho entre el punto marcado y la esquina más cercana (m/s). */
const VELOCIDAD_ENLACE: Record<Modo, number> = { pie: 1.25, bici: 3.9, carro: 5.5 };
const EJEMPLO: Record<Cual, Parada> = {
  origen: { punto: [-74.06841, 4.61552], nombre: "Museo Nacional de Colombia" },
  destino: { punto: [-74.06956, 4.60127], nombre: "Parque de los Periodistas" },
};
const celular = window.matchMedia("(max-width: 720px)");

type Cual = "origen" | "destino";

interface Parada {
  punto: Punto;
  nombre: string;
}

interface Sector {
  id: string;
  nombre: string;
  hurtos: number;
  rr_pie?: number;
  rr_bici?: number;
  rr_carro?: number;
}

interface Meta {
  anio?: number;
  periodo?: string;
}

const estado = {
  origen: null as Parada | null,
  destino: null as Parada | null,
  modo: "pie" as Modo,
  prioridad: "moderado" as Prioridad,
};
let sectores: FeatureCollection<Geometry, Sector> | null = null;
let meta: Meta | null = null;
/** Campo que la persona está llenando: el próximo toque en el mapa va ahí. */
let campoActivo: Cual | null = null;
/** Cada cálculo nuevo invalida los anteriores que sigan esperando. */
let turno = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const entrada = (cual: Cual) => $<HTMLInputElement>(cual);
const alfa = () => PRIORIDADES.find((p) => p.id === estado.prioridad)!.alfa;
const GUIA = $("resultado").innerHTML;

setWorkerUrl(urlWorker);

const mapa = new Mapa({
  container: "mapa",
  style: ESTILO_BASE,
  center: BOGOTA.centro,
  zoom: 11.5,
  maxBounds: BOGOTA.limites,
  attributionControl: false,
});
mapa.addControl(new NavigationControl({ showCompass: false }), "top-right");
mapa.addControl(new AttributionControl({ compact: true }), "bottom-right");

const marcadores: Record<Cual, Marker> = { origen: crearMarcador("origen"), destino: crearMarcador("destino") };
const enMapa = new Set<Cual>();
const mostrarMarcador = (cual: Cual, punto: Punto) => {
  marcadores[cual].setLngLat(punto);
  if (!enMapa.has(cual)) marcadores[cual].addTo(mapa);
  enMapa.add(cual);
};
const quitarMarcador = (cual: Cual) => {
  marcadores[cual].remove();
  enMapa.delete(cual);
};

activarHoja();
activarFormulario();
leerUrl();

mapa.on("load", async () => {
  // Las capas propias van debajo de los nombres de calles y barrios del mapa base.
  const debajoDe = mapa.getStyle().layers.find((capa) => capa.type === "symbol")?.id;
  const vacio: FeatureCollection = { type: "FeatureCollection", features: [] };
  mapa.addSource("sectores", {
    type: "geojson",
    data: vacio,
    promoteId: "id",
    attribution: "Datos: Secretaría Distrital de Seguridad (CC BY-SA 4.0)",
  });
  mapa.addLayer(
    { id: "sectores", type: "fill", source: "sectores", paint: { "fill-color": colorZonas(), "fill-opacity": opacidadZonas(false) } },
    debajoDe,
  );
  mapa.addLayer(
    {
      id: "sectores-borde",
      type: "line",
      source: "sectores",
      paint: {
        "line-color": ["case", ["boolean", ["feature-state", "activo"], false], TINTA, "#ffffff"],
        "line-width": ["case", ["boolean", ["feature-state", "activo"], false], 2, 0.3],
      },
    },
    debajoDe,
  );

  mapa.addSource("rutas", { type: "geojson", data: vacio });
  const linea = { "line-join": "round", "line-cap": "round" } as const;
  mapa.addLayer({ id: "enlaces", type: "line", source: "rutas", filter: ["==", ["get", "tipo"], "enlace"], layout: linea,
    paint: { "line-color": TINTA, "line-width": 2, "line-dasharray": [0.1, 2], "line-opacity": 0.7 } });
  mapa.addLayer({ id: "rapida-borde", type: "line", source: "rutas", filter: ["==", ["get", "tipo"], "rapida"], layout: linea,
    paint: { "line-color": "#ffffff", "line-width": 8 } });
  mapa.addLayer({ id: "rapida", type: "line", source: "rutas", filter: ["==", ["get", "tipo"], "rapida"], layout: linea,
    paint: { "line-color": "#6b7280", "line-width": 4, "line-dasharray": [1.4, 1.2] } });
  mapa.addLayer({ id: "tranquila-borde", type: "line", source: "rutas", filter: ["==", ["get", "tipo"], "tranquila"], layout: linea,
    paint: { "line-color": "#ffffff", "line-width": 10 } });
  mapa.addLayer({ id: "tranquila", type: "line", source: "rutas", filter: ["==", ["get", "tipo"], "tranquila"], layout: linea,
    paint: { "line-color": TINTA, "line-width": 5.5 } });

  try {
    const [respuesta, datosMeta] = await Promise.all([fetch(`${DATOS}/sectores.geojson`), leerJson<Meta>(`${DATOS}/meta.json`)]);
    if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
    sectores = await respuesta.json();
    meta = datosMeta;
  } catch {
    $("escala").innerHTML = '<p class="cargando">No se pudieron cargar las zonas. Intenta de nuevo más tarde.</p>';
  }
  if (sectores) {
    (mapa.getSource("sectores") as GeoJSONSource).setData(sectores);
    $("cifra-sectores").textContent = numero(sectores.features.length);
    if (meta?.periodo) $("periodo").textContent = meta.periodo;
    dibujarEscala();
    activarFicha();
  }
  // En el celular los créditos arrancan plegados en el botón (i): están también en el panel.
  if (celular.matches) document.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");

  mapa.on("click", (evento) => {
    if ((evento.originalEvent.target as HTMLElement).closest(".marcador")) return;
    const cual: Cual = campoActivo ?? (!estado.origen ? "origen" : "destino");
    campoActivo = null;
    (document.activeElement as HTMLElement | null)?.blur();
    fijar(cual, [evento.lngLat.lng, evento.lngLat.lat], null);
  });
  if (estado.origen || estado.destino) calcular();
});

// ---------------------------------------------------------------- Origen, destino y modo

function crearMarcador(cual: Cual): Marker {
  const elemento = document.createElement("div");
  elemento.className = `marcador ${cual}`;
  elemento.title = cual === "origen" ? "Origen (arrástralo para moverlo)" : "Destino (arrástralo para moverlo)";
  const marcador = new Marker({ element: elemento, draggable: true });
  marcador.on("dragend", () => {
    const { lng, lat } = marcador.getLngLat();
    fijar(cual, [lng, lat], null);
  });
  return marcador;
}

/** Pone el origen o el destino. Sin nombre, se busca el de la calle más cercana. */
function fijar(cual: Cual, punto: Punto, nombre: string | null, recalcular = true): void {
  if (!dentroDeBogota(punto)) {
    avisar("Ese punto queda fuera de la zona urbana de Bogotá.");
    const anterior = estado[cual];
    if (anterior) marcadores[cual].setLngLat(anterior.punto);
    return;
  }
  const parada: Parada = { punto, nombre: nombre ?? "Punto en el mapa" };
  estado[cual] = parada;
  entrada(cual).value = parada.nombre;
  mostrarMarcador(cual, punto);
  if (!nombre) {
    nombrarPunto(punto).then((encontrado) => {
      if (!encontrado || estado[cual] !== parada) return;
      parada.nombre = encontrado;
      if (document.activeElement !== entrada(cual)) entrada(cual).value = encontrado;
      actualizarTrayecto();
      guardarUrl();
    });
  }
  void cargarGrafo(estado.modo).catch(() => undefined); // se adelanta la descarga
  if (recalcular) calcular();
}

function activarFormulario(): void {
  for (const cual of ["origen", "destino"] as const) activarBuscador(cual);

  $("viaje").addEventListener("submit", (evento) => evento.preventDefault());
  $("viaje").addEventListener("change", (evento) => {
    const control = evento.target as HTMLInputElement;
    if (control.name !== "modo") return;
    estado.modo = control.value as Modo;
    $("modo-zonas").textContent = MODOS[estado.modo].verbo === "caminando" ? "a pie" : MODOS[estado.modo].verbo;
    if (mapa.getLayer("sectores")) mapa.setPaintProperty("sectores", "fill-color", colorZonas());
    calcular();
  });

  $("invertir").addEventListener("click", () => {
    [estado.origen, estado.destino] = [estado.destino, estado.origen];
    for (const cual of ["origen", "destino"] as const) {
      const parada = estado[cual];
      entrada(cual).value = parada?.nombre ?? "";
      if (parada) mostrarMarcador(cual, parada.punto);
      else quitarMarcador(cual);
    }
    calcular(false);
  });

  $("mi-ubicacion").addEventListener("click", () => {
    if (!navigator.geolocation) {
      avisar("Este navegador no permite conocer tu ubicación.");
      return;
    }
    avisar("Buscando tu ubicación…");
    navigator.geolocation.getCurrentPosition(
      (posicion) => {
        ocultarAviso();
        const punto: Punto = [posicion.coords.longitude, posicion.coords.latitude];
        if (!dentroDeBogota(punto)) {
          avisar("Parece que no estás en Bogotá: marca el origen en el mapa.");
          return;
        }
        fijar("origen", punto, "Mi ubicación");
      },
      () => avisar("No se pudo obtener tu ubicación. Revisa el permiso del navegador."),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });

  $("trayecto").addEventListener("click", () => {
    $("viaje").classList.remove("compacta");
    medirHoja();
  });

  $("resultado").addEventListener("click", (evento) => {
    if ((evento.target as HTMLElement).closest("#ejemplo")) {
      fijar("origen", EJEMPLO.origen.punto, EJEMPLO.origen.nombre, false);
      fijar("destino", EJEMPLO.destino.punto, EJEMPLO.destino.nombre);
    }
  });
  $("resultado").addEventListener("change", (evento) => {
    const control = evento.target as HTMLInputElement;
    if (control.name !== "prioridad") return;
    estado.prioridad = control.value as Prioridad;
    calcular(false);
  });

  $("ver-zonas").addEventListener("change", (evento) => {
    const visible = (evento.target as HTMLInputElement).checked;
    for (const capa of ["sectores", "sectores-borde"]) {
      if (mapa.getLayer(capa)) mapa.setLayoutProperty(capa, "visibility", visible ? "visible" : "none");
    }
  });
}

/** Autocompletar de un campo con Photon: flechas para moverse, Enter para elegir, Esc para cerrar. */
function activarBuscador(cual: Cual): void {
  const campo = entrada(cual);
  const listaEl = $(`sugerencias-${cual}`);
  let control: AbortController | null = null;
  let espera = 0;
  let lugares: Lugar[] = [];
  let marcado = -1;

  const cerrar = () => {
    listaEl.hidden = true;
    campo.setAttribute("aria-expanded", "false");
    campo.removeAttribute("aria-activedescendant");
    marcado = -1;
  };
  const pintar = (mensaje?: string) => {
    listaEl.replaceChildren();
    if (mensaje) {
      listaEl.append(elemento("li", "sugerencia-vacia", mensaje));
    }
    lugares.forEach((lugar, i) => {
      const item = elemento("li", "sugerencia");
      item.id = `sugerencia-${cual}-${i}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === marcado));
      item.append(elemento("span", "sugerencia-nombre", lugar.nombre), elemento("span", "sugerencia-detalle", lugar.detalle));
      item.addEventListener("click", () => elegir(i));
      listaEl.append(item);
    });
    listaEl.hidden = false;
    campo.setAttribute("aria-expanded", "true");
    if (marcado >= 0) campo.setAttribute("aria-activedescendant", `sugerencia-${cual}-${marcado}`);
  };
  const elegir = (i: number) => {
    const lugar = lugares[i];
    if (!lugar) return;
    cerrar();
    campoActivo = null;
    campo.blur();
    fijar(cual, lugar.punto, lugar.nombre);
    const otro: Cual = cual === "origen" ? "destino" : "origen";
    if (!estado[otro] && !celular.matches) entrada(otro).focus();
    else if (celular.matches) abrirHoja(false);
  };

  campo.addEventListener("focus", () => {
    campoActivo = cual;
    campo.select();
    if (celular.matches) abrirHoja(true);
    void cargarGrafo(estado.modo).catch(() => undefined);
  });
  campo.addEventListener("blur", () => {
    // Si escribió algo sin elegir, vuelve el nombre del punto actual.
    window.setTimeout(() => {
      cerrar();
      if (document.activeElement !== campo) campo.value = estado[cual]?.nombre ?? "";
    }, 150);
  });
  campo.addEventListener("input", () => {
    window.clearTimeout(espera);
    const texto = campo.value.trim();
    if (texto.length < 3) {
      lugares = [];
      cerrar();
      return;
    }
    espera = window.setTimeout(async () => {
      control?.abort();
      control = new AbortController();
      try {
        const centro = mapa.getCenter();
        lugares = await buscarLugares(texto, [centro.lng, centro.lat], control.signal);
        marcado = lugares.length ? 0 : -1;
        pintar(lugares.length ? undefined : "No encontramos ese lugar en Bogotá. Prueba con otro nombre o toca el mapa.");
      } catch (error) {
        if ((error as Error).name === "AbortError") return;
        lugares = [];
        pintar("No se pudo buscar. Revisa tu conexión o toca el mapa.");
      }
    }, 250);
  });
  campo.addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      if (!lugares.length) return;
      evento.preventDefault();
      marcado = (marcado + (evento.key === "ArrowDown" ? 1 : -1) + lugares.length) % lugares.length;
      pintar();
    } else if (evento.key === "Enter") {
      evento.preventDefault();
      elegir(Math.max(0, marcado));
    } else if (evento.key === "Escape") {
      cerrar();
    }
  });
  // Evita que el campo pierda el foco antes de registrar el clic en una sugerencia.
  listaEl.addEventListener("pointerdown", (evento) => evento.preventDefault());
}

// ---------------------------------------------------------------- Grafos y cálculo

const grafos = new Map<Modo, Promise<Grafo>>();
const listos = new Set<Modo>();

function cargarGrafo(modo: Modo): Promise<Grafo> {
  let promesa = grafos.get(modo);
  if (!promesa) {
    promesa = descargar(`${DATOS}/grafo-${modo}.bin.gz`, modo)
      .then(descomprimir)
      .then(leerGrafo)
      .then((grafo) => {
        listos.add(modo);
        return grafo;
      });
    promesa.catch(() => grafos.delete(modo)); // se puede reintentar
    grafos.set(modo, promesa);
  }
  return promesa;
}

async function descargar(url: string, modo: Modo): Promise<ArrayBuffer> {
  const respuesta = await fetch(url);
  if (!respuesta.ok || !respuesta.body) throw new Error(`HTTP ${respuesta.status}`);
  const total = Number(respuesta.headers.get("content-length")) || 0;
  const lector = respuesta.body.getReader();
  const partes: Uint8Array[] = [];
  let cargados = 0;
  for (;;) {
    const { done, value } = await lector.read();
    if (done) break;
    partes.push(value);
    cargados += value.length;
    const barra = document.querySelector<HTMLElement>(`[data-descarga="${modo}"]`);
    if (barra) {
      const fraccion = total ? Math.min(0.99, cargados / total) : 0;
      barra.style.setProperty("--avance", String(fraccion));
      barra.textContent = total ? `${Math.round(fraccion * 100)} %` : `${(cargados / 1e6).toFixed(1)} MB`;
    }
  }
  const todo = new Uint8Array(cargados);
  let posicion = 0;
  for (const parte of partes) {
    todo.set(parte, posicion);
    posicion += parte.length;
  }
  return todo.buffer;
}

async function calcular(encuadrar = true): Promise<void> {
  const mio = ++turno;
  guardarUrl();
  actualizarTrayecto();
  const { origen, destino, modo } = estado;
  if (!origen || !destino) {
    dibujarRutas(null);
    $("viaje").classList.remove("compacta");
    if (!origen && !destino) $("resultado").innerHTML = GUIA;
    else pintarMensaje(origen ? "Ahora marca el destino: escríbelo o toca el mapa." : "Ahora marca el origen: escríbelo, usa tu ubicación o toca el mapa.");
    if (encuadrar) {
      const unico = (origen ?? destino)!;
      if (!mapa.getBounds().contains(unico.punto)) mapa.easeTo({ center: unico.punto, zoom: Math.max(mapa.getZoom(), 13) });
    }
    medirHoja();
    return;
  }

  if (!listos.has(modo)) {
    pintarCarga(modo);
    medirHoja();
  }
  let grafo: Grafo;
  try {
    grafo = await cargarGrafo(modo);
  } catch {
    if (mio === turno) pintarMensaje("No se pudo descargar el mapa de calles. Revisa tu conexión e intenta de nuevo.", true);
    return;
  }
  if (mio !== turno) return;
  await new Promise(requestAnimationFrame); // deja ver el estado antes de calcular

  const inicio = performance.now();
  const o = nodoCercano(grafo, origen.punto);
  const d = nodoCercano(grafo, destino.punto);
  if (o < 0 || d < 0) {
    dibujarRutas(null);
    const cual = o < 0 ? "El origen" : "El destino";
    pintarMensaje(`${cual} está lejos de las calles que se pueden recorrer ${MODOS[modo].verbo}. Muévelo a una calle cercana.`, true);
    return;
  }
  if (o === d) {
    dibujarRutas(null);
    pintarMensaje("El origen y el destino quedan en la misma esquina: ya llegaste.", true);
    return;
  }
  const tramosRapida = buscarRuta(grafo, o, d, 0);
  const tramosTranquila = buscarRuta(grafo, o, d, alfa());
  if (!tramosRapida || !tramosTranquila) {
    dibujarRutas(null);
    pintarMensaje(`No encontramos un camino ${MODOS[modo].verbo} entre esos puntos. Prueba moverlos a una calle cercana.`, true);
    return;
  }
  const segundosCalculo = (performance.now() - inicio) / 1000;
  const rapida = resumir(grafo, tramosRapida, o);
  const tranquila = resumir(grafo, tramosTranquila, o);
  const misma =
    tramosRapida.length === tramosTranquila.length && tramosRapida.every((t, i) => t.arista === tramosTranquila[i].arista);

  // El trecho entre cada punto marcado y su esquina cuenta igual para las dos rutas.
  const inicioRuta: Punto = [grafo.lon[o], grafo.lat[o]];
  const finRuta: Punto = [grafo.lon[d], grafo.lat[d]];
  const extraM = distancia(origen.punto, inicioRuta) + distancia(destino.punto, finRuta);
  const enlace = { metros: extraM, segundos: extraM / VELOCIDAD_ENLACE[modo] };

  dibujarRutas({ rapida, tranquila, misma, enlaces: [[origen.punto, inicioRuta], [finRuta, destino.punto]] });
  pintarResultado(rapida, tranquila, misma, enlace, segundosCalculo);
  if (celular.matches) {
    $("viaje").classList.add("compacta");
    abrirHoja(false);
    $("hoja").scrollTop = 0;
  }
  medirHoja();
  if (encuadrar) {
    const limites = new LngLatBounds();
    for (const p of [...rapida.coordenadas, ...tranquila.coordenadas, origen.punto, destino.punto]) limites.extend(p);
    mapa.fitBounds(limites, { padding: margenes(), maxZoom: 16.5, duration: 700 });
  }
}

function dibujarRutas(
  rutas: { rapida: Resumen; tranquila: Resumen; misma: boolean; enlaces: [Punto, Punto][] } | null,
): void {
  const fuente = mapa.getSource("rutas") as GeoJSONSource | undefined;
  if (!fuente) return;
  const lineas: Feature<LineString, { tipo: string }>[] = [];
  const linea = (tipo: string, coordinates: Punto[]): Feature<LineString, { tipo: string }> => ({
    type: "Feature",
    properties: { tipo },
    geometry: { type: "LineString", coordinates },
  });
  if (rutas) {
    if (!rutas.misma) lineas.push(linea("rapida", rutas.rapida.coordenadas));
    lineas.push(linea("tranquila", rutas.tranquila.coordenadas));
    for (const enlace of rutas.enlaces) lineas.push(linea("enlace", enlace));
  }
  fuente.setData({ type: "FeatureCollection", features: lineas });
  mapa.setPaintProperty("sectores", "fill-opacity", opacidadZonas(rutas !== null));
}

// ---------------------------------------------------------------- Panel de resultados

function pintarResultado(
  rapida: Resumen,
  tranquila: Resumen,
  misma: boolean,
  enlace: { metros: number; segundos: number },
  segundosCalculo: number,
): void {
  const c = comparar(rapida, tranquila, misma);
  const modo = estado.modo;
  const panel = $("resultado");
  panel.replaceChildren();

  panel.append(elemento("p", "rotulo", `Tu recorrido ${modo === "pie" ? "a pie" : MODOS[modo].verbo}`));
  panel.append(elemento("p", "titular", c.titular));

  const rutas = elemento("div", "rutas");
  const fila = (clase: string, nombre: string, r: Resumen) => {
    const item = elemento("div", `ruta ${clase}`);
    const cifras = elemento("span", "ruta-cifras");
    cifras.append(elemento("strong", "", minutos(r.segundos + enlace.segundos)), ` · ${distanciaTexto(r.metros + enlace.metros)}`);
    item.append(elemento("span", "trazo"), elemento("span", "ruta-nombre", nombre), cifras);
    return item;
  };
  if (misma) {
    rutas.append(fila("tranquila", "Ruta sugerida", tranquila));
  } else {
    rutas.append(fila("tranquila", "Más tranquila", tranquila), fila("rapida", "Más rápida", rapida));
  }
  panel.append(rutas);

  // Franja: cómo cambia el riesgo desde la salida hasta la llegada, con el largo según el tiempo.
  const franjas = elemento("div", "franjas");
  franjas.append(elemento("p", "franjas-titulo", "Riesgo a lo largo del camino"));
  const mayor = Math.max(rapida.segundos, tranquila.segundos);
  const filaFranja = (nombre: string, r: Resumen) => {
    const item = elemento("div", "franja-fila");
    const barra = elemento("div", "franja");
    barra.style.width = `${(100 * r.segundos) / mayor}%`;
    barra.setAttribute("role", "img");
    barra.setAttribute("aria-label", `${nombre}: en promedio ${veces(r.exposicion / (r.segundos || 1))} el promedio de la ciudad`);
    for (const tramo of franja(r, CORTES_RIESGO)) {
      const parte = elemento("span");
      parte.style.flexGrow = String(tramo.fraccion);
      parte.style.backgroundColor = RAMPA[tramo.clase];
      barra.append(parte);
    }
    item.append(elemento("span", "franja-nombre", nombre), barra);
    return item;
  };
  if (misma) franjas.append(filaFranja("Sugerida", tranquila));
  else franjas.append(filaFranja("Tranquila", tranquila), filaFranja("Rápida", rapida));
  const ejes = elemento("div", "franja-ejes");
  ejes.append(elemento("span", "", "Salida"), elemento("span", "", "Más claro = menos reportes"), elemento("span", "", "Llegada"));
  franjas.append(ejes);
  panel.append(franjas);

  let explicacion = c.explicacion;
  if (c.vale && sectores) {
    const nombres = sectoresEvitados(rapida, tranquila)
      .map((i) => sectores!.features[i]?.properties.nombre)
      .filter((n): n is string => Boolean(n));
    if (nombres.length) explicacion += ` El desvío evita tramos por ${lista(nombres)}.`;
  }
  panel.append(elemento("p", "explicacion", explicacion));

  const prioridad = elemento("fieldset", "prioridad");
  prioridad.append(elemento("legend", "", "¿Cuánto pesa la tranquilidad frente al tiempo?"));
  const opciones = elemento("div", "segmentos");
  for (const p of PRIORIDADES) {
    const etiqueta = elemento("label");
    const radio = elemento("input");
    radio.type = "radio";
    radio.name = "prioridad";
    radio.value = p.id;
    radio.checked = p.id === estado.prioridad;
    etiqueta.append(radio, elemento("span", "", p.nombre));
    opciones.append(etiqueta);
  }
  prioridad.append(opciones);
  const elegida = PRIORIDADES.find((p) => p.id === estado.prioridad)!;
  const equivale = (1 + 2 * elegida.alfa).toLocaleString("es-CO", { maximumFractionDigits: 1 });
  prioridad.append(
    elemento("p", "nota", `Con «${elegida.nombre}», un minuto por una calle con el doble de reportes que el promedio cuenta como ${equivale} minutos.`),
  );
  panel.append(prioridad);

  if (modo === "carro") panel.append(elemento("p", "nota", "Tiempos sin trancón: tómalos como el mejor caso."));
  const calculo = elemento("p", "calculo");
  const duracion =
    segundosCalculo < 0.01 ? "menos de una centésima de segundo" : `${segundosCalculo.toLocaleString("es-CO", { maximumFractionDigits: 2 })} s`;
  calculo.textContent = `Calculado en tu dispositivo en ${duracion}.`;
  panel.append(calculo);
}

function pintarCarga(modo: Modo): void {
  const panel = $("resultado");
  const texto = elemento("p", "mensaje", `Descargando las calles de Bogotá para ir ${modo === "pie" ? "a pie" : MODOS[modo].verbo}…`);
  const barra = elemento("div", "descarga", "0 %");
  barra.dataset.descarga = modo;
  const nota = elemento("p", "nota", "Solo la primera vez: después la ruta se calcula en tu dispositivo, sin enviar tu origen ni tu destino.");
  panel.replaceChildren(texto, barra, nota);
}

function pintarMensaje(texto: string, problema = false): void {
  $("resultado").replaceChildren(elemento("p", problema ? "mensaje problema" : "mensaje", texto));
  medirHoja();
}

function actualizarTrayecto(): void {
  const { origen, destino } = estado;
  $("trayecto").textContent = origen && destino ? `${origen.nombre} → ${destino.nombre}` : "";
}

// ---------------------------------------------------------------- Zonas del mapa

function colorZonas() {
  const propiedad = `rr_${estado.modo}`;
  return expresionColor(propiedad, { cortes: CORTES_RIESGO, colores: RAMPA });
}

function dibujarEscala(): void {
  const barra = elemento("div", "escala-barra");
  barra.setAttribute("role", "list");
  const nombres = ["Muchos menos", "Menos", "Cerca del promedio", "Más", "Muchos más"];
  barra.append(
    ...RAMPA.map((color, i) => {
      const tramo = elemento("span", "escala-tramo");
      tramo.dataset.clase = String(i);
      tramo.style.backgroundColor = color;
      tramo.style.opacity = String(OPACIDAD_ZONAS + 0.2);
      tramo.setAttribute("role", "listitem");
      tramo.setAttribute("aria-label", `${nombres[i]} reportes que el promedio`);
      return tramo;
    }),
  );
  const valores = elemento("div", "escala-valores");
  valores.setAttribute("aria-hidden", "true");
  valores.style.setProperty("--clases", String(RAMPA.length));
  valores.append(
    ...CORTES_RIESGO.map((corte, i) => {
      const valor = elemento("span", "", `${corte.toLocaleString("es-CO")}×`);
      valor.style.gridColumn = String(i + 2);
      return valor;
    }),
  );
  const extremos = elemento("div", "escala-extremos");
  extremos.setAttribute("aria-hidden", "true");
  extremos.append(elemento("span", "", "Menos reportes"), elemento("span", "", "Promedio = 1×"), elemento("span", "", "Más reportes"));
  $("escala").replaceChildren(barra, valores, extremos);
}

/** Ficha de un sector al pasar el mouse (en computador; en el celular, tocar el mapa marca puntos). */
function activarFicha(): void {
  const ficha = $("ficha");
  let activo: string | number | undefined;

  const marcar = (id: string | number | undefined, clase?: number) => {
    if (activo !== undefined) mapa.setFeatureState({ source: "sectores", id: activo }, { activo: false });
    activo = id;
    if (activo !== undefined) mapa.setFeatureState({ source: "sectores", id: activo }, { activo: true });
    document.querySelectorAll<HTMLElement>(".escala-tramo").forEach((tramo) => {
      tramo.classList.toggle("activo", clase !== undefined && tramo.dataset.clase === String(clase));
    });
  };
  const ocultar = () => {
    marcar(undefined);
    ficha.hidden = true;
  };

  mapa.on("mousemove", "sectores", (evento: MapLayerMouseEvent) => {
    if (celular.matches) return;
    const sector = evento.features?.[0];
    if (!sector) return;
    const p = sector.properties as Sector;
    const rr = p[`rr_${estado.modo}` as const] ?? 1;
    const clase = CORTES_RIESGO.filter((c) => rr >= c).length;
    marcar(sector.id, clase);

    const muestra = elemento("span", "ficha-muestra");
    muestra.style.backgroundColor = RAMPA[clase];
    const nivelEl = elemento("p", "ficha-nivel");
    nivelEl.append(muestra, `${veces(rr)} el promedio ${estado.modo === "pie" ? "a pie" : MODOS[estado.modo].verbo}`);
    const texto = nivel(rr);
    const ficha1 = elemento("p", "ficha-cifras", texto.charAt(0).toUpperCase() + texto.slice(1));
    const ficha2 = elemento("p", "ficha-cifras");
    ficha2.append(elemento("strong", "", numero(p.hurtos)), ` llamadas por hurto en ${meta?.anio ?? "el último año"}`);
    ficha.replaceChildren(
      elemento("p", "ficha-rotulo", "Sector catastral"),
      elemento("p", "ficha-nombre", p.nombre || "Sin nombre"),
      ficha1,
      ficha2,
      nivelEl,
    );
    ficha.hidden = false;
    const x = Math.min(evento.originalEvent.clientX + 16, window.innerWidth - ficha.offsetWidth - 12);
    const y = Math.min(evento.originalEvent.clientY + 16, window.innerHeight - ficha.offsetHeight - 12);
    ficha.style.transform = `translate(${Math.max(12, x)}px, ${Math.max(12, y)}px)`;
  });
  mapa.on("mouseleave", "sectores", ocultar);
  mapa.on("dragstart", ocultar);
}

// ---------------------------------------------------------------- Hoja (panel) y utilidades

/** En el celular, el panel es una hoja que asoma abajo y se despliega con la manija. */
function activarHoja(): void {
  $("asa").addEventListener("click", () => abrirHoja(!$("hoja").classList.contains("abierta")));
  window.addEventListener("resize", medirHoja);
  celular.addEventListener("change", () => {
    if (!celular.matches) $("viaje").classList.remove("compacta");
    medirHoja();
  });
  medirHoja();
}

function abrirHoja(abrir: boolean): void {
  if (!celular.matches) return;
  const hoja = $("hoja");
  const asa = $("asa");
  hoja.classList.toggle("abierta", abrir);
  asa.setAttribute("aria-expanded", String(abrir));
  asa.querySelector(".solo-lectores")!.textContent = abrir ? "Mostrar menos información" : "Mostrar más información";
  if (!abrir) hoja.scrollTop = 0;
}

/** Calcula cuánto asoma la hoja en el celular y deja ese espacio libre en el mapa. */
function medirHoja(): void {
  const raiz = document.documentElement;
  if (!celular.matches) {
    raiz.style.removeProperty("--asomar");
    mapa.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
    return;
  }
  // Asoma hasta las rutas si hay resultado; si no, hasta el formulario y el primer mensaje.
  const hasta =
    document.querySelector<HTMLElement>("#resultado .rutas") ??
    document.querySelector<HTMLElement>("#resultado .descarga, #resultado .mensaje, #ejemplo") ??
    $("viaje");
  const asomar = Math.round(hasta.offsetTop + hasta.offsetHeight + 16);
  raiz.style.setProperty("--asomar", `${asomar}px`);
}

function margenes() {
  if (!celular.matches) return { top: 70, bottom: 70, left: 70, right: 70 };
  const asomar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--asomar")) || 240;
  return { top: 70, bottom: asomar + 24, left: 36, right: 36 };
}

function guardarUrl(): void {
  const p = new URLSearchParams();
  const coordenadas = (punto: Punto) => `${punto[1].toFixed(5)},${punto[0].toFixed(5)}`;
  if (estado.origen) p.set("desde", `${coordenadas(estado.origen.punto)},${estado.origen.nombre}`);
  if (estado.destino) p.set("hasta", `${coordenadas(estado.destino.punto)},${estado.destino.nombre}`);
  if (estado.modo !== "pie") p.set("modo", estado.modo);
  if (estado.prioridad !== "moderado") p.set("prioridad", estado.prioridad);
  const texto = p.toString();
  history.replaceState(null, "", texto ? `#${texto}` : location.pathname + location.search);
}

/** Lee un recorrido compartido en el enlace (#desde=lat,lon,nombre&hasta=…&modo=…). */
function leerUrl(): void {
  const p = new URLSearchParams(location.hash.slice(1));
  const modo = p.get("modo");
  if (modo && modo in MODOS) {
    estado.modo = modo as Modo;
    const radio = document.querySelector<HTMLInputElement>(`input[name="modo"][value="${modo}"]`);
    if (radio) radio.checked = true;
    $("modo-zonas").textContent = modo === "pie" ? "a pie" : MODOS[estado.modo].verbo;
  }
  const prioridad = p.get("prioridad");
  if (PRIORIDADES.some((x) => x.id === prioridad)) estado.prioridad = prioridad as Prioridad;
  for (const [clave, cual] of [["desde", "origen"], ["hasta", "destino"]] as const) {
    const valor = p.get(clave);
    if (!valor) continue;
    const [lat, lon, ...nombre] = valor.split(",");
    const punto: Punto = [Number(lon), Number(lat)];
    if (!punto.every(Number.isFinite) || !dentroDeBogota(punto)) continue;
    estado[cual] = { punto, nombre: nombre.join(",") || "Punto en el mapa" };
    entrada(cual).value = estado[cual]!.nombre;
    mostrarMarcador(cual, punto);
  }
  actualizarTrayecto();
}

async function leerJson<T>(url: string): Promise<T | null> {
  try {
    const respuesta = await fetch(url);
    return respuesta.ok ? await respuesta.json() : null;
  } catch {
    return null;
  }
}

let temporizador = 0;
function avisar(texto: string): void {
  const aviso = $("aviso");
  aviso.textContent = texto;
  aviso.hidden = false;
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(ocultarAviso, 4500);
}

function ocultarAviso(): void {
  $("aviso").hidden = true;
}

function elemento<K extends keyof HTMLElementTagNameMap>(etiqueta: K, clase = "", texto?: string) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}
