"""Cálculo del riesgo por sector catastral (ver docs/metodologia.md, secciones 2, 3, 5 y 6).

Solo usa la biblioteca estándar de Python para poder probarse en cualquier lado.
"""

TOPE_RR = 5.0  # un sector no puede "costar" más de 5 veces el promedio (sección 2)

# Qué tanto pesa cada tipo de llamada en cada modo de viaje. Propuesta inicial, pendiente de
# aprobar en el paso 1.5 del PLAN. H = hurtos, R = riñas, D = disparos (ver metodologia.md, 12.1).
PESOS_MODO = {
    "pie": {"H": 0.60, "R": 0.25, "D": 0.15},
    "bici": {"H": 0.75, "R": 0.10, "D": 0.15},
    "carro": {"H": 0.70, "R": 0.00, "D": 0.30},
}


def peso_antiguedad(meses):
    """Un caso de hace `meses` meses pesa 2^(−meses/12): la mitad al cabo de un año (sección 6)."""
    return 2 ** (-meses / 12)


def suavizar(casos, exposicion, vecinos):
    """Tasa por sector con el estimador bayesiano empírico local (Marshall, 1991).

    casos[i]      casos ponderados del sector i
    exposicion[i] exposición del sector i (km de calle × años); puede ser 0
    vecinos[i]    índices de los sectores que tocan al sector i (sin incluirlo)

    Si un sector tiene muchos casos se le cree a su propia tasa; si tiene pocos, se acerca a la
    tasa de su vecindario en proporción a lo poco confiable que es su dato.
    """
    total_exp = sum(exposicion)
    media_global = sum(casos) / total_exp if total_exp else 0.0
    tasas = []
    for i in range(len(casos)):
        grupo = [i] + [j for j in vecinos[i] if j != i]
        con_calles = [j for j in grupo if exposicion[j] > 0]
        exp_grupo = sum(exposicion[j] for j in con_calles)
        if exp_grupo == 0:
            tasas.append(media_global)
            continue
        media = sum(casos[j] for j in con_calles) / exp_grupo
        varianza = sum(exposicion[j] * (casos[j] / exposicion[j] - media) ** 2 for j in con_calles) / exp_grupo
        exp_promedio = exp_grupo / len(con_calles)
        varianza_real = max(0.0, varianza - media / exp_promedio)  # quita el ruido de conteo esperado
        if exposicion[i] == 0:
            tasas.append(media)
            continue
        propia = casos[i] / exposicion[i]
        ruido = media / exposicion[i]
        confianza = varianza_real / (varianza_real + ruido) if varianza_real + ruido > 0 else 0.0
        tasas.append(media + confianza * (propia - media))
    return tasas


def riesgo_relativo(tasas, casos, exposicion, tope=TOPE_RR):
    """Divide cada tasa por la media de la ciudad (1 = promedio) y aplica el tope."""
    total_exp = sum(exposicion)
    media = sum(casos) / total_exp if total_exp else 0.0
    if media <= 0:
        return [1.0] * len(tasas)
    return [min(tope, max(0.0, t / media)) for t in tasas]


def riesgo_por_modo(rr_por_tipo, pesos=PESOS_MODO):
    """Combina el riesgo relativo de cada tipo de llamada con los pesos de cada modo.

    rr_por_tipo: {"H": [rr por sector], "R": [...], "D": [...]}
    Devuelve {"pie": [rr por sector], "bici": [...], "carro": [...]}.
    """
    n = len(next(iter(rr_por_tipo.values())))
    salida = {}
    for modo, pesos_tipo in pesos.items():
        total = sum(pesos_tipo.values())
        salida[modo] = [
            min(TOPE_RR, sum(p * rr_por_tipo[tipo][i] for tipo, p in pesos_tipo.items()) / total)
            for i in range(n)
        ]
    return salida
