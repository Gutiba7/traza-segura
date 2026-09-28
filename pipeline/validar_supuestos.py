#!/usr/bin/env python3
"""Valida con datos reales los supuestos del modelo de riesgo (pasos 1.2 y 1.4 del PLAN).

1. Descifra los códigos de "Incidente Reportado" (llamadas a la Línea 123 por zona) comparando
   cada columna con las llamadas por UPZ y tipo de incidente del archivo NUSE: si una columna es
   igual a la suma de ciertos tipos, ese es su significado.
2. Comprueba si las llamadas por hurto siguen el mismo patrón geográfico que las denuncias de
   hurto (por localidad), también después de descontar el tamaño de cada localidad.
3. Mide si el patrón por sector catastral se repite de un año a otro, cuántos sectores tienen
   pocos casos (lo que obliga a suavizar) y el tamaño real de los sectores.

Solo usa la biblioteca estándar de Python.
Uso: python3 pipeline/validar_supuestos.py
"""
import csv
import io
import math
import os
import statistics
from collections import defaultdict
from itertools import combinations

from datos_abiertos import DAI_ANUAL, IR_ANUAL, IR_ENE_AGO, NUSE, area_km2, campo, capa, capas
from explorar_fuentes import abrir, lineas, p

CODIGOS_IR = ["R", "N", "AOP", "MM", "M", "D", "PIA", "H", "HC"]
# Pares (código de llamadas, código de denuncias) que deberían moverse juntos si ambas fuentes
# miden el mismo fenómeno.
PARES = [("H", "HP"), ("H", "HCE"), ("H", "HB"), ("D", "H"), ("R", "LP"), ("MM", "VI"), ("M", "VI")]


# ---------------------------------------------------------------- utilidades

