# 0005 — La lista `environment` del compose es lo único que llega a la web

**Estado:** vigente · **Fecha:** 2026-10-23

## Contexto

`deploy/docker-compose.app.yml` arranca la web con `docker compose --env-file .env.app`. Ese
`--env-file` SOLO alimenta la interpolación `${…}` del propio compose: no exporta nada al
contenedor. Y no hay `env_file:` en el servicio.

## Decisión

- Cada variable que la web lee en runtime se declara en la lista `environment:` del servicio
  `web`, una por una. Una variable que está en `.env.app` pero no en esa lista **no existe** para
  la aplicación.
- `apps/web/lib/deploy-env.test.ts` lo vigila: lee el compose y el `Dockerfile`, los cruza con
  los `process.env.X` del código y se pone rojo si falta alguna.

## Consecuencias

- El fallo de olvidar una era silencioso y solo en producción (en desarrollo se lee de
  `apps/web/.env.local`). Ejemplos de lo que pasaba:
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` no llegaba al build: en producción no se podía pagar
    (lo encontró el propio test).
  - Sin `STRIPE_BILLING_WEBHOOK_SECRET`, el webhook de facturación responde 500 siempre: Stripe
    reintenta tres días, deshabilita el endpoint y ningún cliente se corta nunca por impago.
  - Sin `CRON_SECRET`, los `/api/internal/*` responden 503: ni retención de datos, ni corte por
    impago, ni avisos de dispositivo caído.
- La service role key va solo aquí, en el servidor: nunca con prefijo `NEXT_PUBLIC_`, nunca en un
  `ARG` de build (acabaría en una capa de la imagen) y nunca en el instalador del agente.
- Descartado: `env_file:` con todo `.env.app`. Metería en el proceso secretos que no usa.
