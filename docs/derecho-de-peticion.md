# Borrador: derecho de petición para obtener datos de delitos más detallados

**Para qué sirve:** los datos abiertos de delitos de Bogotá vienen agrupados por zonas (ver
[fuentes.md](fuentes.md)). Con un derecho de petición podemos pedir a las autoridades datos más
finos, por ejemplo por cuadrante de policía, por manzana o con la hora del hecho. Es gratis, es un
derecho constitucional (artículo 23) y la entidad tiene un plazo legal para responder.

> Esto es un borrador de trabajo, no asesoría legal. Revísalo antes de enviarlo.

## A quién enviarlo

| Entidad | Canal | Por qué |
|---|---|---|
| Secretaría Distrital de Seguridad, Convivencia y Justicia (Oficina de Análisis de Información y Estudios Estratégicos, OAIEE) | **Bogotá te escucha** (sistema distrital de peticiones) o el canal de atención de la Secretaría | Publica las cifras de Bogotá y administra el servidor de mapas donde están |
| Policía Nacional (DIJIN, estadística delictiva / SIEDCO) | Canal de peticiones de la Policía Nacional, o el correo que la Policía indica para solicitudes estadísticas: `dijin.aicri-jef@policia.gov.co` | Es la dueña del sistema SIEDCO, de donde salen los datos |

**Plazo de respuesta:** 10 días hábiles para solicitudes de información y documentos (Ley 1755 de
2015, artículo 14). Si la entidad niega una parte, debe entregar el resto y explicar por qué
(Ley 1712 de 2014).

## Texto sugerido

---

Bogotá D.C., [fecha]

Señores
[Secretaría Distrital de Seguridad, Convivencia y Justicia – Oficina de Análisis de Información y
Estudios Estratégicos] / [Policía Nacional – Dirección de Investigación Criminal e INTERPOL]

**Asunto:** Derecho de petición de información pública: datos de delitos de alto impacto en
Bogotá D.C. con desagregación espacial y temporal.

Yo, [nombre completo], identificado(a) con cédula de ciudadanía n.º [número], en ejercicio del
derecho fundamental de petición (artículo 23 de la Constitución Política y Ley 1755 de 2015) y del
derecho de acceso a la información pública (Ley 1712 de 2014), solicito respetuosamente:

1. La base de datos de los siguientes delitos ocurridos en Bogotá D.C. entre el 1 de enero de 2023 y
   la fecha de corte más reciente disponible: hurto a personas, hurto de bicicletas, hurto de
   celulares, hurto de motocicletas, hurto de automotores, lesiones personales, homicidio y delitos
   sexuales.
2. Que cada registro incluya, en lo posible: fecha, hora (o franja horaria), día de la semana, tipo
   de delito, modalidad, arma o medio empleado, clase de sitio (vía pública, transporte público,
   establecimiento, etc.), localidad, UPZ, barrio, cuadrante de policía y **ubicación aproximada**
   (coordenadas redondeadas a unos 100 metros, o asignadas al centro de la manzana o del tramo de vía).
3. Que la información se entregue **anonimizada**, sin ningún dato que permita identificar a
   víctimas o presuntos responsables (nombres, documentos, direcciones exactas de residencia).
4. Si no es posible entregar el detalle por hecho, solicito subsidiariamente el **conteo mensual
   por cuadrante de policía (o por manzana), tipo de delito y franja horaria** para el mismo periodo.
5. Que la información se entregue en formato digital abierto (CSV, GeoJSON o Shapefile).

**Finalidad:** la información se usará en *Traza Segura*, un proyecto ciudadano sin ánimo de lucro
que calcula rutas más seguras para caminar, ir en bicicleta o en carro por Bogotá. Los datos se
publicarán únicamente de forma agregada, sin exponer ubicaciones exactas de hechos individuales, y
se citará a la entidad como fuente. El proyecto es de código abierto:
https://github.com/Gutiba7/traza-segura

Si alguna parte de la información fuera clasificada o reservada, solicito que se entregue la parte
no reservada (divulgación parcial) y que se indique la norma que fundamenta la reserva.

Recibo notificaciones en el correo electrónico [correo].

Atentamente,

[Nombre]
C.C. [número]
[Correo] · [Teléfono opcional]

---

## Qué hacemos con la respuesta

- **Si entregan datos por hecho o por cuadrante:** el riesgo pasa de "por zona" a "por calle" y las
  rutas cortas a pie mejoran mucho. Se integra en la Fase 1 sin cambiar el resto del plan.
- **Si la niegan o se demoran:** seguimos con los datos abiertos por zona; el plan ya está diseñado
  para funcionar así.
