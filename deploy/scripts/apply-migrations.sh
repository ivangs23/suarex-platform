#!/usr/bin/env bash
# Aplica las migraciones del repo contra el Postgres del VPS.
#
# No se usa `supabase db push` porque el CLI exige TLS incluso contra 127.0.0.1 y el
# Postgres del compose oficial no lo sirve. Se hace lo mismo a mano: ejecutar los ficheros
# en orden y REGISTRAR cada versión en supabase_migrations.schema_migrations, que es lo que
# hace idempotente al `db push` de los despliegues siguientes.
set -euo pipefail

MIGRATIONS_DIR="/opt/suarex/supabase/migrations"
CONTAINER="supabase-db"

run_sql() {
	docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

# El esquema de control lo crea el CLI la primera vez; aquí no ha corrido nunca.
run_sql <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
SQL

applied=0
skipped=0

for file in "$MIGRATIONS_DIR"/*.sql; do
	base="$(basename "$file")"
	version="${base%%_*}"
	name="${base#*_}"
	name="${name%.sql}"

	if run_sql -Atc "select 1 from supabase_migrations.schema_migrations where version = '${version}'" | grep -q 1; then
		echo "  = ${base} (ya aplicada)"
		skipped=$((skipped + 1))
		continue
	fi

	echo "  + ${base}"
	# Cada migración va en su propia transacción: si una falla, el script aborta (set -e)
	# y esa migración no queda a medias ni se registra como aplicada.
	docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q --single-transaction <"$file"
	run_sql -c "insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}')"
	applied=$((applied + 1))
done

echo
echo "Aplicadas: ${applied} | Ya estaban: ${skipped}"
