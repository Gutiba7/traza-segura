#!/usr/bin/env python3
"""Explorador de fuentes de datos de Traza Segura (Fase 1.1 del PLAN).

Consulta, solo en modo lectura, los servicios públicos donde se publican datos de
delitos de Bogotá e imprime un inventario en Markdown: qué capas existen, qué campos
tienen, cuántos registros, qué tan recientes son y si vienen como puntos o por zonas.

Fuentes consultadas:
  1. Servidor ArcGIS REST de la Secretaría Distrital de Seguridad (oaiee.scj.gov.co)
  2. Datos Abiertos Bogotá (portal CKAN del Distrito)
  3. datos.gov.co (Policía Nacional / SIEDCO, portal Socrata)

Solo usa la biblioteca estándar de Python para correr en cualquier lado sin instalar nada.
Uso: python3 pipeline/explorar_fuentes.py
"""
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone

UA = "TrazaSegura-explorador/0.1 (+https://github.com/Gutiba7/traza-segura)"
ARCGIS = "https://oaiee.scj.gov.co/agc/rest/services"
CKAN = "https://datosabiertos.bogota.gov.co/api/3/action"
ORG_SDSCJ = "secretaria-distrital-de-seguridad-convivencia-y-justicia"
SOCRATA = {
    "4rxi-8m8d": "Hurto a personas (Policía Nacional)",
    "m8fd-ahd9": "Homicidio (Policía Nacional)",
    "7mn7-vzqp": "Hurto a residencias (Policía Nacional)",
    "t26q-43fj": "Delito de Alto Impacto Bogotá (copia en datos.gov.co)",
}
# Servicios y conjuntos que vale la pena revisar en detalle.
INTERES = re.compile(r"siedco|cifra|delit|hurt|homic|_hom|incid|lesion|rnmc|nuse|123|cuadr|crim|violen|comport|victim", re.I)
# Campos que suelen indicar el periodo cubierto.
CAMPO_TIEMPO = re.compile(r"^(a[nñ]o|anio|ano|vigencia|year|mes|periodo|fecha)", re.I)
MAX_CAMPOS = 3000  # caracteres máximos al listar campos de una capa

lineas = []


def p(texto=""):
    print(texto, flush=True)
    lineas.append(texto)


def limpiar(texto):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", texto or "")).strip()


