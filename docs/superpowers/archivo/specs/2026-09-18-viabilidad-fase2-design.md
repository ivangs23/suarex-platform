# Fase 2 — Supervivencia operativa: diseño

_2026-09-18. Spec de lo que evita ahogarse en soporte con 3-5 clientes._

## Problema

La Fase 1 cerró lo que impedía **cobrar**. Esta cierra lo que impide **sostener** lo cobrado.
Seis huecos, todos con la misma forma: el sistema hace algo mal o no dice nada, y quien se
entera es el cliente antes que tú.

1. **La base de datos miente sobre el dinero.** El webhook solo escucha
   `payment_intent.succeeded`. Un reembolso hecho en Stripe no llega nunca: el pedido sigue
   `paid` para siempre. `orders.status` ni siquiera tiene un valor para reembolsado.
2. **No hay forma de diagnosticar nada.** Toda la observabilidad son 17 `console.error` en
   `apps/web`, dentro de un contenedor. Cuando un restaurante llame diciendo "no imprime", no
   hay nada que mirar.
3. **El heartbeat no dispara nada.** `devices.last_seen_at` se escribe, pero nadie lo lee para
   avisar. Un PC apagado se descubre cuando la cocina se queda sin comandas.
4. **El backup nunca se ha restaurado.** `backup-db.sh` está bien escrito, pero `RCLONE_REMOTE`
   es opcional y no hay RPO/RTO declarado ni simulacro.
5. **La caída del agente no se recupera sola.** El watchdog interno cubre excepciones dentro
   del proceso; si el proceso muere o el PC se reinicia, no vuelve.
6. **El nombre de impresora se teclea a mano** (`PrinterForm.tsx:37`). Un typo = no imprime, en
   silencio.

## Decisiones tomadas (Iván, 2026-09-18)

### D1 — Los reembolsos se REGISTRAN, no se ejecutan desde el panel

El webhook escucha `charge.refunded` y `charge.dispute.created` y actualiza la base. El
reembolso se sigue haciendo en el dashboard de Stripe.

Cierra la mentira, que es el bug, sin abrir el diseño de la UI (¿parcial por línea? ¿quién
puede? ¿límite de tiempo?). El botón en `/staff` queda para más adelante, como tarea propia.

### D2 — Observabilidad sin proveedores nuevos

Logs estructurados en JSON a stdout (recogidos por Docker y rotados) más un ping de uptime
externo. **No Sentry, no GlitchTip.**

El motivo no es el coste: es que la Fase 1 acaba de publicar una política de privacidad que
nombra exactamente dos destinatarios —SuarEx y Stripe— y un DPA con cada cliente. Meter un
tercer encargado obliga a actualizar los tres documentos legales de todos los tenants y a
firmar un DPA nuevo. Eso es una decisión de negocio, no una de herramientas, y hoy no hace
falta para diagnosticar.

Si algún día el volumen lo justifica, GlitchTip autoalojado es la vía que no añade encargados.

### D3 — Las alertas van a Iván primero

Un dispositivo sin latir más de 10 minutos genera un aviso **a soporte**, no al restaurante.

Al principio habrá falsos positivos (wifi doméstico, el PC que alguien apaga al cerrar), y cada
falso positivo enviado al cliente es una llamada tuya de todas formas — pero con el cliente ya
alarmado. Cuando el ruido esté medido, se baja el aviso al restaurante como cambio aparte.

### D4 — El watchdog de Windows no se puede verificar aquí

No hay Windows ni entorno gráfico en esta máquina. La verificación es typecheck + unit, igual
que el resto de `agent-desktop`, y la prueba real va en `docs/agent-desktop-validacion.md` para
hacerla en el PC de un cliente.

## Lo que este spec descubrió del código

**El desplegable de impresoras no es un desplegable.** El panel de administración es una página
web que corre en el navegador del dueño, y la lista de impresoras solo la conoce el proceso
Electron del PC de cocina. El panel va incrustado en la app (`web-panel.ts`), pero esa vista
**no tiene preload a propósito**, y su docstring explica por qué: si heredara `window.agent.*`,
un XSS en el panel podría des-emparejar el dispositivo o disparar impresiones.

Así que la solución correcta no es exponer IPC al panel —eso rompería una garantía deliberada—
sino que **el agente reporte su lista de impresoras al servidor** (en el heartbeat), se guarde
en `devices`, y el panel la lea de la base como cualquier otro dato. Más trabajo, pero no toca
la frontera de seguridad.

## Restricciones globales

Las mismas de la Fase 1, más:

- **Ningún dato personal en los logs.** Nunca el contenido de `order_items.notes` (texto libre
  del comensal), nunca correos completos. Ids y contadores. Un log que se guarda 90 días con
  notas de comensales dentro convierte el logger en un tratamiento no declarado.
- **Ningún encargado de tratamiento nuevo** sin actualizar antes `legal-content.ts` y avisarlo.
- Las tareas van EN SERIE, por el mismo motivo que en la Fase 1 (una base, un dev server, un
  catálogo sembrado).

## Fuera de alcance

Botón de reembolso en `/staff` · alertas al restaurante · Realtime en el tablero · cierre de
caja · APM y trazas distribuidas · alta disponibilidad.
