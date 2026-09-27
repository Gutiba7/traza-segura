# Plan de trabajo — Traza Segura 2.0

Cada fase se divide en pasos pequeños. Cada paso termina con algo **que tú puedes comprobar sin
saber programar** (abrir un enlace, ver un mapa, leer una tabla). Si un paso no se puede
verificar, no se da por terminado.

**Regla de oro:** cada paso se entrega en su propia rama y *pull request* (una propuesta de
cambio que revisas y apruebas en GitHub). Nada llega a la versión principal sin tu visto bueno.

Leyenda: 🧑 = necesito algo de ti · ✅ = cómo verificamos que quedó bien

---

## Fase 0 — Cimientos (1–2 días)

**Por qué primero:** publicar una página "vacía" desde el día uno hace que cada avance
posterior se vea de inmediato en tu celular. Es más motivador y detecta problemas temprano.

| # | Paso | ✅ Verificación |
|---|---|---|
| 0.1 | Crear la estructura de carpetas (`pipeline/`, `web/`) y el archivo `.gitignore`. | Ves las carpetas en GitHub. |
| 0.2 | Página mínima con un mapa de Bogotá (MapLibre + OpenFreeMap). | Abres el enlace y ves Bogotá, puedes hacer zoom. |
| 0.3 | Publicación automática en GitHub Pages cada vez que se aprueba un cambio. | El enlace `https://gutiba7.github.io/traza-segura/` funciona en tu celular. |
| 0.4 | Revisión automática (pruebas) en cada *pull request*. | Aparece una ✔ verde en GitHub. |

🧑 Activar GitHub Pages en *Settings → Pages → Source: GitHub Actions* (te guío con capturas).

---

## Fase 1 — Datos de delitos (3–5 días)

**Objetivo:** tener una tabla limpia de delitos por zona (o por punto, si se consigue), con fecha,
tipo y, si existe, franja horaria.

| # | Paso | ✅ Verificación |
|---|---|---|
| 1.1 | ✅ **Hecho.** Inventario de fuentes: servidor ArcGIS de la Secretaría, Datos Abiertos Bogotá, Policía Nacional en datos.gov.co y capas complementarias (siniestros viales, alumbrado, ciclorrutas, seguridad nocturna). | [`docs/fuentes.md`](docs/fuentes.md) y el script `pipeline/explorar_fuentes.py`. |
| 1.2 | **Decisión clave:** elegir la zona más pequeña disponible con datos al día. Los datos oficiales publicados vienen por zona, no como puntos (ver `docs/fuentes.md`). | Te explico el hallazgo y decidimos juntos. |
| 1.3 | Script de descarga desde **Datos Abiertos Bogotá** (archivos mensuales). El servidor ArcGIS de la Secretaría no responde desde fuera de Colombia, así que la actualización automática no puede depender de él. | Los totales descargados coinciden con los que publica la Secretaría en sus boletines. |
| 1.4 | Limpieza: unificar nombres de delitos y de zonas, revisar zonas sin datos y cortes de fecha. | Reporte: "X registros originales → Y válidos", con motivos de descarte. |
| 1.5 | Tabla de pesos por tipo de delito **para cada modo** (a pie, bici, carro). | Tabla en `docs/pesos.md` que tú apruebas o ajustas. |
| 1.6 | Mapa de prueba con las zonas coloreadas sobre Bogotá. | Ves el mapa y los datos caen donde deben (no en el mar ni en Villavicencio). |
| 1.7 | *(En paralelo)* Enviar el [derecho de petición](docs/derecho-de-peticion.md) para pedir datos más detallados (por cuadrante o por punto, con hora). | Radicado de la petición; respuesta en 10 días hábiles. |
| 1.8 | *(En paralelo)* Abrir desde Colombia el servicio `SIEDCO_Delitos_Pub` para ver si trae más detalle que los archivos abiertos. | Captura de pantalla de la lista de capas. |

🧑 Pasos 1.7 y 1.8: los haces tú desde Colombia (te dejo todo listo). Si traen datos más finos, se
integran sin cambiar el resto del plan.

---

## Fase 2 — Red vial con costo de riesgo (5–7 días)

**Objetivo:** cada tramo de calle de Bogotá con un puntaje de riesgo de 0 a 1, **para cada modo
de viaje** (a pie, bicicleta, carro/moto).

