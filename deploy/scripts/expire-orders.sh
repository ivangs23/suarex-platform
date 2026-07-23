#!/usr/bin/env bash
# Barre los pedidos que quedaron `pending` sin pagar y nunca se cerraron.
#
# Se llama desde el CRON DEL SISTEMA (crontab del host), no desde pg_cron: el Supabase
# autoalojado de este despliegue no siempre trae pg_cron, así que la programación de la
# migración se salta en silencio y hay que barrer desde fuera. Ver el README de deploy.
#
# Instalar en el host (cada 5 minutos):
#   */5 * * * * CRON_SECRET=xxx APP_URL=https://<tu-dominio> /ruta/deploy/scripts/expire-orders.sh
#
# `CRON_SECRET` debe ser el MISMO que el de `.env.app` (lo lee el endpoint).
set -euo pipefail

: "${APP_URL:?Falta APP_URL (p. ej. https://suarex.app)}"
: "${CRON_SECRET:?Falta CRON_SECRET (el mismo que en .env.app)}"

# `-fsS`: falla con código != 0 si el endpoint responde error, para que el cron lo registre.
curl -fsS -X POST "${APP_URL%/}/api/internal/expire-orders" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "content-type: application/json"
echo
