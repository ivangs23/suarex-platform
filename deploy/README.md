# Despliegue en el VPS

Instalación desde cero de la plataforma en un VPS propio (probado contra Hostinger KVM 2:
2 vCPU, 8 GB RAM, 100 GB NVMe). Levanta dos stacks de Docker que comparten red:

| Stack | Qué es | De dónde sale |
|---|---|---|
| `supabase` | Postgres, Auth, PostgREST, Storage, Realtime, Kong | `supabase/docker` oficial, **sin modificar** |
| `suarex` | La web (Next) y Caddy (TLS + enrutado) | `deploy/` de este repo |

Se mantienen separadas para que actualizar Supabase sea un `git pull` y no un merge a mano.

**Esto no toca nada de garum ni de manuela en producción.** Es una instalación nueva y
vacía; sus proyectos y sus bases siguen donde están.

---

## Antes de empezar

Necesitas:

- Un **dominio** con el DNS en Cloudflare (o en otro proveedor con API; ver paso 3).
- La **IP del VPS** y acceso SSH.
- Un **proveedor de SMTP** (Resend, Postmark, Brevo…). Sin él, Auth no envía ni altas ni
  recuperaciones de contraseña.
- Decidir el dominio **antes** de generar instaladores del agente de escritorio: el
  instalador lleva `PLATFORM_WEB_ORIGIN` horneado y cambiarlo obliga a regenerarlo.

Reserva ~40 minutos.

---

## 1. Asegurar el servidor

Como `root`, recién creado el VPS:

```bash
adduser suarex && usermod -aG sudo suarex
rsync --archive --chown=suarex:suarex ~/.ssh /home/suarex
```

Deshabilita el acceso de root y por contraseña en `/etc/ssh/sshd_config`:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
systemctl restart ssh
```

Cortafuegos: solo SSH y HTTP(S). **Postgres (5432) no se abre nunca al exterior** — se
llega por túnel SSH cuando haga falta.

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp
ufw enable
```

Swap: con 8 GB y esta stack no deberías tocarla, pero 2 GB evitan que el OOM killer se
lleve a Postgres en un pico de build.

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

