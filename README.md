# Traza Segura 2.0

**La ruta más segura por Bogotá, aunque no sea la más corta.**

Traza Segura es una aplicación web instalable (PWA) que, dados un punto de origen y uno de
destino en Bogotá, calcula el camino que **evita las zonas con más delitos registrados**,
aceptando un pequeño desvío a cambio de más tranquilidad.

> Estado actual: **planeación**. Todavía no hay código. El plan de trabajo está en
> [PLAN.md](PLAN.md).

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
3. **Honestidad sobre los límites.** Los datos son *delitos denunciados*, no todos los que
   ocurren. La app muestra riesgo *relativo*, nunca promete "seguridad garantizada".
4. **No estigmatizar.** Mostramos calles y franjas horarias, no etiquetamos barrios como
   "peligrosos". El mapa de calor agrega datos para no señalar direcciones exactas.
5. **Costo casi cero.** Debe poder mantenerse gratis o por muy poco dinero durante años.

## 2. Funciones

| Función | Qué hace | Fase |
|---|---|---|
| **Ruta más segura** | Calcula la ruta de menor riesgo entre dos puntos y la compara con la más corta. | 3 |
| **Control "más seguro ↔ más corto"** | Un deslizador para decidir cuánto desvío estás dispuesto a aceptar. | 3 |
| **Día / noche** | El riesgo cambia según la hora (si los datos oficiales traen la hora del hecho). | 3 |
| **Mapa de calor** | Muestra dónde se concentran los delitos registrados, por tipo y periodo. | 4 |
| **Reportes ciudadanos** | Permite reportar de forma anónima una situación (poca luz, robo, acoso). Se moderan antes de influir en las rutas. | 5 |
| **Instalable y offline** | Se instala como app desde el navegador y funciona con mala señal una vez descargada. | 6 |
| **"Mi ubicación"** | Usa el GPS del celular como punto de partida, sin guardarlo. | 3 |

Fuera del alcance inicial (ideas para después): navegación paso a paso con voz, rutas en
bicicleta o en carro, compartir el trayecto en vivo con un contacto, otras ciudades.

## 3. Arquitectura propuesta

La idea central: **hacer el trabajo pesado una vez al mes en la nube, y el trabajo liviano en el
celular del usuario.** Así no necesitamos un servidor encendido las 24 horas.

```
 ┌───────────────────────── UNA VEZ AL MES (automático, gratis) ─────────────────────────┐
 │                                                                                        │
 │   Datos de delitos (SDSCJ,           Red vial de Bogotá                                │
 │   servicios ArcGIS REST)             (OpenStreetMap)                                   │
 │            │                                │                                          │
 │            ▼                                ▼                                          │
 │   ┌────────────────────────────────────────────────────────┐                           │
 │   │  "Tubería de datos" en Python (GitHub Actions)         │                           │
 │   │   1. Descarga y limpia los delitos                     │                           │
 │   │   2. Descarga las calles caminables                    │                           │
 │   │   3. Le pone a cada tramo de calle un puntaje de riesgo│                           │
 │   │   4. Genera archivos compactos listos para la app      │                           │
 │   └────────────────────────────────────────────────────────┘                           │
 │            │                                                                           │
 └────────────┼───────────────────────────────────────────────────────────────────────────┘
              ▼
   Archivos estáticos publicados en internet (GitHub Pages)
     • grafo.bin       → las calles con su riesgo (unos pocos MB)
     • calor.json      → datos para el mapa de calor
     • la app (HTML, CSS, JavaScript)
              │
              ▼
 ┌──────────────────────── EN EL CELULAR DEL USUARIO ────────────────────────┐
 │  PWA (app web instalable)                                                  │
 │   • Muestra el mapa (MapLibre + mapa base gratuito)                         │
 │   • Descarga grafo.bin una vez y lo guarda                                  │
 │   • Calcula la ruta más segura AHÍ MISMO (algoritmo A*)                     │
 │   • Funciona sin conexión después de la primera visita                      │
 └──────────────────────────────┬─────────────────────────────────────────────┘
                                │ (solo para reportes ciudadanos, Fase 5)
                                ▼
                     Supabase (base de datos gratuita)
                     reportes anónimos + panel de moderación
```

### ¿Cómo se calcula "la ruta más segura"?

1. **Las calles como una red.** OpenStreetMap nos da cada tramo de calle entre dos esquinas.
   A eso se le llama un *grafo*: puntos (esquinas) unidos por líneas (tramos).
2. **Riesgo por tramo.** Para cada tramo miramos cuántos delitos ocurrieron cerca, dando más
   peso a los recientes y a los más graves (por ejemplo, hurto a personas pesa más que
   hurto de autopartes para alguien que camina). El resultado es un número de 0 a 1.
3. **Costo del tramo** = `longitud × (1 + α × riesgo)`.
   - `α` (alfa) es el deslizador "más seguro ↔ más corto". Con α = 0 sale la ruta más corta;
     con α alto, la app acepta desvíos grandes para evitar tramos riesgosos.
4. **Buscar el camino de menor costo.** Se usa el algoritmo A* (un método clásico y rápido para
   encontrar caminos en mapas). Con la red de Bogotá tarda menos de un segundo en un celular.
5. **Comparar.** Mostramos la ruta segura junto a la más corta, con minutos extra y porcentaje
   de riesgo evitado, para que la persona decida.

> **Punto a confirmar en la Fase 1:** si la Secretaría publica cada delito como un punto con
> coordenadas, el riesgo será por calle. Si solo publica totales por zona (localidad, UPZ o
> cuadrante), el riesgo será por zona: funciona, pero es menos fino. El plan contempla ambos
> casos.

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
├── pipeline/            ← scripts de Python que preparan los datos (Fases 1–2)
├── web/                 ← la aplicación que ve el usuario (Fases 3–6)
│   └── public/data/     ← archivos generados por la tubería (grafo, mapa de calor)
└── .github/workflows/   ← automatizaciones: actualizar datos y publicar la app
```

## 6. Datos, licencias y responsabilidad

- **Delitos:** Secretaría Distrital de Seguridad, Convivencia y Justicia de Bogotá, publicados en
  [Datos Abiertos Bogotá](https://datosabiertos.bogota.gov.co/organization/secretaria-distrital-de-seguridad-convivencia-y-justicia)
  y servicios ArcGIS REST. Verificaremos la licencia exacta de cada conjunto en la Fase 1.
- **Calles:** © colaboradores de OpenStreetMap, licencia ODbL. La app debe mostrar esa
  atribución en el mapa.
- **Datos personales:** no se guardan rutas, orígenes ni destinos. Los reportes ciudadanos son
  anónimos y no almacenan IP ni identificadores. Esto se alinea con la Ley 1581 de 2012
  (Habeas Data).
- **Aviso al usuario:** "Traza Segura muestra riesgo relativo según delitos denunciados. No
  garantiza tu seguridad. Mantente atento a tu entorno."

## 7. Glosario rápido

- **PWA:** página web que se puede instalar en el celular como si fuera una app.
- **ArcGIS REST:** forma estándar en que muchas entidades publican mapas y datos por internet.
- **OpenStreetMap (OSM):** mapa del mundo hecho por voluntarios, libre y gratuito.
- **Grafo:** representación de las calles como puntos (esquinas) conectados por líneas (tramos).
- **A\* ("A estrella"):** algoritmo para encontrar el camino de menor costo en un grafo.
- **GitHub Actions:** robot de GitHub que ejecuta tareas automáticamente (por ejemplo, cada mes).
- **Estático:** archivos que se sirven tal cual, sin un servidor "pensando" por detrás. Por eso
  es gratis.
