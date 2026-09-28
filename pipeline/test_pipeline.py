"""Pruebas de la tubería de datos. Uso: python3 -m unittest discover -s pipeline -v"""
import random
import unittest

from datos_abiertos import area_km2, campo
from preparar_sectores import preparar, simplificar
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


if __name__ == "__main__":
    unittest.main()
