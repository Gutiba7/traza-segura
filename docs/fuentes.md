# Fuentes de datos: inventario (septiembre de 2026)

**Cómo se hizo:** búsquedas web más el script [`pipeline/explorar_fuentes.py`](../pipeline/explorar_fuentes.py),
que corre en GitHub Actions y consulta cada fuente directamente: descarga los archivos, los abre
y cuenta qué hay adentro. Los resultados completos están en la pestaña *Actions* del repositorio,
ejecución "Explorar fuentes de datos". Todo lo marcado ✅ se comprobó abriendo la fuente, no solo
leyendo su descripción; lo marcado ⚠️ es una limitación o algo por confirmar.

## En 30 segundos

1. **Hay datos oficiales, gratuitos y al día**: corte a agosto de 2026, actualizados cada mes.
2. **Ninguna fuente abierta trae la ubicación exacta de cada delito.** Lo más fino que se publica
   son **1.170 sectores catastrales** (en promedio, zonas de unas 5×5 cuadras) con las **llamadas a la Línea
   123** por hurto, riñas, disparos y otros incidentes. Las **denuncias** oficiales por tipo de
   delito solo vienen **por localidad** (20 zonas, demasiado grandes para elegir calles).
3. **El servidor ArcGIS de la Secretaría no responde desde fuera de Colombia.** La misma
   información está en **Datos Abiertos Bogotá**, que sí responde: esa será la fuente principal.
4. **Tres capas dan detalle casi de cuadra:** robos de bicicleta en hexágonos de 100 m por franja
   de 3 horas; una auditoría nocturna de 44.335 puntos en calles y ciclorrutas (Secretaría de la
   Mujer, 2019); y siniestros viales con coordenadas exactas (2015–2021).
5. **Para tener delitos más precisos** (por cuadrante o por punto, con hora) hay que pedirlos:
   ver el [borrador de derecho de petición](derecho-de-peticion.md).

## Fuentes recomendadas (en orden de importancia)

| # | Fuente | Entidad | Qué mide | Detalle geográfico | Periodo | Uso en Traza Segura |
|---|---|---|---|---|---|---|
| 1 | **Incidente Reportado** | Secretaría de Seguridad (Línea 123) | Llamadas ciudadanas en 9 categorías: hurtos, riñas, disparos, porte de armas, narcóticos, ruido, maltrato (dos categorías) y habitante de la calle | ✅ **1.170 sectores catastrales**, 117 UPZ y 20 localidades | ✅ 2018 – agosto 2026, mensual | **Señal principal de riesgo por zona**, en los tres modos |
| 2 | **Delito de Alto Impacto** | Secretaría de Seguridad (datos SIEDCO de la Policía) | Denuncias de 11 delitos: hurto a personas, a residencias, a comercio, de carros, motos, bicicletas y celulares; lesiones, homicidio, delitos sexuales y violencia intrafamiliar | ⚠️ Solo **20 localidades** | ✅ 2018 – agosto 2026, mensual | Calibrar cuánto pesa cada delito en cada modo y en cada localidad |
| 3 | **Llamadas tramitadas NUSE 123** (CSV) | Secretaría de Seguridad (C4) | Llamadas por decenas de tipos de incidente: hurto efectuado, atraco en proceso, lesiones, disparos, violencia sexual, vehículo hurtado… | ✅ 117 UPZ | ✅ enero 2015 – agosto 2026, mensual | Detalle por tipo de incidente y tendencias largas |
| 4 | **Zonas de riesgo por hurto de bicicletas** | IDECA, con datos SIEDCO de la Secretaría de Seguridad | Robos de bicicleta por celda | ✅ **Hexágonos de 100 a 500 m**, también por **franja de 3 horas** | ⚠️ El servicio no indica el periodo | Modo bici y su versión día/noche |
| 5 | **Evaluación de seguridad nocturna para las mujeres** | Secretaría de la Mujer (IDECA) | 8 variables medidas de 6 a 11 p. m.: iluminación, visibilidad, presencia de personas y de seguridad, estado del andén, cercanía al transporte… | ✅ **44.335 puntos** sobre calles y ciclorrutas | ⚠️ Septiembre de 2019 (hay otra de 2016) | Ajuste nocturno calle por calle |
| 6 | **Cuadrantes de policía** | Secretaría de Seguridad | Zona de cada cuadrante, con su CAI, estación y **teléfono** | ✅ 599 cuadrantes | ✅ Corte a junio de 2026 | Botón "llamar a mi cuadrante"; unidad pedida en el derecho de petición |
| 7 | **Siniestros viales** | Secretaría de Movilidad | Choques, atropellos y otros, con gravedad, fecha y hora | ✅ Puntos exactos (209.861) | ⚠️ 2015–2021 | Opcional: seguridad vial para bici y carro |
| 8 | **Ciclorrutas** | IDU (vía IDECA) | Red oficial de ciclorrutas | ✅ 6.311 tramos | ✅ Actualizada en agosto de 2026 | Complementa OpenStreetMap en el modo bici |

