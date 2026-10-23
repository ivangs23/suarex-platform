#!/usr/bin/env bash
# Resumen DIARIO de los errores de la web, por correo y sin terceros (D2: el log JSON de
# `apps/web/lib/log.ts` es la única observabilidad). Agrupa los `log.error` por `event` y, si
# hay alguno, avisa; los que cuestan dinero o dejan a un cliente sin imprimir, arriba.
#
# Corre EN el servidor (lee el contenedor), una vez al día. Ver deploy/README.md §8.
#   0 8 * * * AVISO_A=tu@correo /opt/suarex/deploy/scripts/alertas-log.sh >> /var/log/suarex-alertas.log 2>&1
#
# Sin Docker, contra un fichero (para probarlo): LOG_FICHERO=muestra.log ./alertas-log.sh
set -euo pipefail

CONTENEDOR="${CONTENEDOR:-suarex-web-1}"
DESDE="${DESDE:-24h}"
AVISO_A="${AVISO_A:-}"
PRIORITARIOS="stripe.cobro_sin_pedido stripe.importe_no_coincide stripe.disputa_abierta dispositivo.caido"

avisar() { # asunto, cuerpo
	printf '[%s] %s\n%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2"
	if [ -n "$AVISO_A" ] && command -v mail >/dev/null 2>&1; then
		printf '%s\n' "$2" | mail -s "$1" "$AVISO_A"
	fi
}

# Sin poder leer el log, el silencio parecería "sin errores": se avisa de eso también.
if [ -n "${LOG_FICHERO:-}" ]; then
	lineas="$(cat "$LOG_FICHERO")"
elif ! lineas="$(docker logs --since "$DESDE" "$CONTENEDOR" 2>&1)"; then
	avisar "SuarEx: alertas-log no pudo leer ${CONTENEDOR}" "$lineas"
	exit 1
fi

# "  12 pedido.creacion_fallo", de más a menos. `JSON.stringify` no deja espacios y `event` es
# un identificador con puntos, sin comillas: basta grep, sin depender de `jq` en el servidor.
conteo="$(printf '%s\n' "$lineas" | grep '"level":"error"' | grep -o '"event":"[^"]*"' |
	cut -d'"' -f4 | sort | uniq -c | sort -rn || true)"
if [ -z "$conteo" ]; then
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] sin errores en ${DESDE}"
	exit 0
fi

prioridad="$(printf '%s\n' "$conteo" | awk -v p=" $PRIORITARIOS " 'index(p, " " $2 " ")')"
resto="$(printf '%s\n' "$conteo" | awk -v p=" $PRIORITARIOS " '!index(p, " " $2 " ")')"
total="$(printf '%s\n' "$conteo" | awk '{ s += $1 } END { print s }')"

cuerpo=""
[ -n "$prioridad" ] && cuerpo+="PRIORIDAD ALTA"$'\n'"${prioridad}"$'\n\n'
[ -n "$resto" ] && cuerpo+="Resto"$'\n'"${resto}"$'\n\n'
cuerpo+="Detalle: docker logs --since ${DESDE} ${CONTENEDOR} 2>&1 | grep '\"level\":\"error\"'"
avisar "SuarEx: ${total} errores en ${DESDE}$([ -n "$prioridad" ] && echo ' (PRIORIDAD ALTA)')" "$cuerpo"
