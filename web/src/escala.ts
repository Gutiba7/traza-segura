// Escala de colores y utilidades del mapa. Son funciones puras: se prueban en escala.test.ts.
import type { ExpressionSpecification } from "maplibre-gl";

/** Centro y límites aproximados de Bogotá [longitud, latitud]. */
export const BOGOTA = {
  centro: [-74.0817, 4.6533] as [number, number],
  limites: [[-74.35, 4.4], [-73.95, 4.9]] as [[number, number], [number, number]],
};

/**
 * Gama secuencial de un solo tono: azul claro = pocos casos, azul oscuro = muchos.
 * Se evita el rojo a propósito para no pintar barrios como "peligrosos".
 */
export const RAMPA = ["#b7d3f6", "#6da7ec", "#2a78d6", "#1c5cab", "#0d366b"];

export interface Clases {
  /** Valores donde empieza cada clase a partir de la segunda (siempre crecientes). */
  cortes: number[];
  /** Un color por clase: cortes.length + 1 colores. */
  colores: string[];
}

/** Cuantil p (entre 0 y 1) de valores ya ordenados, con interpolación lineal. */
export function cuantil(ordenados: number[], p: number): number {
  const posicion = (ordenados.length - 1) * p;
  const abajo = Math.floor(posicion);
  const arriba = Math.min(abajo + 1, ordenados.length - 1);
  return ordenados[abajo] + (ordenados[arriba] - ordenados[abajo]) * (posicion - abajo);
}

/** Redondea a 2 cifras significativas para que la leyenda sea fácil de leer (1.234 → 1.200). */
export function redondear(valor: number): number {
  return valor === 0 ? 0 : Number(valor.toPrecision(2));
}

/**
 * Divide los valores en hasta n clases con más o menos el mismo número de zonas (cuantiles).
 *
 * Los cortes se calculan uno a uno sobre lo que va quedando: si un corte cae sobre un valor muy
 * repetido (por ejemplo, muchas zonas con 0), esa clase se queda con todos los repetidos y el
 * resto se reparte entre las clases que faltan. Los cortes se redondean para la leyenda y siempre
 * son crecientes, como exige MapLibre.
 */
export function clasificar(valores: number[], n = RAMPA.length): Clases {
  let restantes = valores.filter(Number.isFinite).sort((a, b) => a - b);
  const cortes: number[] = [];
  for (let faltan = n; faltan > 1 && restantes.length > 0; faltan--) {
    const minimo = restantes[0];
    let corte = redondear(cuantil(restantes, 1 / faltan));
    if (corte <= minimo) {
      const siguiente = restantes.find((v) => v > minimo);
      if (siguiente === undefined) break; // todo lo que queda es igual: no hay más clases
      corte = siguiente;
    }
    const encima = restantes.filter((v) => v >= corte);
    if (encima.length === 0) break;
    cortes.push(corte);
    restantes = encima;
  }
  return { cortes, colores: coloresPara(cortes.length + 1) };
}

/** Toma k colores de la rampa, repartidos de claro a oscuro. */
function coloresPara(k: number): string[] {
  if (k >= RAMPA.length) return RAMPA.slice();
  if (k === 1) return [RAMPA[Math.floor(RAMPA.length / 2)]];
  return Array.from({ length: k }, (_, i) => RAMPA[Math.round((i * (RAMPA.length - 1)) / (k - 1))]);
}

/** Índice de la clase (0 = la más clara) a la que pertenece un valor. */
export function claseDe(valor: number, cortes: number[]): number {
  return cortes.filter((corte) => valor >= corte).length;
}

/** Números con separador de miles colombiano (1.200). */
export function numero(valor: number): string {
  return Math.round(valor).toLocaleString("es-CO");
}

/** Texto de la leyenda para cada clase. */
export function etiquetas(cortes: number[]): string[] {
  if (cortes.length === 0) return ["Todas las zonas"];
  return [
    `Menos de ${numero(cortes[0])}`,
    ...cortes.slice(1).map((corte, i) => `${numero(cortes[i])} a ${numero(corte)}`),
    `${numero(cortes[cortes.length - 1])} o más`,
  ];
}

/** Expresión de MapLibre que pinta cada zona según el valor de una propiedad. */
export function expresionColor(propiedad: string, clases: Clases): ExpressionSpecification | string {
  if (clases.cortes.length === 0) return clases.colores[0];
  const pasos = clases.cortes.flatMap((corte, i) => [corte, clases.colores[i + 1]]);
  return ["step", ["get", propiedad], clases.colores[0], ...pasos] as ExpressionSpecification;
}
