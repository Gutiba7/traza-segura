# Metodología: cómo se calcula el riesgo

Este documento explica, paso a paso y con sus fórmulas, cómo Traza Segura convierte los datos
oficiales en un "costo" para cada tramo de calle. Cada fórmula viene con su explicación en palabras.
La evidencia que respalda los supuestos está en la sección 12.

## 1. Qué queremos medir

Lo que le importa a quien se mueve por la ciudad es la **probabilidad de ser víctima durante su
trayecto**. El modelo supone que cada tramo de calle *e* tiene una "tasa de peligro" λₑ
(incidentes esperados por cada minuto que alguien pasa ahí). Si el trayecto pasa tₑ minutos por
cada tramo:

$$P(\text{al menos un incidente}) = 1 - e^{-\sum_e \lambda_e t_e} \;\approx\; \sum_e \lambda_e\, t_e$$

La aproximación vale porque la probabilidad en un solo trayecto es pequeña. **Consecuencia clave:**
el riesgo de una ruta es la *suma* del riesgo de sus tramos, y eso es justo lo que necesitan los
algoritmos de rutas, que trabajan sumando costos.

## 2. El costo de cada tramo

$$c_e = t_e\,(1 + \alpha \cdot RR_e) \;=\; \underbrace{t_e}_{\text{tiempo}} + \alpha \cdot \underbrace{RR_e\, t_e}_{\text{exposición al riesgo}}$$

- **RRₑ (riesgo relativo)** = λₑ / λ̄, donde λ̄ es el promedio de la ciudad. RR = 1 es un tramo
  promedio; RR = 2, el doble de peligroso; RR = 0,5, la mitad.
- **α** es el deslizador "más seguro ↔ más corto". En palabras: *un minuto en un tramo con RR = 3
  "cuesta" como 1 + 3α minutos*. Con α = 0 sale la ruta más rápida.
- El costo combina dos objetivos (tiempo y exposición). Cada valor de α da una ruta para la que no
  existe otra que sea a la vez más rápida y más segura.
- **La ruta encontrada es la óptima:** como cₑ ≥ tₑ, la estimación "tiempo en línea recta a
  velocidad máxima" nunca sobreestima lo que falta, y con esa condición el algoritmo A\* garantiza
  el mejor resultado (Hart, Nilsson y Raphael, 1968).
- **"% de riesgo evitado"** = 1 − (Σ RR·t de la ruta segura) / (Σ RR·t de la ruta rápida): cuánto
  se reduce la exposición esperada.
- **Valores de α en la app**, calibrados con trayectos reales a pie por el centro: *Poco* = 0,3;
  *Moderado* = 0,75 (por defecto); *Bastante* = 1,5. Con *Moderado*, un minuto por una calle con
  RR = 2 cuenta como 2,5 minutos. En las pruebas, *Moderado* solo acepta desvíos de hasta ~30 % del
  tiempo cuando la exposición baja ~40 %; por ejemplo, del Museo Nacional al Parque de los
  Periodistas: 6 % más de tiempo y 36 % menos exposición. Con α = 1, el valor inicial, llegaba a
  proponer desvíos de 50 % del tiempo, demasiado para un uso diario.

> **Corrección al plan original:** el PLAN decía normalizar el riesgo a una escala 0–1 por
> percentiles. Eso ordena los tramos, pero **sumar percentiles no tiene significado matemático**:
> no mide cuánto más peligroso es un tramo que otro. Se usa el riesgo relativo, con un tope
> (RR ≤ 5) para que un valor atípico no domine. Los percentiles quedan solo para colorear el mapa.

## 3. Tasa de cada sector: suavizado bayesiano empírico

Para un sector *s*: yₛ son los casos (ponderados por tipo y antigüedad) y Eₛ la exposición
(kilómetros de calle × años). La tasa "cruda" yₛ / Eₛ es muy ruidosa cuando hay pocos casos: el
ruido típico es 1/√yₛ, es decir **±32 % con 10 casos**. Un sector con 2 robos puede parecer el
doble de peligroso que su vecino con 1, por pura casualidad.

