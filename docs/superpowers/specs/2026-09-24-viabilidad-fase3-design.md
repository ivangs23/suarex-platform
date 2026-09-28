# Fase 3 — Producto que se renueva: diseño

_2026-09-24. Spec de lo que hace que el cliente pague el segundo año._

## Qué cambia respecto al roadmap

El roadmap listaba seis puntos. Al mirar el código antes de escribir, **uno ya estaba hecho**:

- **86-ing (agotado hoy): YA EXISTE.** `products.is_available` está en el esquema desde
  `20260721000002_catalog.sql`, el panel lo conmuta (`setProductAvailability` +
  `setProductAvailabilityAction`), la carta pública lo filtra (`catalog.ts:43`) y
  `createPendingOrder` lo comprueba al crear el pedido. Un producto marcado no disponible
  desaparece de la carta y no se puede pedir. No hay nada que construir.

  Lo que NO existe y sí se pide: que se **restablezca solo al día siguiente**. Hoy hay que
  acordarse de volver a activarlo, y nadie se acuerda — así que al tercer día el producto
  sigue oculto sin que nadie sepa por qué.

Y dos que tampoco existían pese a aparecer en búsquedas: **propina** y **pago en efectivo**.
Las coincidencias eran falsos positivos (`de propina` como giro, `privilegios efectivos`).

## Decisiones tomadas (Iván, 2026-09-24)

### D1 — Informe, no arqueo

Ventas del día por producto y por franja, con export CSV, en solo lectura. **No** hay cierre de
turno ni Z congelado.

Un arqueo obliga a decidir de qué día es un pedido de la 01:30, qué pasa con un turno partido y
qué ocurre si se cobra después de cerrar. Esas respuestas dependen de lo que exija la asesoría
de cada cliente, y ninguno lo ha pedido todavía. Diseñarlo a ciegas es garantizar que habrá que
rehacerlo.

El informe cubre la necesidad diaria real —"¿cuánto he vendido hoy y de qué?"— sin inventar un
proceso.

### D2 — Ni propina ni pago en barra

**La propina se descartó (Iván, 2026-09-24).** Se conserva escrito el razonamiento del pago en
barra porque sigue siendo válido si algún día se retoma.

El pago en barra cambia el ciclo de vida del pedido: hoy nada llega a cocina sin estar pagado
(`unprintedPaidOrders` selecciona `status = 'paid'`), así que permitir "pido ahora, pago
luego" obliga a imprimir comandas de pedidos sin cobrar y a decidir qué pasa si el comensal se
va sin pagar. Es un rediseño del camino crítico del producto.

La propina, en cambio, es aditiva: una columna, un selector antes de pagar y una línea en el
recibo. Cubre la objeción comercial más habitual con una fracción del riesgo.

### D3 — Realtime, después

El polling de 4 s funciona y nadie se ha quejado. Realtime bajaría la latencia a ~0,3 s a
cambio de meter una vía de fallo más (WAL frío, reconexiones) justo en la pantalla de la que
depende la cocina — y los tests de Realtime ya son los más frágiles de la suite.

Se hará cuando haya una queja real de latencia, no antes.

### D4 — La franja va en la categoría, no en el plato

Un hostelero piensa "la carta de mediodía", no "este plato de 13:00 a 16:00". Marcarlo plato a
plato sería más flexible y no lo mantendría nadie: 184 productos con dos horas cada uno es un
trabajo que se hace una vez y se abandona.

Tres decisiones dentro de esa:

- **La franja puede cruzar medianoche.** Una cena de 20:00 a 02:00 es lo normal, no el caso
  raro. `visible_hasta < visible_desde` significa exactamente eso, y la comparación lo tiene en
  cuenta; con la ingenua, la carta de cena desaparecería a medianoche en pleno servicio.
- **La hora es la de la sede** (`venues.timezone`), no la del servidor. Mismo criterio que
  `marcar_agotado_hoy`, y por la misma razón: un local canario vería la carta de cena una hora
  antes de lo que cree.
