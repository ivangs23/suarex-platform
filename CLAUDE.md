# SuarEx Platform — guía para Claude Code

SaaS multi-tenant de hostelería: cada restaurante (tenant) tiene su carta por QR en mesa, el
comensal pide y paga desde el móvil, y una app de escritorio imprime las comandas en cocina.
Producto de **SuarEx Soluciones Digitales** (agencia de Iván González).

## Con quién colaboras

Iván es CEO de SuarEx y **desarrollador senior (12 años)**. Salta las explicaciones de
principiante; da por hecho que conoce web, frameworks y tooling. Enmarca las recomendaciones en
**trade-offs e impacto de negocio** (coste de mantenimiento, fiabilidad operativa), no solo "qué
funciona". Es quien decide: presenta opciones con una recomendación y espera su "sí".

## La doctrina (regla del producto) — NO negociable

> **Todo lo que no sean estilos debe implementarse para TODOS los clientes. Lo único que cambia
> por cliente es a nivel visual y de contenido.**

La FUNCIONALIDAD (pasos del flujo, carrito, pago, alérgenos, selector de idioma, recibo) es
idéntica para todos. Lo que varía por tenant: el **aspecto** (colores, dónde cae cada cosa) y el
**contenido** (productos, fotos, imagen de bienvenida, traducciones). Un paso del flujo no es
opcional según el cliente; una foto sí.

Esto lo blinda `apps/web/app/[mesa]/themes/contract.test.tsx`: renderiza TODOS los temas
registrados y falla si a alguno le falta un paso del flujo (bienvenida, ficha, botón de pedido,
conteo de productos, badges de alérgenos, selector de idioma). Al añadir un tema o un paso,
pasa por ahí.

## Stack

pnpm workspaces + Turborepo · Next 16 App Router (**webpack**, no turbopack — ver
`next.config.ts`) · Supabase self-hosted (Docker) · TypeScript strict · Vitest + happy-dom ·
Playwright · Biome (lint+format) · Electron (app de escritorio, `electron-vite`).

## Estructura

- `apps/web` — Next.js: carta del comensal (`app/[mesa]`), panel admin (`app/admin`), staff
  (`app/staff`), pantalla de pedido/recibo (`app/pedido`), API (`app/api`).
- `apps/agent-desktop` — Electron: agente de impresión desatendido + panel incrustado.
- `packages/agent` — bucle del agente (`runAgent`/`runAgentTick`): polling, impresión, marcado.
- `packages/db` — acceso a datos (queries, tipos, storage, rate-limit). Se consume como fuente
  TS sin compilar (`exports "." -> "./src/index.ts"`, imports NodeNext `./x.js` -> `./x.ts`).
- `packages/printing` · `packages/ticket` · `packages/domain` · `packages/config` ·
  `packages/realtime`.
- `supabase/migrations` — esquema + RLS. `scripts/` — utilidades (alta de cliente, import de
  catálogo, limpieza de storage, traducciones).

## Comandos

```bash
pnpm install
pnpm db:start           # Supabase local (imprime las claves)
pnpm db:reset           # reset a migraciones + seed
pnpm dev  (o preview_start name:"web")   # nunca levantar el dev server con bash
pnpm typecheck          # turbo typecheck + tests tsconfig
pnpm lint  /  pnpm lint:fix
pnpm test               # unit (turbo, por paquete)
pnpm test:integration   # vitest tests/integration (necesita Supabase local)
pnpm test:e2e           # Playwright (necesita dev server)
```

Verificación antes de dar algo por bueno: **lint · typecheck · unit · integración · e2e**. La
suite lleva `retry:2` para absorber flakiness de entorno (Realtime WAL, sockets de impresora
falsa, cold compile de Next), no para tapar bugs.

## Patrones clave

- **Multi-tenancy**: `tenant_id` + RLS. Tenant resuelto por host (`findTenantByHost`). Claims JWT
  vía `custom_access_token_hook`.
- **Rol `device`**: la app de escritorio inicia sesión con credenciales de dispositivo (nunca la
  service key, que JAMÁS llega al PC del cliente). Solo puede imprimir: RLS lo excluye de escribir
  catálogo; escribe vía RPCs `SECURITY DEFINER` acotadas al JWT (`reserve_printed_self`,
  `device_heartbeat`).
- **Cookie de mesa** (`suarex_mesa`, httpOnly, 12 h): el QR `/m/{token}` la fija y redirige a
  `/{mesa}`. Pedir exige que la cookie designe ESA mesa de ESTE tenant (`page.tsx` `canOrder`).
  El token nunca sale del servidor ni viaja en URL compartible. Sin cookie, la carta se consulta
  pero no se pide (y sale el aviso "Escanea el QR").
- **Carrito por LÍNEAS**, no por producto: el mismo plato puede pedirse dos veces con distinta
  personalización. No hay contador en la tarjeta; las cantidades se ajustan en el panel del pedido.
- **Impresión at-least-once**: `runAgentTick` entrega el ticket y SOLO si la entrega fue bien
  marca esa impresora. Un fallo entre ambos reimprime al siguiente tick, nunca pierde el ticket.
  Marca por impresora (una ok y otra caída → solo reintenta la caída).
- **i18n data-driven**: el selector de idioma solo aparece en los idiomas donde el tenant TIENE
  carta (`availableLangs`, deducido de las claves `name_i18n`). Ofrecer "EN" para enseñar todo en
  español es peor que no ofrecerlo.
- **Pagos**: Stripe test mode (PaymentIntent + Elements). Si el tenant no tiene
  `stripe_account_id`, cobra por la cuenta de plataforma; si lo tiene, Connect direct charge.

## Gotchas (te ahorran horas)

- **Dos repos en la máquina de Iván**: el shell suele arrancar en
  `/Users/ivangonzalez/Documents/Mis proyectos/web-prueba` (web de agencia, Astro, otro
  producto). Este proyecto está en `.../Documents/proyectos/suarex-platform`. Usa **rutas
  absolutas** o `git -C` para no operar en el repo equivocado. `gh` puede resolver al repo
  equivocado → pasa siempre `--repo ivangs23/suarex-platform`.
- **No hay `psql`** en el host: para la BD, `docker exec <container> psql -U postgres -c "..."`,
  o Node con `@supabase/supabase-js` y la service key de `apps/web/.env.local`.
- **Puertos por defecto ocupados**: suarex-platform mantiene Supabase en 5432x y `next dev` en
  3000. Otros proyectos deben fijar sus puertos.
- **Manuela reimportada = solo español**: tras `import-catalog` de Manuela, corre
  `node scripts/traducir-manuela.mjs --aplicar` o se pierde el en/pt (el import reimporta solo es).
- **Secretos NO en git** (correcto): `apps/web/.env.local`, `.env.test`. Recrear desde
  `supabase start` + Stripe test. Plantilla en `.env.example`.
- **Electron no se prueba aquí** (sin Windows/entorno gráfico): la impresión USB usa winspool
  (koffi), solo en Windows. Verificación = typecheck + unit + integración.

## Prohibido

- Tocar los repos/proyectos Supabase en **producción**.
- Que el dispositivo/agente tenga la **service role key**.
- Levantar el dev server con bash (usa `preview_start`).

## Más docs

`docs/HANDOFF.md` (estado y pendientes) · `docs/migrar-un-cliente.md` ·
`docs/importar-catalogo.md` · `docs/agent-desktop-validacion.md`.
