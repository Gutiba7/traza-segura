#!/usr/bin/env python3
"""Prepara la capa de sectores catastrales para el mapa de prueba (paso 1.6 del PLAN).

Descarga las llamadas a la Línea 123 por sector catastral, calcula para cada sector las llamadas
por hurto de un año por km² y guarda una versión liviana de la capa para la página web: formas
simplificadas y coordenadas redondeadas a ≈ 1 m, para que cargue rápido en el celular.

Todavía no es el riesgo de las rutas (eso llega en la Fase 2, ver docs/metodologia.md): es la
primera capa de datos reales, para comprobar que caen donde deben.

Solo usa la biblioteca estándar de Python.
Uso: python3 pipeline/preparar_sectores.py [carpeta de salida]   (por defecto web/public/data)
"""
import json
import math
import os
import sys
from datetime import datetime, timezone

from datos_abiertos import IR_ANUAL, M_POR_GRADO_LAT, M_POR_GRADO_LON, area_km2, campo, capa, capas, poligonos

ANIO = 2025
TOLERANCIA_M = 8   # se quitan vértices que se apartan menos de esto de la forma simplificada
DECIMALES = 5      # 5 decimales de grado ≈ 1 m en Bogotá
FUENTE = "Secretaría Distrital de Seguridad, Convivencia y Justicia · Datos Abiertos Bogotá (CC BY-SA 4.0)"


def simplificar(anillo, tolerancia_m=TOLERANCIA_M):
    """Douglas–Peucker sobre un anillo cerrado, midiendo distancias en metros.

    Conserva un vértice solo si se aparta más de la tolerancia de la línea entre los vértices que
    lo rodean. Si el resultado quedara con menos de 4 puntos (no sería un polígono), devuelve el
    anillo original.
    """
    if len(anillo) <= 4:
        return anillo
    pts = [(c[0] * M_POR_GRADO_LON, c[1] * M_POR_GRADO_LAT) for c in anillo]
    conservar = [False] * len(pts)
    conservar[0] = conservar[-1] = True
    pendientes = [(0, len(pts) - 1)]
    while pendientes:
        i, j = pendientes.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        largo = math.hypot(dx, dy)
        lejos, idx = 0.0, None
        for k in range(i + 1, j):
            px, py = pts[k]
            # En un anillo cerrado el primer y el último punto coinciden: se mide al punto.
            d = abs(dy * (px - x1) - dx * (py - y1)) / largo if largo else math.hypot(px - x1, py - y1)
            if d > lejos:
                lejos, idx = d, k
        if idx is not None and lejos > tolerancia_m:
            conservar[idx] = True
            pendientes += [(i, idx), (idx, j)]
    resultado = [c for c, sigue in zip(anillo, conservar) if sigue]
    return resultado if len(resultado) >= 4 else anillo


def geometria_liviana(geometria):
    partes = [[[[round(c[0], DECIMALES), round(c[1], DECIMALES)] for c in simplificar(anillo)]
               for anillo in poligono]
              for poligono in poligonos(geometria)]
    if len(partes) == 1:
        return {"type": "Polygon", "coordinates": partes[0]}
    return {"type": "MultiPolygon", "coordinates": partes}


def preparar(elementos, anio=ANIO):
    """Convierte la capa oficial por sector catastral en la capa liviana del mapa."""
    salida = []
    for elemento in elementos:
        geometria = elemento.get("geometry")
        area = area_km2(geometria)
        if area <= 0:
            continue  # registros "sin localización"
        props = elemento["properties"]
        hurtos = campo(props, "H", anio) or 0.0
        salida.append({
            "type": "Feature",
            "geometry": geometria_liviana(geometria),
            "properties": {
                "id": props.get("CMIUSCAT"),
                "nombre": (props.get("CMNOMSCAT") or "").strip().title(),
                "area_km2": round(area, 3),
                "hurtos": int(hurtos),
                "hurtos_km2": round(hurtos / area),
            },
        })
    return {"type": "FeatureCollection", "features": salida}


def vertices(elementos):
    return sum(len(anillo) for e in elementos for pol in poligonos(e.get("geometry")) for anillo in pol)


if __name__ == "__main__":
    carpeta = sys.argv[1] if len(sys.argv) > 1 else os.path.join("web", "public", "data")
    os.makedirs(carpeta, exist_ok=True)
    originales = capa(capas(IR_ANUAL), "SCAT")
    coleccion = preparar(originales)

    ruta = os.path.join(carpeta, "sectores.geojson")
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(coleccion, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(carpeta, "meta.json"), "w", encoding="utf-8") as f:
        json.dump({
            "generado": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "anio": ANIO,
            "conjunto": "Incidente Reportado (llamadas a la Línea 123) por sector catastral",
            "fuente": FUENTE,
        }, f, ensure_ascii=False, indent=2)

    elementos = coleccion["features"]
    lons = [c[0] for e in elementos for pol in poligonos(e["geometry"]) for c in pol[0]]
    lats = [c[1] for e in elementos for pol in poligonos(e["geometry"]) for c in pol[0]]
    print(f"Sectores: {len(elementos)} de {len(originales)} registros")
    print(f"Vértices: {vertices(originales):,} → {vertices(elementos):,}")
    print(f"Archivo: {ruta} ({os.path.getsize(ruta) / 1e6:.2f} MB)")
    print(f"Extensión: lon {min(lons):.3f} a {max(lons):.3f} · lat {min(lats):.3f} a {max(lats):.3f}")
    print(f"Llamadas por hurto en {ANIO}: {sum(e['properties']['hurtos'] for e in elementos):,}")