**Licencias:** Secretaría de Seguridad y Secretaría de la Mujer, CC BY-SA 4.0; Movilidad e IDU,
CC BY 4.0. ⚠️ La capa de robos de bicicleta (4) no declara licencia: se confirma antes de usarla.

**Ojo con la diferencia:** las fuentes 1 y 3 son **llamadas** a la Línea 123, no denuncias. Incluyen
falsas alarmas y dependen de quién llama, pero son más detalladas, más recientes y registran
hechos que nunca se denuncian. La fuente 2 son **denuncias** confirmadas, pero solo por localidad.
Usar las dos juntas compensa las debilidades de cada una.

## Detalle técnico de cada fuente

### 1. Incidente Reportado (llamadas a la Línea 123 por zona)
- Descarga (enero–agosto de cada año, 2018–2026):
  `https://datosabiertos.bogota.gov.co/dataset/ac8ebc76-583c-4c3b-9a2b-0f3791d63886/resource/ef95540b-f224-4452-a2d4-30d956942a04/download/ir_geojson.zip`
- Años completos 2018–2025:
  `https://datosabiertos.bogota.gov.co/dataset/ac8ebc76-583c-4c3b-9a2b-0f3791d63886/resource/2a4b73fd-93a7-4b08-8c20-b6ea22182a47/download/ir_geojson.zip`
- ✅ El zip trae tres archivos: `IRSCAT.geojson` (1.170 sectores catastrales, 18 MB),
  `IRUPZ.geojson` (117 UPZ) e `IRLoc.geojson` (20 localidades).
- Campos: identificador y nombre de la zona (`CMIUSCAT`, `CMNOMSCAT`) y un conteo por categoría y
  año con la forma `CM<categoría><año>CONT`, por ejemplo `CMH25CONT`.
- ✅ Diccionario comprobado con los datos (ver [metodologia.md](metodologia.md), sección 12.1):
  `H` hurtos (904 + 905), `R` riñas, `D` disparos, `PIA` porte de armas, `N` narcóticos, `AOP`
  ruido, `M` maltrato, `HC` habitante de la calle. `MM` es probablemente "maltrato a mujer".
  Ojo: `HC` **no** es hurto a comercio.

### 2. Delito de Alto Impacto
- Descarga (enero–agosto 2018–2026):
  `https://datosabiertos.bogota.gov.co/dataset/7b270013-42ca-436b-9c1e-3bcb7d280c6b/resource/aba0e25d-d407-45f4-9a98-327493b538bd/download/dai_geojson.zip`
- ✅ El zip trae un solo archivo, `DAILoc.geojson`, con 20 localidades. Hasta 2022 también se
  publicaba por UPZ y sector catastral; hoy los archivos abiertos solo vienen por localidad.
- Campos con la forma `CM<delito><año>CONT`. Códigos: `H` homicidio, `LP` lesiones personales,
  `HP` hurto a personas, `HR` a residencias, `HC` a comercio, `HA` de automotores, `HM` de
  motocicletas, `HB` de bicicletas, `HCE` de celulares, `DS` delitos sexuales, `VI` violencia
  intrafamiliar (interpretación de los códigos; se confirma en el paso 1.4).