Por eso se usa el estimador bayesiano empírico de Poisson–Gamma (Clayton y Kaldor, 1987), en su
versión local (Marshall, 1991):

$$\hat\lambda_s = \frac{y_s + \kappa \cdot m_s}{E_s + \kappa}$$

- **mₛ** es la tasa de los sectores vecinos.
- **κ** mide cuánto se confía en el vecindario. No se inventa: se estima con los propios datos.
- **En palabras:** si un sector tiene muchos casos, se le cree a su propia tasa; si tiene pocos, se
  acerca al promedio de sus vecinos. Esto reemplaza el "suavizado con zonas vecinas" del plan
  original por un método con respaldo estadístico.

## 4. Combinar llamadas y denuncias: reparto dasimétrico

Las denuncias por tipo de delito (fuente oficial, gruesa: 20 localidades) se reparten entre los
sectores de cada localidad según las llamadas a la Línea 123 del tipo equivalente (fuente fina:
1.170 sectores). Para el delito *k* en la localidad *L*, con Dₗ,ₖ denuncias:

$$y_{s,k} = D_{L,k} \cdot \frac{c_{s,k}}{\sum_{s' \in L} c_{s',k}}$$

donde cₛ,ₖ son las llamadas del tipo equivalente en el sector *s*. **En palabras:** la cifra
oficial dice *cuánto* hubo en la localidad; las llamadas dicen *dónde* dentro de ella. Los totales
por localidad siempre coinciden con la cifra oficial (Mennis, 2003, sobre este tipo de reparto).

**Supuesto:** dentro de una localidad, las denuncias se distribuyen como las llamadas del mismo
tipo. Se comprobó con datos reales (sección 12) y de ahí sale esta tabla:

| Denuncia (por localidad) | Se reparte entre sectores según | Evidencia |
|---|---|---|
| Hurto a personas | Llamadas por hurto (`H`) | ✅ Siguen el mismo patrón |
| Hurto de celulares | Llamadas por hurto (`H`) | ✅ Siguen el mismo patrón |
| Lesiones personales | Llamadas por riñas (`R`) | ✅ La relación más fuerte de todas |
| Homicidio | Llamadas por disparos (`D`) | ✅ Siguen el mismo patrón |
| Hurto de bicicletas | **No** según las llamadas por hurto: se usan los hexágonos de robo de bicicletas | ❌ Patrón distinto (ver sección 12) |
| Hurto de motos y carros; delitos sexuales | Llamadas "vehículo hurtado" (913) y "violencia sexual" (906), que solo existen por UPZ | ⚠️ Por validar en el paso 1.4 |

## 5. Pesos por modo y solo delitos "de calle"

$$\lambda_{s,m} = \sum_k w_{m,k}\, \lambda_{s,k}$$

- **wₘ,ₖ** combina qué tanto afecta el delito *k* al modo *m* (el robo de bicicletas pesa en bici y
  no a pie) y qué tan grave es para la persona. Los números se aprueban en el paso 1.5.
- **Se excluyen** violencia intrafamiliar, maltrato, hurto a residencias y hurto a comercio: ocurren
  mayormente bajo techo y no dependen de por dónde vayas. Contarlos castigaría barrios
  residenciales sin proteger a nadie.
- **De las 9 categorías de llamadas por sector solo se usan tres:** hurtos (`H`), riñas (`R`) y
  disparos (`D`). Se descartan ruido (`AOP`), narcóticos (`N`) y porte de armas (`PIA`), porque
  reflejan más la actividad de la policía o molestias que el riesgo de ser víctima. También se
  descartan maltrato (`M`) y probablemente maltrato a mujer (`MM`), que ocurren bajo techo.
- **"Habitante de la calle" (`HC`) nunca cuenta como peligro.** Una persona sin hogar no es un
  delito, y tratarla como riesgo sería discriminatorio.

## 6. Antigüedad de los datos

Un caso de hace Δ meses pesa 2^(−Δ/12): la mitad al cabo de un año y la cuarta parte a los dos.
Así el mapa refleja la ciudad de hoy sin olvidar los patrones persistentes.

## 7. De zonas a calles

