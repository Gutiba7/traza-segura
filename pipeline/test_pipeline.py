"""Pruebas de la tubería de datos. Uso: python3 -m unittest discover -s pipeline -v"""
import random
import unittest

from datos_abiertos import area_km2, campo
from formato_grafo import codificar, decodificar, recortar
from preparar_sectores import preparar, simplificar
from riesgo import TOPE_RR, peso_antiguedad, riesgo_por_modo, riesgo_relativo, suavizar
from validar_supuestos import descomponer, spearman

# Un cuadrado de 0,01° × 0,01° en Bogotá (≈ 1,1 km de lado).
CUADRADO = [[-74.10, 4.60], [-74.09, 4.60], [-74.09, 4.61], [-74.10, 4.61], [-74.10, 4.60]]


class Campos(unittest.TestCase):
    def test_nombres_recortados_y_codigos_parecidos(self):
        props = {"CMM25CONT": 1, "CMMM25CONT": 2, "CMH25CONT": 3, "CMHC25CONT": 4,
                 "CMHCE25CON": 5, "CMAOP25CON": 6, "CMHVAR": 9}
        self.assertEqual([campo(props, c, 2025) for c in ["M", "MM", "H", "HC", "HCE", "AOP"]],
                         [1, 2, 3, 4, 5, 6])

    def test_campo_inexistente(self):
        self.assertIsNone(campo({"CMH24CONT": 3}, "H", 2025))


class Areas(unittest.TestCase):
    def test_cuadrado_en_grados(self):
        self.assertAlmostEqual(area_km2({"type": "Polygon", "coordinates": [CUADRADO]}), 1.227, places=2)

    def test_cuadrado_en_metros(self):
        metros = [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]]
        self.assertAlmostEqual(area_km2({"type": "Polygon", "coordinates": [metros]}), 1.0)

    def test_huecos_se_restan(self):
        hueco = [[-74.098, 4.602], [-74.092, 4.602], [-74.092, 4.608], [-74.098, 4.608], [-74.098, 4.602]]
        con_hueco = area_km2({"type": "Polygon", "coordinates": [CUADRADO, hueco]})
        self.assertLess(con_hueco, area_km2({"type": "Polygon", "coordinates": [CUADRADO]}))

    def test_sin_geometria(self):
        self.assertEqual(area_km2(None), 0.0)


class Simplificacion(unittest.TestCase):
    def test_quita_puntos_alineados(self):
        # Mismo cuadrado con puntos intermedios sobre los lados: deben desaparecer.
        denso = [[-74.10 + 0.001 * i, 4.60] for i in range(10)] + [[-74.09, 4.60], [-74.09, 4.61],
                                                                    [-74.10, 4.61], [-74.10, 4.60]]
        self.assertEqual(len(simplificar(denso)), 5)

    def test_conserva_una_punta_grande(self):
        # Una punta de ≈ 55 m (0,0005°) supera la tolerancia de 8 m: se conserva.
        punta = [[-74.10, 4.60], [-74.095, 4.60], [-74.0948, 4.6005], [-74.0946, 4.60], [-74.09, 4.60],
                 [-74.09, 4.61], [-74.10, 4.61], [-74.10, 4.60]]
        self.assertIn([-74.0948, 4.6005], simplificar(punta))

    def test_no_rompe_anillos_pequenos(self):
        self.assertEqual(simplificar(CUADRADO), CUADRADO)


class Preparacion(unittest.TestCase):
    def test_capa_liviana(self):
        elementos = [
            {"geometry": {"type": "Polygon", "coordinates": [CUADRADO]},
             "properties": {"CMIUSCAT": "001", "CMNOMSCAT": "  LA CANDELARIA ", "CMH25CONT": 245.0}},
            {"geometry": None, "properties": {"CMIUSCAT": "999", "CMH25CONT": 10.0}},
        ]
        salida = preparar(elementos, 2025)["features"]
        self.assertEqual(len(salida), 1)  # el registro sin geometría se descarta
        props = salida[0]["properties"]
        self.assertEqual(props["nombre"], "La Candelaria")
        self.assertEqual(props["hurtos"], 245)
        self.assertEqual(props["hurtos_km2"], round(245 / props["area_km2"]))


class Diccionario(unittest.TestCase):
    def test_descifra_sumas_exactas_entre_muchos_tipos(self):
        rnd = random.Random(1)
        upzs = range(117)
        candidatos = {f"T{t}": [rnd.randint(0, 600) for _ in upzs] for t in range(80)}
        y = [a + b for a, b in zip(candidatos["T3"], candidatos["T41"])]
        elegidos, error = descomponer(y, candidatos)
        self.assertEqual(set(elegidos), {"T3", "T41"})
        self.assertLess(error, 0.01)

    def test_spearman_con_empates(self):
        self.assertAlmostEqual(spearman([1, 2, 2, 3], [10, 20, 20, 30]), 1.0)


