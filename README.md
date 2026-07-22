# SuarEx Platform

Plataforma multitenant para hostelería. Un despliegue, N negocios.

## Arranque

```bash
pnpm install
supabase start
pnpm db:env
pnpm seed:staff
cp .env.test apps/web/.env.local
pnpm --filter @suarex/web dev
```

`pnpm seed:staff` es parte del arranque estándar, no un paso aparte que haya
que recordar: sin personal sembrado, `/staff/login` no tiene con qué
autenticar y `tests/e2e/staff-auth.spec.ts` (la suite que prueba ese login de
extremo a extremo) fallaría por falta de prerrequisito. Es idempotente --
puedes volver a correrlo sin duplicar usuarios ni membresías -- así que
sembrar siempre no tiene coste. Tras un `supabase db reset` (que destruye
`auth.users` junto con todo lo demás), hace falta repetir `pnpm db:env &&
pnpm seed:staff` antes de volver a levantar el servidor o correr los tests.

Abrir `http://garum.localhost:3000/5` y `http://manuela.localhost:3000/2`.

La carta real del canal QR en mesa (fase A) vive en `/m/{token}`, no en esas rutas
numéricas de demostración: `http://garum.localhost:3000/m/11111111-1111-1111-1111-111111111111`
resuelve la mesa 1 de `garum` a partir del token sembrado por `supabase/seed.sql`. Un
token desconocido o de una mesa desactivada devuelve 404 sin revelar cuáles existen.
Añadir productos al carrito y pulsar "Pagar" crea el pedido (`POST /api/orders`,
precios recalculados en servidor) y redirige a `/pedido/{publicToken}`, que muestra su
estado sin autenticación.

### Acceso del personal

El personal de cocina/sala inicia sesión en `/staff/login` (por ejemplo
`http://garum.localhost:3000/staff/login`) con email y contraseña, vía
Supabase Auth. `pnpm seed:staff` (ver arriba, parte del arranque estándar)
crea, si no existen ya, `staff@garum.local` y `staff@manuela.local` con rol
`staff` en `memberships`.

Por defecto no eliges tú la contraseña: si no defines `STAFF_SEED_PASSWORD`,
el script genera una aleatoria y la guarda en `.env.test` (gitignorado, el
mismo fichero que escribe `pnpm db:env`) — nunca se hardcodea en ningún
fichero del repo. Es una contraseña **del stack local desechable**
(`supabase db reset` la destruye junto con todo lo demás).

Si prefieres elegir tú la contraseña (por ejemplo para iniciar sesión a mano
en el navegador sin ir a mirar `.env.test`), pásala como variable de entorno;
igualmente se guarda en `.env.test` para que el resto de comandos la
encuentren sin más:

```bash
STAFF_SEED_PASSWORD='<elige-tu-contraseña-de-desarrollo>' pnpm seed:staff
```

`tests/e2e/staff-auth.spec.ts` inicia sesión de verdad contra ese usuario
sembrado, leyendo `STAFF_SEED_PASSWORD` de `.env.test`
(`playwright.config.ts` lo carga igual que `vitest.config.ts`) — no hace
falta exportar nada a mano para que `pnpm test:e2e` los ejecute. Si de verdad
no hay personal sembrado (nunca corriste `pnpm seed:staff`, o hiciste
`supabase db reset` sin repetirlo), esos dos tests **fallan** con un mensaje
explícito en vez de saltarse: un test saltado es indistinguible de uno que
pasa en un resumen de CI, así que esta suite nunca se salta en silencio.

### Panel de administración del catálogo

`/admin/catalogo` (por ejemplo `http://garum.localhost:3000/admin/catalogo`) deja
gestionar categorías, productos (con imagen y alérgenos), extras y alérgenos propios
del tenant. Lo protege `requireManager()` (`apps/web/lib/require-manager.ts`): solo
los roles `owner`/`admin` pasan — un `staff` que intente entrar es redirigido a
`/staff/login`, igual que alguien sin sesión.

`pnpm seed:staff` (el mismo comando de arriba, parte del arranque estándar) siembra
**también** una cuenta demo por tenant con rol `owner` — `owner@garum.local` y
`owner@manuela.local` — con el mismo mecanismo de contraseña generada que la de
`staff`: si no defines `OWNER_SEED_PASSWORD`, se genera una aleatoria y se guarda en
`.env.test` (gitignorado). Para elegir tú la contraseña:

```bash
OWNER_SEED_PASSWORD='<elige-tu-contraseña-de-desarrollo>' pnpm seed:staff
```

`tests/e2e/admin-catalogo.spec.ts` prueba las dos caras del guard con sesiones reales
(login por `/staff/login`, sin cookies fabricadas a mano): un `staff` que no ve el
panel, y un `owner` que crea una categoría y un producto que aparecen después en la
carta pública (`/m/{token}`). Igual que con `STAFF_SEED_PASSWORD`, si falta
`OWNER_SEED_PASSWORD` el test **falla** con un mensaje explícito en vez de saltarse.

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