- Un tramo dentro de un sector toma el valor del sector.
- Un tramo que es **límite** entre sectores (muchas avenidas lo son) toma el promedio de los
  sectores que toca una franja de 15 m a cada lado, ponderado por área. Así no se decide al azar
  a qué lado "pertenece" una avenida.

## 8. Noche

$$\lambda^{\text{noche}}_e = \lambda_e \cdot g_e, \qquad 0{,}8 \le g_e \le 1{,}5$$

- **gₑ** sale de la auditoría nocturna de la Secretaría de la Mujer (iluminación, visibilidad,
  presencia de personas) en los puntos cercanos al tramo.
- **Es un ajuste heurístico, no estimado:** los datos abiertos de delitos no traen la hora, así que
  no se puede calibrar con incidentes nocturnos. Se declara así en la app.
- **En bici** sí hay calibración real: los robos de bicicleta vienen por franjas de 3 horas.

## 9. El límite más importante: la exposición

Más incidentes en un lugar pueden significar **más gente, no más peligro por persona**. Una calle
comercial con 100 robos al año y 50.000 peatones diarios es más segura *para cada peatón* que una
calle vacía con 10 robos y 500 peatones. Sin conteos de peatones, dividir por kilómetros de calle
castiga de más a las calles concurridas, y el modelo podría mandar gente a calles solas, que de
noche suelen ser peores (Cohen y Felson, 1979; Jacobs, 1961).

No hay datos abiertos que resuelvan esto del todo. Mitigaciones:

1. **De noche**, la auditoría premia las calles con gente y buena visibilidad (sección 8).
2. **En la Fase 2** se prueba un denominador de actividad: población del censo del DANE más uso
   comercial del suelo de Catastro. Se compara con la versión por kilómetro usando las calles que
   conoces (paso 2.7) y se elige la que dé resultados más sensatos.
3. **α moderado por defecto**, y la ruta rápida siempre visible para comparar.

## 10. Incertidumbre y comunicación

- Si dos rutas difieren en menos de 10 % de exposición, la app dice "riesgo similar" en lugar de
  presumir una diferencia que está dentro del ruido.
- La app aclara que el riesgo es **por zona** (en promedio, unas 5×5 cuadras), no por cuadra.

## 11. Otros límites conocidos

- **Unidades de área** (Openshaw, 1984): los resultados dependen de cómo se trazaron los sectores,
  y todas las calles de un sector reciben el mismo valor base.
- **Subregistro:** muchos delitos no se denuncian ni se reportan; las llamadas lo reducen, pero
  dependen de quién tiene la costumbre de llamar.
- **Retroalimentación:** si todos evitan una zona, puede quedar más sola. Por eso α es moderado por
  defecto y la app no etiqueta barrios como "peligrosos".
- **Antigüedad de la auditoría nocturna** (2019).

## 12. Evidencia con datos reales

Todo se obtuvo con [`pipeline/validar_supuestos.py`](../pipeline/validar_supuestos.py), que corre
en GitHub Actions ("Validar supuestos del modelo") sobre los archivos oficiales de septiembre de
2026. Cualquiera puede repetirlo.

### 12.1 Qué significa cada código de las llamadas por sector

Cada columna del archivo por zonas se comparó con los 86 tipos de incidente del archivo detallado
de la Línea 123 (6,6 millones de llamadas en 2024–2026), buscando qué combinación de tipos la
reproduce en las 117 UPZ.

| Código | Significado | Coincidencia ene–ago 2026 | Coincidencia 2025 | ¿Se usa? |
|---|---|---|---|---|
| `H` | Hurto efectuado (904) + hurto en proceso (905) | Exacta | 95 % | ✅ |
| `R` | Riña (934) | Exacta | 95 % | ✅ |
| `D` | Disparos (911) | Exacta | 95 % | ✅ |
| `PIA` | Porte de armas (969) | Exacta | 96 % | ❌ |
| `N` | Narcóticos (922) | Exacta | 95 % | ❌ |
| `AOP` | Ruido (932) | Exacta | 95 % | ❌ |
| `M` | Maltrato (611) | Exacta | 95 % | ❌ |
| `MM` | Sin coincidencia exacta; se parece a maltrato. Probablemente es la marca "maltrato a mujer" (611M), que el archivo detallado no trae como tipo aparte | — | — | ❌ |
| `HC` | Habitante de la calle (923) | Exacta | 96 % | ❌ nunca |

