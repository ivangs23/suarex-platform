#!/usr/bin/env bash
# Comprobación de uptime DESDE FUERA del servidor.
#
# Tiene que correr en otra máquina (tu portátil, un VPS distinto, un cron de GitHub Actions).
# Un chequeo que vive en el mismo servidor que vigila no sirve de nada: si el servidor se cae,
# el chequeo se cae con él y nadie se entera.
#
# Golpea `/api/tls-check`, la única ruta pública que NO pasa por la resolución de tenant (ver
# el matcher de apps/web/proxy.ts) y que está diseñada para ser alcanzable desde internet:
# falla cerrado y sus negativas son indistinguibles entre sí. Sin parámetro `domain` responde
# 200 con una denegación, que es justo lo que queremos: prueba que Next, Caddy y el TLS están
# vivos sin revelar nada ni tocar la base de datos.
#
# Instalar (cada 5 minutos, en una máquina DISTINTA del servidor):
#   */5 * * * * APP_URL=https://admin.suarex.app AVISO_A=tu@correo /ruta/uptime-check.sh
set -euo pipefail

: "${APP_URL:?Falta APP_URL}"
AVISO_A="${AVISO_A:-}"
ESTADO="${ESTADO_FICHERO:-/tmp/suarex-uptime.estado}"

# curl YA imprime 000 cuando no conecta; encadenar `|| echo 000` daba "000000". Y `set -e`
# mataría el script justo cuando el servidor está caído, que es cuando más falta hace que
# siga vivo para avisar.
set +e
codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "${APP_URL%/}/api/tls-check")"
set -e
[ -n "$codigo" ] || codigo=000

anterior="$(cat "$ESTADO" 2>/dev/null || echo ok)"
if [ "$codigo" = "200" ]; then nuevo=ok; else nuevo=caido; fi

# Solo se avisa en las TRANSICIONES, no en cada comprobación: un aviso cada 5 minutos durante
# una caída larga se convierte en ruido que se acaba ignorando, que es peor que no avisar.
# Mismo criterio que los avisos de impresora caída del agente de escritorio.
if [ "$nuevo" != "$anterior" ]; then
	if [ "$nuevo" = "caido" ]; then
		mensaje="SuarEx CAIDO: ${APP_URL} responde ${codigo}"
	else
		mensaje="SuarEx recuperado: ${APP_URL} responde 200"
	fi
	# `date -Is` es de GNU y no existe en macOS: este script corre a menudo desde el portátil,
	# que es justo donde debe correr (fuera del servidor que vigila).
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${mensaje}"
	if [ -n "$AVISO_A" ] && command -v mail >/dev/null 2>&1; then
		echo "$mensaje" | mail -s "$mensaje" "$AVISO_A"
	fi
fi

echo "$nuevo" >"$ESTADO"
[ "$nuevo" = "ok" ]
