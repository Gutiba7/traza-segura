"""Pruebas del constructor de grafos con un mapa de ejemplo (necesita osmnx)."""
import unittest

import networkx as nx
from shapely.geometry import box

from construir_grafo import construir, periodo_reciente
from formato_grafo import decodificar

OESTE = box(-74.10, 4.60, -74.09, 4.61)
ESTE = box(-74.09, 4.60, -74.08, 4.61)


def grafo_de_ejemplo(doble_sentido=True):
    """Dos calles horizontales en cada sector y una calle vertical justo en el límite."""
    g = nx.MultiDiGraph(crs="epsg:4326")
    puntos = {1: (-74.098, 4.605), 2: (-74.093, 4.605), 3: (-74.090, 4.605), 4: (-74.087, 4.605),
              5: (-74.082, 4.605), 6: (-74.090, 4.602), 7: (-74.090, 4.608)}
    for n, (x, y) in puntos.items():
        g.add_node(n, x=x, y=y)
    calles = [(1, 2), (2, 3), (3, 4), (4, 5), (6, 3), (3, 7)]
    for u, v in calles:
        (x1, y1), (x2, y2) = puntos[u], puntos[v]
        largo = ((x2 - x1) * 110_950) ** 2 + ((y2 - y1) * 110_574) ** 2
        datos = {"length": largo ** 0.5, "highway": "residential", "osmid": u * 10 + v}
        g.add_edge(u, v, **datos)
        if doble_sentido or (u, v) != (4, 5):  # (4, 5) puede ser de un solo sentido
            g.add_edge(v, u, **datos)
    return g


def coleccion():
    return {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": None, "properties": {"id": "A", "nombre": "Oeste"}},
        {"type": "Feature", "geometry": None, "properties": {"id": "B", "nombre": "Este"}},
    ]}


class Construccion(unittest.TestCase):
    def setUp(self):
        casos = {"H": [100.0, 5.0], "R": [10.0, 10.0], "D": [1.0, 1.0]}
        grafos = {"pie": grafo_de_ejemplo(), "carro": grafo_de_ejemplo(doble_sentido=False)}
        self.archivos, self.coleccion, self.estadisticas = construir(coleccion(), [OESTE, ESTE], casos, 1.0, grafos)

    def aristas(self, modo):
        nodos, aristas = decodificar(self.archivos[modo])
        return nodos, {(round(nodos[a["u"]][0], 3), round(nodos[a["v"]][0], 3), a["sentido"]): a for a in aristas}

    def test_riesgo_mayor_en_el_sector_con_mas_casos(self):
        _, aristas = self.aristas("pie")
        oeste = aristas[(-74.098, -74.093, False)]["riesgo"]
        este = aristas[(-74.087, -74.082, False)]["riesgo"]
        self.assertGreater(oeste, 1.0)
        self.assertLess(este, 1.0)
        self.assertEqual(self.coleccion["features"][0]["properties"]["rr_pie"] > 1, True)

    def test_calle_limite_toma_el_promedio(self):
        _, aristas = self.aristas("pie")
        oeste = aristas[(-74.098, -74.093, False)]["riesgo"]
        este = aristas[(-74.087, -74.082, False)]["riesgo"]
        limite = next(a for (x1, x2, _), a in aristas.items() if x1 == x2 == -74.09)
        self.assertAlmostEqual(limite["riesgo"], (oeste + este) / 2, delta=0.05)

    def test_a_pie_todo_es_doble_sentido_y_en_carro_se_respeta_el_sentido(self):
        _, a_pie = self.aristas("pie")
        self.assertTrue(all(not sentido for (_, _, sentido) in a_pie))
        _, en_carro = self.aristas("carro")
        self.assertIn((-74.087, -74.082, True), en_carro)

    def test_tiempos_a_pie_y_en_carro(self):
        _, a_pie = self.aristas("pie")
        _, en_carro = self.aristas("carro")
        tramo_pie = a_pie[(-74.098, -74.093, False)]
        tramo_carro = en_carro[(-74.098, -74.093, False)]
        self.assertAlmostEqual(tramo_pie["tiempo_s"], tramo_pie["largo_m"] / (4.5 / 3.6), delta=1)
        self.assertLess(tramo_carro["tiempo_s"], tramo_pie["tiempo_s"] / 3)

    def test_estadisticas(self):
        self.assertEqual(self.estadisticas["pie"]["nodos"], 7)
        self.assertEqual(self.estadisticas["pie"]["tramos"], 6)


class Periodo(unittest.TestCase):
    def test_lee_el_texto_del_archivo(self):
        self.assertEqual(periodo_reciente({"CMMES": "Ene-Ago (2025vs2026)"}), (2026, 8))
        self.assertEqual(periodo_reciente({"CMMES": "Ene - Dic (2024 vs 2025)"}), (2025, 12))


if __name__ == "__main__":
    unittest.main()
