# SuarEx Platform

Plataforma multitenant para hostelería. Un despliegue, N negocios.

## Arranque

```bash
pnpm install
supabase start
pnpm db:env
cp .env.test apps/web/.env.local
pnpm --filter @suarex/web dev
```

Abrir `http://garum.localhost:3000/5` y `http://manuela.localhost:3000/2`.

## Verificación

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm --filter @suarex/config test && pnpm test:integration && pnpm test:e2e
```

`pnpm test` (vía Turbo) y `pnpm --filter @suarex/config test` ejecutan hoy los mismos 25
tests unitarios de `packages/config` (es el único paquete con script `test`; Turbo solo
corre el suyo) — están ambos porque ambos forman parte del comando de verificación de
este repo, no por redundancia accidental.

## Reglas del repo

- Solo `packages/db` importa `@supabase/supabase-js`. El resto usa funciones repositorio.
  Excepción adicional declarada en `biome.json`: `tests/integration/helpers/**` también
  puede importarlo directamente (son fixtures de test que hablan con Supabase para armar
  y limpiar tenants de prueba, no código de producción).
- Ninguna policy RLS puede ser `USING (true)`. Excepciones declaradas: lectura de
  `allergens` globales (`tenant_id IS NULL`) y `tenants_isolation` (`id =
  current_tenant_id()`, porque `tenants` se aísla por su propia `id`, no por una columna
  `tenant_id`).
- Toda tabla de dominio lleva `tenant_id not null` (o, en el caso de `tenants`, su propia
  `id` hace ese papel). La suite anti-fuga lo verifica sola.
- Los componentes usan variables CSS, nunca hex literales.
- Los repos `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2` y `web-prueba` siguen en producción y **no se tocan**.

## Dónde protege RLS (y dónde NO)

RLS solo protege el camino **autenticado** (JWT de Supabase Auth, rol `authenticated`):
paneles de gestión, cualquier cosa que pase por `supabase-js` con el token de sesión de
un usuario logueado. La suite anti-fuga generada (`tests/integration/tenant-isolation.test.ts`
+ `helpers/policy-check.ts`) prueba el aislamiento de **ese** camino, tabla por tabla,
descubierta en runtime.

El camino del **comensal anónimo** (`apps/web`, carta vía QR/kiosko) es distinto: nunca
toca RLS. `apps/web` llama a funciones repositorio de `@suarex/db`
(`packages/db/src/*.ts`), y esas funciones usan `serviceClient()` — un cliente con la
**service role key**, que **bypassa RLS por completo**. En ese camino, RLS no es un
backstop de nada: si una función repositorio olvida su `.eq('tenant_id', tenantId)`, no
hay ninguna policy por debajo que la salve. El aislamiento del comensal anónimo depende
enteramente de que **cada función de `packages/db` reciba un `tenantId` explícito y
filtre por él** — es una obligación de código, no de base de datos, y la suite anti-fuga
generada no la ejerce (corre contra el rol `authenticated`, no contra `packages/db`).
`tests/integration/db-repositories.test.ts` es quien cubre `packages/db` directamente.

Resumen por capa:

| Capa | Camino | Qué la protege |
| --- | --- | --- |
| Supabase (rol `authenticated`) | Panel de gestión, futuro CRUD admin | RLS, verificada por la suite anti-fuga |
| `packages/db` (service role) | Comensal anónimo vía `apps/web` | Disciplina de código: `tenantId` explícito en cada función repositorio |
| `apps/web/proxy.ts` | Resolución de host → tenant | Lógica de la app, no RLS (nunca llega a tocar Supabase con sesión de usuario) |
