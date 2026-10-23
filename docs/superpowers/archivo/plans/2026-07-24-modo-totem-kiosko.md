# Plan de implementación: Modo totem (canal `kiosko`)

Basado en `docs/superpowers/specs/2026-07-24-modo-totem-kiosko-design.md` (aprobado).

Regla transversal: cada fase pasa **lint · typecheck · unit · integración · e2e** antes de darse
por buena, y va en su rama `feat/*`. Se construye todo en **mock** de Paytef; el datáfono real es
solo config.

---

## Fase 1 — Datos + config

**Objetivo:** el esquema y los repositorios soportan pedidos `kiosko` y la config de Paytef, sin
UI todavía.

Tareas:
- [ ] Migración:
  - `orders.table_label text null` (nº de mesa libre del totem; `table_id` sigue para QR).
  - `devices.pinpad_id text null`.
  - Tabla `tenant_payment_config` (tenant_id, provider, `access_key`, `secret_key`, `company_id`,
    `mock` bool) con RLS que **niega el SELECT directo** al rol `device`/`authenticated`; solo se
    lee por RPC.
  - RPC `SECURITY DEFINER` `get_payment_config_self()` que devuelve la config del tenant del
    **device que llama** (acotada por `auth.uid()` → su `devices.tenant_id`), incluido `pinpad_id`.
    Grant a `authenticated`, revoke a `anon`/`public`. Nunca expone el secreto por SELECT abierto.
- [ ] `packages/config`: extender `tenantSettingsSchema` si hace falta metadatos no-secretos; el
  secreto NO va en `tenant_settings` (va en la tabla acotada).
- [ ] `packages/db`:
  - `createPendingOrder` parametriza `channel` (`'qr-mesa' | 'kiosko'`) y acepta `tableLabel`.
  - `getPaymentConfigForDevice(client)` → llama la RPC.
  - `setPaymentConfig(tenantId, {...})` y `setDevicePinpad(tenantId, deviceId, pinpadId)` para el admin.
- [ ] Tests integración: la RPC devuelve la config al device propio y **falla/`null` para otro
  tenant**; un `authenticated` no-device no la ve; alta de pedido `kiosko` con `table_label` y
  "para llevar" (label nulo). El secreto no sale por ningún SELECT (suite anti-fuga lo cubre).

**Aceptación:** un device puede leer su config Paytef por RPC (y nadie más); se crean pedidos
`kiosko`; el secreto está acotado.

---

## Fase 2 — Puente Paytef en el agente (mock)

**Objetivo:** el proceso main del agente sabe cobrar por Paytef, con mock.

Tareas:
- [ ] `paytef-service` en `apps/agent-desktop/src/main`: auth → start → poll → result + cancel,
  clonado del legacy pero con config inyectada (no hardcode). Emite estados. Modo `mock`.
  Construcción de payloads como funciones **puras y testeadas**.
- [ ] Resolución de config: al arrancar el rol kiosko, `getPaymentConfigForDevice` (RPC).
- [ ] **Importe desde el servidor**: `chargeOrder(orderId)` lee el total del pedido en Supabase,
  no del renderer. Idempotencia por `orderId`/estado.
- [ ] Tests unit: payloads, máquina de estados, mock aprobado/denegado/cancelado/timeout.

**Aceptación:** `chargeOrder` aprueba en mock y devuelve `authCode`; deniega/cancela/timeout bien.

---

## Fase 3 — Rol `kiosko` del desktop

**Objetivo:** el agente-desktop, en rol kiosko, abre la ventana totem y expone `window.totem`.

Tareas:
- [ ] Detectar rol `kiosko` (de `devices.roles`); si lo tiene, abrir ventana **fullscreen kiosk**
  que carga la ruta de totem de la plataforma; si no, el modo agente actual.
- [ ] Preload `window.totem` acotado: `pay(orderId)`, `print(orderId)`, `onPaymentStatus(cb)`.
  IPC → `chargeOrder` + impresión.
- [ ] La ventana no navega fuera del origen de la plataforma; sin salir a Windows.

**Aceptación:** en rol kiosko arranca en la ruta totem a pantalla completa; `window.totem.pay` en
mock aprueba end-to-end (sin UI de carta aún, un stub).

---

## Fase 4 — Ruta de totem en `apps/web`

**Objetivo:** el flujo completo del comensal, reutilizando carta + temas.

Tareas:
- [ ] Ruta de entrada del canal kiosko (token de venue/dispositivo, sin cookie de QR de mesa;
  `canOrder` true por ser totem).
- [ ] Pasos: welcome (idle) → llevar/mesa → nº mesa (teclado 1–100) → productos (carta reutilizada,
  formato táctil) → carrito → pago (estados Paytef vía `window.totem`) → confirmación (nº recogida).
- [ ] Alta del pedido `channel:'kiosko'` + `table_label`/para-llevar por `POST /api/orders`
  (parametrizado).
- [ ] `contract.test.tsx`: los temas pintan los pasos del flujo totem.

**Aceptación:** e2e del flujo con pago mock, de welcome a confirmación, en garum y manuela.

---

## Fase 5 — Impresión

**Objetivo:** al aprobar, imprime ticket de cliente + comandas.

Tareas:
- [ ] Layout ESC/POS del **ticket de cliente** (cabecera del local, líneas + extras, total, IVA,
  nº recogida) en `packages/ticket`/`printing`.
- [ ] `print(orderId)` en el agente: compone ticket de cliente (impresora del totem) + comandas a
  cocina/barra/ambas (reusa el ruteo por `destination`). Directo + red de seguridad at-least-once.
- [ ] Tests: composición del ticket (pura); integración del ruteo (reusa los del agente).

**Aceptación:** un pedido kiosko aprobado imprime cliente + comandas correctas por destino.

---

## Fase 6 — Cierre

- [ ] e2e del flujo totem completo (mock).
- [ ] Validación en **build empaquetado** con datáfono real (cambiando mock→real por config):
  registro, cobro real aprobado, impresión. (Requiere hardware — tarea de Iván.)
- [ ] Panel admin: alta/edición de la config Paytef (cuenta) y `pinpad_id` en el alta de device;
  selector de rol `kiosko`/`agente`.
- [ ] Docs: actualizar `docs/migrar-un-cliente.md` con los pasos del totem.

**Aceptación:** modo totem funcional de extremo a extremo en mock; listo para datáfono real por config.
