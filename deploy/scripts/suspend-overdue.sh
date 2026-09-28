#!/usr/bin/env bash
# Cierra las ventanas de gracia vencidas: suspende a los clientes que llevan más de
# GRACIA días sin pagar. El webhook de facturación abre la ventana; esto la cierra.
#
# Se llama desde el CRON DEL SISTEMA (crontab del host), no desde pg_cron: el Supabase
# autoalojado de este despliegue no siempre trae pg_cron. Ver el README de deploy.
#
# Instalar en el host (cada noche a las 5:00):
#   0 5 * * * CRON_SECRET=xxx APP_URL=https://<host> /ruta/deploy/scripts/suspend-overdue.sh
#
# ATENCIÓN AL APP_URL, y aquí más que en ningún otro cron. Dos trampas:
#
#   1. El proxy resuelve tenant por Host para TODAS las rutas salvo `api/tls-check`. Si
#      APP_URL es el dominio RAÍZ (suarex.app), `findTenantByHost` devuelve null, la
#      petición se reescribe a /not-found con 404 y el barrido no corre. En silencio.
#
#   2. Peor, y exclusivo de este cron: si APP_URL apunta al host de un TENANT y ese tenant
#      acaba suspendido -- justo lo que este barrido provoca -- el proxy pasa a reescribir
#      a /suspended con 503 para ese host, incluidas las rutas /api/internal/*. El `curl
#      -fsS` de abajo devuelve error y el cron muere PARA TODOS LOS DEMÁS CLIENTES. Se
#      autodestruye.
#
# Usa el host de la consola de plataforma (admin.<dominio>), que no pasa por la resolución
# de tenant, o un tenant que nunca se vaya a suspender.
set -euo pipefail

: "${APP_URL:?Falta APP_URL (p. ej. https://admin.suarex.app)}"
: "${CRON_SECRET:?Falta CRON_SECRET (el mismo que en .env.app)}"

# `-fsS`: falla con código != 0 si el endpoint responde error, para que el cron lo registre.
curl -fsS -X POST "${APP_URL%/}/api/internal/suspend-overdue" \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "content-type: application/json"
echo
