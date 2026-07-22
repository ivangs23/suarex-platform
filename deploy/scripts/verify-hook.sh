#!/usr/bin/env bash
# Verifica de extremo a extremo que el JWT que emite Auth trae tenant_id y tenant_role.
#
# Es LA comprobación que decide si la instalación es segura: si el hook no se aplica,
# current_tenant_id() lee null y las políticas de RLS dejan de acotar nada. Se hace con un
# tenant y un usuario de usar y tirar, que se borran al final.
set -euo pipefail

ENV_FILE="/opt/suarex-supabase/.env"
ANON_KEY=$(grep "^ANON_KEY=" "$ENV_FILE" | cut -d= -f2-)
SERVICE_KEY=$(grep "^SERVICE_ROLE_KEY=" "$ENV_FILE" | cut -d= -f2-)
API="http://127.0.0.1:8000"

EMAIL="verificacion-hook-$$@ejemplo.local"
PASSWORD="$(openssl rand -hex 16)"

psql_q() { docker exec -i supabase-db psql -U postgres -d postgres -Atq -c "$1"; }

cleanup() {
	psql_q "delete from auth.users where email = '${EMAIL}'" >/dev/null 2>&1 || true
	psql_q "delete from public.tenants where slug = 'verificacion-hook'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "1. Creando tenant de prueba"
TENANT_ID=$(psql_q "insert into public.tenants (slug, name, status) values ('verificacion-hook', 'Verificacion Hook', 'active') returning id")
echo "   tenant: ${TENANT_ID}"

echo "2. Creando usuario vía Auth admin"
USER_ID=$(curl -sS -X POST "${API}/auth/v1/admin/users" \
	-H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}" \
	-H "Content-Type: application/json" \
	-d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"email_confirm\":true}" |
	python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
echo "   usuario: ${USER_ID}"

echo "3. Dando de alta la membresía (owner)"
psql_q "insert into public.memberships (user_id, tenant_id, role) values ('${USER_ID}', '${TENANT_ID}', 'owner')" >/dev/null

echo "4. Iniciando sesión y leyendo el JWT"
ACCESS_TOKEN=$(curl -sS -X POST "${API}/auth/v1/token?grant_type=password" \
	-H "apikey: ${ANON_KEY}" -H "Content-Type: application/json" \
	-d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" |
	python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')

if [[ -z "$ACCESS_TOKEN" ]]; then
	echo "FALLO: Auth no devolvió access_token"
	exit 1
fi

# Decodifica el payload sin verificar la firma: aquí solo interesan los claims.
CLAIMS=$(python3 - "$ACCESS_TOKEN" <<'PY'
import base64, json, sys
payload = sys.argv[1].split(".")[1]
payload += "=" * (-len(payload) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(payload)), indent=2, sort_keys=True))
PY
)

echo
echo "=== claims del JWT ==="
echo "$CLAIMS" | grep -E '"(tenant_id|tenant_role|role|sub)"' || true
echo

if echo "$CLAIMS" | grep -q '"tenant_id"' && echo "$CLAIMS" | grep -q '"tenant_role"'; then
	echo "OK: el hook inyecta tenant_id y tenant_role. RLS puede acotar."
	exit 0
fi

echo "FALLO: el JWT NO trae tenant_id/tenant_role. RLS NO acotaría nada."
echo "Revisa GOTRUE_HOOK_* en el contenedor de auth y el grant a supabase_auth_admin."
exit 1
