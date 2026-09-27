import { describe, expect, it } from "vitest";
import { clasificar, cuantil, etiquetas, expresionColor, RAMPA, redondear } from "./escala";

describe("cuantil", () => {
  it("interpola entre valores", () => {
    expect(cuantil([0, 10], 0.5)).toBe(5);
    expect(cuantil([1, 2, 3, 4, 5], 0)).toBe(1);
    expect(cuantil([1, 2, 3, 4, 5], 1)).toBe(5);
  });
});

describe("redondear", () => {
  it("deja dos cifras significativas", () => {
    expect(redondear(1234)).toBe(1200);
    expect(redondear(7.34)).toBe(7.3);
    expect(redondear(0)).toBe(0);
  });
});

describe("clasificar", () => {
  it("reparte los valores en 5 clases con cortes crecientes", () => {
    const valores = Array.from({ length: 1000 }, (_, i) => i * 3);
    const { cortes, colores } = clasificar(valores);
    expect(cortes).toHaveLength(4);
    expect([...cortes].sort((a, b) => a - b)).toEqual(cortes);
    expect(colores).toEqual(RAMPA);
  });

  it("descarta cortes repetidos cuando hay muchos ceros", () => {
    const valores = [...Array(90).fill(0), 5, 10, 20, 40, 80, 100, 200, 300, 400, 500];
    const { cortes, colores } = clasificar(valores);
    expect(new Set(cortes).size).toBe(cortes.length);
    expect(colores).toHaveLength(cortes.length + 1);
    expect(colores[0]).toBe(RAMPA[0]);
    expect(colores[colores.length - 1]).toBe(RAMPA[RAMPA.length - 1]);
  });

  it("ignora valores que no son números finitos", () => {
    expect(clasificar([Number.NaN, 1, 2, Infinity]).colores.length).toBeGreaterThan(0);
  });

  it("funciona sin datos", () => {
    expect(clasificar([])).toEqual({ cortes: [], colores: [RAMPA[2]] });
  });
});

describe("etiquetas", () => {
  it("describe cada clase con miles en formato colombiano", () => {
    expect(etiquetas([500, 1200, 3000])).toEqual([
      "Menos de 500",
      "500 a 1.200",
      "1.200 a 3.000",
      "3.000 o más",
    ]);
  });
});

describe("expresionColor", () => {
  it("arma una expresión step de MapLibre", () => {
    const expresion = expresionColor("hurtos_km2", { cortes: [10, 20], colores: ["#a", "#b", "#c"] });
    expect(expresion).toEqual(["step", ["get", "hurtos_km2"], "#a", 10, "#b", 20, "#c"]);
  });

  it("usa un solo color si no hay cortes", () => {
    expect(expresionColor("x", { cortes: [], colores: ["#a"] })).toBe("#a");
  });
});
