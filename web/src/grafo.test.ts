import { describe, expect, it } from "vitest";
import { buscarRuta, descomprimir, distancia, leerGrafo, nodoCercano, resumir, type Grafo, type Punto } from "./grafo";

interface Arista {
  u: number;
  v: number;
  segundos: number;
  metros?: number;
  riesgo?: number;
  sentido?: boolean;
  sector?: number;
  puntos?: Punto[];
}

/** Escribe un grafo en formato TSG1 (el mismo que produce pipeline/formato_grafo.py, sin gzip). */
function codificar(nodos: Punto[], aristas: Arista[]): ArrayBuffer {
  const n = nodos.length, e = aristas.length;
  const g = aristas.reduce((s, a) => s + (a.puntos?.length ?? 0), 0);
  const bytes = 20 + 8 * n + 8 * e + 4 * (e + 1) + 8 * g + 6 * e + 2 * e;
  const buffer = new ArrayBuffer(bytes);
  const vista = new DataView(buffer);
  [..."TSG1"].forEach((c, i) => vista.setUint8(i, c.charCodeAt(0)));
  vista.setUint16(4, 1, true);
  vista.setUint32(8, n, true);
  vista.setUint32(12, e, true);
  vista.setUint32(16, g, true);
  let pos = 20;
  const escribir = (metodo: "setInt32" | "setUint32" | "setUint16" | "setUint8", tamano: number, valores: number[]) => {
    for (const valor of valores) {
      if (tamano === 1) vista.setUint8(pos, valor);
      else vista[metodo as "setInt32"](pos, valor, true);
      pos += tamano;
    }
  };
  const coord = (x: number) => Math.round(x * 1e6);
  escribir("setInt32", 4, nodos.map((p) => coord(p[0])));
  escribir("setInt32", 4, nodos.map((p) => coord(p[1])));
  escribir("setUint32", 4, aristas.map((a) => a.u));
  escribir("setUint32", 4, aristas.map((a) => a.v));
  let acumulado = 0;
  escribir("setUint32", 4, [0, ...aristas.map((a) => (acumulado += a.puntos?.length ?? 0))]);
  escribir("setInt32", 4, aristas.flatMap((a) => (a.puntos ?? []).flatMap((p) => [coord(p[0]), coord(p[1])])));
  escribir("setUint16", 2, aristas.map((a) => Math.round(a.segundos * 10)));
  escribir("setUint16", 2, aristas.map((a) => Math.round(a.metros ?? a.segundos * 1.25)));
  escribir("setUint16", 2, aristas.map((a) => a.sector ?? 65535));
  escribir("setUint8", 1, aristas.map((a) => Math.round((a.riesgo ?? 1) * 40)));
  escribir("setUint8", 1, aristas.map((a) => (a.sentido ? 1 : 0)));
  return buffer;
}

// Un cuadrado de calles: 0 → 1 → 3 por arriba (corto pero con mucho riesgo) o 0 → 2 → 3 por abajo.
//   0 ── 1
//   │    │
//   2 ── 3
const CUADRADO: Punto[] = [[-74.07, 4.61], [-74.068, 4.61], [-74.07, 4.608], [-74.068, 4.608]];
const aristasCuadrado = (sentidoUnico = false): Arista[] => [
  { u: 0, v: 1, segundos: 100, riesgo: 4, sector: 7 },
  { u: 1, v: 3, segundos: 100, riesgo: 4, sector: 7 },
  { u: 0, v: 2, segundos: 120, riesgo: 0.5, sector: 3, puntos: [[-74.0701, 4.609]] },
  { u: 2, v: 3, segundos: 120, riesgo: 0.5, sector: 3, sentido: sentidoUnico },
];

