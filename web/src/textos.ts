// Textos que explican una ruta en palabras sencillas. Funciones puras: se prueban en textos.test.ts.
import type { Resumen } from "./grafo";

export type Modo = "pie" | "bici" | "carro";

export const MODOS: Record<Modo, { nombre: string; verbo: string }> = {
  pie: { nombre: "A pie", verbo: "caminando" },
  bici: { nombre: "En bici", verbo: "en bici" },
  carro: { nombre: "En carro", verbo: "en carro" },
};

/**
 * Cuánto pesa el riesgo frente al tiempo (α en docs/metodologia.md). Con "moderado", un minuto en
 * una calle con el doble de riesgo que el promedio cuenta como 2,5 minutos. Calibrado con trayectos
 * reales del centro: "moderado" acepta desvíos de hasta ~30 % del tiempo solo cuando el riesgo baja
 * mucho; "bastante" puede casi duplicar el tiempo.
 */
export const PRIORIDADES = [
  { id: "poco", nombre: "Poco", alfa: 0.3 },
  { id: "moderado", nombre: "Moderado", alfa: 0.75 },
  { id: "bastante", nombre: "Bastante", alfa: 1.5 },
] as const;
export type Prioridad = (typeof PRIORIDADES)[number]["id"];

/** Por debajo de esta diferencia, las rutas se consideran de riesgo parecido (ruido de los datos). */
export const DIFERENCIA_MINIMA = 0.1;

export function minutos(segundos: number): string {
  const m = Math.max(1, Math.round(segundos / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

export function distanciaTexto(metros: number): string {
  if (metros < 950) return `${Math.max(10, Math.round(metros / 10) * 10)} m`;
  return `${(metros / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

/** Riesgo promedio del recorrido comparado con el de la ciudad (1 = promedio). */
export function riesgoPromedio(r: Resumen): number {
  return r.segundos > 0 ? r.exposicion / r.segundos : 1;
}

export function veces(valor: number): string {
  if (valor < 0.05) return "menos de 0,1×";
  return `${valor.toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}×`;
}

export interface Comparacion {
  /** true si la ruta tranquila es distinta y reduce el riesgo al menos un 10 %. */
  vale: boolean;
  mismaRuta: boolean;
  /** Fracción de exposición evitada (0 a 1). */
  reduccion: number;
  segundosExtra: number;
  titular: string;
  explicacion: string;
}

export function comparar(rapida: Resumen, tranquila: Resumen, mismaRuta: boolean): Comparacion {
  const reduccion = rapida.exposicion > 0 ? Math.max(0, 1 - tranquila.exposicion / rapida.exposicion) : 0;
  const segundosExtra = Math.max(0, tranquila.segundos - rapida.segundos);
  const base = { mismaRuta, reduccion, segundosExtra };
  const promedio = riesgoPromedio(rapida);

  if (mismaRuta || reduccion < DIFERENCIA_MINIMA) {
    const titular = mismaRuta
      ? "La ruta más rápida ya es la más tranquila."
      : "Las dos rutas tienen un riesgo parecido: toma la más rápida.";
    return {
      ...base, vale: false, titular,
      explicacion: `Pasa por calles con ${nivel(promedio)} (${veces(promedio)} el promedio de Bogotá).`,
    };
  }
  const pct = Math.round(reduccion * 100);
  const extra = segundosExtra < 60 ? "Casi el mismo tiempo" : `${minutos(segundosExtra)} más`;
  return {
    ...base, vale: true,
    titular: `${extra} para pasar por calles con ${pct} % menos riesgo.`,
    explicacion:
      `La ruta más rápida pasa por calles con ${nivel(promedio)} (${veces(promedio)} el promedio); ` +
      `la tranquila baja a ${veces(riesgoPromedio(tranquila))}.`,
  };
}

/** Descripción neutral de un riesgo relativo: no se habla de barrios "peligrosos". */
export function nivel(rr: number): string {
  if (rr < 0.6) return "muchos menos reportes que el promedio";
  if (rr < 0.85) return "menos reportes que el promedio";
  if (rr <= 1.2) return "reportes cercanos al promedio";
  if (rr <= 2) return "más reportes que el promedio";
  return "muchos más reportes que el promedio";
}

/**
 * Sectores que la ruta tranquila evita: los que más "exposición" aportan a la ruta rápida y por los
 * que la tranquila casi no pasa. Devuelve índices de sectores, de mayor a menor aporte.
 */
export function sectoresEvitados(rapida: Resumen, tranquila: Resumen, maximo = 2): number[] {
  const aporte = new Map<number, number>();
  for (const t of rapida.detalle) {
    if (t.sector < 0 || t.riesgo <= 1.2) continue;
    aporte.set(t.sector, (aporte.get(t.sector) ?? 0) + t.segundos * (t.riesgo - 1));
  }
  for (const t of tranquila.detalle) {
    if (t.sector < 0 || !aporte.has(t.sector)) continue;
    aporte.set(t.sector, aporte.get(t.sector)! - t.segundos * (t.riesgo - 1));
  }
  return [...aporte.entries()]
    .filter(([, valor]) => valor > 30) // al menos medio minuto de exposición extra evitada
    .sort((a, b) => b[1] - a[1])
    .slice(0, maximo)
    .map(([sector]) => sector);
}

/** Une nombres en una lista legible: "A", "A y B". */
export function lista(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join("");
  return `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

/** Tramos del recorrido para la franja de riesgo: se unen los consecutivos del mismo nivel. */
export function franja(r: Resumen, cortes: number[]): { fraccion: number; clase: number }[] {
  const total = r.segundos || 1;
  const salida: { fraccion: number; clase: number }[] = [];
  for (const t of r.detalle) {
    const clase = cortes.filter((c) => t.riesgo >= c).length;
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.clase === clase) ultimo.fraccion += t.segundos / total;
    else salida.push({ fraccion: t.segundos / total, clase });
  }
  return salida;
}
