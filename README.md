# Traza Segura 2.0

**La ruta más segura por Bogotá, aunque no sea la más corta.**

Traza Segura es una aplicación web instalable (PWA) que, dados un punto de origen y uno de
destino en Bogotá, calcula el camino que **evita las zonas con más delitos registrados**,
aceptando un pequeño desvío a cambio de más tranquilidad.

> Estado actual: **Fase 0 lista y Fase 1 en curso.** Ya existe una primera versión de la app con
> el mapa de Bogotá y una capa de datos reales (llamadas a la Línea 123 por hurto, por sector
> catastral). Todavía no calcula rutas. El plan de trabajo está en [PLAN.md](PLAN.md); las fuentes,
> en [docs/fuentes.md](docs/fuentes.md), y las matemáticas, en [docs/metodologia.md](docs/metodologia.md).

---

## 1. Visión

Las apps de mapas optimizan minutos. Traza Segura optimiza **tranquilidad**. Queremos que una
persona que camina por Bogotá, sobre todo de noche, pueda preguntar:

> "¿Cómo llego de aquí a allá pasando por las calles con menos historial de delitos?"

y reciba una respuesta clara, con una comparación honesta: *"Esta ruta es 6 minutos más larga
y pasa por calles con un 40 % menos de delitos registrados."*

Principios que guían todas las decisiones:

1. **Datos públicos y verificables.** El riesgo se calcula con datos oficiales de la
   Secretaría Distrital de Seguridad, Convivencia y Justicia (SDSCJ) y la red vial de
   OpenStreetMap. Cualquier persona puede revisar de dónde sale cada número.
2. **Privacidad por diseño.** La ruta se calcula **dentro del celular**. Tu origen y tu
   destino no se envían a ningún servidor.
3. **Honestidad sobre los límites.** Los datos son *delitos denunciados* y *llamadas a la Línea
   123*, no todo lo que ocurre, y vienen por zonas. La app muestra riesgo *relativo* y nunca
   promete "seguridad garantizada".
4. **No estigmatizar.** Mostramos calles y franjas horarias, no etiquetamos barrios como
   "peligrosos". El mapa de calor agrega datos para no señalar direcciones exactas.
5. **Costo casi cero.** Debe poder mantenerse gratis o por muy poco dinero durante años.

## 2. Funciones

| Función | Qué hace | Fase |
|---|---|---|
| **Ruta más segura** | Calcula la ruta de menor riesgo entre dos puntos y la compara con la más corta. | 3 |
| **Tres modos de viaje** | **A pie** (primero), **bicicleta** y **carro/moto**. Cada modo usa sus propias calles (el carro respeta los sentidos viales; la bici prefiere ciclorrutas) y los delitos que más lo afectan. | 3 |
| **Control "más seguro ↔ más corto"** | Un deslizador para decidir cuánto desvío estás dispuesto a aceptar. | 3 |
| **Día / noche** | El riesgo cambia según la hora. Para bici hay datos oficiales por franja de 3 horas; de noche se suma una auditoría de iluminación y visibilidad calle por calle. | 3 |
| **Aviso en el destino** | Para carro, moto y bici: si el destino está en una zona con muchos robos de vehículos, sugiere parquear en un lugar vigilado. | 3 |
| **Botón de ayuda** | Llama al 123 o al **cuadrante de policía** de la zona donde estás (dato oficial con el teléfono de cada cuadrante). | 5 |
| **Mapa de calor** | Muestra dónde se concentran los delitos registrados, por tipo y periodo. | 4 |
| **Reportes ciudadanos** | Permite reportar de forma anónima una situación (poca luz, robo, acoso). Se moderan antes de influir en las rutas. | 5 |
| **Instalable y offline** | Se instala como app desde el navegador y funciona con mala señal una vez descargada. | 6 |
| **"Mi ubicación"** | Usa el GPS del celular como punto de partida, sin guardarlo. | 3 |

Fuera del alcance inicial (ideas para después): navegación paso a paso con voz, tráfico en tiempo
real para carro, compartir el trayecto en vivo con un contacto, otras ciudades.

### ¿Por qué incluir bicicleta y carro desde el principio?

Los datos oficiales de delitos vienen **agrupados por zonas**: en el mejor caso, sectores de unas
5×5 cuadras en promedio (ver sección 3). En un trayecto a pie de 5 cuadras casi siempre te quedas
dentro de la misma zona, así que no hay mucha alternativa que ofrecer. En bici o en carro recorres
varios kilómetros y atraviesas muchas zonas: ahí sí se puede elegir entre pasar por una zona con
muchos robos o rodearla. Con datos por zona, **los trayectos largos son donde la app aporta más**.

## 3. Arquitectura propuesta

