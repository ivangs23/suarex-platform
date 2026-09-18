# Viabilidad — hoja de ruta

_2026-09-15. Índice de fases. La Fase 1 está desarrollada tarea a tarea; el resto lleva
alcance y coste para poder decidir, no para ejecutar._

Origen: revisión completa del repo del 2026-09-15. La base técnica está sana (aislamiento
multi-tenant con prueba estructural, impresión sin pérdida, 70+ tests de integración y e2e).
Lo que falta es negocio y operación.

---

## Fase 1 — Comercializable · **detallada**

**Bloquea:** cobrar al primer cliente.
**Plan:** [`2026-09-15-fase1-comercializable.md`](2026-09-15-fase1-comercializable.md)
**Spec:** [`../specs/2026-09-15-viabilidad-fase1-design.md`](../specs/2026-09-15-viabilidad-fase1-design.md)
**Tamaño:** 19 tareas, 5 bloques.

| Bloque | Qué cierra |
|---|---|
| A · Recibo no fiscal | La ambigüedad "esto parece una factura". 4 tareas |
| B · Legal | Páginas legales, encargo de tratamiento, retención. 3 tareas |
| C · Correo y credenciales | SMTP, recuperación de contraseña, alta por invitación. 3 tareas |
| D · Suscripción y corte | Stripe Billing, impago, gracia de 7 días, suspensión. 4 tareas |
| E · Consola de plataforma | Alta de cliente desde el navegador, no por SSH. 5 tareas |

Los bloques A, B y C son independientes entre sí y del resto: se pueden hacer en cualquier
orden o en paralelo. **D depende de E** solo en un punto (la consola crea el cliente de
Stripe al dar de alta); si se hace D primero, ese enganche queda para la tarea 18.

---

## Fase 2 — Supervivencia operativa

**Bloquea:** no ahogarte en soporte con 3-5 clientes.
**Coste estimado:** 2-3 semanas.

1. **Reembolsos y fallos de pago.** El webhook solo escucha `payment_intent.succeeded`
   ([route.ts:26](../../../apps/web/app/api/webhook/stripe/route.ts#L26)). Faltan
   `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`, y un camino
   de anulación desde el panel de staff con devolución vía Stripe. Hoy, un plato agotado
   después de cobrar se devuelve a mano en el dashboard de Stripe y la base de datos miente.
2. **Observabilidad.** Sentry en `apps/web` y en `agent-desktop`, logs estructurados a
   fichero rotativo en el VPS, y uptime externo contra `/api/tls-check`. Hoy todo es
   `console.error` dentro de un contenedor.
3. **Alertas de dispositivo caído.** El heartbeat existe (`device_heartbeat`); falta que
   alguien mire y avise cuando un PC lleva 10 minutos sin latir.
4. **Simulacro de restauración.** [`backup-db.sh`](../../../deploy/scripts/backup-db.sh) está
   bien escrito pero `RCLONE_REMOTE` es opcional y nadie ha restaurado nunca. Declarar RPO/RTO
   y probarlo contra un VPS limpio.
5. **Watchdog del sistema en Windows.** Tarea programada que resucita el agente si el proceso
   muere. La caída del proceso principal no se recupera desde dentro.
6. **Desplegable de impresoras** en el panel (el desktop ya las lista con
   `getPrintersAsync`). Un typo en el nombre = no imprime, en silencio.

---

## Fase 3 — Producto que se renueva

**Bloquea:** que el cliente pague el segundo año.
**Coste estimado:** 3-4 semanas.

1. **Cierre de caja e informes.** Ventas del día, por producto, por franja; export CSV. Se
   pide en la semana 2. El producto anterior ya tenía `cierres_dia`.
2. **86-ing (agotado hoy)** y franjas horarias de carta (mediodía/noche). Se pide en la
   semana 1.
3. **Pago en barra y propina.** Hoy solo tarjeta por Stripe. Es objeción en la primera demo.
4. **Histórico de pedidos** en el panel. `/admin` es hoy un placeholder literal.
5. **Realtime en el tablero de staff**, con el polling de 4 s como respaldo.
6. **Analítica de producto**: conversión del QR, qué se pide. Sin esto no puedes defender el
   precio en la renovación.

---

## Fase 4 — Escala

**Bloquea:** pasar de ~15 clientes.

Autoservicio público · staging y rollback de migraciones · réplica de Postgres o Supabase
gestionado · multi-sede real en la UI · panel de staff en varios idiomas · kiosko ·
pruebas de carga.

---

## Lo que NO está en ninguna fase, y es decisión tuya

**VeriFactu.** La Fase 1 lo resuelve por posicionamiento (D1 del spec): el recibo se declara
justificante, no factura, y el contrato lo dice. Eso cierra el flanco y cuesta 4 tareas.
Convertir SuarEx en sistema de facturación verificable es un proyecto aparte, de 4-6 semanas
más asesoría fiscal, y solo tiene sentido cuando un cliente sin TPV lo pague. Revisa la
decisión con tu asesor antes de firmar el primer contrato, no después.
