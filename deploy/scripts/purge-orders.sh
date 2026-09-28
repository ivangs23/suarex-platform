#!/usr/bin/env bash
# Aplica la retención de datos del comensal: anula las notas de los pedidos de hace más de
# 90 días y borra los pedidos de hace más de 24 meses.
#
# Esto NO es limpieza opcional: son los plazos que la política de privacidad publicada al
# comensal promete (ver apps/web/lib/legal-content.ts). Si este cron no corre, la política
# miente.
#
# Se llama desde el CRON DEL SISTEMA (crontab del host), no desde pg_cron: el Supabase
# autoalojado de este despliegue no siempre lo trae. Ver el README de deploy.
#
# Instalar en el host (cada noche a las 4:15):
#   15 4 * * * CRON_SECRET=xxx APP_URL=https://<host> /ruta/deploy/scripts/purge-orders.sh
#
# OJO CON APP_URL: el proxy resuelve tenant por Host para TODAS las rutas salvo
# `api/tls-check`. Si APP_URL es el dominio RAÍZ (suarex.app), `findTenantByHost` devuelve
# null, la petición se reescribe a /not-found con 404 y la purga no corre, en silencio.
# Usa el host de la consola de plataforma, o el de un tenant que no vaya a suspenderse
# (un tenant suspendido devuelve 503 en estas rutas y el `-fsS` de abajo mata el cron).
set -euo pipefail

: "${APP_URL:?Falta APP_URL (p. ej. https://admin.suarex.app)}"
: "${CRON_SECRET:?Falta CRON_SECRET (el mismo que en .env.app)}"

# `-fsS`: falla con código != 0 si el endpoint responde error, para que el cron lo registre.
curl -fsS -X POST "${APP_URL%/}/api/internal/purge-orders" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "content-type: application/json"
echo