La idea central: **hacer el trabajo pesado una vez al mes en la nube, y el trabajo liviano en el
celular del usuario.** Así no necesitamos un servidor encendido las 24 horas.

```
 ┌───────────────────────── UNA VEZ AL MES (automático, gratis) ─────────────────────────┐
 │                                                                                        │
 │   Datos de delitos (Secretaría de    Red vial de Bogotá                                │
 │   Seguridad, vía Datos Abiertos      (OpenStreetMap)                                   │
 │   Bogotá e IDECA)                                                                      │
 │            │                                │                                          │
 │            ▼                                ▼                                          │
 │   ┌────────────────────────────────────────────────────────┐                           │
 │   │  "Tubería de datos" en Python (GitHub Actions)         │                           │
 │   │   1. Descarga y limpia los delitos                     │                           │
 │   │   2. Descarga las calles: a pie, en bici y en carro    │                           │
 │   │   3. Le pone a cada tramo de calle un puntaje de riesgo│                           │
 │   │      distinto para cada modo de viaje                  │                           │
 │   │   4. Genera archivos compactos listos para la app      │                           │
 │   └────────────────────────────────────────────────────────┘                           │
 │            │                                                                           │
 └────────────┼───────────────────────────────────────────────────────────────────────────┘
              ▼
   Archivos estáticos publicados en internet (GitHub Pages)
     • grafo-pie.bin, grafo-bici.bin, grafo-carro.bin
                       → las calles de cada modo con su riesgo (unos pocos MB cada uno)
     • calor.json      → datos para el mapa de calor
     • la app (HTML, CSS, JavaScript)
              │
              ▼
 ┌──────────────────────── EN EL CELULAR DEL USUARIO ────────────────────────┐
 │  PWA (app web instalable)                                                  │
 │   • Muestra el mapa (MapLibre + mapa base gratuito)                         │
 │   • Descarga solo el grafo del modo que uses, una vez, y lo guarda          │
 │   • Calcula la ruta más segura AHÍ MISMO (algoritmo A*)                     │
 │   • Funciona sin conexión después de la primera visita                      │
 └──────────────────────────────┬─────────────────────────────────────────────┘
                                │ (solo para reportes ciudadanos, Fase 5)
                                ▼
                     Supabase (base de datos gratuita)
                     reportes anónimos → moderados por Claude y por ti
```

### ¿Cómo se calcula "la ruta más segura"?

1. **Las calles como una red.** OpenStreetMap nos da cada tramo de calle entre dos esquinas.
   A eso se le llama un *grafo*: puntos (esquinas) unidos por líneas (tramos).
2. **Riesgo por tramo.** Para cada tramo miramos cuántos incidentes hubo en su zona (y en las
   zonas vecinas), dando más peso a los recientes y a los más graves. Donde hay datos más finos,
   como los robos de bicicleta en hexágonos de 100 m, se usan esos. El resultado es un **riesgo
   relativo**: 1 es el promedio de la ciudad y 2, el doble. Cada modo de viaje mira los delitos
   que realmente lo afectan:

   | Modo | Delitos que más pesan |
   |---|---|
   | A pie | Hurto a personas, lesiones personales, homicidio, delitos sexuales |
   | Bicicleta | Hurto de bicicletas, hurto a personas, lesiones personales |
   | Carro / moto | Hurto a personas en vía (fleteo, raponeo en trancones), hurto de motos y carros |

3. **Costo del tramo** = `tiempo × (1 + α × riesgo)`.
   - Para caminar y la bici, el tiempo sale de la distancia a velocidad constante. Para el carro
     se usa la velocidad típica de cada tipo de vía (sin tráfico en tiempo real, al menos al principio).
   - `α` (alfa) es el deslizador "más seguro ↔ más corto". Con α = 0 sale la ruta más rápida;
     con α alto, la app acepta desvíos grandes para evitar tramos riesgosos.
   - En palabras: un minuto en un tramo con riesgo 3 "cuesta" como 1 + 3α minutos.
4. **Buscar el camino de menor costo.** Se usa el algoritmo A* (un método clásico y rápido para
   encontrar caminos en mapas). Con la red de Bogotá tarda menos de un segundo en un celular.
5. **Comparar.** Mostramos la ruta segura junto a la más corta, con minutos extra y porcentaje
   de riesgo evitado, para que la persona decida.

Las fórmulas completas, por qué son correctas y la evidencia con datos reales están en
[docs/metodologia.md](docs/metodologia.md).

### Lo que encontramos en los datos (Fase 1.1)

El inventario completo está en [docs/fuentes.md](docs/fuentes.md). Lo esencial:

