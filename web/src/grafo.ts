// Motor de rutas: lee el grafo de calles (formato TSG1, ver pipeline/formato_grafo.py) y busca
// caminos con A*. Todo ocurre en el teléfono: ni el origen ni el destino salen del dispositivo.

export const ESCALA_RIESGO = 40;
export const SIN_SECTOR = 65535;
const ESCALA_COORD = 1e6;
/** Metros por grado en Bogotá (latitud ≈ 4,65°). */
export const M_POR_GRADO_LAT = 110_574;
export const M_POR_GRADO_LON = 111_320 * Math.cos((4.65 * Math.PI) / 180);
/** Tamaño de la cuadrícula para encontrar la esquina más cercana (≈ 220 m). */
const CELDA = 0.002;

export type Punto = [number, number]; // [longitud, latitud]

export interface Grafo {
  nodos: number;
  aristas: number;
  /** Coordenadas de cada nodo en grados. */
  lon: Float64Array;
  lat: Float64Array;
  u: Uint32Array;
  v: Uint32Array;
  inicioGeom: Uint32Array;
  geom: Int32Array;
  /** Décimas de segundo para recorrer cada tramo. */
  tiempo: Uint16Array;
  largo: Uint16Array;
  sector: Uint16Array;
  /** Riesgo relativo × 40 (40 = promedio de la ciudad). */
  riesgo: Uint8Array;
  sentido: Uint8Array;
  /** Vecinos de cada nodo (lista compacta): de inicioAdy[n] a inicioAdy[n + 1]. */
  inicioAdy: Uint32Array;
  adyArista: Uint32Array;
  adyDestino: Uint32Array;
  /** Mayor velocidad del grafo (metros por décima de segundo), para la estimación de A*. */
  vmax: number;
  /** Cuadrícula de nodos para buscar el más cercano a un punto. */
  cuadricula: { oeste: number; sur: number; columnas: number; filas: number; inicio: Uint32Array; nodos: Uint32Array };
}

/** Lee el archivo, esté comprimido (gzip) o no: algunos servidores ya lo entregan descomprimido. */
export async function descomprimir(datos: ArrayBuffer): Promise<ArrayBuffer> {
  const bytes = new Uint8Array(datos, 0, Math.min(2, datos.byteLength));
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return datos;
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(flujo).arrayBuffer();
}

export function leerGrafo(buffer: ArrayBuffer): Grafo {
  const vista = new DataView(buffer);
  const magia = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magia !== "TSG1") throw new Error("El archivo no es un grafo de Traza Segura");
  const version = vista.getUint16(4, true);
  if (version !== 1) throw new Error(`Versión de grafo no soportada: ${version}`);
  const n = vista.getUint32(8, true);
  const e = vista.getUint32(12, true);
  const g = vista.getUint32(16, true);

  let pos = 20;
  const tomar = <T>(Tipo: { new (b: ArrayBuffer, o: number, l: number): T; BYTES_PER_ELEMENT: number }, cantidad: number) => {
    const arreglo = new Tipo(buffer, pos, cantidad);
    pos += Tipo.BYTES_PER_ELEMENT * cantidad;
    return arreglo;
  };
  const lonE = tomar(Int32Array, n);
  const latE = tomar(Int32Array, n);
  const u = tomar(Uint32Array, e);
  const v = tomar(Uint32Array, e);
  const inicioGeom = tomar(Uint32Array, e + 1);
  const geom = tomar(Int32Array, 2 * g);
  const tiempo = tomar(Uint16Array, e);
  const largo = tomar(Uint16Array, e);
  const sector = tomar(Uint16Array, e);
  const riesgo = tomar(Uint8Array, e);
  const sentido = tomar(Uint8Array, e);
  if (pos !== buffer.byteLength) throw new Error("El grafo está incompleto o dañado");

  const lon = Float64Array.from(lonE, (x) => x / ESCALA_COORD);
  const lat = Float64Array.from(latE, (y) => y / ESCALA_COORD);

  // Lista de vecinos: cada tramo sirve de u a v y, si es de doble sentido, también de v a u.
  const grado = new Uint32Array(n + 1);
  for (let i = 0; i < e; i++) {
    grado[u[i] + 1]++;
    if (!sentido[i]) grado[v[i] + 1]++;
  }
  for (let i = 0; i < n; i++) grado[i + 1] += grado[i];
  const inicioAdy = grado;
  const lleno = inicioAdy.slice(0, n);
  const total = inicioAdy[n];
  const adyArista = new Uint32Array(total);
  const adyDestino = new Uint32Array(total);
  let vmax = 0;
  for (let i = 0; i < e; i++) {
    let k = lleno[u[i]]++;
    adyArista[k] = i;
    adyDestino[k] = v[i];
    if (!sentido[i]) {
      k = lleno[v[i]]++;
      adyArista[k] = i;
      adyDestino[k] = u[i];
    }
    // Los tramos de pocos metros no cuentan: sus tiempos redondeados exageran la velocidad.
    if (largo[i] >= 10) vmax = Math.max(vmax, (largo[i] + 0.5) / tiempo[i]);
  }

  if (vmax === 0) vmax = 1;
  return {
    nodos: n, aristas: e, lon, lat, u, v, inicioGeom, geom, tiempo, largo, sector, riesgo, sentido,
    inicioAdy, adyArista, adyDestino, vmax, cuadricula: armarCuadricula(lon, lat, inicioAdy),
  };
}