def pearson(x, y):
    mx, my = statistics.fmean(x), statistics.fmean(y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    return sxy / (sx * sy) if sx and sy else float("nan")


def rangos(v):
    orden = sorted(range(len(v)), key=v.__getitem__)
    r = [0.0] * len(v)
    i = 0
    while i < len(orden):
        j = i
        while j + 1 < len(orden) and v[orden[j + 1]] == v[orden[i]]:
            j += 1
        for k in range(i, j + 1):
            r[orden[k]] = (i + j) / 2
        i = j + 1
    return r


def spearman(x, y):
    return pearson(rangos(x), rangos(y))


# ---------------------------------------------------------------- 1. Diccionario de códigos

def leer_nuse(anios):
    """Llamadas NUSE agregadas: {(año, mes, upz, tipo): cantidad} y {tipo: nombre}."""
    r, err = abrir(NUSE, timeout=300)
    if err:
        raise SystemExit(f"No se pudo abrir el archivo NUSE: {err}")
    conteo, nombres = defaultdict(float), {}
    with r:
        texto = io.TextIOWrapper(r, encoding="utf-8-sig", errors="replace", newline="")
        for fila in csv.DictReader(texto, delimiter=";"):
            anio = int(fila["ANIO"])
            if anio not in anios:
                continue
            tipo = fila["TIPO_INCIDENTE"].strip()
            nombres[tipo] = fila["TIPO_DETALLE"].strip()
            conteo[(anio, int(fila["MES"]), fila["COD_UPZ"].strip(), tipo)] += float(fila["CANT_INCIDENTES"] or 0)
    return conteo, nombres


def por_upz(conteo, anio, meses):
    total = defaultdict(float)
    for (a, m, upz, tipo), n in conteo.items():
        if a == anio and m in meses:
            total[(upz, tipo)] += n
    return total


def descomponer(y, candidatos, max_tipos=5, max_candidatos=15, holgura=0.05):
    """Busca la combinación más pequeña de tipos NUSE cuya suma reproduce la columna y.

    Como los conteos nunca son negativos, un tipo que forma parte de la suma tiene que "caber"
    debajo de y en todas las UPZ (con una holgura pequeña por diferencias de registro). De los
    tipos que caben se toman los más correlacionados con y y se prueban todas sus combinaciones.
    Devuelve los tipos elegidos y el error relativo que queda (0 % = coincidencia exacta).
    """
    total = sum(y) or 1
    aptos = []
    for tipo, x in candidatos.items():
        suma_x = sum(x)
        exceso = sum(max(0.0, b - a) for a, b in zip(y, x))
        r = pearson(y, x) if suma_x else float("nan")
        if suma_x and exceso <= holgura * suma_x and r > 0:
            aptos.append((r, tipo))
    aptos = [t for _, t in sorted(aptos, reverse=True)[:max_candidatos]]
    mejor = ([], 1.0)
    for k in range(1, max_tipos + 1):
        for combo in combinations(aptos, k):
            error = sum(abs(a - sum(candidatos[t][i] for t in combo)) for i, a in enumerate(y)) / total
            if error < mejor[1] - 1e-9:
                mejor = (list(combo), error)
        if mejor[1] < 0.01:
            break  # ya hay una combinación exacta con el menor número de tipos
    return mejor


def descifrar_codigos(ir_upz, conteo, nombres, anio, meses, etiqueta):
    upzs = [f["properties"].get("CMIUUPLA") for f in ir_upz]
    nuse = por_upz(conteo, anio, meses)
    tipos = sorted({t for (_, t) in nuse})
    candidatos = {t: [nuse.get((u, t), 0.0) for u in upzs] for t in tipos}
    en_comun = sum(1 for u in upzs if any((u, t) in nuse for t in tipos))
    p(f"\n### Códigos de «Incidente Reportado» frente a NUSE ({etiqueta})")
    p(f"- UPZ en el archivo de zonas: {len(upzs)} · con datos en NUSE: {en_comun}")
    p("\n| Código | Total | Tipos NUSE cuya suma lo reproduce | Error | Tipos más parecidos (correlación) |")
    p("|---|---|---|---|---|")
    resultado = {}
    for codigo in CODIGOS_IR:
        y = [campo(f["properties"], codigo, anio) or 0.0 for f in ir_upz]
        if not any(y):
            p(f"| `{codigo}` | 0 | sin datos | — | — |")
            continue
        elegidos, error = descomponer(y, candidatos)
        parecidos = sorted(((pearson(y, x), t) for t, x in candidatos.items() if any(x)), reverse=True)[:3]
        texto = "; ".join(f"{t} {nombres.get(t, '?')}" for t in elegidos) or "—"
        pistas = "; ".join(f"{t} {nombres.get(t, '?')} ({r:.2f})" for r, t in parecidos)
        p(f"| `{codigo}` | {sum(y):,.0f} | {texto} | {error:.1%} | {pistas} |")
        resultado[codigo] = (elegidos, error)
    return resultado


# ---------------------------------------------------------------- 2. Llamadas frente a denuncias

def comparar_con_denuncias(ir_loc, dai_loc, anio):
    def por_localidad(elementos, codigos):
        tabla = {}
        for f in elementos:
            props = f["properties"]
            if not f.get("geometry"):
                continue  # registros "sin localización"
            tabla[props.get("CMIULOCAL")] = {c: campo(props, c, anio) or 0.0 for c in codigos}
        return tabla

    codigos_dai = sorted({d for _, d in PARES})
    ir = por_localidad(ir_loc, CODIGOS_IR)
    dai = por_localidad(dai_loc, codigos_dai)
    comunes = sorted(set(ir) & set(dai))
    total_ir = {l: sum(ir[l].values()) or 1 for l in comunes}
    total_dai = {l: sum(dai[l].values()) or 1 for l in comunes}
    p(f"\n### Llamadas a la 123 frente a denuncias, por localidad ({anio}, {len(comunes)} localidades)")
    p("Spearman: 1 = mismo orden entre localidades. «Sin efecto tamaño» compara la *proporción* de cada"
      " tipo dentro de la localidad, para que no gane solo la localidad más grande.")
    p("\n| Llamadas | Denuncias | Spearman (conteos) | Spearman (sin efecto tamaño) |")
    p("|---|---|---|---|")
    for c_ir, c_dai in PARES:
        x = [ir[l][c_ir] for l in comunes]
        y = [dai[l][c_dai] for l in comunes]
        xs = [ir[l][c_ir] / total_ir[l] for l in comunes]
        ys = [dai[l][c_dai] / total_dai[l] for l in comunes]
        p(f"| `{c_ir}` | `{c_dai}` | {spearman(x, y):.2f} | {spearman(xs, ys):.2f} |")


# ---------------------------------------------------------------- 3. Sectores catastrales

def estudiar_sectores(ir_scat, anio):
    validos = [f for f in ir_scat if f.get("geometry")]
    areas = sorted(area_km2(f["geometry"]) for f in validos)
    deciles = statistics.quantiles(areas, n=10)
    p(f"\n### Sectores catastrales ({len(validos)} con geometría)")
    p(f"- Área: mediana {statistics.median(areas):.3f} km² · 10 % más pequeños < {deciles[0]:.3f} km²"
      f" · 10 % más grandes > {deciles[-1]:.3f} km²")
    lado = math.sqrt(statistics.median(areas)) * 1000
    p(f"- Un sector mediano equivale a un cuadrado de {lado:.0f} m de lado"
      f" (≈ {lado / 100:.1f} cuadras de 100 m por lado)")
    p("\n| Código | Estabilidad año anterior → año (Spearman) | Mediana de casos por sector |"
      " Sectores con < 10 casos | Ruido típico en el sector mediano |")
    p("|---|---|---|---|---|")
    for codigo in CODIGOS_IR:
        actual = [campo(f["properties"], codigo, anio) or 0.0 for f in validos]
        previo = [campo(f["properties"], codigo, anio - 1) or 0.0 for f in validos]
        mediana = statistics.median(actual)
        pocos = sum(1 for v in actual if v < 10) / len(actual)
        ruido = f"±{1 / math.sqrt(mediana):.0%}" if mediana > 0 else "—"
        p(f"| `{codigo}` | {spearman(previo, actual):.2f} | {mediana:.0f} | {pocos:.0%} | {ruido} |")


if __name__ == "__main__":
    p("# Validación de supuestos del modelo de riesgo")
    ir_anual, ir_ene_ago, dai_anual = capas(IR_ANUAL), capas(IR_ENE_AGO), capas(DAI_ANUAL)
    p(f"- Archivos: IR anual {list(ir_anual)} · IR ene–ago {list(ir_ene_ago)} · DAI anual {list(dai_anual)}")
    conteo, nombres = leer_nuse({2024, 2025, 2026})
    p(f"- Llamadas NUSE leídas: {sum(conteo.values()):,.0f} (2024–2026) en {len(nombres)} tipos de incidente")

    p("\n## 1. Diccionario de códigos")
    descifrar_codigos(capa(ir_anual, "UPZ"), conteo, nombres, 2025, range(1, 13), "2025 completo, archivo anual")
    descifrar_codigos(capa(ir_ene_ago, "UPZ"), conteo, nombres, 2026, range(1, 9), "enero–agosto 2026")

    p("\n## 2. ¿Las llamadas siguen el patrón de las denuncias?")
    comparar_con_denuncias(capa(ir_anual, "Loc"), capa(dai_anual, "Loc"), 2025)

    p("\n## 3. ¿El patrón por sector es estable y cuánto ruido tiene?")
    estudiar_sectores(capa(ir_anual, "SCAT"), 2025)

    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write("\n".join(lineas) + "\n")