- **No hay datos abiertos con la ubicación exacta de cada delito.** Lo más fino son las llamadas a
  la Línea 123 por **sector catastral** (1.170 zonas; en promedio, unas 5×5 cuadras). Las
  denuncias oficiales por tipo de delito solo vienen **por localidad** (20 zonas).
- Por eso el riesgo será **por zona**, suavizado entre zonas vecinas, más tres capas con detalle
  casi de cuadra: robos de bicicleta en hexágonos de 100 m, la auditoría nocturna de la Secretaría
  de la Mujer (44.335 puntos) y siniestros viales con coordenadas.
- El servidor ArcGIS de la Secretaría **no responde desde fuera de Colombia**, así que la
  actualización automática usa Datos Abiertos Bogotá e IDECA, que publican lo mismo.
- Los supuestos del modelo se comprobaron con los datos oficiales: el patrón por sector se
  repite casi idéntico de un año a otro, y las llamadas por hurto, riñas y disparos siguen el
  mismo patrón que las denuncias de hurto, lesiones y homicidio. El robo de bicicletas no, y por
  eso usa su propia capa.
- Para ganar precisión se puede pedir el detalle con un
  [derecho de petición](docs/derecho-de-peticion.md). Si llega, se reemplaza la fuente sin
  cambiar el resto de la app.

### Moderación de reportes ciudadanos: Claude y tú

Un reporte falso podría desviar a la gente o estigmatizar una cuadra. Por eso cada reporte pasa
por tres filtros antes de influir en una ruta:

1. **Filtros automáticos (instantáneos).** Casilla "no soy un robot" (Turnstile), un máximo de
   reportes por dispositivo al día, rechazo de puntos fuera de Bogotá y formulario cerrado:
   categoría fija más un texto opcional de máximo 140 caracteres. Sin fotos ni nombres, para no
   exponer a nadie.
2. **Claude (una vez al día).** Una tarea programada de Claude Code revisa los reportes pendientes
   siguiendo reglas escritas en `docs/moderacion.md`. Funciona como esta sesión, pero automática.
   Aprueba los claros, rechaza el spam y los insultos, y te deja los dudosos con un resumen. No
   tiene costo adicional porque usa tu plan de Claude, y cada decisión queda registrada con su motivo.
3. **Tú (cuando haya dudas).** Resuelves los dudosos desde el panel de Supabase y puedes revertir
   cualquier decisión de Claude.

Reglas de protección adicionales:

- Un reporte aislado se muestra como aviso, pero **no cambia rutas**. Hacen falta al menos 2
  reportes de dispositivos distintos en la misma zona en 7 días, para que una sola persona no
  pueda manipular el sistema.
- Los reportes caducan a los 30 días.
- La app no es un canal de emergencias: siempre tiene a mano el botón de ayuda (123 y cuadrante
  de policía).

## 4. Stack propuesto (y por qué)

"Stack" = el conjunto de herramientas con las que se construye la app. El criterio fue:
**lo más simple, lo más barato y lo que menos se pueda romper.**

| Pieza | Herramienta | Costo | Por qué esta y no otra |
|---|---|---|---|
| Código y tareas automáticas | **GitHub** + **GitHub Actions** | Gratis (repo público) | Ya tienes el repositorio aquí. Actions ejecuta la actualización mensual de datos sin que tengas que encender nada. |
| Procesar datos | **Python** con GeoPandas y OSMnx | Gratis | Es el estándar para datos geográficos; OSMnx descarga las calles de OpenStreetMap en una línea. Solo corre una vez al mes, no en el celular. |
| Publicar la app | **GitHub Pages** | Gratis | Sirve archivos estáticos sin servidor. Todo queda en un solo lugar (GitHub): una cuenta, una contraseña, cero facturas. |
| Mapa en pantalla | **MapLibre GL JS** + mapa base de **OpenFreeMap** | Gratis, sin clave | MapLibre es la versión libre de Mapbox. OpenFreeMap da el fondo del mapa sin registro ni tarjeta de crédito. Google Maps cobra por uso. |
| Calcular rutas | **A\* en JavaScript**, dentro del celular | Gratis | Un servidor de rutas (OSRM, GraphHopper) cuesta ~USD 10–20/mes y hay que mantenerlo. Calcular en el teléfono es gratis y además protege la privacidad. |
| Interfaz | **JavaScript/TypeScript sin framework** + **Vite** | Gratis | Menos piezas = menos cosas que se desactualizan. React u otros frameworks sobran para una pantalla con un mapa y dos buscadores. Vite empaqueta todo y ayuda a convertirla en PWA. |
| App instalable | **vite-plugin-pwa** | Gratis | Genera automáticamente lo necesario para "Agregar a pantalla de inicio" y el modo sin conexión. |
| Reportes ciudadanos (Fase 5) | **Supabase** (PostgreSQL + PostGIS) + **Cloudflare Turnstile** | Gratis en el plan básico | Base de datos con panel visual para moderar sin programar. Turnstile es un "no soy un robot" gratuito que no rastrea al usuario. |
| Buscar direcciones | **Photon** (basado en OpenStreetMap) | Gratis | Sin clave. Si algún día se queda corto, se cambia sin tocar el resto. |