def pedir(url, params=None, timeout=45):
    """Devuelve (json, None) o (None, error) sin lanzar excepciones."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r), None
    except Exception as e:  # red, HTTP, JSON inválido...
        return None, f"{type(e).__name__}: {e}"


def fecha(valor, en_ms=True):
    if not valor:
        return "—"
    try:
        segundos = valor / 1000 if en_ms else valor
        return datetime.fromtimestamp(segundos, tz=timezone.utc).strftime("%Y-%m-%d")
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
    a = data["features"][0].get("attributes", {})
    mn, mx = a.get("minimo", a.get("MINIMO")), a.get("maximo", a.get("MAXIMO"))
    return (fecha(mn), fecha(mx)) if es_fecha else (mn, mx)


def explorar_capa(url_servicio, capa):
    url = f"{url_servicio}/{capa['id']}"
    meta, err = pedir(url, {"f": "json"})
    if err:
        p(f"- Capa {capa['id']} «{capa.get('name')}»: ❌ {err}")
        return
    if meta.get("type") == "Group Layer":
        p(f"- Capa {capa['id']} «{meta.get('name')}» (grupo de capas)")
        return
    conteo, err_c = pedir(f"{url}/query", {"where": "1=1", "returnCountOnly": "true", "f": "json"})
    n = conteo.get("count") if conteo else f"❌ {err_c}"
    edicion = meta.get("editingInfo") or {}
    ultima = edicion.get("dataLastEditDate") or edicion.get("lastEditDate")
    p(f"- **Capa {capa['id']}: {meta.get('name')}** — geometría: {meta.get('geometryType') or '(tabla, sin geometría)'}"
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
            if es_fecha or CAMPO_TIEMPO.match(c["name"]):
                r = rango_campo(url, c["name"], es_fecha)
                if r:
                    p(f"  - Rango de {c['name']}: {r[0]} → {r[1]}")
    ids, _ = pedir(f"{url}/query", {"where": "1=1", "returnIdsOnly": "true", "f": "json"})
    if ids and ids.get("objectIds"):
        primero = min(ids["objectIds"])
        muestra, _ = pedir(f"{url}/query", {"objectIds": primero, "outFields": "*", "returnGeometry": "false", "f": "json"})
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
    derechos = limpiar(info.get("copyrightText"))
    if derechos:
        p(f"- Créditos/licencia: {derechos[:200]}")
    for capa in info.get("layers", []) + info.get("tables", []):
        explorar_capa(url, capa)


def explorar_arcgis():
    p("## 1. Servidor ArcGIS REST de la SDSCJ (oaiee.scj.gov.co)")
    raiz, err = pedir(ARCGIS, {"f": "json"})
    if err:
        p(f"- ❌ La raíz no respondió: {err}")
        carpetas = ["Tematicos_Pub", "Tematicos_NR"]
    else:
        carpetas = raiz.get("folders", [])
        p(f"- Carpetas: {', '.join(carpetas) or '(ninguna)'}")
        for s in raiz.get("services", []):
            p(f"- Servicio en la raíz: {s['name']} ({s['type']})")
    for carpeta in carpetas:
        data, err = pedir(f"{ARCGIS}/{carpeta}", {"f": "json"})
        p(f"\n### Carpeta {carpeta}")
        if err:
            p(f"- ❌ {err}")
            continue
        tipos = {}
        for s in data.get("services", []):
            tipos.setdefault(s["name"], []).append(s["type"])
        for nombre, ts in tipos.items():
            p(f"- {nombre} ({', '.join(ts)})")
        for nombre, ts in tipos.items():
            if not INTERES.search(nombre):
                continue
            # Si existe FeatureServer se prefiere: permite descargar datos y no solo verlos.
            tipo = "FeatureServer" if "FeatureServer" in ts else ("MapServer" if "MapServer" in ts else None)
            if tipo:
                explorar_servicio(f"{ARCGIS}/{nombre}/{tipo}")


# ---------------------------------------------------------------- 2. Datos Abiertos Bogotá

def imprimir_conjunto(pkg, con_recursos):
    p(f"\n### {pkg.get('title')}")
    p(f"- id: `{pkg.get('name')}` · entidad: {(pkg.get('organization') or {}).get('title')}"
      f" · modificado: {(pkg.get('metadata_modified') or '')[:10]} · licencia: {pkg.get('license_title')}")
    notas = limpiar(pkg.get("notes"))
    if notas:
        p(f"- {notas[:400]}")
    if con_recursos:
        for r in pkg.get("resources", []):
            p(f"  - [{r.get('format')}] {limpiar(r.get('name'))[:120]} → {r.get('url')}")


def explorar_ckan():
    p("\n## 2. Datos Abiertos Bogotá — conjuntos de la SDSCJ")
    data, err = pedir(f"{CKAN}/package_search", {"fq": f"organization:{ORG_SDSCJ}", "rows": 1000})
    if err:
        p(f"- ❌ {err}")
    else:
        res = data["result"]
        p(f"- Total de conjuntos publicados por la SDSCJ: {res['count']}")
        conjuntos = sorted(res["results"], key=lambda x: x.get("metadata_modified", ""), reverse=True)
        p("- Todos los títulos: " + " | ".join(c.get("title", "") for c in conjuntos))
        for pkg in conjuntos:
            if INTERES.search(f"{pkg.get('title')} {pkg.get('name')}"):
                imprimir_conjunto(pkg, con_recursos=True)
    # Capas complementarias de otras entidades, útiles para bici/carro y para la noche.
    for tema in ("siniestros viales", "alumbrado público", "ciclorruta"):
        data, err = pedir(f"{CKAN}/package_search", {"q": tema, "rows": 5})
        p(f"\n### Búsqueda complementaria: «{tema}»")
        if err:
            p(f"- ❌ {err}")
            continue
        for pkg in data["result"]["results"]:
            imprimir_conjunto(pkg, con_recursos=False)
            formatos = sorted({(r.get("format") or "?").upper() for r in pkg.get("resources", [])})
            p(f"  - Formatos: {', '.join(formatos)}")


# ---------------------------------------------------------------- 3. datos.gov.co

def explorar_socrata():
    p("\n## 3. datos.gov.co (Policía Nacional / SIEDCO)")
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
        recurso = f"https://www.datos.gov.co/resource/{vid}.json"
        col_mpio = next((c for c in columnas if "municipio" in c.lower()), None)
        filtro = {"$where": f"upper({col_mpio}) like '%BOGOT%'"} if col_mpio else {}
        total, _ = pedir(recurso, {"$select": "count(*) as n", **filtro})
        if total:
            p(f"- Filas {'de Bogotá' if filtro else 'en total'}: {total[0].get('n')}")
        for col in (c for c in columnas if "fecha" in c.lower()):
            rango, _ = pedir(recurso, {"$select": f"min({col}) as mn, max({col}) as mx", **filtro})
            if rango:
                p(f"- Rango de {col}: {str(rango[0].get('mn'))[:10]} → {str(rango[0].get('mx'))[:10]}")
        ejemplo, _ = pedir(recurso, {"$limit": 1, **filtro})
        if ejemplo:
            p(f"- Ejemplo: {json.dumps(ejemplo[0], ensure_ascii=False)[:700]}")


if __name__ == "__main__":
    p(f"# Inventario de fuentes — {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC")
    explorar_arcgis()
    explorar_ckan()
    explorar_socrata()
    resumen = os.environ.get("GITHUB_STEP_SUMMARY")
    if resumen:
        with open(resumen, "a", encoding="utf-8") as f:
            f.write("\n".join(lineas) + "\n")
