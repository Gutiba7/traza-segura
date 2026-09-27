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

**Objetivo:** tener una tabla limpia de delitos con ubicación, fecha, hora y tipo.

| # | Paso | ✅ Verificación |
|---|---|---|
| 1.1 | Inventario de fuentes: listar los servicios ArcGIS REST de la SDSCJ y los conjuntos de Datos Abiertos Bogotá; anotar qué campos trae cada uno, licencia y fecha de actualización. | Documento `docs/fuentes.md` con una tabla legible. |
| 1.2 | **Decisión clave:** ¿los delitos vienen como puntos (cada hecho con coordenadas) o como totales por zona (localidad/UPZ/cuadrante)? Esto define la precisión de todo lo demás. | Te explico el hallazgo y decidimos juntos. |
| 1.3 | Script de descarga que pida los datos por páginas (los servicios ArcGIS entregan máximo ~1.000–2.000 registros por consulta) y los guarde. | Número total de registros descargados coincide con el que reporta el servicio. |
| 1.4 | Limpieza: quitar duplicados, registros sin ubicación o fuera de Bogotá, unificar nombres de delitos. | Reporte: "X registros originales → Y válidos", con motivos de descarte. |
| 1.5 | Tabla de pesos por tipo de delito para peatones (ej. hurto a personas = 1,0; lesiones = 0,9; hurto de autopartes = 0,2). | Tabla en `docs/pesos.md` que tú apruebas o ajustas. |
| 1.6 | Mapa de prueba con los puntos/zonas sobre Bogotá. | Ves el mapa y los datos caen donde deben (no en el mar ni en Villavicencio). |

**Riesgo conocido:** la red de este entorno de trabajo bloquea hoy `datosabiertos.bogota.gov.co`.
La descarga definitiva correrá en GitHub Actions (que sí tiene internet abierto); para
desarrollar necesito que se habilite ese dominio (ver "Qué necesito de ti").

---

## Fase 2 — Red vial con costo de riesgo (4–6 días)

**Objetivo:** cada tramo de calle caminable de Bogotá con un puntaje de riesgo de 0 a 1.

| # | Paso | ✅ Verificación |
|---|---|---|
| 2.1 | Descargar de OpenStreetMap las calles caminables del perímetro urbano de Bogotá (con OSMnx). | Conteo de esquinas y tramos (esperamos del orden de cientos de miles) y un mapa de la red. |
| 2.2 | Calcular el riesgo de cada tramo: suma de delitos cercanos (ej. a 100 m), ponderada por gravedad y por antigüedad (un delito de hace 3 años pesa menos que uno de ayer). | Mapa donde las calles se colorean de verde a rojo. |
| 2.3 | Si hay hora del hecho: dos puntajes por tramo, **día** (6 a. m.–6 p. m.) y **noche**. | Dos mapas; el de noche debe verse distinto al de día. |
| 2.4 | Normalizar (convertir a escala 0–1 por percentiles) para que un solo punto extremo no distorsione todo. | Histograma del riesgo: la mayoría de calles en valores bajos, pocas en rojo. |
| 2.5 | Exportar a un archivo compacto `grafo.bin` para el celular. | Tamaño del archivo ≤ 10 MB (comprimido, idealmente ≤ 5 MB). |
| 2.6 | Prueba de sentido común: 5 calles que tú conoces bien y su puntaje. | Tú confirmas que el resultado "tiene sentido" o lo ajustamos. |

---

## Fase 3 — Cálculo de ruta en el celular (4–6 días)

**Objetivo:** tocar dos puntos en el mapa y ver la ruta segura vs. la más corta.

| # | Paso | ✅ Verificación |
|---|---|---|
| 3.1 | La app descarga `grafo.bin` y lo guarda en el teléfono. | Segunda visita carga casi instantánea. |
| 3.2 | Elegir origen y destino tocando el mapa o con "Mi ubicación". | Aparecen dos marcadores. |
| 3.3 | Algoritmo A* con costo `longitud × (1 + α × riesgo)`. | Dibuja una ruta que sigue calles reales. |
| 3.4 | Mostrar las dos rutas (segura y corta) con: distancia, minutos a pie, % de riesgo evitado. | Tarjeta resumen legible. |
| 3.5 | Deslizador "más seguro ↔ más corto" y selector día/noche. | Al moverlo, la ruta cambia. |
| 3.6 | Búsqueda de direcciones (Photon). | Escribes "Parque de la 93" y lo encuentra. |
| 3.7 | **Medición de rendimiento** en un celular de gama media. | Ruta calculada en < 1 segundo para trayectos de hasta ~10 km. Si no se cumple, activamos el plan B (servidor de rutas). |
| 3.8 | Pruebas automáticas con rutas conocidas. | ✔ verde en GitHub. |

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
| 5.4 | Moderación: los reportes entran como "pendiente"; tú (o un moderador) los aprueba desde el panel de Supabase. | Solo los aprobados se ven en el mapa. |
| 5.5 | Los reportes aprobados suman un poco de riesgo al tramo cercano y **caducan a los 30 días**. | Una ruta cambia levemente tras aprobar un reporte, y vuelve a la normalidad al caducar. |
| 5.6 | Política de privacidad y términos de uso en lenguaje sencillo. | Página accesible desde el menú. |

🧑 Crear la cuenta gratuita de Supabase y una de Cloudflare (para Turnstile). Te guío paso a paso.

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
| 2. Red vial con riesgo | 4–6 días |
| 3. Cálculo de ruta | 4–6 días |
| 4. Mapa de calor | 2–3 días |
| 5. Reportes ciudadanos | 4–6 días |
| 6. PWA y despliegue | 2–4 días |
| **Total** | **~4 a 6 semanas** de trabajo, dependiendo de la calidad de los datos |

La primera versión útil (ruta segura en el celular) llega al final de la **Fase 3**.