describe("lectura del grafo", () => {
  it("lee nodos, tramos y la lista de vecinos", () => {
    const grafo = leerGrafo(codificar(CUADRADO, aristasCuadrado(true)));
    expect(grafo.nodos).toBe(4);
    expect(grafo.aristas).toBe(4);
    expect(grafo.lon[1]).toBeCloseTo(-74.068, 6);
    // El nodo 3 solo puede salir por los tramos de doble sentido (1 → 3); 2 → 3 es de un solo sentido.
    const vecinos = (n: number) => [...grafo.adyDestino.slice(grafo.inicioAdy[n], grafo.inicioAdy[n + 1])].sort();
    expect(vecinos(3)).toEqual([1]);
    expect(vecinos(2)).toEqual([0, 3]);
  });

  it("rechaza archivos que no son grafos", () => {
    expect(() => leerGrafo(new ArrayBuffer(20))).toThrow();
  });

  it("descomprime gzip y deja pasar un archivo ya descomprimido", async () => {
    const crudo = codificar(CUADRADO, aristasCuadrado());
    const comprimido = await new Response(new Blob([crudo]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    expect(leerGrafo(await descomprimir(comprimido)).aristas).toBe(4);
    expect(await descomprimir(crudo)).toBe(crudo);
  });
});

describe("búsqueda de rutas", () => {
  const grafo = leerGrafo(codificar(CUADRADO, aristasCuadrado()));

  it("sin peso al riesgo toma la más rápida y con peso rodea el riesgo", () => {
    const rapida = buscarRuta(grafo, 0, 3, 0)!;
    const tranquila = buscarRuta(grafo, 0, 3, 1)!;
    expect(rapida.map((t) => t.arista)).toEqual([0, 1]);
    expect(tranquila.map((t) => t.arista)).toEqual([2, 3]);
  });

  it("recorre tramos al revés y respeta el sentido único", () => {
    const vuelta = buscarRuta(grafo, 3, 0, 1)!;
    expect(vuelta).toEqual([{ arista: 3, alReves: true }, { arista: 2, alReves: true }]);
    const unico = leerGrafo(codificar(CUADRADO, aristasCuadrado(true)));
    expect(buscarRuta(unico, 3, 0, 1)!.map((t) => t.arista)).toEqual([1, 0]);
  });

  it("sin camino devuelve null y el mismo punto, una ruta vacía", () => {
    const suelto = leerGrafo(codificar([...CUADRADO, [-74.0, 4.7]], aristasCuadrado()));
    expect(buscarRuta(suelto, 0, 4, 0)).toBeNull();
    expect(buscarRuta(grafo, 2, 2, 0)).toEqual([]);
  });

  it("resume tiempo, distancia, exposición y dibujo en el sentido correcto", () => {
    const r = resumir(grafo, buscarRuta(grafo, 3, 0, 1)!, 3);
    expect(r.segundos).toBe(240);
    expect(r.exposicion).toBeCloseTo(120);
    expect(r.coordenadas).toEqual([CUADRADO[3], CUADRADO[2], [-74.0701, 4.609], CUADRADO[0]]);
    expect(r.detalle[0]).toEqual({ segundos: 120, riesgo: 0.5, sector: 3 });
  });

  it("A* encuentra el mismo costo que una búsqueda exhaustiva (Dijkstra)", () => {
    const azar = aleatorio(7);
    const lado = 12;
    const nodos: Punto[] = [];
    for (let y = 0; y < lado; y++) for (let x = 0; x < lado; x++) nodos.push([-74.1 + x * 0.001, 4.6 + y * 0.001]);
    const aristas: Arista[] = [];
    const unir = (a: number, b: number) => {
      const metros = distancia(nodos[a], nodos[b]) * (1 + azar() * 0.3);
      const velocidad = 4 + azar() * 12; // tramos lentos y rápidos, como en carro
      aristas.push({ u: a, v: b, metros, segundos: metros / velocidad, riesgo: 0.2 + azar() * 4.5, sentido: azar() < 0.3 });
    };
    for (let y = 0; y < lado; y++) {
      for (let x = 0; x < lado; x++) {
        const i = y * lado + x;
        if (x + 1 < lado) (azar() < 0.5 ? unir(i, i + 1) : unir(i + 1, i));
        if (y + 1 < lado) (azar() < 0.5 ? unir(i, i + lado) : unir(i + lado, i));
      }
    }
    const red = leerGrafo(codificar(nodos, aristas));
    for (const alfa of [0, 1, 3]) {
      for (let prueba = 0; prueba < 25; prueba++) {
        const a = Math.floor(azar() * nodos.length);
        const b = Math.floor(azar() * nodos.length);
        const esperado = dijkstra(red, a, b, alfa);
        const ruta = buscarRuta(red, a, b, alfa);
        if (esperado === Infinity) {
          expect(ruta).toBeNull();
        } else {
          expect(costoDe(red, ruta!, alfa)).toBeCloseTo(esperado, 6);
        }
      }
    }
  });
});

describe("esquina más cercana", () => {
  const grafo = leerGrafo(codificar(CUADRADO, aristasCuadrado()));

  it("encuentra el nodo más cercano y no inventa si está lejos", () => {
    expect(nodoCercano(grafo, [-74.0681, 4.6079])).toBe(3);
    expect(nodoCercano(grafo, [-74.0699, 4.6101])).toBe(0);
    expect(nodoCercano(grafo, [-74.2, 4.5])).toBe(-1);
  });
});

function costoDe(grafo: Grafo, ruta: { arista: number }[], alfa: number): number {
  return ruta.reduce((s, { arista }) => s + grafo.tiempo[arista] * (1 + (alfa * grafo.riesgo[arista]) / 40), 0);
}

function dijkstra(grafo: Grafo, origen: number, destino: number, alfa: number): number {
  const costo = new Array(grafo.nodos).fill(Infinity);
  const hecho = new Array(grafo.nodos).fill(false);
  costo[origen] = 0;
  for (;;) {
    let actual = -1;
    for (let i = 0; i < grafo.nodos; i++) if (!hecho[i] && (actual < 0 || costo[i] < costo[actual])) actual = i;
    if (actual < 0 || costo[actual] === Infinity) break;
    hecho[actual] = true;
    for (let j = grafo.inicioAdy[actual]; j < grafo.inicioAdy[actual + 1]; j++) {
      const a = grafo.adyArista[j];
      const nuevo = costo[actual] + grafo.tiempo[a] * (1 + (alfa * grafo.riesgo[a]) / 40);
      if (nuevo < costo[grafo.adyDestino[j]]) costo[grafo.adyDestino[j]] = nuevo;
    }
  }
  return costo[destino];
}

/** Números al azar repetibles (la prueba da siempre lo mismo). */
function aleatorio(semilla: number): () => number {
  let s = semilla;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}