La diferencia de 5 % en 2025 es la misma en todas las columnas; lo más probable es que se deba a
reclasificaciones de llamadas entre la fecha de corte de un archivo y la del otro.

### 12.2 ¿Las llamadas siguen el patrón de las denuncias?

Comparación de las 20 localidades en 2025 con la correlación de Spearman (1 = mismo orden; 0 = sin
relación). La columna "sin efecto tamaño" compara *proporciones* dentro de cada localidad, para que
la relación no se deba solo a que las localidades grandes tienen más de todo. Con 20 localidades,
valores por encima de 0,45 ya no se explican por azar.

| Llamadas | Denuncias | Conteos | Sin efecto tamaño | Conclusión |
|---|---|---|---|---|
| Hurto (`H`) | Hurto a personas | 0,87 | 0,62 | ✅ Se puede repartir con las llamadas |
| Hurto (`H`) | Hurto de celulares | 0,78 | 0,54 | ✅ Se puede repartir con las llamadas |
| Hurto (`H`) | Hurto de bicicletas | 0,88 | **−0,09** | ❌ Patrón propio: se usan los hexágonos de bici |
| Disparos (`D`) | Homicidio | 0,92 | 0,70 | ✅ Se puede repartir con las llamadas |
| Riñas (`R`) | Lesiones personales | 0,92 | 0,79 | ✅ Se puede repartir con las llamadas |

**Límite de esta prueba:** muestra que ambas fuentes coinciden *entre localidades*. Que también
coincidan *dentro* de cada localidad es un supuesto razonable, pero no se puede comprobar con datos
abiertos: las denuncias por sector dejaron de publicarse en 2022. El derecho de petición resolvería
esta duda.

### 12.3 Sectores catastrales: tamaño, estabilidad y ruido

- **Tamaño:** 1.170 sectores. El sector típico (mediana) mide 0,29 km², un cuadrado de 539 m de
  lado, unas 5 cuadras. El 10 % más pequeño mide menos de 0,08 km² (unas 3 cuadras de lado) y el
  10 % más grande más de 1 km².
- **Estabilidad:** comparando 2024 con 2025, el orden de los sectores se mantiene casi idéntico en
  hurtos (0,98) y riñas (0,99), y bastante en disparos (0,84). **El patrón es estructural, no
  ruido**, así que tiene sentido usarlo para planear rutas.
- **Ruido:** el sector típico tiene 81 llamadas por hurto al año (ruido de ±11 %), pero el 21 % de
  los sectores tiene menos de 10 (ruido de ±32 % o más). En disparos, la mitad de los sectores
  tiene menos de 10. **Esto confirma que el suavizado bayesiano de la sección 3 es necesario.**

## Referencias

- Clayton, D. y Kaldor, J. (1987). *Empirical Bayes estimates of age-standardized relative risks
  for use in disease mapping.* Biometrics, 43(3), 671–681.
- Cohen, L. E. y Felson, M. (1979). *Social change and crime rate trends: a routine activity
  approach.* American Sociological Review, 44(4), 588–608.
- Hart, P. E., Nilsson, N. J. y Raphael, B. (1968). *A formal basis for the heuristic determination
  of minimum cost paths.* IEEE Transactions on Systems Science and Cybernetics, 4(2), 100–107.
- Jacobs, J. (1961). *The Death and Life of Great American Cities.* Random House.
- Marshall, R. J. (1991). *Mapping disease and mortality rates using empirical Bayes estimators.*
  Applied Statistics, 40(2), 283–294.
- Mennis, J. (2003). *Generating surface models of population using dasymetric mapping.* The
  Professional Geographer, 55(1), 31–42.
- Openshaw, S. (1984). *The Modifiable Areal Unit Problem.* CATMOG 38. Geo Books.
