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

echo "[$(date -Is)] Volcando ${DB_CONTAINER} -> ${outfile}"

# --clean --if-exists deja un volcado que se puede restaurar sobre una base ya existente
# sin borrarla antes a mano. Se vuelca la base entera (todos los esquemas: public, auth,
# storage): restaurar solo `public` dejaría los usuarios y los ficheros huérfanos.
docker exec "${DB_CONTAINER}" \
	pg_dump --username postgres --clean --if-exists --quote-all-identifiers postgres |
	gzip -9 >"${outfile}.tmp"

# Renombrar al final: si el volcado se corta a medias, el fichero se queda como .tmp y
# nunca se confunde con una copia buena. Un backup roto que parece bueno es peor que no
# tener backup, porque no te enteras hasta que lo necesitas.
mv "${outfile}.tmp" "${outfile}"
chmod 600 "${outfile}"

size="$(du -h "${outfile}" | cut -f1)"
echo "[$(date -Is)] Copia terminada (${size})"

if [[ -n "${RCLONE_REMOTE}" ]]; then
	echo "[$(date -Is)] Subiendo a ${RCLONE_REMOTE}"
	rclone copy "${outfile}" "${RCLONE_REMOTE}"
else
	echo "[$(date -Is)] AVISO: RCLONE_REMOTE sin configurar; la copia vive solo en este disco."
fi

# La purga va DESPUÉS de la subida: si el remoto falla, el script aborta (set -e) antes de
# borrar nada y conservas las copias viejas.
deleted="$(find "${BACKUP_DIR}" -name 'suarex-*.sql.gz' -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)"
echo "[$(date -Is)] Purgadas ${deleted} copias de más de ${RETENTION_DAYS} días"