| # | Paso | ✅ Verificación |
|---|---|---|
| 2.1 | Descargar de OpenStreetMap las tres redes del perímetro urbano de Bogotá (con OSMnx): **a pie** (andenes y calles), **bici** (incluye ciclorrutas) y **carro** (respeta los sentidos de las vías). | Conteo de esquinas y tramos de cada red y un mapa de cada una. |
| 2.2 | Asignar delitos a los tramos. Si los datos vienen por zona, cada tramo toma la tasa de su zona (delitos por kilómetro de calle) suavizada con las zonas vecinas, para evitar "saltos" bruscos en los bordes. Si vienen como puntos, se suman los delitos cercanos (ej. a 100 m). En ambos casos se pondera por gravedad y antigüedad. | Mapa donde las calles se colorean de verde a rojo. |
| 2.3 | Puntaje distinto por modo, con la tabla de pesos aprobada en 1.5: a pie pesa el hurto a personas; en bici, el hurto de bicicletas; en carro, el hurto en vía y de vehículos. | Tres mapas; el de bici debe resaltar zonas distintas al de peatón. |
| 2.4 | Si hay hora del hecho: dos puntajes por tramo, **día** (6 a. m.–6 p. m.) y **noche**. | Dos mapas; el de noche debe verse distinto al de día. |
| 2.5 | Normalizar (convertir a escala 0–1 por percentiles) para que un solo valor extremo no distorsione todo. | Histograma del riesgo: la mayoría de calles en valores bajos, pocas en rojo. |
| 2.6 | Exportar tres archivos compactos: `grafo-pie.bin`, `grafo-bici.bin`, `grafo-carro.bin`. | Cada archivo ≤ 10 MB (comprimido, idealmente ≤ 5 MB). |
| 2.7 | Prueba de sentido común: 5 calles que tú conoces bien y su puntaje en cada modo. | Tú confirmas que el resultado "tiene sentido" o lo ajustamos. |

---

## Fase 3 — Cálculo de ruta en el celular (6–8 días)

**Objetivo:** tocar dos puntos en el mapa, elegir cómo te mueves y ver la ruta segura frente a la
más rápida. Se construye **a pie primero**; bici y carro reutilizan el mismo motor.

| # | Paso | ✅ Verificación |
|---|---|---|
| 3.1 | La app descarga el grafo del modo elegido y lo guarda en el teléfono. | Segunda visita carga casi instantánea. |
| 3.2 | Elegir origen y destino tocando el mapa o con "Mi ubicación". | Aparecen dos marcadores. |
| 3.3 | Algoritmo A* con costo `tiempo × (1 + α × riesgo)`, **a pie**. | Dibuja una ruta que sigue calles reales. |
| 3.4 | Mostrar las dos rutas (segura y rápida) con: distancia, minutos, % de riesgo evitado. | Tarjeta resumen legible. |
| 3.5 | Deslizador "más seguro ↔ más corto" y selector día/noche. | Al moverlo, la ruta cambia. |
| 3.6 | Selector de modo **🚶 / 🚲 / 🚗** usando los grafos de bici y carro. | En carro la ruta respeta los sentidos viales; en bici aprovecha ciclorrutas. |
| 3.7 | Aviso en el destino para bici, moto y carro si la zona tiene muchos robos de vehículos. | Aparece al elegir un destino en una zona roja. |
| 3.8 | Búsqueda de direcciones (Photon). | Escribes "Parque de la 93" y lo encuentra. |
| 3.9 | **Medición de rendimiento** en un celular de gama media. | Ruta calculada en < 1 segundo a pie (hasta ~10 km) y en < 2 segundos en carro (hasta ~30 km). Si no se cumple, activamos el plan B (servidor de rutas). |
| 3.10 | Pruebas automáticas con rutas conocidas en los tres modos. | ✔ verde en GitHub. |

---

## Fase 4 — Mapa de calor (2–3 días)

**Objetivo:** ver dónde se concentran los delitos, sin señalar direcciones exactas.

| # | Paso | ✅ Verificación |
|---|---|---|
| 4.1 | Agrupar delitos en hexágonos (~250 m) y ocultar los que tengan muy pocos casos, para proteger a las víctimas. | Ningún hexágono muestra 1 o 2 casos. |
| 4.2 | Capa de calor que se activa/desactiva con un botón. | Se prende y se apaga. |
| 4.3 | Filtros: tipo de delito, periodo (último mes / año), día/noche. | Al filtrar, el mapa cambia. |
| 4.4 | Leyenda y texto explicativo ("delitos denunciados, fuente SDSCJ, fecha de corte"). | Se lee claro en el celular. |