function armarCuadricula(lon: Float64Array, lat: Float64Array, inicioAdy: Uint32Array) {
  let oeste = Infinity, sur = Infinity, este = -Infinity, norte = -Infinity;
  for (let i = 0; i < lon.length; i++) {
    oeste = Math.min(oeste, lon[i]);
    este = Math.max(este, lon[i]);
    sur = Math.min(sur, lat[i]);
    norte = Math.max(norte, lat[i]);
  }
  if (lon.length === 0) oeste = sur = este = norte = 0;
  const columnas = Math.max(1, Math.ceil((este - oeste) / CELDA) + 1);
  const filas = Math.max(1, Math.ceil((norte - sur) / CELDA) + 1);
  const celdaDe = (i: number) => Math.floor((lat[i] - sur) / CELDA) * columnas + Math.floor((lon[i] - oeste) / CELDA);
  const inicio = new Uint32Array(columnas * filas + 1);
  // Solo cuentan los nodos desde los que se puede salir (los demás no sirven de punto de partida).
  const util = (i: number) => inicioAdy[i + 1] > inicioAdy[i];
  for (let i = 0; i < lon.length; i++) if (util(i)) inicio[celdaDe(i) + 1]++;
  for (let c = 0; c < columnas * filas; c++) inicio[c + 1] += inicio[c];
  const lleno = inicio.slice(0, columnas * filas);
  const nodos = new Uint32Array(inicio[columnas * filas]);
  for (let i = 0; i < lon.length; i++) if (util(i)) nodos[lleno[celdaDe(i)]++] = i;
  return { oeste, sur, columnas, filas, inicio, nodos };
}

/** Distancia aproximada en metros (suficiente dentro de una ciudad). */
export function distancia(a: Punto, b: Punto): number {
  return Math.hypot((a[0] - b[0]) * M_POR_GRADO_LON, (a[1] - b[1]) * M_POR_GRADO_LAT);
}

/** Nodo más cercano a un punto, buscando en anillos de celdas. -1 si está a más de maxM metros. */
export function nodoCercano(grafo: Grafo, punto: Punto, maxM = 1500): number {
  const { oeste, sur, columnas, filas, inicio, nodos } = grafo.cuadricula;
  const cx = Math.floor((punto[0] - oeste) / CELDA);
  const cy = Math.floor((punto[1] - sur) / CELDA);
  const celdaM = CELDA * M_POR_GRADO_LON;
  let mejor = -1;
  let mejorD = maxM;
  const anillos = Math.ceil(maxM / celdaM) + 1;
  for (let r = 0; r <= anillos; r++) {
    // Lo más cerca que puede estar un nodo del anillo r es (r - 1) celdas.
    if (mejor >= 0 && (r - 1) * celdaM > mejorD) break;
    for (let y = cy - r; y <= cy + r; y++) {
      if (y < 0 || y >= filas) continue;
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || x >= columnas) continue;
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        const c = y * columnas + x;
        for (let k = inicio[c]; k < inicio[c + 1]; k++) {
          const i = nodos[k];
          const d = distancia(punto, [grafo.lon[i], grafo.lat[i]]);
          if (d < mejorD) {
            mejorD = d;
            mejor = i;
          }
        }
      }
    }
  }
  return mejor;
}

/** Montículo binario de prioridades (el menor sale primero). */
class Monticulo {
  private claves = new Float64Array(1024);
  private valores = new Uint32Array(1024);
  tamano = 0;

  poner(clave: number, valor: number): void {
    if (this.tamano === this.claves.length) {
      const claves = new Float64Array(this.tamano * 2);
      claves.set(this.claves);
      this.claves = claves;
      const valores = new Uint32Array(this.tamano * 2);
      valores.set(this.valores);
      this.valores = valores;
    }
    let i = this.tamano++;
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (this.claves[padre] <= clave) break;
      this.claves[i] = this.claves[padre];
      this.valores[i] = this.valores[padre];
      i = padre;
    }
    this.claves[i] = clave;
    this.valores[i] = valor;
  }

  /** Saca el menor y devuelve [clave, valor]. */
  sacar(): [number, number] {
    const clave = this.claves[0];
    const valor = this.valores[0];
    const ultimaClave = this.claves[--this.tamano];
    const ultimoValor = this.valores[this.tamano];
    let i = 0;
    for (;;) {
      let hijo = 2 * i + 1;
      if (hijo >= this.tamano) break;
      if (hijo + 1 < this.tamano && this.claves[hijo + 1] < this.claves[hijo]) hijo++;
      if (this.claves[hijo] >= ultimaClave) break;
      this.claves[i] = this.claves[hijo];
      this.valores[i] = this.valores[hijo];
      i = hijo;
    }
    this.claves[i] = ultimaClave;
    this.valores[i] = ultimoValor;
    return [clave, valor];
  }
}

