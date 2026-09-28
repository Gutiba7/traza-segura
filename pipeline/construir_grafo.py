#!/usr/bin/env python3
"""Construye los grafos de calles con riesgo que usa la app para calcular rutas (Fase 2 del PLAN).

1. Lee las llamadas a la Línea 123 por sector catastral (hurtos, riñas y disparos) de los últimos
   años, con más peso para lo reciente.
2. Descarga de OpenStreetMap las calles de Bogotá para caminar, ir en bici y en carro.
3. Calcula el riesgo relativo de cada sector con suavizado bayesiano (docs/metodologia.md).
4. Le pone a cada tramo de calle el riesgo de su sector; si el tramo es el límite entre dos
   sectores (muchas avenidas lo son), el promedio de ambos.
5. Escribe grafo-<modo>.bin.gz (ver formato_grafo.py), sectores.geojson y meta.json.

Necesita osmnx (pipeline/requirements.txt). Uso:
    python3 pipeline/construir_grafo.py [carpeta de salida]    (por defecto web/public/data)
Con TS_MUESTRA=1 escribe además grafos pequeños del centro, para pruebas.
"""
import json
import math
import os
import re
import sys
from datetime import datetime, timezone

import osmnx as ox
import shapely
from shapely.geometry import LineString, shape
from shapely.strtree import STRtree

from datos_abiertos import IR_ANUAL, IR_ENE_AGO, M_POR_GRADO_LAT, M_POR_GRADO_LON, campo, capa, capas
from formato_grafo import codificar, recortar
from preparar_sectores import FUENTE, preparar
from riesgo import PESOS_MODO, peso_antiguedad, riesgo_por_modo, riesgo_relativo, suavizar

# Zona urbana de Bogotá (oeste, sur, este, norte): fuera de ella no hay rutas que calcular.
BBOX_URBANO = (-74.23, 4.47, -73.99, 4.84)
# Zona pequeña del centro para los grafos de prueba.
BBOX_MUESTRA = (-74.085, 4.595, -74.045, 4.665)
TIPOS = ("H", "R", "D")
ANIOS_COMPLETOS = 3  # además del año en curso
MODOS = {
    "pie": {"red": "walk", "kmh": 4.5},
    "bici": {"red": "bike", "kmh": 14},
    "carro": {"red": "drive", "kmh": None},  # velocidad según el tipo de vía
}
# Velocidades típicas sin trancón (km/h), dentro del límite urbano de Bogotá.
VELOCIDADES_CARRO = {
    "motorway": 60, "trunk": 50, "primary": 45, "secondary": 40, "tertiary": 35,
    "unclassified": 30, "residential": 25, "living_street": 15, "service": 15,
}
DESFASE_M = 15          # franja a cada lado de un tramo para saber qué sectores toca
SIMPLIFICAR_M = 3       # detalle de la forma de cada tramo
MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
         "jul": 7, "ago": 8, "sep": 9, "oct": 10, "nov": 11, "dic": 12}


# ---------------------------------------------------------------- Datos de sectores

def periodo_reciente(props):
    """Del texto "Ene-Ago (2025vs2026)" saca (2026, 8): año en curso y meses publicados."""
    texto = str(props.get("CMMES", ""))
    m = re.search(r"-\s*([A-Za-zé]{3})\w*\s*\(\s*\d{4}\s*vs\s*(\d{4})\s*\)", texto)
    if not m:
        raise SystemExit(f"No se reconoce el periodo del archivo reciente: {texto!r}")
    return int(m.group(2)), MESES[m.group(1).lower()[:3]]


def cargar_sectores():
    """Devuelve la capa liviana de sectores, sus polígonos, los casos ponderados y la exposición."""
    anual = capa(capas(IR_ANUAL), "SCAT")
    reciente = capa(capas(IR_ENE_AGO), "SCAT")
    anio, meses = periodo_reciente(reciente[0]["properties"])
    fin = anio * 12 + meses
    # (fuente, año, fracción de año cubierta, peso por antigüedad)
    periodos = [("anual", a, 1.0, peso_antiguedad(fin - (a * 12 + 6)))
                for a in range(anio - ANIOS_COMPLETOS, anio)]
    periodos.append(("reciente", anio, meses / 12, peso_antiguedad(meses / 2)))

    coleccion = preparar(anual, anio - 1)
    por_id = {f["properties"]["CMIUSCAT"]: f for f in anual}
    recientes = {f["properties"]["CMIUSCAT"]: f["properties"] for f in reciente}
    geometrias, casos = [], {t: [] for t in TIPOS}
    for elemento in coleccion["features"]:
        sid = elemento["properties"]["id"]
        geometrias.append(shape(por_id[sid]["geometry"]))
        for tipo in TIPOS:
            total = 0.0
            for fuente, a, _, peso in periodos:
                props = por_id[sid]["properties"] if fuente == "anual" else recientes.get(sid, {})
                total += peso * (campo(props, tipo, a) or 0.0)
            casos[tipo].append(total)
    anios_equivalentes = sum(fraccion * peso for _, _, fraccion, peso in periodos)
    texto_periodo = f"{anio - ANIOS_COMPLETOS} a {list(MESES)[meses - 1]}. de {anio}"
    return coleccion, geometrias, casos, anios_equivalentes, texto_periodo


