"""Formato binario del grafo de calles que descarga la app (archivo grafo-<modo>.bin.gz).

Todo en little-endian, comprimido con gzip. Los arreglos van de mayor a menor tamaño de elemento
para que el navegador pueda leerlos directamente como Int32Array, Uint16Array, etc.

    Encabezado (20 bytes): "TSG1", versión u16, reservado u16, nodos u32, aristas u32, puntos u32
    Int32  lon[nodos], lat[nodos]        grados × 1e6
    Uint32 u[aristas], v[aristas]        nodos de cada tramo
    Uint32 inicio_geom[aristas + 1]      dónde empiezan los puntos intermedios de cada tramo
    Int32  geom[2 × puntos]              lon, lat intercalados (grados × 1e6)
    Uint16 tiempo[aristas]               décimas de segundo para recorrer el tramo
    Uint16 largo[aristas]                metros
    Uint16 sector[aristas]               posición del sector en sectores.geojson (65535 = ninguno)
    Uint8  riesgo[aristas]               riesgo relativo × 40 (1 = promedio → 40)
    Uint8  sentido[aristas]              0 = doble sentido, 1 = solo de u a v

Solo usa la biblioteca estándar de Python.
"""
import gzip
import struct
import sys
from array import array

MAGIA = b"TSG1"
VERSION = 1
SIN_SECTOR = 65535
ESCALA_RIESGO = 40
ESCALA_COORD = 1_000_000


def _arreglo(tipo, valores):
    a = array(tipo, valores)
    if sys.byteorder != "little":
        a.byteswap()
    return a.tobytes()


def codificar(nodos, aristas):
    """nodos: [(lon, lat)]; aristas: dicts con u, v, tiempo_s, largo_m, sector, riesgo, sentido, puntos."""
    lon = [round(x * ESCALA_COORD) for x, _ in nodos]
    lat = [round(y * ESCALA_COORD) for _, y in nodos]
    inicio, geom = [0], []
    for a in aristas:
        for x, y in a.get("puntos", ()):
            geom += [round(x * ESCALA_COORD), round(y * ESCALA_COORD)]
        inicio.append(len(geom) // 2)
    partes = [
        MAGIA + struct.pack("<HHIII", VERSION, 0, len(nodos), len(aristas), len(geom) // 2),
        _arreglo("i", lon), _arreglo("i", lat),
        _arreglo("I", [a["u"] for a in aristas]), _arreglo("I", [a["v"] for a in aristas]),
        _arreglo("I", inicio), _arreglo("i", geom),
        _arreglo("H", [min(65535, max(1, round(a["tiempo_s"] * 10))) for a in aristas]),
        _arreglo("H", [min(65535, round(a["largo_m"])) for a in aristas]),
        _arreglo("H", [SIN_SECTOR if a["sector"] is None else a["sector"] for a in aristas]),
        _arreglo("B", [min(255, round(a["riesgo"] * ESCALA_RIESGO)) for a in aristas]),
        _arreglo("B", [1 if a["sentido"] else 0 for a in aristas]),
    ]
    return gzip.compress(b"".join(partes), compresslevel=9, mtime=0)


def decodificar(datos):
    """Inverso de codificar (para pruebas). Devuelve (nodos, aristas) con valores redondeados."""
    crudo = gzip.decompress(datos)
    assert crudo[:4] == MAGIA, "no es un grafo de Traza Segura"
    version, _, n, e, g = struct.unpack_from("<HHIII", crudo, 4)
    assert version == VERSION
    pos = 20

    def leer(tipo, cantidad):
        nonlocal pos
        a = array(tipo)
        a.frombytes(crudo[pos:pos + a.itemsize * cantidad])
        if sys.byteorder != "little":
            a.byteswap()
        pos += a.itemsize * cantidad
        return list(a)

    lon, lat = leer("i", n), leer("i", n)
    u, v = leer("I", e), leer("I", e)
    inicio, geom = leer("I", e + 1), leer("i", 2 * g)
    tiempo, largo, sector = leer("H", e), leer("H", e), leer("H", e)
    riesgo, sentido = leer("B", e), leer("B", e)
    assert pos == len(crudo), "el archivo tiene bytes de más o de menos"
    nodos = [(x / ESCALA_COORD, y / ESCALA_COORD) for x, y in zip(lon, lat)]
    aristas = [{
        "u": u[i], "v": v[i], "tiempo_s": tiempo[i] / 10, "largo_m": largo[i],
        "sector": None if sector[i] == SIN_SECTOR else sector[i],
        "riesgo": riesgo[i] / ESCALA_RIESGO, "sentido": bool(sentido[i]),
        "puntos": [(geom[2 * k] / ESCALA_COORD, geom[2 * k + 1] / ESCALA_COORD)
                   for k in range(inicio[i], inicio[i + 1])],
    } for i in range(e)]
    return nodos, aristas


def recortar(datos, bbox):
    """Grafo pequeño con los nodos dentro de bbox (oeste, sur, este, norte), sin recalcular nada."""
    nodos, aristas = decodificar(datos)
    oeste, sur, este, norte = bbox
    nuevo, dentro = {}, []
    for i, (x, y) in enumerate(nodos):
        if oeste <= x <= este and sur <= y <= norte:
            nuevo[i] = len(dentro)
            dentro.append((x, y))
    sub = [dict(a, u=nuevo[a["u"]], v=nuevo[a["v"]]) for a in aristas if a["u"] in nuevo and a["v"] in nuevo]
    return codificar(dentro, sub)
