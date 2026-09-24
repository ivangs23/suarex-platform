#!/usr/bin/env bash
# Restaura un volcado de `backup-db.sh`.
#
# Un backup que no se ha restaurado nunca NO es un backup: es un fichero. Este script y el
# simulacro de `deploy/README.md` existen para que la primera restauración no sea la del día
# del desastre.
#
#   ./restore-db.sh /var/backups/suarex/suarex-20260922-033000.sql.gz
#
# EL DESTINO NO PUEDE ESTAR VACÍO, y esto es lo que más sorprende: el volcado se genera con
# `--clean --if-exists` porque el destino real nunca está vacío (la imagen de Supabase precrea
# `auth` y `storage`). A cambio, contra una base completamente nueva falla en la primera línea
# —`DROP POLICY ... ON public.venues`, cuyo IF EXISTS protege la policy y no la tabla—.
#
# El orden correcto, verificado con un simulacro real:
#   1. Levantar el stack de Supabase (crea esquemas y roles base).
#   2. Cargar los roles del volcado `.roles.sql.gz` (pg_dump NO los incluye: son del cluster).
#   3. Aplicar las migraciones (crea el esquema `public`).
#   4. Ejecutar este script.
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
VOLCADO="${1:-}"

if [ -z "$VOLCADO" ] || [ ! -f "$VOLCADO" ]; then
	echo "Uso: DB_CONTAINER=<contenedor> $0 <volcado.sql.gz>" >&2
	exit 1
fi

ROLES="${VOLCADO%.sql.gz}.roles.sql.gz"

echo "ATENCIÓN: esto SOBRESCRIBE la base de '${DB_CONTAINER}'."
echo "Si es el contenedor de producción, para la web antes:"
echo "  docker compose -f docker-compose.app.yml --env-file .env.app stop web"
echo
echo "Volcado: ${VOLCADO}"
[ -f "$ROLES" ] && echo "Roles:   ${ROLES}" || echo "Roles:   (no encontrado — si faltan roles, la restauración fallará)"
echo
echo "Escribe 'restaurar' para continuar:"
read -r confirmacion
[ "$confirmacion" = "restaurar" ] || { echo "Cancelado." >&2; exit 1; }

# Todo como `supabase_admin`: en el stack autoalojado `postgres` NO es superusuario, y la
# restauración falla con `must be able to SET ROLE "supabase_admin"` en cuanto llega a un
# objeto de `auth`. La contraseña se lee DENTRO del contenedor, así que nunca aparece en la
# línea de comandos del host ni en el historial del shell.
if [ -f "$ROLES" ]; then
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Cargando roles"
	# Sin ON_ERROR_STOP: los roles que ya existan dan error y no pasa nada. Lo que importa es
	# que no falte ninguno.
	gunzip -c "$ROLES" | docker exec -i "$DB_CONTAINER" bash -c \
		'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres --quiet' 2>&1 |
		grep -iE "^ERROR" | grep -v "already exists" | grep -v "reserved role" || true
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restaurando ${VOLCADO}"

# `ON_ERROR_STOP=1`: sin esto psql sigue tras un error y termina con código 0, dejando una
# restauración a medias que PARECE correcta. Ese es el modo de fallo que convierte un backup
# en una falsa sensación de seguridad.
gunzip -c "$VOLCADO" | docker exec -i "$DB_CONTAINER" bash -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 --quiet'

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Restauración terminada. Recuento:"

# El recuento es la prueba de que el volcado traía DATOS y no solo el esquema. Una
# restauración que termina sin error pero deja las tablas vacías es el peor resultado posible,
# porque parece que funcionó. Compáralo con lo que esperabas tener.
docker exec "$DB_CONTAINER" bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U supabase_admin -d postgres -t -A -F" | " -c "
  select '"'"'tenants'"'"', count(*) from public.tenants
  union all select '"'"'productos'"'"', count(*) from public.products
  union all select '"'"'pedidos'"'"', count(*) from public.orders
  union all select '"'"'usuarios'"'"', count(*) from auth.users
  union all select '"'"'dispositivos'"'"', count(*) from public.devices;"'
