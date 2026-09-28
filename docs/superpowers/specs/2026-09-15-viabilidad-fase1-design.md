# Fase 1 — Comercializable: diseño

_2026-09-15. Spec de los bloqueantes que impiden cobrar al primer cliente._

## Problema

La plataforma funciona (multi-tenancy con RLS, carta por QR, pago, impresión at-least-once,
panel admin). Lo que falta para **vender** no es funcionalidad del comensal: es la capa de
negocio y de cumplimiento que convierte un despliegue en un SaaS cobrable.

Cinco huecos bloquean la primera factura:

1. `tenants.plan` y `tenants.stripe_customer_id` existen pero **nada los lee**. No hay
   suscripción, ni trial, ni impago, ni corte. Stripe solo cobra al COMENSAL.
2. El alta de un cliente es `node scripts/create-tenant.mjs` por SSH contra el VPS, con la
   service key en el entorno. No escala y no se delega.
3. `createStaff` obliga al gestor a inventar y teclear la contraseña del camarero en claro.
   No hay recuperación de contraseña. No hay SMTP configurado.
4. Cero páginas legales, cero contrato de encargado de tratamiento, cero política de
   retención. Datos de comensales tratados por cuenta del restaurante sin el marco del
   art. 28 RGPD.
5. El recibo PDF parece una factura pero no lo es: sin emisor, sin desglose de IVA, sin
   advertencia. Ambigüedad que expone a SuarEx y al restaurante.

## Decisiones tomadas (Iván, 2026-09-15)

### D1 — SuarEx NO es emisor de factura

El recibo se marca de forma explícita como **justificante de pedido, no válido como
factura**. La obligación de facturar sigue siendo del restaurante, que la cumple con su TPV.
El contrato lo refleja.

Consecuencia técnica: el recibo gana los datos del emisor (razón social, CIF, dirección) y
el desglose base/IVA **a título informativo**, más la advertencia. No gana serie fiscal,
ni numeración correlativa, ni huella encadenada, ni envío a AEAT.

Consecuencia de negocio: no se puede vender a un local que no tenga TPV propio. Se asume.
El esquema no se prepara para VeriFactu: cuando toque, será su propio proyecto con
asesoría fiscal, y prepararlo hoy a ciegas cuesta más de lo que ahorra.

### D2 — Stripe Billing con corte automático y periodo de gracia

La suscripción del restaurante vive en Stripe. Los webhooks de facturación mandan sobre
`tenants.plan_status`. **La suspensión nunca es inmediata**: un impago abre 7 días de
gracia (`grace_until`) durante los cuales el servicio sigue en pie y el panel avisa; un
barrido diario suspende lo que venza. Cortar la carta de un restaurante a las 14:30 por un
rechazo de tarjeta cuesta más que 7 días de servicio regalado.

### D3 — Consola de plataforma, no autoservicio público

Una superficie `/plataforma` en un host propio (`admin.<dominio-raíz>`), protegida por una
tabla `platform_admins` independiente de `memberships`. Da de alta clientes, ve su estado y
suspende/reactiva. Iván sigue en el bucle, pero desde el navegador y en minutos.

No hay registro público: el onboarding de hostelería necesita una conversación (carta,
impresoras, mesas), y un formulario público sin esa conversación genera tenants muertos y
soporte.

### D4 — Alcance

Esta fase cubre solo lo que bloquea la primera factura. Lo operativo (reembolsos,
observabilidad, restore, watchdog) y lo de producto (cierre de caja, 86-ing, propina) van
en fases posteriores — ver `docs/superpowers/plans/2026-09-15-viabilidad-roadmap.md`.

## Fronteras de seguridad nuevas

Dos, y son las únicas partes de esta fase donde un error se paga caro:

**F1 — El host de plataforma.** `admin.<raíz>` ya está en `RESERVED_SUBDOMAINS`
(`packages/config/src/tenant-host.ts`), así que hoy `parseTenantHost` devuelve `null` y el
proxy reescribe a `/not-found`. La consola necesita que ese host se sirva, y a la vez que
**ningún host de tenant sirva jamás `/plataforma`**. Las dos direcciones se comprueban:
`/plataforma` bajo un host de tenant es 404, y cualquier ruta que no sea `/plataforma` bajo
el host de plataforma es 404.

**F2 — La lectura entre tenants.** `packages/db` tiene una garantía estructural: el único
acceso sin `tenant_id` son exenciones documentadas una a una, y todas menos ninguna son
búsquedas de fila única por clave. La consola necesita **listar todos los tenants**: es la
primera exención que barre de verdad. Va acotada por firma, documentada como tal, y su
único llamante pasa por `requirePlatformAdmin()`.

`platform_admins` es deliberadamente **otra tabla**, no un rol nuevo en `memberships`: un
rol `platform` dentro de `memberships` viajaría en el claim `tenant_id` del
`custom_access_token_hook` y quedaría a un `if` de distancia de confundirse con un rol de
tenant. Separarlas hace que un superadmin no tenga `tenant_id` en su JWT en absoluto.

## Restricciones globales

- **Doctrina del producto**: nada de esta fase es opcional por cliente. Las páginas legales,
  el aviso del recibo y el corte por impago aplican a todos; lo que cambia por tenant son
  los datos (razón social, CIF) y los estilos.
- Node >= 22.12, pnpm 10.33, TypeScript strict, Biome, Vitest + happy-dom, Playwright.
- `packages/db` se consume como fuente TS sin compilar: imports NodeNext (`./x.js` ->
  `./x.ts`).
- Migraciones nuevas en `supabase/migrations/`, nomenclatura `YYYYMMDDNNNNNN_nombre.sql`.
  Toda tabla con `tenant_id` lleva RLS (lo comprueba `tenant-isolation.test.ts`).
- Ninguna clave de service role llega nunca al navegador ni al PC del cliente.
- Verificación antes de dar nada por bueno: `pnpm lint`, `pnpm typecheck`, `pnpm test`,
  `pnpm test:integration`, `pnpm test:e2e`.
- Textos de cara al comensal en es/en/pt (`apps/web/lib/i18n.ts`). Panel y consola, solo es.

## Fuera de alcance explícito

VeriFactu · reembolsos y disputas · observabilidad · cierre de caja · propina · pago en
barra · autoservicio público · multi-sede en la UI · kiosko.