### 3. Llamadas tramitadas NUSE 123 (CSV)
- Descarga (115 MB):
  `https://datosabiertos.bogota.gov.co/dataset/9bdf518e-b756-4865-983f-0521111fbcd1/resource/30d65a8b-d0ed-4e95-977e-0d7cc2ea89ef/download/datos-abiertllamadastramitadas-c4-bogota_numerounicodeseguridadyemergencias-nuse_linea-123os-nus.csv`
- ✅ Columnas: `ANIO`, `MES`, `TIPO_INCIDENTE`, `TIPO_DETALLE`, `COD_LOCALIDAD`, `LOCALIDAD`,
  `COD_UPZ`, `UPZ`, `CANT_INCIDENTES`. No trae la hora.
- Tipos útiles: 904 hurto efectuado, 905 atraco o hurto en proceso, 906 violencia sexual,
  909 exhibicionismo, 910 lesiones personales, 911 disparos, 913 vehículo hurtado. El conjunto
  incluye una guía oficial con la definición de cada tipo.

### 4. Zonas de riesgo por hurto de bicicletas
- Servicio: `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/aplicaciones/mbbici_seguridad/MapServer`
- ✅ Capas 1 a 5: total de robos en hexágonos de 500, 400, 300, 200 y 100 m (campo `COUNT`;
  1.758 hexágonos en la versión de 100 m). Capas 7 a 50: lo mismo separado por franjas de 3 horas
  (12 a. m., 3 a. m., 6 a. m., 9 a. m., 12 m., 3 p. m., 6 p. m. y 9 p. m.).
- ⚠️ No indica de qué años son los datos ni su licencia.

### 5. Evaluación de seguridad nocturna para las mujeres
- Servicio: `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/mujeres/seguridad/MapServer`
- ✅ Capa 1: 44.335 puntos evaluados en 2019. Capas 2 a 9: cada variable por separado
  (iluminación, "qué veo", "quién me ve", presencia de personas, presencia de seguridad, estado
  del sendero, cercanía al transporte y diversidad de género). Capas 10 y 11: índice por localidad
  y por UPZ.
- ⚠️ Tiene 7 años: la ciudad cambió buena parte de su alumbrado a LED desde entonces. Sirve como
  referencia de "cómo se siente la calle de noche", no como dato exacto de hoy.

### 6. Cuadrantes de policía
- Descarga: `https://datosabiertos.bogota.gov.co/dataset/b555594d-203e-4d34-8d17-32b13f94168b/resource/f0ad2ee3-bfd0-4825-9b31-bff9041649fa/download/cuadrantepolicia.geojson`
- ✅ 599 cuadrantes con estación, CAI, UPZ, sector catastral y teléfono del cuadrante (`PCUTELEFON`).

### 7. Siniestros viales
- Servicio: `https://services2.arcgis.com/NEwhEo9GGSHXcRXV/arcgis/rest/services/HistoricoSiniestros/FeatureServer/0`
- ✅ 209.861 puntos con fecha, hora, gravedad y clase de siniestro. ⚠️ Llega hasta 2021 y no
  indica si hubo ciclistas involucrados.

### 8. Ciclorrutas
- Capa oficial: `https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/18`

## Fuentes revisadas que no sirven para calcular rutas

| Fuente | Por qué no |
|---|---|
| **Policía Nacional en datos.gov.co** (SIEDCO: hurto a personas, homicidio, hurto a residencias) | ✅ Actualizada a agosto de 2026, pero solo trae **totales diarios por municipio** (columnas `fecha_hecho`, `municipio`, `cantidad`). No dice en qué parte de Bogotá ocurrió nada. Sirve, como mucho, para ver tendencias de la ciudad entera. |
| Copia de "Delito de Alto Impacto" en datos.gov.co (`t26q-43fj`) | ✅ Ya no existe (error 404). La versión vigente está en Datos Abiertos Bogotá. |
| Alumbrado público (UAESP) | ✅ Solo trae el número de lámparas por UPZ (112 zonas); no dice qué calles están iluminadas. Además, el archivo GeoJSON publicado en ese conjunto contiene en realidad contenedores de basura. |
| Visores y tableros (Observatorio, Power BI de la Secretaría) | Muestran gráficas, pero no permiten descargar datos de forma automática. |