---

## Fase 5 — Reportes ciudadanos (4–6 días)

**Objetivo:** que la comunidad aporte información reciente sin abrir la puerta al abuso.

| # | Paso | ✅ Verificación |
|---|---|---|
| 5.1 | Crear proyecto en Supabase con tabla `reportes` (tipo, ubicación, fecha, estado). Sin nombres, correos ni IP. | Ves la tabla en el panel de Supabase. |
| 5.2 | Formulario en la app: tocar el mapa → elegir tipo (poca luz, hurto, acoso, otro) → enviar. | Un reporte de prueba aparece en el panel. |
| 5.3 | Protección antiabuso: "no soy un robot" (Turnstile) y límite de reportes por dispositivo. | Un envío masivo de prueba es rechazado. |
| 5.4 | Reglas de moderación escritas en `docs/moderacion.md`: qué se aprueba, qué se rechaza y qué se consulta contigo. | Tú las lees y las apruebas. |
| 5.5 | **Moderación por Claude:** una tarea programada de Claude Code revisa cada día los reportes pendientes, aplica las reglas, registra el motivo de cada decisión y te deja los dudosos. | Con 10 reportes de prueba (buenos, spam, ofensivos y ambiguos), Claude clasifica bien los claros y te pasa los ambiguos. |
| 5.6 | **Moderación por ti:** resuelves los dudosos o reviertes decisiones desde el panel de Supabase. | Cambias un reporte a "rechazado" y desaparece del mapa. |
| 5.7 | Protección contra manipulación: un reporte aislado solo se muestra como aviso; para cambiar rutas hacen falta ≥ 2 reportes de dispositivos distintos en la misma zona en 7 días. | Un único reporte no mueve la ruta; dos sí. |
| 5.8 | Los reportes aprobados suman un poco de riesgo al tramo cercano y **caducan a los 30 días**. | La ruta vuelve a la normalidad al caducar. |
| 5.9 | Política de privacidad, términos de uso y aviso "Si estás en peligro, llama al 123". | Páginas accesibles desde el menú. |

🧑 Crear la cuenta gratuita de Supabase y una de Cloudflare (para Turnstile). Te guío paso a paso.
Para que Claude modere, la clave de Supabase se guarda como credencial del entorno de Claude Code
(nunca en el código) y el entorno debe permitir el dominio `*.supabase.co`.

---

## Fase 6 — PWA completa y despliegue final (2–4 días)

**Objetivo:** que se sienta como una app de verdad y se actualice sola.

| # | Paso | ✅ Verificación |
|---|---|---|
| 6.1 | Ícono, nombre y colores; opción "Agregar a pantalla de inicio". | Se instala en Android (Chrome) y iPhone (Safari). |
| 6.2 | Modo sin conexión: mapa base de Bogotá y grafo guardados. | En modo avión, calculas una ruta. |
| 6.3 | Aviso cuando hay datos nuevos ("Datos actualizados al 1 de octubre"). | Se ve la fecha de corte. |
| 6.4 | Actualización mensual automática de datos (GitHub Actions, día 1 de cada mes). | Un *pull request* automático con datos nuevos que tú apruebas. |
| 6.5 | Accesibilidad: textos legibles, contraste, uso con lector de pantalla. | Puntaje ≥ 90 en Lighthouse (herramienta gratuita de Google). |
| 6.6 | (Opcional) Dominio propio. | `trazasegura.co` (o el que elijas) abre la app. |

---

## Después del lanzamiento (ideas, sin compromiso)

- Compartir trayecto en vivo con un contacto de confianza.
- Rutas en bicicleta.
- Datos adicionales: alumbrado público, comercios abiertos de noche, estaciones de TransMilenio.
- Medir si la gente usa la ruta segura (de forma anónima y agregada).

## Resumen de tiempos

| Fase | Duración estimada |
|---|---|
| 0. Cimientos | 1–2 días |
| 1. Datos | 3–5 días |
| 2. Red vial con riesgo (3 modos) | 5–7 días |
| 3. Cálculo de ruta (3 modos) | 6–8 días |
| 4. Mapa de calor | 2–3 días |
| 5. Reportes ciudadanos | 4–6 días |
| 6. PWA y despliegue | 2–4 días |
| **Total** | **~5 a 7 semanas** de trabajo, dependiendo de la calidad de los datos |

La primera versión útil (ruta segura a pie en el celular) llega a mitad de la **Fase 3**; bici y
carro llegan al final de esa misma fase.