Docker:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker suarex
```

A partir de aquí, todo como usuario `suarex`.

---

## 2. DNS

Dos registros en Cloudflare, ambos apuntando a la IP del VPS:

| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| A | `@` | `72.61.106.185` | **DNS only** |
| A | `*` | `72.61.106.185` | **DNS only** |

**El proxy naranja de Cloudflare tiene que estar apagado.** Con él activado, Cloudflare
termina el TLS y Caddy nunca ve el challenge; además la nube gratuita no cubre subdominios
de segundo nivel con certificado propio.

Luego, un token de API en Cloudflare (*My Profile → API Tokens → Create Token*):

- Permisos: **Zone / DNS / Edit**
- Recursos: **solo la zona de tu dominio**

No uses la Global API Key: da acceso a toda la cuenta.

---

## 3. ¿Y si mi DNS no es Cloudflare?

El certificado comodín (`*.suarex.app`) es obligatorio aquí, porque cada cliente vive en su
propio subdominio y emitir un certificado por alta no escala. Let's Encrypt solo firma
comodines por challenge **DNS-01**, que necesita crear un registro TXT vía API.

Cambia el módulo en `Dockerfile.caddy` por el de tu proveedor
([caddy-dns](https://github.com/caddy-dns): DigitalOcean, OVH, Namecheap, Route53…) y ajusta
el bloque `tls` del `Caddyfile`. Si tu proveedor no tiene módulo, mueve el DNS a uno que sí.

---

## 4. Supabase

```bash
sudo mkdir -p /opt && sudo chown suarex:suarex /opt
cd /opt
git clone --depth 1 https://github.com/supabase/supabase
mkdir suarex-supabase && cp -r supabase/docker/* supabase/docker/.env.example suarex-supabase/
cd suarex-supabase && mv .env.example .env
```

### Generar los secretos

```bash
# JWT_SECRET: 40+ caracteres
openssl rand -base64 48 | tr -d '\n='
# POSTGRES_PASSWORD y los dos de Studio
openssl rand -base64 32 | tr -d '\n='
```

`ANON_KEY` y `SERVICE_ROLE_KEY` son JWT firmados con ese `JWT_SECRET`. Genéralos en
<https://supabase.com/docs/guides/self-hosting#api-keys> (payloads `{"role":"anon"}` y
`{"role":"service_role"}`) — es una página estática, la firma ocurre en tu navegador.

### Editar `.env`

```ini
POSTGRES_PASSWORD=<generado>
JWT_SECRET=<generado>
ANON_KEY=<jwt anon>
SERVICE_ROLE_KEY=<jwt service_role>
DASHBOARD_USERNAME=suarex
DASHBOARD_PASSWORD=<generado>

SITE_URL=https://suarex.app
API_EXTERNAL_URL=https://api.suarex.app
SUPABASE_PUBLIC_URL=https://api.suarex.app

# Cada cliente vuelve a su propio subdominio tras autenticarse. Sin el comodín aquí,
# Auth rechaza la redirección y el personal se queda fuera.
ADDITIONAL_REDIRECT_URLS=https://*.suarex.app/**

SMTP_HOST=<tu proveedor>
SMTP_PORT=587
SMTP_USER=<usuario>
SMTP_PASS=<contraseña>
SMTP_ADMIN_EMAIL=no-reply@suarex.app
SMTP_SENDER_NAME=SuarEx

# Solo el personal dado de alta desde el panel entra. Sin esto, cualquiera con la anon
# key se crea una cuenta contra tu Auth.
DISABLE_SIGNUP=true
```

### El hook de token — **no te lo saltes**

Todo el modelo multi-cliente depende de que el JWT lleve el `tenant_id`. Lo inyecta
`custom_access_token_hook` (`supabase/migrations/20260721000001_core_tenancy.sql`). Si el
hook no está activado, **RLS no acota nada y cada usuario ve la base entera**. Añade al
`.env`:

```ini
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook
```

El paso 7 lo verifica. **No pases de ahí sin que dé verde.**

### Arrancar

El `-p supabase` no es opcional: fija el nombre de la red a `supabase_default`, que es la
que busca `docker-compose.app.yml`.

```bash
docker compose -p supabase up -d
docker compose -p supabase ps
```

### Aligerar (opcional, recomendado)

`analytics` (Logflare) come ~1 GB y es la pieza más frágil del Supabase autoalojado. Con
8 GB entra todo, pero si prefieres el margen:

```bash
docker compose -p supabase stop analytics vector studio
```

Studio se puede levantar solo cuando lo necesites.

---

## 5. Migraciones

```bash
cd /opt
git clone <url-de-este-repo> suarex && cd suarex

curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz \
  | tar -xz -C /tmp && sudo mv /tmp/supabase /usr/local/bin/

export SUPABASE_DB_URL="postgresql://postgres:<POSTGRES_PASSWORD>@localhost:5432/postgres"
supabase db push --db-url "$SUPABASE_DB_URL"
```

**No ejecutes `supabase/seed.sql`.** Crea los clientes de demostración (garum, manuela) con
catálogo de muestra. En producción los clientes se dan de alta desde el panel.

---

## 6. La plataforma

```bash
cd /opt/suarex
cp deploy/.env.app.example deploy/.env.app
chmod 600 deploy/.env.app
nano deploy/.env.app   # ANON_KEY y SERVICE_ROLE_KEY salen del .env de Supabase
```

```bash
docker compose -f deploy/docker-compose.app.yml --env-file deploy/.env.app up -d --build
```

La primera vez, Caddy tarda ~1 minuto en emitir el certificado comodín. Sigue el proceso:

```bash
docker compose -f deploy/docker-compose.app.yml logs -f caddy
```

---

## 7. Verificar

Del más barato al más caro. Si uno falla, para y arréglalo antes de seguir.

**Un host desconocido da 404** (y no un 500 ni la carta de otro cliente):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://nadie.suarex.app/1
```

**La API responde:**

```bash
curl -sS https://api.suarex.app/rest/v1/ -H "apikey: <ANON_KEY>" -o /dev/null -w '%{http_code}\n'
```

**El hook de token inyecta el `tenant_id`** — la comprobación que de verdad importa. Da de
alta un cliente y un owner desde el panel, inicia sesión, y pega el `access_token` en
<https://jwt.io>. El payload tiene que traer `tenant_id` y `tenant_role`.

Si no están: el hook no está activo. Revisa las dos variables `GOTRUE_HOOK_*`, reinicia
`auth` (`docker compose -p supabase restart auth`) y **vuelve a iniciar sesión** — un token
ya emitido no se rellena solo.

**Aislamiento entre clientes:** con dos clientes dados de alta, entra con el personal de uno
y comprueba que su panel de comandas no ve los pedidos del otro. Es el mismo control que
cubre `tests/e2e/staff-board.spec.ts` en local.

---

## 8. Copias de seguridad

```bash
chmod +x /opt/suarex/deploy/scripts/*.sh
sudo mkdir -p /var/backups/suarex && sudo chown suarex:suarex /var/backups/suarex
crontab -e
```

```
30 3 * * * /opt/suarex/deploy/scripts/backup-db.sh >> /var/log/suarex-backup.log 2>&1
```

Configura `RCLONE_REMOTE` para que el volcado salga del servidor. Una copia que vive en el
mismo disco que la base no protege del fallo más probable, que es perder ese disco.

**Restaura una copia al menos una vez, en un contenedor de usar y tirar.** Un backup que no
se ha restaurado nunca es una suposición, no una copia de seguridad.

---

## Operación diaria

Desplegar una versión nueva:

```bash
cd /opt/suarex && ./deploy/scripts/deploy.sh
```

Registros:

```bash
docker compose -f deploy/docker-compose.app.yml logs --tail=100 -f web
docker compose -p supabase logs --tail=100 -f auth
```

Recursos:

```bash
docker stats --no-stream
```

---

## Dar de alta un cliente

1. Crear el tenant desde el panel (su `slug` decide el subdominio).
2. El comodín de DNS y el certificado ya lo cubren: **no hay que tocar ni DNS ni Caddy**.
3. Configurar su marca y su tema en Ajustes.
4. Si lleva impresora: generar su instalador del agente con `PLATFORM_WEB_ORIGIN=https://<slug>.suarex.app`.

---

## Seguridad — lo que no se negocia

- **La service role key vive solo en `deploy/.env.app`.** Salta RLS por completo: quien la
  tenga lee y escribe los datos de todos los clientes. Nunca con prefijo `NEXT_PUBLIC_`,
  nunca en el instalador del agente, nunca en un `ARG` de build.
- **El agente de escritorio solo lleva la anon key** y el origen de la web. Es su diseño
  desde la fase C2b: el dispositivo no escribe su propia configuración, la escribe el
  owner desde el panel.
- **Postgres no se expone.** Para llegar con un cliente gráfico, túnel SSH:
  `ssh -L 5432:localhost:5432 suarex@<ip>`.
- **Rota lo que se haya filtrado antes de abrir al público:** las credenciales de GitHub y
  de Paytef que aparecieron en historiales de otros repos no deben poder tocar esto.

## Qué hacer cuando 8 GB se queden cortos

En orden, de más barato a más caro:

1. Apagar `analytics`, `vector` y `studio` (~1,3 GB).
2. Ajustar `shared_buffers` y `work_mem` de Postgres a la RAM real.
3. Subir a KVM 4 (4 vCPU / 16 GB). Hostinger lo hace en caliente.
4. Sacar Postgres a su propio servidor. A partir de aquí la web escala sola.
