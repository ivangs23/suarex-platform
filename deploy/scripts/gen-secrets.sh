#!/usr/bin/env bash
# Genera todos los secretos de la stack de Supabase EN el servidor y los escribe
# directamente en .env. Ningún secreto se imprime por stdout: se quedan en el fichero,
# con permisos 600.
set -euo pipefail

ENV_DIR="/opt/suarex-supabase"
cd "$ENV_DIR"

rand() { openssl rand -hex "$1"; }

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# JWT HS256 firmado con JWT_SECRET. Supabase espera `role`, `iss`, `iat`, `exp`.
mint_jwt() {
	local role="$1" secret="$2"
	local iat exp header payload signing_input sig
	iat=$(date +%s)
	exp=$((iat + 3600 * 24 * 365 * 10)) # 10 años
	header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
	payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$role" "$iat" "$exp" | b64url)
	signing_input="${header}.${payload}"
	sig=$(printf '%s' "$signing_input" | openssl dgst -binary -sha256 -hmac "$secret" | b64url)
	printf '%s.%s' "$signing_input" "$sig"
}

POSTGRES_PASSWORD=$(rand 24)
JWT_SECRET=$(rand 32)
ANON_KEY=$(mint_jwt anon "$JWT_SECRET")
SERVICE_ROLE_KEY=$(mint_jwt service_role "$JWT_SECRET")
DASHBOARD_PASSWORD=$(rand 16)
SECRET_KEY_BASE=$(rand 32)
VAULT_ENC_KEY=$(rand 16)
PG_META_CRYPTO_KEY=$(rand 16)
# EXACTAMENTE 16 caracteres: Realtime lo usa como clave de AES-128 tal cual, sin derivar.
# Con cualquier otra longitud arranca en bucle con
# `(ErlangError) Erlang error: {:badarg, ...} Bad key size` -- y el error solo aparece en
# los registros del contenedor, la stack se levanta "sana" a su alrededor.
REALTIME_DB_ENC_KEY=$(rand 8)
LOGFLARE_PUBLIC_ACCESS_TOKEN=$(rand 24)
LOGFLARE_PRIVATE_ACCESS_TOKEN=$(rand 24)
S3_KEY_ID=$(rand 16)
S3_KEY_SECRET=$(rand 32)

cp .env.example .env

set_kv() {
	local key="$1" value="$2"
	# Delimitador | porque los JWT llevan / y +. El valor va entre comillas por si
	# algún carácter especial se cuela.
	python3 - "$key" "$value" <<'PY'
import sys, re, pathlib
key, value = sys.argv[1], sys.argv[2]
p = pathlib.Path(".env")
lines = p.read_text().splitlines()
out, found = [], False
for line in lines:
    if re.match(rf"^{re.escape(key)}=", line):
        out.append(f"{key}={value}")
        found = True
    else:
        out.append(line)
if not found:
    out.append(f"{key}={value}")
p.write_text("\n".join(out) + "\n")
PY
}

set_kv POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
set_kv JWT_SECRET "$JWT_SECRET"
set_kv ANON_KEY "$ANON_KEY"
set_kv SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_kv DASHBOARD_USERNAME "suarex"
set_kv DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD"
set_kv SECRET_KEY_BASE "$SECRET_KEY_BASE"
set_kv VAULT_ENC_KEY "$VAULT_ENC_KEY"
set_kv PG_META_CRYPTO_KEY "$PG_META_CRYPTO_KEY"
set_kv REALTIME_DB_ENC_KEY "$REALTIME_DB_ENC_KEY"
set_kv LOGFLARE_PUBLIC_ACCESS_TOKEN "$LOGFLARE_PUBLIC_ACCESS_TOKEN"
set_kv LOGFLARE_PRIVATE_ACCESS_TOKEN "$LOGFLARE_PRIVATE_ACCESS_TOKEN"
set_kv S3_PROTOCOL_ACCESS_KEY_ID "$S3_KEY_ID"
set_kv S3_PROTOCOL_ACCESS_KEY_SECRET "$S3_KEY_SECRET"
set_kv POOLER_TENANT_ID "suarex"

# Solo el personal dado de alta desde el panel entra. Sin esto, cualquiera con la anon
# key (que es pública por diseño) se crea una cuenta contra este Auth.
set_kv DISABLE_SIGNUP "true"
set_kv ENABLE_PHONE_SIGNUP "false"
set_kv ENABLE_PHONE_AUTOCONFIRM "false"
set_kv ENABLE_ANONYMOUS_USERS "false"

# Sin esto, Compose IGNORA docker-compose.override.yml en silencio -- y con él se irían el
# hook del JWT y el atado de puertos a loopback, o sea, las dos garantías de seguridad de
# la instalación.
set_kv COMPOSE_FILE "docker-compose.yml:docker-compose.override.yml"

# El hook que inyecta tenant_id/tenant_role en el JWT vive en el override, NO aquí: el
# compose oficial no propaga estas dos variables desde el .env al contenedor de auth.

chmod 600 .env
echo "OK: .env generado con secretos nuevos (no impresos)."
echo "Claves presentes:"
grep -cE "^(POSTGRES_PASSWORD|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=" .env