- **La franja se hereda hacia abajo.** Una subcategoría dentro de un padre fuera de hora se
  oculta también. Si no, ocultar "Cenas" dejaría "Cenas › Postres" accesible y pedible desde su
  propia URL, fuera de la carta a efectos de navegación pero vendible.

No se puede BORRAR la franja a medias (las dos horas o ninguna) ni ponerlas iguales: media
franja daría una carta que aparece y no desaparece, y "de 12:00 a 12:00" no tiene lectura
obvia. Lo impiden dos CHECK y el parser de la action, que da un mensaje legible en vez del 500
de Postgres.

Pedir fuera de horario se rechaza en el servidor, no solo en la carta: un carrito abierto a las
15:50 podía mandar la comanda de mediodía a las 16:05.

### D5 — La analítica mide con contadores, no con un registro de eventos

Medir qué fichas de producto se abren exigiría una baliza desde el navegador del comensal y una
fila por visita. Eso es un tratamiento de datos personales NUEVO: retención, mención en la
política de privacidad —que hoy declara una cookie técnica y ninguna analítica— y una tabla que
crece sin techo.

Las dos preguntas que de verdad se hacen se responden sin nada de eso:

- **"¿Cuánta gente escanea y no pide?"** — un entero por sede y día. No identifica a nadie, no
  crece (365 filas por sede y año) y deja la política de privacidad intacta.
- **"¿Qué platos no pide nadie?"** — no necesita medir NADA: sale de cruzar los pedidos que ya
  existen con el catálogo.

El contador se incrementa por RPC, no por upsert: dos comensales escaneando a la vez se
pisarían. Y la fecha es la local de la sede, por el mismo motivo que las franjas.

La pantalla dice lo que el número **no** significa. Una mesa de cuatro escanea cuatro veces y
hace un pedido: leer un 25 % como "solo pide uno de cada cuatro comensales" es falso y es una
conclusión sobre la que alguien rehace su carta. Sin escaneos se pinta un guión, no un 0 %.

Queda fuera, y se apunta por si algún día se pide: el embudo dentro de la carta (qué categorías
se abren, dónde se abandona). Necesita la baliza, y con ella la conversación de privacidad.

## Alcance

1. ~~Informes del día~~ — hecho el 2026-09-24 (ventas, por producto, por franja, CSV).
2. ~~Propina~~ — descartada el 2026-09-24.
3. ~~Histórico de pedidos~~ — hecho el 2026-09-24.
4. ~~Restablecer el 86-ing~~ — hecho el 2026-09-24 ("se acabó hoy").
5. ~~Franjas horarias de carta~~ — hecho el 2026-09-24 (ver D4).
6. ~~Analítica de producto~~ — hecho el 2026-09-24 (ver D5).

Orden: el informe primero (lo que se pregunta el día 2), luego el histórico de pedidos.

**Fase 3 cerrada el 2026-09-24.** Los seis puntos, resueltos o descartados con su razón.

## Restricciones globales

Las mismas de las fases anteriores, y dos que esta fase toca de cerca:

- **La propina NO entra en la base imponible.** El recibo ya desglosa base e IVA (Fase 1); una
  propina sumada al subtotal haría que el desglose mintiera sobre el impuesto. Va en su propia
  línea, después del total.
- **Los informes NO son un tratamiento nuevo.** Agregan datos de pedidos que ya existen y que
  la política de privacidad ya declara. Si algún informe llegara a mostrar notas del comensal
  —texto libre— dejaría de ser cierto: los informes muestran productos y cantidades, nunca
  notas.
- Las tareas van EN SERIE, por el mismo motivo que en las fases anteriores.

## Fuera de alcance

Arqueo y cierre de turno · pago en barra o efectivo · Realtime · propina repartida por
camarero · informes multi-sede · comparativas entre periodos.
