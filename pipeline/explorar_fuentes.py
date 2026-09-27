#!/usr/bin/env python3
"""Explorador de fuentes de datos de Traza Segura (Fase 1.1 del PLAN).

Consulta, solo en modo lectura, los servicios públicos donde se publican datos de
delitos de Bogotá e imprime un inventario en Markdown: qué capas existen, qué campos
tienen, cuántos registros, qué tan recientes son y si vienen como puntos o por zonas.

Fuentes consultadas:
  1. Servidores ArcGIS REST de la Secretaría de Seguridad (oaiee.scj.gov.co) y de IDECA
  2. Datos Abiertos Bogotá (portal CKAN del Distrito), abriendo por dentro los archivos clave
  3. datos.gov.co (Policía Nacional / SIEDCO, portal Socrata)

Solo usa la biblioteca estándar de Python para correr en cualquier lado sin instalar nada.
Uso: python3 pipeline/explorar_fuentes.py
"""
import io
import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from datetime import datetime, timezone

UA = "TrazaSegura-explorador/0.2 (+https://github.com/Gutiba7/traza-segura)"
SERVIDORES_ARCGIS = {
    "Secretaría de Seguridad (oaiee.scj.gov.co)": "https://oaiee.scj.gov.co/agc/rest/services",
    "IDECA / Catastro Bogotá": "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services",
}
CKAN = "https://datosabiertos.bogota.gov.co/api/3/action"
ORG_SDSCJ = "secretaria-distrital-de-seguridad-convivencia-y-justicia"
# Conjuntos de Datos Abiertos Bogotá cuyos archivos se abren para ver su contenido real.
CONJUNTOS_CLAVE = [
    "delito-de-alto-impacto-bogota-d-c",
    "incidente-reportado-bogota-d-c",
    "incidentes",  # Llamadas a la Línea 123 (NUSE)
    "cuadrantes-de-policia-bogota-d-c",
    "indice-de-condiciones-de-seguridad-nocturna-bogota-d-c",
    "historico-siniestros-bogota-d-c",
    "luminarias_upz-bogota-d-c",
    "cicloruta-bogota-d-c",
]
SOCRATA = {
    "4rxi-8m8d": "Hurto a personas (Policía Nacional)",
    "m8fd-ahd9": "Homicidio (Policía Nacional)",
}
# Servicios ArcGIS que vale la pena revisar en detalle.
INTERES = re.compile(
    r"siedco|cifra|delit|hurt|homic|_hom|incid|lesion|rnmc|nuse|123|cuadr|crim|violen|comport|victim"
    r"|seguridad|polic|lumin|alumbr|siniestr|mujer", re.I)
# Campos que suelen indicar el periodo cubierto.
CAMPO_TIEMPO = re.compile(r"(a[nñ]o|anio|vigencia|year|periodo|fecha)", re.I)
MAX_CAMPOS = 3000     # caracteres máximos al listar campos
LIMITE_MB = 150       # tamaño máximo de archivo que se descarga completo
inalcanzables = set()  # servidores que no respondieron: no se reintentan
lineas = []


def p(texto=""):
    print(texto, flush=True)
    lineas.append(texto)


def limpiar(texto):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", texto or "")).strip()


