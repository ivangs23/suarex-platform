#!/usr/bin/env bash
#
# Copia de seguridad de Postgres. 100 GB de NVMe no son una copia de seguridad: si el disco
# del VPS se corrompe o alguien ejecuta un DELETE sin WHERE, un volcado que viva en ese
# mismo disco se pierde con él. Este script hace el volcado y RECUERDA sacarlo del servidor;
# configura RCLONE_REMOTE para que lo haga solo.
#
# Cron sugerido (cada noche a las 3:30, hora del servidor):
#   30 3 * * * /opt/suarex/deploy/scripts/backup-db.sh >> /var/log/suarex-backup.log 2>&1

set -euo pipefail

# Contenedor de Postgres de la stack de Supabase (nombre fijo en su compose oficial).
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/suarex}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Destino remoto opcional de rclone, p. ej. "b2:suarex-backups". Vacío = solo local.
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

timestamp="$(date +%Y%m%d-%H%M%S)"
outfile="${BACKUP_DIR}/suarex-${timestamp}.sql.gz"

mkdir -p "${BACKUP_DIR}"
# Los volcados llevan datos personales de clientes y personal: solo el dueño los lee.
chmod 700 "${BACKUP_DIR}"

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Volcando ${DB_CONTAINER} -> ${outfile}"

# SE VUELCAN DOS COSAS, Y LAS DOS HACEN FALTA.
#
# 1. LOS ROLES, aparte. `pg_dump` NO los incluye -- son del cluster, no de la base. Sin ellos
#    la restauración muere en la primera sentencia que asigna propiedad:
#    `role "supabase_realtime_admin" does not exist`. Comprobado en un simulacro real contra
#    un contenedor limpio, no deducido: la imagen de Supabase trae 4 de los 13 roles que este
#    esquema usa.
#
# 2. LOS DATOS, con --clean --if-exists. Ese flag NO es opcional y no hay que "arreglarlo":
#    el destino de una restauración real NUNCA está vacío -- la imagen de Supabase precrea los
#    esquemas `auth` y `storage` al arrancar, y sin --clean el volcado falla con
#    `schema "auth" already exists`. A cambio, un volcado --clean tampoco se puede restaurar
#    en una base COMPLETAMENTE vacía (empieza por `DROP POLICY ... ON public.venues`, y ese
#    IF EXISTS protege la policy, no la tabla). Por eso el procedimiento de restauración es
#    "levantar el stack, aplicar migraciones, restaurar encima" y no "psql sobre una base
#    nueva". Está escrito en deploy/README.md.
#
# Se vuelca la base entera (public, auth, storage): restaurar solo `public` dejaría los
# usuarios y los ficheros huérfanos.
docker exec "${DB_CONTAINER}" bash -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" pg_dumpall --username supabase_admin --roles-only --no-role-passwords' \
	| gzip -9 >"${outfile%.sql.gz}.roles.sql.gz.tmp"
mv "${outfile%.sql.gz}.roles.sql.gz.tmp" "${outfile%.sql.gz}.roles.sql.gz"
chmod 600 "${outfile%.sql.gz}.roles.sql.gz"

docker exec "${DB_CONTAINER}" bash -c \
	'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --username supabase_admin --clean --if-exists --quote-all-identifiers postgres' |
	gzip -9 >"${outfile}.tmp"

# Renombrar al final: si el volcado se corta a medias, el fichero se queda como .tmp y
# nunca se confunde con una copia buena. Un backup roto que parece bueno es peor que no
# tener backup, porque no te enteras hasta que lo necesitas.
mv "${outfile}.tmp" "${outfile}"
chmod 600 "${outfile}"

size="$(du -h "${outfile}" | cut -f1)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Copia terminada (${size})"

if [[ -n "${RCLONE_REMOTE}" ]]; then
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Subiendo a ${RCLONE_REMOTE}"
	# LOS DOS FICHEROS, no solo el de datos. El de roles es imprescindible para restaurar
	# (pg_dump no los incluye, ver arriba), y la copia remota es la unica que sirve el dia que
	# se pierde el VPS -- justo el escenario donde no tienes el otro fichero al lado. Subir
	# solo uno deja una copia off-site que NO se puede restaurar.
	rclone copy "${outfile}" "${RCLONE_REMOTE}"
	rclone copy "${outfile%.sql.gz}.roles.sql.gz" "${RCLONE_REMOTE}"
else
	echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] AVISO: RCLONE_REMOTE sin configurar; la copia vive solo en este disco."
fi

# La purga va DESPUÉS de la subida: si el remoto falla, el script aborta (set -e) antes de
# borrar nada y conservas las copias viejas.
deleted="$(find "${BACKUP_DIR}" -name 'suarex-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Purgadas ${deleted} copias de más de ${RETENTION_DAYS} días"
