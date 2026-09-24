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

### D2 — Propina sobre tarjeta. NO pago en barra

Se añade propina al pago con tarjeta y **no se toca el flujo de pago**.

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

## Alcance

1. **Informes del día** — ventas, por producto, por franja, export CSV.
2. **Propina** — selector antes de pagar, cobrada con el pedido, desglosada en el recibo.
3. **Histórico de pedidos** en el panel — hoy `/admin` es un placeholder literal.
4. **Restablecer el 86-ing** al día siguiente.
5. **Franjas horarias de carta** — carta de mediodía y de noche.
6. **Analítica de producto** — conversión del QR y qué se pide.

En ese orden: 1 y 2 son lo que el hostelero pide en la primera semana.

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