def abrir(url, params=None, timeout=45, rango=None):
    """Abre una URL; devuelve (respuesta, None) o (None, error). Omite servidores caídos."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    servidor = urllib.parse.urlparse(url).hostname
    if servidor in inalcanzables:
        return None, f"{servidor} no respondió antes; se omite"
    cabeceras = {"User-Agent": UA}
    if rango:
        cabeceras["Range"] = f"bytes=0-{rango - 1}"
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=cabeceras), timeout=timeout), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError) as e:
        inalcanzables.add(servidor)
        return None, f"sin conexión con {servidor}: {getattr(e, 'reason', e)}"


def pedir(url, params=None, timeout=45):
    """Pide un JSON; devuelve (json, None) o (None, error) sin lanzar excepciones."""
    r, err = abrir(url, params, timeout)
    if err:
        return None, err
    try:
        with r:
            return json.load(r), None
    except (ValueError, OSError) as e:
        return None, f"respuesta inválida: {e}"


def descargar(url, limite_mb=LIMITE_MB):
    r, err = abrir(url, timeout=180)
    if err:
        return None, err
    with r:
        tam = r.headers.get("Content-Length")
        if tam and int(tam) > limite_mb * 1e6:
            return None, f"archivo de {int(tam) / 1e6:.0f} MB; no se descarga completo"
        datos = r.read(int(limite_mb * 1e6) + 1)
    if len(datos) > limite_mb * 1e6:
        return None, f"archivo de más de {limite_mb} MB; no se descarga completo"
    return datos, None


def decodificar(datos):
    for codificacion in ("utf-8-sig", "latin-1"):
        try:
            return datos.decode(codificacion)
        except UnicodeDecodeError:
            continue
    return datos.decode("utf-8", errors="replace")


def fecha(valor, en_ms=True):
    if not valor:
        return "—"
    try:
        return datetime.fromtimestamp(valor / 1000 if en_ms else valor, tz=timezone.utc).strftime("%Y-%m-%d")
    except (TypeError, ValueError, OSError):
        return str(valor)


# ---------------------------------------------------------------- 1. ArcGIS REST

def rango_campo(url_capa, campo, es_fecha):
    stats = json.dumps([
        {"statisticType": "min", "onStatisticField": campo, "outStatisticFieldName": "minimo"},
        {"statisticType": "max", "onStatisticField": campo, "outStatisticFieldName": "maximo"},
    ])
    data, _ = pedir(f"{url_capa}/query", {"where": "1=1", "outStatistics": stats, "f": "json"})
    if not data or not data.get("features"):
        return None
    a = {k.lower(): v for k, v in data["features"][0].get("attributes", {}).items()}
    return (fecha(a.get("minimo")), fecha(a.get("maximo"))) if es_fecha else (a.get("minimo"), a.get("maximo"))


def explorar_capa(url_servicio, capa_id):
    url = f"{url_servicio}/{capa_id}"
    meta, err = pedir(url, {"f": "json"})
    if err:
        p(f"- Capa {capa_id}: ❌ {err}")
        return
    if meta.get("type") == "Group Layer":
        p(f"- Capa {capa_id} «{meta.get('name')}» (grupo de capas)")
        return
    conteo, err_c = pedir(f"{url}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"})
    n = conteo.get("count") if conteo else f"❌ {err_c}"
    edicion = meta.get("editingInfo") or {}
    ultima = edicion.get("dataLastEditDate") or edicion.get("lastEditDate")
    p(f"- **Capa {capa_id}: {meta.get('name')}** — geometría: {meta.get('geometryType') or '(tabla, sin geometría)'}"
      f" · registros: {n} · última edición: {fecha(ultima)}")
    descripcion = limpiar(meta.get("description"))
    if descripcion:
        p(f"  - Descripción: {descripcion[:400]}")
    campos = meta.get("fields") or []
    if campos:
        texto = ", ".join(
            c["name"] + (f" «{c['alias']}»" if c.get("alias") and c["alias"] != c["name"] else "")
            + f" [{c.get('type', '').replace('esriFieldType', '')}]"
            for c in campos
        )
        p(f"  - Campos ({len(campos)}): {texto[:MAX_CAMPOS]}{' …' if len(texto) > MAX_CAMPOS else ''}")
        for c in campos:
            es_fecha = c.get("type") == "esriFieldTypeDate"
            if es_fecha or (CAMPO_TIEMPO.search(c["name"]) and c.get("type") != "esriFieldTypeString"):
                r = rango_campo(url, c["name"], es_fecha)
                if r:
                    p(f"  - Rango de {c['name']}: {r[0]} → {r[1]}")
    ids, _ = pedir(f"{url}/query", {"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    if ids and ids.get("objectIds"):
        muestra, _ = pedir(f"{url}/query", {"objectIds": min(ids["objectIds"]), "outFields": "*",
                                            "returnGeometry": "false", "f": "json"})
        if muestra and muestra.get("features"):
            ejemplo = json.dumps(muestra["features"][0].get("attributes", {}), ensure_ascii=False)
            p(f"  - Ejemplo de registro: {ejemplo[:700]}")


def explorar_servicio(url):
    p(f"\n#### {url}")
    info, err = pedir(url, {"f": "json"})
    if err:
        p(f"- ❌ {err}")
        return
    descripcion = limpiar(info.get("serviceDescription") or info.get("description"))
    if descripcion:
        p(f"- Descripción: {descripcion[:500]}")
    p(f"- Máximo de registros por consulta: {info.get('maxRecordCount')}")
    for capa in info.get("layers", []) + info.get("tables", []):
        explorar_capa(url, capa["id"])


def explorar_url_arcgis(url):
    """Revisa una URL de servicio o de capa ArcGIS tal como aparece en un catálogo."""
    base = url.split("?")[0].rstrip("/")
    capa = re.match(r"(.*/(?:MapServer|FeatureServer))/(\d+)$", base)
    if capa:
        p(f"\n#### {base}")
        explorar_capa(capa.group(1), capa.group(2))
    elif base.endswith(("MapServer", "FeatureServer")):
        explorar_servicio(base)


def explorar_servidor(nombre, raiz_url):
    p(f"\n## Servidor ArcGIS: {nombre}")
    raiz, err = pedir(raiz_url, {"f": "json"}, timeout=30)
    if err:
        p(f"- ❌ {err}")
        return
    carpetas = raiz.get("folders", [])
    p(f"- Carpetas: {', '.join(carpetas) or '(ninguna)'}")
    servicios = list(raiz.get("services", []))
    for carpeta in carpetas:
        data, err = pedir(f"{raiz_url}/{carpeta}", {"f": "json"})
        if err:
            p(f"- Carpeta {carpeta}: ❌ {err}")
            continue
        servicios += data.get("services", [])
    tipos = {}
    for s in servicios:
        tipos.setdefault(s["name"], []).append(s["type"])
    relevantes = {n: ts for n, ts in tipos.items() if INTERES.search(n)}
    p(f"- Servicios: {len(tipos)} en total, {len(relevantes)} relacionados con seguridad")
    for nombre_servicio, ts in relevantes.items():
        # Si existe FeatureServer se prefiere: permite descargar datos y no solo verlos.
        tipo = "FeatureServer" if "FeatureServer" in ts else ("MapServer" if "MapServer" in ts else None)
        if tipo:
            explorar_servicio(f"{raiz_url}/{nombre_servicio}/{tipo}")


# ---------------------------------------------------------------- 2. Datos Abiertos Bogotá

def resumir_geojson(datos):
    gj = json.loads(decodificar(datos))
    elementos = gj.get("features", [])
    geometrias = Counter((f.get("geometry") or {}).get("type") for f in elementos)
    props = elementos[0].get("properties", {}) if elementos else {}
    p(f"      - {len(elementos)} elementos · geometría: {dict(geometrias)}")
    p(f"      - Campos ({len(props)}): {', '.join(props)[:MAX_CAMPOS]}")
    for campo in (c for c in props if CAMPO_TIEMPO.search(c)):
        valores = [f["properties"].get(campo) for f in elementos if f.get("properties", {}).get(campo) is not None]
        if valores:
            try:
                p(f"      - Rango de {campo}: {min(valores)} → {max(valores)}")
            except TypeError:
                pass
    p(f"      - Ejemplo: {json.dumps(props, ensure_ascii=False)[:900]}")


def inspeccionar_geojson(url):
    datos, err = descargar(url)
    if err:
        p(f"    - ⚠️ {err}")
        return
    try:
        if datos[:2] == b"PK":  # es un .zip
            with zipfile.ZipFile(io.BytesIO(datos)) as z:
                for info in z.infolist():
                    p(f"    - Dentro del zip: `{info.filename}` ({info.file_size / 1e6:.1f} MB)")
                    if info.filename.lower().endswith((".geojson", ".json")):
                        resumir_geojson(z.read(info))
        else:
            resumir_geojson(datos)
    except (ValueError, zipfile.BadZipFile) as e:
        p(f"    - ⚠️ no se pudo leer: {e}")


def inspeccionar_csv(url, max_bytes=300_000):
    r, err = abrir(url, timeout=90, rango=max_bytes)
    if err:
        p(f"    - ⚠️ {err}")
        return
    with r:
        total = (r.headers.get("Content-Range") or "").split("/")[-1] or r.headers.get("Content-Length")
        trozo = r.read(max_bytes)
    completo = len(trozo) < max_bytes
    texto = decodificar(trozo).splitlines()
    tam = f"{int(total) / 1e6:.1f} MB" if total and total.isdigit() else "tamaño desconocido"
    p(f"    - Tamaño: {tam} · primeras líneas:")
    for linea in texto[: 80 if completo else 6]:
        p(f"      | {linea[:400]}")


def inspeccionar_conjunto(id_conjunto):
    data, err = pedir(f"{CKAN}/package_show", {"id": id_conjunto})
    p(f"\n### `{id_conjunto}`")
    if err:
        p(f"- ❌ {err}")
        return
    pkg = data["result"]
    p(f"- **{pkg.get('title')}** · entidad: {(pkg.get('organization') or {}).get('title')}"
      f" · modificado: {(pkg.get('metadata_modified') or '')[:10]} · licencia: {pkg.get('license_title')}")
    notas = limpiar(pkg.get("notes"))
    if notas:
        p(f"- {notas[:600]}")
    vistos, csvs = set(), 0
    for r in pkg.get("resources", []):
        formato = (r.get("format") or "").upper().replace(" ", "")
        url = r.get("url") or ""
        p(f"  - [{r.get('format')}] {limpiar(r.get('name'))[:120]} → {url}")
        if formato == "CSV" and csvs < 4:
            csvs += 1
            inspeccionar_csv(url)
        elif formato in vistos:
            continue  # ya se abrió un archivo de este formato (suelen ser versiones del mismo dato)
        elif formato == "GEOJSON":
            vistos.add(formato)
            inspeccionar_geojson(url)
        elif "/rest/services/" in url:
            vistos.add(formato)
            explorar_url_arcgis(url)


def explorar_ckan():
    p("\n## Datos Abiertos Bogotá")
    data, err = pedir(f"{CKAN}/package_search", {"fq": f"organization:{ORG_SDSCJ}", "rows": 1000})
    if err:
        p(f"- ❌ {err}")
    else:
        res = data["result"]
        p(f"- Conjuntos publicados por la Secretaría de Seguridad: {res['count']}")
        p("- Títulos: " + " | ".join(limpiar(c.get("title")) for c in res["results"]))
    for id_conjunto in CONJUNTOS_CLAVE:
        inspeccionar_conjunto(id_conjunto)


# ---------------------------------------------------------------- 3. datos.gov.co

def explorar_socrata():
    p("\n## datos.gov.co (Policía Nacional / SIEDCO)")
    for vid, nombre in SOCRATA.items():
        meta, err = pedir(f"https://www.datos.gov.co/api/views/{vid}.json")
        p(f"\n### {nombre} (`{vid}`)")
        if err:
            p(f"- ❌ {err}")
            continue
        columnas = [c.get("fieldName") for c in meta.get("columns", []) if c.get("fieldName")]
        p(f"- Título oficial: {meta.get('name')} · datos actualizados: {fecha(meta.get('rowsUpdatedAt'), en_ms=False)}"
          f" · licencia: {(meta.get('license') or {}).get('name')}")
        p(f"- Columnas: {', '.join(columnas)}")
        ejemplo, _ = pedir(f"https://www.datos.gov.co/resource/{vid}.json",
                           {"$limit": 1, "$where": "upper(municipio) like '%BOGOT%'"})
        if ejemplo:
            p(f"- Ejemplo: {json.dumps(ejemplo[0], ensure_ascii=False)[:700]}")


if __name__ == "__main__":
    p(f"# Inventario de fuentes — {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC")
    for nombre, url in SERVIDORES_ARCGIS.items():
        explorar_servidor(nombre, url)
    explorar_ckan()
    explorar_socrata()
    if inalcanzables:
        p(f"\n> Servidores que no respondieron desde este equipo: {', '.join(sorted(inalcanzables))}")
    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write("\n".join(lineas) + "\n")
