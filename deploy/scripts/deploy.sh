#!/usr/bin/env bash
#
# Despliegue de una versión nueva de la web en el VPS. Se ejecuta EN el servidor, desde el
# clon del repo (/opt/suarex por convención):
#
#   ./deploy/scripts/deploy.sh
#
# No toca la stack de Supabase ni la base: solo trae el código, aplica las migraciones
# pendientes y reconstruye la web.

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
ENV_FILE="${REPO_ROOT}/deploy/.env.app"

if [[ ! -f "${ENV_FILE}" ]]; then
	echo "Falta ${ENV_FILE}. Cópialo de deploy/.env.app.example y rellénalo." >&2
	exit 1
fi

echo "==> Trayendo cambios"
git pull --ff-only

echo "==> Aplicando migraciones pendientes"
# `db push` aplica solo las migraciones que aún no constan en supabase_migrations, así que
# es idempotente: relanzar el despliegue no reejecuta nada.
#
# NO se ejecuta supabase/seed.sql: crea los tenants de demostración (garum, manuela) con
# datos de muestra. En producción los clientes se dan de alta desde el panel.
supabase db push --db-url "${SUPABASE_DB_URL:?exporta SUPABASE_DB_URL con la cadena de conexión a Postgres}"

echo "==> Reconstruyendo la web"
# --build fuerza reconstruir la imagen: las NEXT_PUBLIC_* se hornean en tiempo de build, así
# que sin esto un cambio de dominio o una rotación de la anon key no llegaría al navegador.
docker compose -f deploy/docker-compose.app.yml --env-file "${ENV_FILE}" up -d --build web

echo "==> Esperando a que responda"
for i in $(seq 1 30); do
	if docker compose -f deploy/docker-compose.app.yml --env-file "${ENV_FILE}" \
		exec -T web node -e 'fetch("http://127.0.0.1:3000/").then(()=>process.exit(0)).catch(()=>process.exit(1))' 2>/dev/null; then
		echo "==> La web responde. Despliegue terminado."
		exit 0
	fi
	sleep 2
done

echo "La web no respondió en 60 s. Revisa los registros:" >&2
echo "  docker compose -f deploy/docker-compose.app.yml logs --tail=100 web" >&2
exit 1