class Riesgo(unittest.TestCase):
    def test_peso_por_antiguedad(self):
        self.assertAlmostEqual(peso_antiguedad(0), 1.0)
        self.assertAlmostEqual(peso_antiguedad(12), 0.5)
        self.assertAlmostEqual(peso_antiguedad(24), 0.25)

    def test_pocos_casos_se_acercan_a_los_vecinos(self):
        # Sector 0: 2 casos en poca calle, rodeado de sectores tranquilos con mucha calle.
        casos = [2.0, 10.0, 12.0, 8.0]
        exposicion = [0.1, 10.0, 10.0, 10.0]
        vecinos = [[1, 2, 3], [0], [0], [0]]
        tasas = suavizar(casos, exposicion, vecinos)
        cruda = casos[0] / exposicion[0]  # 20 por km: parece 20 veces peor
        self.assertLess(tasas[0], cruda / 2)
        self.assertGreater(tasas[0], 1.0)

    def test_muchos_casos_conservan_su_tasa(self):
        casos = [2000.0, 100.0, 120.0]
        exposicion = [100.0, 100.0, 100.0]
        vecinos = [[1, 2], [0], [0]]
        tasas = suavizar(casos, exposicion, vecinos)
        self.assertAlmostEqual(tasas[0], 20.0, delta=0.5)

    def test_sector_sin_calles_toma_la_tasa_del_vecindario(self):
        tasas = suavizar([0.0, 10.0, 30.0], [0.0, 10.0, 10.0], [[1, 2], [0], [0]])
        self.assertAlmostEqual(tasas[0], 2.0)

    def test_riesgo_relativo_promedia_uno_y_tiene_tope(self):
        casos, exposicion = [10.0, 20.0, 30.0], [10.0, 10.0, 10.0]
        rr = riesgo_relativo([c / e for c, e in zip(casos, exposicion)], casos, exposicion)
        self.assertAlmostEqual(sum(r * e for r, e in zip(rr, exposicion)) / sum(exposicion), 1.0)
        self.assertEqual(riesgo_relativo([1.0], [1.0], [1.0]), [1.0])  # igual al promedio
        self.assertEqual(riesgo_relativo([100.0, 1.0], [1.0, 1.0], [1.0, 1.0])[0], TOPE_RR)

    def test_pesos_por_modo(self):
        rr = riesgo_por_modo({"H": [2.0], "R": [1.0], "D": [1.0]})
        self.assertAlmostEqual(rr["pie"][0], 0.60 * 2 + 0.25 + 0.15)
        self.assertAlmostEqual(rr["carro"][0], 0.70 * 2 + 0.30)


class FormatoGrafo(unittest.TestCase):
    NODOS = [(-74.1, 4.6), (-74.09, 4.6), (-74.09, 4.61), (-74.2, 4.7)]
    ARISTAS = [
        {"u": 0, "v": 1, "tiempo_s": 123.4, "largo_m": 150.2, "sector": 7, "riesgo": 1.5,
         "sentido": False, "puntos": [(-74.095, 4.601)]},
        {"u": 1, "v": 2, "tiempo_s": 20.0, "largo_m": 30.0, "sector": None, "riesgo": 0.8,
         "sentido": True, "puntos": []},
        {"u": 2, "v": 3, "tiempo_s": 900.0, "largo_m": 1200.0, "sector": 2, "riesgo": 5.0,
         "sentido": False, "puntos": []},
    ]

    def test_ida_y_vuelta(self):
        nodos, aristas = decodificar(codificar(self.NODOS, self.ARISTAS))
        self.assertEqual(nodos, self.NODOS)
        self.assertEqual([(a["u"], a["v"], a["sector"], a["sentido"]) for a in aristas],
                         [(0, 1, 7, False), (1, 2, None, True), (2, 3, 2, False)])
        self.assertAlmostEqual(aristas[0]["tiempo_s"], 123.4)
        self.assertEqual(aristas[0]["largo_m"], 150)
        self.assertAlmostEqual(aristas[0]["riesgo"], 1.5)
        self.assertEqual(aristas[0]["puntos"], [(-74.095, 4.601)])
        self.assertEqual(aristas[2]["riesgo"], 5.0)

    def test_recorte_conserva_solo_lo_de_adentro(self):
        nodos, aristas = decodificar(recortar(codificar(self.NODOS, self.ARISTAS), (-74.15, 4.55, -74.05, 4.65)))
        self.assertEqual(len(nodos), 3)
        self.assertEqual([(a["u"], a["v"]) for a in aristas], [(0, 1), (1, 2)])


if __name__ == "__main__":
    unittest.main()
