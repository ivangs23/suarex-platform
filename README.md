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
pnpm lint && pnpm typecheck && pnpm test:integration && pnpm test:e2e
```

## Reglas del repo

- Solo `packages/db` importa `@supabase/supabase-js`. El resto usa funciones repositorio.
- Ninguna policy RLS puede ser `USING (true)`. Excepción declarada: lectura de `allergens` globales.
- Toda tabla de dominio lleva `tenant_id not null`. La suite anti-fuga lo verifica sola.
- Los componentes usan variables CSS, nunca hex literales.
- Los repos `GARUM`, `web-manuela`, `kiosko-manuela`, `agente-impresora-v2` y `web-prueba` siguen en producción y **no se tocan**.