export interface Tramo {
  arista: number;
  /** true si se recorre de v a u (al revés de como está guardado). */
  alReves: boolean;
}

/**
 * Camino de menor costo con A*. Costo de cada tramo = tiempo × (1 + alfa × riesgo relativo).
 * Con alfa = 0 sale la ruta más rápida. Como el costo nunca es menor que el tiempo, estimar lo que
 * falta con "distancia en línea recta ÷ velocidad máxima" nunca exagera y A* da el óptimo.
 */
export function buscarRuta(grafo: Grafo, origen: number, destino: number, alfa: number): Tramo[] | null {
  if (origen < 0 || destino < 0) return null;
  if (origen === destino) return [];
  const { lon, lat, inicioAdy, adyArista, adyDestino, tiempo, riesgo } = grafo;
  const costo = new Float64Array(grafo.nodos).fill(Infinity);
  const llegada = new Int32Array(grafo.nodos).fill(-1); // posición en la lista de vecinos
  const previo = new Int32Array(grafo.nodos).fill(-1);
  const xD = lon[destino] * M_POR_GRADO_LON;
  const yD = lat[destino] * M_POR_GRADO_LAT;
  // Un pequeño margen compensa los redondeos del archivo (metros y décimas de segundo).
  const factor = 0.98 / grafo.vmax;
  const estimar = (i: number) => Math.hypot(lon[i] * M_POR_GRADO_LON - xD, lat[i] * M_POR_GRADO_LAT - yD) * factor;
  const k = alfa / ESCALA_RIESGO;

  const abiertos = new Monticulo();
  costo[origen] = 0;
  abiertos.poner(estimar(origen), origen);
  while (abiertos.tamano > 0) {
    const [f, actual] = abiertos.sacar();
    if (actual === destino) break;
    const g = costo[actual];
    if (f > g + estimar(actual) + 1e-9) continue; // entrada vieja: ya se encontró algo mejor
    for (let j = inicioAdy[actual]; j < inicioAdy[actual + 1]; j++) {
      const arista = adyArista[j];
      const siguiente = adyDestino[j];
      const nuevo = g + tiempo[arista] * (1 + k * riesgo[arista]);
      if (nuevo < costo[siguiente]) {
        costo[siguiente] = nuevo;
        llegada[siguiente] = j;
        previo[siguiente] = actual;
        abiertos.poner(nuevo + estimar(siguiente), siguiente);
      }
    }
  }
  if (costo[destino] === Infinity) return null;

  const tramos: Tramo[] = [];
  for (let n = destino; n !== origen; n = previo[n]) {
    const arista = adyArista[llegada[n]];
    tramos.push({ arista, alReves: grafo.u[arista] !== previo[n] });
  }
  return tramos.reverse();
}

export interface Resumen {
  segundos: number;
  metros: number;
  /** Exposición al riesgo: Σ tiempo × riesgo relativo (en segundos "promedio de ciudad"). */
  exposicion: number;
  coordenadas: Punto[];
  /** Por tramo: segundos, riesgo relativo y sector (índice en sectores.geojson o -1). */
  detalle: { segundos: number; riesgo: number; sector: number }[];
}

/** Tiempo, distancia, exposición y dibujo de un camino. */
export function resumir(grafo: Grafo, tramos: Tramo[], inicio: number): Resumen {
  const coordenadas: Punto[] = [[grafo.lon[inicio], grafo.lat[inicio]]];
  const detalle: Resumen["detalle"] = [];
  let segundos = 0, metros = 0, exposicion = 0;
  for (const { arista, alReves } of tramos) {
    const t = grafo.tiempo[arista] / 10;
    const rr = grafo.riesgo[arista] / ESCALA_RIESGO;
    segundos += t;
    metros += grafo.largo[arista];
    exposicion += t * rr;
    const s = grafo.sector[arista];
    detalle.push({ segundos: t, riesgo: rr, sector: s === SIN_SECTOR ? -1 : s });

    const puntos: Punto[] = [];
    for (let p = grafo.inicioGeom[arista]; p < grafo.inicioGeom[arista + 1]; p++) {
      puntos.push([grafo.geom[2 * p] / ESCALA_COORD, grafo.geom[2 * p + 1] / ESCALA_COORD]);
    }
    if (alReves) puntos.reverse();
    const fin = alReves ? grafo.u[arista] : grafo.v[arista];
    coordenadas.push(...puntos, [grafo.lon[fin], grafo.lat[fin]]);
  }
  return { segundos, metros, exposicion, coordenadas, detalle };
}