def vecinos_de(geometrias):
    arbol = STRtree(geometrias)
    return [[int(j) for j in arbol.query(g.buffer(1e-5), predicate="intersects") if j != i]
            for i, g in enumerate(geometrias)]


# ---------------------------------------------------------------- Grafos

def descargar_grafo(poligono, modo):
    ox.settings.use_cache = True
    ox.settings.cache_folder = os.environ.get("TS_CACHE_OSM", ".cache/osmnx")
    ox.settings.requests_timeout = 900
    ox.settings.log_console = True
    grafo = ox.graph_from_polygon(poligono, network_type=MODOS[modo]["red"], simplify=True,
                                  retain_all=False, truncate_by_edge=True)
    if modo == "carro":
        grafo = ox.truncate.largest_component(grafo, strongly=True)
    return grafo


def tiempos(grafo, modo):
    """Segundos para recorrer cada tramo en cada modo."""
    if modo == "carro":
        grafo = ox.add_edge_speeds(grafo, hwy_speeds=VELOCIDADES_CARRO, fallback=30)
        grafo = ox.add_edge_travel_times(grafo)
        return grafo, lambda d: float(d["travel_time"])
    metros_por_segundo = MODOS[modo]["kmh"] / 3.6
    return grafo, lambda d: float(d["length"]) / metros_por_segundo


def tramos(grafo, segundos):
    """Nodos y tramos del grafo. Une en un solo tramo de doble sentido los pares ida y vuelta."""
    ids = {n: i for i, n in enumerate(grafo.nodes)}
    nodos = [(float(grafo.nodes[n]["x"]), float(grafo.nodes[n]["y"])) for n in grafo.nodes]
    mejor = {}
    for u, v, datos in grafo.edges(data=True):
        if u == v:
            continue
        clave = (ids[u], ids[v])
        if clave not in mejor or segundos(datos) < segundos(mejor[clave]):
            mejor[clave] = datos
    lista, usados = [], set()
    for (u, v), datos in mejor.items():
        if (u, v) in usados:
            continue
        linea = datos.get("geometry") or LineString([nodos[u], nodos[v]])
        vuelta = mejor.get((v, u))
        doble = vuelta is not None and abs(float(vuelta["length"]) - float(datos["length"])) < 1.0
        if doble:
            usados.add((v, u))
        lista.append({"u": u, "v": v, "linea": linea, "largo_m": float(datos["length"]),
                      "tiempo_s": segundos(datos), "sentido": not doble})
    return nodos, lista


def sectores_de_tramos(lista, geometrias):
    """Para cada tramo: el sector de su punto medio y todos los sectores que toca a los lados."""
    arbol = STRtree(geometrias)
    puntos, dueno = [], []
    for k, t in enumerate(lista):
        linea = t["linea"]
        medio = linea.interpolate(0.5, normalized=True)
        a = linea.interpolate(0.45, normalized=True)
        b = linea.interpolate(0.55, normalized=True)
        dx, dy = (b.x - a.x) * M_POR_GRADO_LON, (b.y - a.y) * M_POR_GRADO_LAT
        norma = math.hypot(dx, dy) or 1.0
        ox_, oy_ = -dy / norma * DESFASE_M / M_POR_GRADO_LON, dx / norma * DESFASE_M / M_POR_GRADO_LAT
        puntos += [(medio.x, medio.y), (medio.x + ox_, medio.y + oy_), (medio.x - ox_, medio.y - oy_)]
        dueno += [k, k, k]
    pares = arbol.query(shapely.points(puntos), predicate="within")
    medio_de = [None] * len(lista)
    toca = [set() for _ in lista]
    for p, s in zip(pares[0], pares[1]):
        k = dueno[p]
        toca[k].add(int(s))
        if p % 3 == 0 and medio_de[k] is None:
            medio_de[k] = int(s)
    return medio_de, toca


def km_por_sector(lista, medio_de, n_sectores):
    km = [0.0] * n_sectores
    for t, s in zip(lista, medio_de):
        if s is not None:
            km[s] += t["largo_m"] / 1000
    return km


