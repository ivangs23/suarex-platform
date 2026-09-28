#!/usr/bin/env bash
# Avisa cuando el PC de cocina de un cliente lleva rato sin dar señales — y cuando vuelve.
#
# El agente de escritorio late cada pocos segundos (`device_heartbeat`). Si deja de hacerlo,
# las comandas no se imprimen y el restaurante se entera cuando la cocina se queda vacía. Esto
# lo detecta antes.
#
# Avisa SOLO EN LAS TRANSICIONES (cae / vuelve), nunca mientras sigue caído: un correo cada 5
# minutos durante una caída de dos horas son 24 correos, y después de eso el aviso de la
# caída siguiente tampoco lo lee nadie.
#
# Los avisos van A SOPORTE, no al restaurante: al principio habrá falsos positivos (wifi
# doméstico, el PC que alguien apaga al cerrar) y cada uno enviado al cliente es una llamada
# igualmente, pero con el cliente ya alarmado.
#
# Instalar (cada 5 minutos):
#   */5 * * * * CRON_SECRET=xxx APP_URL=https://admin.<dominio> AVISO_A=tu@correo /ruta/device-health.sh
#
# APP_URL: el host de la consola. Ver la advertencia de suspend-overdue.sh — un host de tenant
# suspendido devuelve 503 y mata el cron para todos los demás.
set -euo pipefail

: "${APP_URL:?Falta APP_URL (p. ej. https://admin.suarex.app)}"
: "${CRON_SECRET:?Falta CRON_SECRET (el mismo que en .env.app)}"
AVISO_A="${AVISO_A:-}"

respuesta="$(curl -fsS -X POST "${APP_URL%/}/api/internal/device-health" \
	-H "Authorization: Bearer ${CRON_SECRET}" \
	-H "content-type: application/json")"

# Sin `jq` en el host no se puede formatear el detalle, pero tampoco hace falta fallar: el
# cuerpo crudo ya es legible y el log del contenedor tiene los eventos estructurados.
if ! command -v jq >/dev/null 2>&1; then
	echo "$respuesta"
	exit 0
fi

caidos="$(echo "$respuesta" | jq -r '.caidos[]? | "CAIDO: \(.tenantSlug) / \(.nombre) (ultimo latido: \(.ultimoLatido // "nunca"))"')"
vueltos="$(echo "$respuesta" | jq -r '.recuperados[]? | "RECUPERADO: \(.tenantSlug) / \(.nombre)"')"

mensaje=""
[ -n "$caidos" ] && mensaje="${caidos}"
[ -n "$vueltos" ] && mensaje="${mensaje}${mensaje:+$'\n'}${vueltos}"

if [ -n "$mensaje" ]; then
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)]"
	echo "$mensaje"
	if [ -n "$AVISO_A" ] && command -v mail >/dev/null 2>&1; then
		echo "$mensaje" | mail -s "SuarEx: cambio en dispositivos" "$AVISO_A"
	fi
fi
