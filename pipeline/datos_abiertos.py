"""Piezas comunes para leer los archivos de Datos Abiertos Bogotá (ver docs/fuentes.md).

Solo usa la biblioteca estándar de Python.
"""
import io
import json
import math
import os
import zipfile

from explorar_fuentes import decodificar, descargar

DATOS = "https://datosabiertos.bogota.gov.co/dataset"
# Llamadas a la Línea 123 por zona ("Incidente Reportado"): años completos 2018–2025 y enero–agosto.
IR_ANUAL = f"{DATOS}/ac8ebc76-583c-4c3b-9a2b-0f3791d63886/resource/2a4b73fd-93a7-4b08-8c20-b6ea22182a47/download/ir_geojson.zip"
IR_ENE_AGO = f"{DATOS}/ac8ebc76-583c-4c3b-9a2b-0f3791d63886/resource/ef95540b-f224-4452-a2d4-30d956942a04/download/ir_geojson.zip"
# Denuncias de delitos de alto impacto por localidad, años completos 2018–2025.
DAI_ANUAL = f"{DATOS}/7b270013-42ca-436b-9c1e-3bcb7d280c6b/resource/fc846aa6-68a9-456a-bdd3-f0284e162bd4/download/dai_geojson.zip"
# Llamadas a la Línea 123 por UPZ, mes y tipo de incidente (CSV de 115 MB).
NUSE = (f"{DATOS}/9bdf518e-b756-4865-983f-0521111fbcd1/resource/30d65a8b-d0ed-4e95-977e-0d7cc2ea89ef/download/"
        "datos-abiertllamadastramitadas-c4-bogota_numerounicodeseguridadyemergencias-nuse_linea-123os-nus.csv")

# Latitud de referencia de Bogotá y metros por grado, para pasar coordenadas a metros.
LAT_BOGOTA = 4.65
M_POR_GRADO_LON = 111_320 * math.cos(math.radians(LAT_BOGOTA))
M_POR_GRADO_LAT = 110_574


def campo(props, codigo, anio):
    """Valor de CM<código><aa>CONT. Los nombres largos vienen recortados a 10 letras (CMAOP25CON)."""
    prefijo = f"CM{codigo}{anio % 100:02d}"
    for nombre, valor in props.items():
        if nombre.startswith(prefijo) and "CONT".startswith(nombre[len(prefijo):]):
            return float(valor or 0)
    return None


def capas(url):
    """Descarga un .zip de Datos Abiertos y devuelve {nombre de archivo: lista de elementos}."""
    datos, err = descargar(url)
    if err:
        raise SystemExit(f"No se pudo descargar {url}: {err}")
    with zipfile.ZipFile(io.BytesIO(datos)) as z:
        return {os.path.basename(n): json.loads(decodificar(z.read(n)))["features"]
                for n in z.namelist() if n.lower().endswith(".geojson")}


def capa(archivos, sufijo):
    for nombre, elementos in archivos.items():
        if nombre.lower().endswith(f"{sufijo.lower()}.geojson"):
            return elementos
    raise SystemExit(f"No hay capa *{sufijo}.geojson en {list(archivos)}")


def poligonos(geometria):
    """Lista de polígonos (cada uno, lista de anillos) de un Polygon o MultiPolygon."""
    if not geometria:
        return []
    return [geometria["coordinates"]] if geometria["type"] == "Polygon" else geometria["coordinates"]


def area_km2(geometria):
    """Área aproximada de un polígono (proyección local; error < 1 % en Bogotá)."""
    total = 0.0
    for poligono in poligonos(geometria):
        for i, anillo in enumerate(poligono):
            if max(abs(c[0]) for c in anillo) > 180:  # ningún grado pasa de 180: ya viene en metros
                xs, ys = [c[0] for c in anillo], [c[1] for c in anillo]
            else:  # grados: se pasan a metros alrededor de la latitud de Bogotá
                xs = [c[0] * M_POR_GRADO_LON for c in anillo]
                ys = [c[1] * M_POR_GRADO_LAT for c in anillo]
            a = abs(sum(xs[k] * ys[k + 1] - xs[k + 1] * ys[k] for k in range(len(anillo) - 1))) / 2
            total += a if i == 0 else -a
    return total / 1e6