# ---------------------------------------------------------------- Todo junto

def construir(coleccion, geometrias, casos, anios_equivalentes, grafos):
    """Calcula el riesgo y codifica los grafos. grafos: {modo: grafo de osmnx}.

    Devuelve ({modo: bytes}, coleccion con riesgo por modo, {modo: estadísticas}).
    """
    n = len(geometrias)
    preparados = {}
    for modo, grafo in grafos.items():
        grafo, segundos = tiempos(grafo, modo)
        nodos, lista = tramos(grafo, segundos)
        medio_de, toca = sectores_de_tramos(lista, geometrias)
        preparados[modo] = (nodos, lista, medio_de, toca)

    # La exposición de cada sector se mide con la red peatonal, la más completa.
    base = preparados.get("pie") or next(iter(preparados.values()))
    exposicion = [km * anios_equivalentes for km in km_por_sector(base[1], base[2], n)]
    vecinos = vecinos_de(geometrias)
    rr_tipo = {t: riesgo_relativo(suavizar(casos[t], exposicion, vecinos), casos[t], exposicion) for t in TIPOS}
    rr_modo = riesgo_por_modo(rr_tipo)

    archivos, estadisticas = {}, {}
    for modo, (nodos, lista, medio_de, toca) in preparados.items():
        rr = rr_modo[modo]
        aristas = []
        for t, s_medio, s_toca in zip(lista, medio_de, toca):
            valores = [rr[s] for s in s_toca]
            puntos = list(t["linea"].simplify(SIMPLIFICAR_M / M_POR_GRADO_LAT).coords)[1:-1]
            aristas.append({
                "u": t["u"], "v": t["v"], "tiempo_s": t["tiempo_s"], "largo_m": t["largo_m"],
                "sector": s_medio, "riesgo": sum(valores) / len(valores) if valores else 1.0,
                "sentido": t["sentido"], "puntos": puntos,
            })
        archivos[modo] = codificar(nodos, aristas)
        estadisticas[modo] = {
            "nodos": len(nodos), "tramos": len(aristas),
            "km": round(sum(a["largo_m"] for a in aristas) / 1000),
            "mb": round(len(archivos[modo]) / 1e6, 2),
        }
    for i, elemento in enumerate(coleccion["features"]):
        for modo in grafos:
            elemento["properties"][f"rr_{modo}"] = round(rr_modo[modo][i], 2)
    return archivos, coleccion, estadisticas


def poligono_urbano(geometrias):
    caja = shapely.box(*BBOX_URBANO)
    union = shapely.union_all([g for g in geometrias if g.intersects(caja)]).intersection(caja)
    return union.buffer(0.003).simplify(0.002)


if __name__ == "__main__":
    carpeta = sys.argv[1] if len(sys.argv) > 1 else os.path.join("web", "public", "data")
    os.makedirs(carpeta, exist_ok=True)
    coleccion, geometrias, casos, anios_eq, periodo = cargar_sectores()
    poligono = poligono_urbano(geometrias)
    grafos = {modo: descargar_grafo(poligono, modo) for modo in MODOS}
    archivos, coleccion, estadisticas = construir(coleccion, geometrias, casos, anios_eq, grafos)

    for modo, datos in archivos.items():
        with open(os.path.join(carpeta, f"grafo-{modo}.bin.gz"), "wb") as f:
            f.write(datos)
    with open(os.path.join(carpeta, "sectores.geojson"), "w", encoding="utf-8") as f:
        json.dump(coleccion, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(carpeta, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "periodo": periodo,
            "conjunto": "Incidente Reportado (llamadas a la Línea 123) por sector catastral",
            "fuente": FUENTE,
            "pesos": PESOS_MODO,
            "velocidades_kmh": {m: c["kmh"] for m, c in MODOS.items() if c["kmh"]},
            "modos": estadisticas,
        }, f, ensure_ascii=False, indent=2)

    if os.environ.get("TS_MUESTRA") == "1":
        for modo, datos in archivos.items():
            with open(os.path.join(carpeta, f"muestra-{modo}.bin.gz"), "wb") as f:
                f.write(recortar(datos, BBOX_MUESTRA))

    print(f"Periodo: {periodo} · años equivalentes: {anios_eq:.2f}")
    for modo, e in estadisticas.items():
        print(f"{modo}: {e['nodos']:,} nodos · {e['tramos']:,} tramos · {e['km']:,} km · {e['mb']} MB")
    rr = [f["properties"]["rr_pie"] for f in coleccion["features"]]
    rr.sort()
    print(f"Riesgo relativo a pie por sector: mínimo {rr[0]} · mediana {rr[len(rr) // 2]} · máximo {rr[-1]}")