## El servidor ArcGIS de la Secretaría de Seguridad

La Secretaría publica sus capas en un servidor ArcGIS REST propio:
`https://oaiee.scj.gov.co/agc/rest/services`. Estos son los servicios identificados en buscadores:

| Servicio | Qué contiene (según su descripción) |
|---|---|
| `Tematicos_Pub/CifrasSCJ` | Capa 0: delitos de alto impacto (la misma de Datos Abiertos). Capas 2 y 3: llamadas a la Línea 123 por localidad y por UPZ. Capas 5 y 8: medidas correctivas del Código de Policía por UPZ y por sector catastral. |
| `Tematicos_Pub/SIEDCO_Delitos_Pub` | Delitos del SIEDCO (homicidios, hurtos, lesiones). Hasta 32.000 registros por consulta. |
| `Tematicos_Pub/SIEDCO_Hom_Pub` | Homicidios del SIEDCO. |
| `Tematicos_Pub/RNMC_Articulos_Pub` | Medidas correctivas por artículo del Código de Policía. |
| `Tematicos_NR/EquipamientoPMSDSCJ` | Estaciones de policía, CAI, cuadrantes (capa 25), casas de justicia, URI. |
| `Tematicos_NR/Territorio_Referencia` | Límites de referencia (localidades, UPZ, municipio). |

**Hallazgo importante:** ✅ este servidor **no responde a conexiones desde fuera de Colombia**.
Se probó desde los servidores de GitHub, en EE. UU. El nombre se resuelve (149.130.175.80), pero la
conexión se agota sin respuesta tanto por HTTPS como por HTTP. Lo mismo pasa con `scj.gov.co`. En
cambio, Datos Abiertos Bogotá, Mapas Bogotá e IDECA sí responden desde el mismo lugar. Consecuencias:

- La actualización automática mensual **no puede depender de este servidor**. Usará Datos Abiertos
  Bogotá e IDECA, que publican la misma información y se actualizan cada mes.
- Si `SIEDCO_Delitos_Pub` trae más detalle que los archivos abiertos, solo se puede ver desde
  Colombia (paso 1.8 del PLAN).

## Qué significa para Traza Segura (decisión del paso 1.2)

Aprobada tras revisarla y comprobar sus supuestos con los datos. El detalle matemático y la
evidencia están en [metodologia.md](metodologia.md). En resumen:

1. **Las denuncias por localidad (fuente 2) dicen cuánto hubo**, y **las llamadas por sector
   (fuente 1) dicen dónde dentro de cada localidad**. Solo cuentan hurtos, riñas y disparos;
   "habitante de la calle" nunca cuenta como peligro.
2. **Los sectores con pocos casos se suavizan** con el método bayesiano empírico, que los acerca a
   sus vecinos en proporción a lo poco confiable que es su propio dato.
3. **Bici:** los hexágonos de 100 m de robo de bicicletas (fuente 4), con franja horaria. Las
   llamadas por hurto no sirven para esto: siguen un patrón distinto al del robo de bicicletas.
4. **Noche:** la auditoría nocturna (fuente 5) como ajuste calle por calle.
5. **Honestidad:** la app dirá que el riesgo es "por zona (unas 5×5 cuadras)", no por cuadra
   exacta. Si el derecho de petición trae datos más finos, se reemplaza la fuente 1 sin cambiar
   nada más.

## Pendiente por confirmar

- Los códigos de "Delito de Alto Impacto" (interpretación muy probable, falta confirmarla) y la
  categoría `MM` de las llamadas.
- Si las llamadas por "vehículo hurtado" y "violencia sexual" (por UPZ) siguen el patrón de las
  denuncias de robo de motos, robo de carros y delitos sexuales.
- Periodo y licencia de los hexágonos de robo de bicicletas.
- Contenido real de `SIEDCO_Delitos_Pub` y de `CifrasSCJ` (solo visibles desde Colombia).
- Si existe una versión de siniestros viales posterior a 2021.