**Costo mensual esperado: 0 COP.** Único gasto opcional: un dominio propio
(ej. `trazasegura.co`), del orden de USD 10–40 al año según la extensión.

### Alternativas descartadas

- **Servidor propio de rutas (OSRM/GraphHopper en un VPS):** más preciso para trayectos muy
  largos, pero implica pagar y mantener un servidor. Lo dejamos como plan B si el cálculo en el
  celular resulta lento (lo mediremos en la Fase 3).
- **Google Maps / Mapbox:** excelentes, pero cobran por uso y exigen tarjeta de crédito.
- **App nativa (Android/iOS):** requiere tiendas de apps, cuentas pagas (Apple cobra USD 99
  al año) y dos códigos distintos. Una PWA se instala desde el navegador.

## 5. Estructura prevista del repositorio

```
traza-segura/
├── README.md            ← este documento
├── PLAN.md              ← fases de trabajo
├── docs/                ← fuentes de datos, decisiones, reglas de moderación
├── pipeline/            ← scripts de Python que preparan los datos (Fases 1–2)
├── web/                 ← la aplicación que ve el usuario (Fases 3–6)
│   └── public/data/     ← archivos generados por la tubería (grafo, mapa de calor)
└── .github/workflows/   ← automatizaciones: actualizar datos y publicar la app
```

## 6. Datos, licencias y responsabilidad

- **Delitos:** Secretaría Distrital de Seguridad, Convivencia y Justicia de Bogotá, publicados en
  [Datos Abiertos Bogotá](https://datosabiertos.bogota.gov.co/organization/secretaria-distrital-de-seguridad-convivencia-y-justicia)
  con licencia **CC BY-SA 4.0**: se pueden usar libremente citando la fuente, y lo que derivemos
  de ellos (por ejemplo, el riesgo por calle) se comparte con la misma licencia. El detalle de cada
  fuente está en [docs/fuentes.md](docs/fuentes.md).
- **Movilidad (ciclorrutas, siniestros viales):** IDU y Secretaría de Movilidad, licencia CC BY 4.0.
- **Calles:** © colaboradores de OpenStreetMap, licencia ODbL. La app debe mostrar esa
  atribución en el mapa.
- **Datos personales:** no se guardan rutas, orígenes ni destinos. Los reportes ciudadanos son
  anónimos: no guardan IP, nombre ni teléfono. Solo guardan un código aleatorio del dispositivo,
  que no revela quién eres y sirve para que una misma persona no pueda reportar lo mismo muchas
  veces. Esto se alinea con la Ley 1581 de 2012 (Habeas Data).
- **Aviso al usuario:** "Traza Segura muestra riesgo relativo por zonas, según delitos
  denunciados y llamadas a la Línea 123. No garantiza tu seguridad. Mantente atento a tu entorno."

## 7. Glosario rápido

- **PWA:** página web que se puede instalar en el celular como si fuera una app.
- **ArcGIS REST:** forma estándar en que muchas entidades publican mapas y datos por internet.
- **OpenStreetMap (OSM):** mapa del mundo hecho por voluntarios, libre y gratuito.
- **Grafo:** representación de las calles como puntos (esquinas) conectados por líneas (tramos).
- **A\* ("A estrella"):** algoritmo para encontrar el camino de menor costo en un grafo.
- **GitHub Actions:** robot de GitHub que ejecuta tareas automáticamente (por ejemplo, cada mes).
- **Estático:** archivos que se sirven tal cual, sin un servidor "pensando" por detrás. Por eso
  es gratis.
- **Localidad / UPZ / cuadrante:** divisiones de Bogotá de mayor a menor tamaño. Hay 20
  localidades y más de 100 UPZ (Unidades de Planeamiento Zonal). Los cuadrantes son las zonas
  que patrulla cada equipo de la Policía y son más pequeños que una UPZ.
- **Sector catastral:** zona definida por Catastro Bogotá, parecida a un barrio. Hay unos 1.170
  y es la zona más pequeña con datos de seguridad abiertos y al día.
- **SIEDCO:** sistema de la Policía Nacional donde se registran las denuncias de delitos; de ahí
  salen las cifras oficiales.
- **Derecho de petición:** solicitud formal y gratuita a una entidad pública, que debe responder
  en un plazo legal.
- **CC BY-SA:** licencia de datos abiertos: puedes usarlos citando la fuente y compartiendo lo
  que derives con la misma licencia.
