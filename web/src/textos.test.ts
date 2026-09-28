import { describe, expect, it } from "vitest";
import type { Resumen } from "./grafo";
import { comparar, distanciaTexto, franja, lista, minutos, nivel, sectoresEvitados } from "./textos";

function ruta(tramos: [segundos: number, riesgo: number, sector: number][]): Resumen {
  const detalle = tramos.map(([segundos, riesgo, sector]) => ({ segundos, riesgo, sector }));
  return {
    segundos: detalle.reduce((s, t) => s + t.segundos, 0),
    metros: 0,
    exposicion: detalle.reduce((s, t) => s + t.segundos * t.riesgo, 0),
    coordenadas: [],
    detalle,
  };
}

describe("formatos", () => {
  it("minutos y horas", () => {
    expect(minutos(20)).toBe("1 min");
    expect(minutos(14 * 60 + 20)).toBe("14 min");
    expect(minutos(3600)).toBe("1 h");
    expect(minutos(95 * 60)).toBe("1 h 35 min");
  });

  it("metros y kilómetros", () => {
    expect(distanciaTexto(433)).toBe("430 m");
    expect(distanciaTexto(1840)).toBe("1,8 km");
  });

  it("listas y niveles", () => {
    expect(lista(["Las Nieves"])).toBe("Las Nieves");
    expect(lista(["A", "B", "C"])).toBe("A, B y C");
    expect(nivel(1)).toBe("reportes cercanos al promedio");
    expect(nivel(3)).toBe("muchos más reportes que el promedio");
  });
});

describe("comparación de rutas", () => {
  const rapida = ruta([[300, 3, 5], [300, 1, 6]]);

  it("cuenta minutos extra y riesgo evitado", () => {
    const tranquila = ruta([[400, 0.8, 8], [320, 1, 6]]);
    const c = comparar(rapida, tranquila, false);
    expect(c.vale).toBe(true);
    expect(c.titular).toBe("2 min más para pasar por calles con 47 % menos riesgo.");
    expect(c.explicacion).toContain("2,0× el promedio");
  });

  it("no presume diferencias menores al 10 %", () => {
    const parecida = ruta([[300, 2.8, 9], [300, 1, 6]]);
    const c = comparar(rapida, parecida, false);
    expect(c.vale).toBe(false);
    expect(c.titular).toContain("riesgo parecido");
  });

  it("reconoce cuando la rápida ya es la tranquila", () => {
    expect(comparar(rapida, rapida, true).titular).toBe("La ruta más rápida ya es la más tranquila.");
  });

  it("nombra los sectores que se evitan y no los que se comparten", () => {
    const tranquila = ruta([[400, 0.8, 8], [320, 1, 6]]);
    expect(sectoresEvitados(rapida, tranquila)).toEqual([5]);
    expect(sectoresEvitados(rapida, rapida)).toEqual([]);
  });

  it("franja de riesgo: une tramos seguidos del mismo nivel", () => {
    const r = ruta([[100, 0.5, 1], [100, 0.55, 1], [200, 3, 2]]);
    expect(franja(r, [0.6, 0.85, 1.2, 2])).toEqual([
      { fraccion: 0.5, clase: 0 },
      { fraccion: 0.5, clase: 4 },
    ]);
  });
});
