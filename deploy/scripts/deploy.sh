#!/usr/bin/env bash
#
# Despliegue de una versión nueva de la web en el VPS. Se ejecuta EN el servidor, desde el
# clon del repo (/opt/suarex por convención):
#
#   ./deploy/scripts/deploy.sh
#
# No toca la stack de Supabase: trae el código, hace una copia de la base, aplica las
# migraciones pendientes y reconstruye la web (y reinicia Caddy si cambió su Caddyfile).

set -euo pipefail

cd "$(dirname "$0")/../.."
REPO_ROOT="$(pwd)"
ENV_FILE="${REPO_ROOT}/deploy/.env.app"

if [[ ! -f "${ENV_FILE}" ]]; then
	echo "Falta ${ENV_FILE}. Cópialo de deploy/.env.app.example y rellénalo." >&2
	exit 1
fi

echo "==> Trayendo cambios"
ANTES="$(git rev-parse HEAD)"
git pull --ff-only

echo "==> Copia de seguridad antes de migrar"
"${REPO_ROOT}/deploy/scripts/backup-db.sh"

echo "==> Aplicando migraciones pendientes"
# Solo las que no constan en supabase_migrations: relanzar no reejecuta nada. No es
# `supabase db push`: el CLI exige TLS contra el Postgres del compose y falla (README §5).
# NO se ejecuta supabase/seed.sql: crea los clientes de demostración.
"${REPO_ROOT}/deploy/scripts/apply-migrations.sh"

echo "==> Reconstruyendo la web"
# --build fuerza reconstruir la imagen: las NEXT_PUBLIC_* se hornean en tiempo de build, así
# que sin esto un cambio de dominio o una rotación de la anon key no llegaría al navegador.
docker compose -f deploy/docker-compose.app.yml --env-file "${ENV_FILE}" up -d --build web

# El Caddyfile va montado: un cambio no se aplica hasta reiniciar Caddy (README §6).
if ! git diff --quiet "${ANTES}" HEAD -- deploy/Caddyfile; then
	echo "==> El Caddyfile cambió: reiniciando Caddy"
	docker compose -f deploy/docker-compose.app.yml --env-file "${ENV_FILE}" restart caddy
fi

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
