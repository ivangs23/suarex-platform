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
| A | `@` | `<IP-DEL-VPS>` | **DNS only** |
| A | `*` | `<IP-DEL-VPS>` | **DNS only** |

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

Un script los genera todos **en el servidor** y los escribe en `.env` sin imprimir ninguno
por pantalla — incluidos los dos JWT (`ANON_KEY`, `SERVICE_ROLE_KEY`), que firma con el
`JWT_SECRET` recién creado:

```bash
/opt/suarex/deploy/scripts/gen-secrets.sh
```

Deja también puestos `DISABLE_SIGNUP=true` y el `COMPOSE_FILE` que carga el override.

### El override — el único cambio sobre el compose oficial

```bash
cp /opt/suarex/deploy/supabase-override.yml /opt/suarex-supabase/docker-compose.override.yml
```

Hace dos cosas, y **las dos son de seguridad**: activa el hook del JWT y ata Postgres y el
pooler a loopback. Lee sus comentarios antes de tocarlo.

### Editar `.env` (lo que el script no puede saber)

```ini
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
hook no está activado, **RLS no acota nada y cada usuario ve la base entera**.

Va en `supabase-override.yml`, **no en el `.env`**: el compose oficial solo propaga al
contenedor de `auth` la lista de `GOTRUE_*` que él conoce, y estas dos no están en ella.
Ponerlas en el `.env` no da ningún error: el contenedor arranca sano, sin el hook, y la
instalación parece correcta.

El paso 7 lo verifica de extremo a extremo. **No pases de ahí sin que dé verde.**

### Arrancar

El `-p supabase` no es opcional: fija el nombre de la red a `supabase_default`, que es la
que busca `docker-compose.app.yml`.

```bash
cd /opt/suarex-supabase && docker compose -p supabase up -d
```

Los 11 servicios deben quedar `healthy`. Si `realtime` entra en bucle de reinicio, mira sus
registros: casi siempre es `REALTIME_DB_ENC_KEY` con una longitud distinta de 16.

---

## 5. Migraciones

```bash
cd /opt
git clone <url-de-este-repo> suarex
/opt/suarex/deploy/scripts/apply-migrations.sh
```

El script ejecuta los ficheros en orden y registra cada versión en
`supabase_migrations.schema_migrations`, así que es idempotente y deja la base en el estado
que espera `supabase db push` para los despliegues siguientes.

No se usa el CLI directamente porque **exige TLS incluso contra `127.0.0.1`** y el Postgres
del compose oficial no lo sirve: falla con `tls error (server refused TLS connection)`, y
`?sslmode=disable` no lo evita.

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

Tras cambiar el `Caddyfile` (un `git pull` que lo toque), reinicia Caddy. `restart` y no
`caddy reload`: el fichero va montado, y el contenedor no ve el nuevo hasta volver a arrancar.

```bash
docker compose -f deploy/docker-compose.app.yml restart caddy
```

---

## 7. Verificar

Del más barato al más caro. Si uno falla, para y arréglalo antes de seguir.

**Un host desconocido da 404** (y no un 500 ni la carta de otro cliente):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://nadie.suarex.app/1
```

**Un cuerpo de más de 1MB en `/api/*` da 413.** Usa el host de un cliente real:
`/api/devices/pair` lee el cuerpo antes que nada. Un 404 aquí significa que el Caddy que corre
no tiene el tope (falta el `restart` del paso anterior).

```bash
head -c 2000000 /dev/zero | curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Content-Type: application/json' --data-binary @- https://<slug>.suarex.app/api/devices/pair
```

**La API responde:**

```bash
curl -sS https://api.suarex.app/rest/v1/ -H "apikey: <ANON_KEY>" -o /dev/null -w '%{http_code}\n'
```

**El hook de token inyecta el `tenant_id`** — la comprobación que de verdad importa:

```bash
/opt/suarex/deploy/scripts/verify-hook.sh
```

Crea un cliente y un usuario de usar y tirar, inicia sesión de verdad, decodifica el JWT y
comprueba que trae `tenant_id` y `tenant_role`. Limpia lo que crea, pase o falle.

Si falla: el hook no está activo. Comprueba que el contenedor los tiene de verdad —

```bash
docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i hook
```

— y si no aparecen, es que Compose está ignorando el override: revisa `COMPOSE_FILE` en el
`.env`. Tras arreglarlo, `docker compose -p supabase up -d --force-recreate auth` y **vuelve
a iniciar sesión**: un token ya emitido no se rellena solo.

**`anon` no puede leer ninguna tabla de clientes:**

```bash
ANON=$(grep '^ANON_KEY=' /opt/suarex-supabase/.env | cut -d= -f2-)
curl -sS "http://127.0.0.1:8000/rest/v1/tenants?select=id" -H "apikey: $ANON"
```

Debe responder `permission denied for table tenants`. Si devuelve filas, para: los `REVOKE`
de las migraciones no se aplicaron.

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
0 8 * * * AVISO_A=tu@correo /opt/suarex/deploy/scripts/alertas-log.sh >> /var/log/suarex-alertas.log 2>&1
```

La segunda línea es el **resumen diario de errores** de la web: agrupa los `log.error` de las
últimas 24 h por evento y te lo manda si hay alguno, con los que cuestan dinero o dejan a un
cliente sin imprimir arriba (`stripe.cobro_sin_pedido`, `stripe.importe_no_coincide`,
`stripe.disputa_abierta`, `dispositivo.caido`). Sin errores no escribe nada; si no puede leer
el contenedor, avisa de eso. Usa `mail` como `uptime-check.sh` (sin él, solo al log). El correo
lleva nombres de evento y conteos, ningún dato del log. Para probarlo sin Docker:
`LOG_FICHERO=muestra.log ./alertas-log.sh`.

Cada copia son tres ficheros: datos (`.sql.gz`), roles (`.roles.sql.gz`) y fotos
(`.storage.tgz`, el volumen de Storage; si tu layout no es el de §4, fija `STORAGE_DIR`). Si
las fotos fallan, la copia de la base sigue adelante y el log dice `AVISO: … SIN fotos`.

Configura `RCLONE_REMOTE` para que el volcado salga del servidor. Una copia que vive en el
mismo disco que la base no protege del fallo más probable, que es perder ese disco.

**Restaura una copia al menos una vez, en un contenedor de usar y tirar.** Un backup que no
se ha restaurado nunca es una suposición, no una copia de seguridad.

---

## 9. Expirar pedidos pendientes (cron del sistema)

Un comensal puede crear un pedido y no llegar a pagar (cierra la pestaña, se queda sin
batería). Ese pedido queda `pending` para siempre si nadie lo barre: ensucia el tablero del
personal y las métricas.

La base trae una función que los cancela (`expire_pending_orders`), y la migración intenta
programarla con **pg_cron**. Pero el Supabase autoalojado no siempre trae pg_cron en
`shared_preload_libraries`; cuando falta, verás en los logs del `db reset`/`db push` un
`pg_cron scheduling skipped: ...` y **nadie los barre**. Compruébalo:

```bash
docker compose -p supabase exec db \
  psql -U postgres -c "select jobname from cron.job;" 2>/dev/null || echo "pg_cron no disponible"
```

Si no hay job, prográmalo desde el **cron del sistema**, que existe en cualquier servidor:

```bash
crontab -e
```

```
*/5 * * * * CRON_SECRET=<el de .env.app> APP_URL=https://<tu-dominio> /opt/suarex/deploy/scripts/expire-orders.sh >> /var/log/suarex-expire.log 2>&1
```

El endpoint (`/api/internal/expire-orders`) exige ese `CRON_SECRET` en la cabecera y **falla
cerrado**: sin secreto configurado responde 503 y no barre nada, para que un despliegue a
medio hacer no lo deje abierto. Genera el secreto con `openssl rand -hex 32` y ponlo tanto en
`.env.app` como en la línea del cron.

---

## Restaurar: el simulacro, y por qué no es obvio

**Un backup que no se ha restaurado nunca no es un backup, es un fichero.** Haz el simulacro
una vez al trimestre y cuando cambies de versión de Postgres.

### Lo que hay que saber antes

Tres cosas que se descubrieron haciendo un simulacro de verdad, y que cuestan una noche si se
descubren el día del desastre:

1. **El volcado NO incluye los roles.** `pg_dump` vuelca una base; los roles son del cluster.
   La imagen de Supabase trae 4 de los 13 que este esquema usa, así que sin ellos la
   restauración muere en `role "supabase_realtime_admin" does not exist`. Por eso
   `backup-db.sh` genera `suarex-FECHA.sql.gz` y `suarex-FECHA.roles.sql.gz` aparte (y un
   tercero con las fotos, ver abajo). Cópialos todos fuera del servidor.

2. **El destino NO puede estar vacío.** El volcado lleva `--clean --if-exists` porque el
   destino real nunca está limpio: la imagen de Supabase precrea `auth` y `storage`, y sin ese
   flag falla con `schema "auth" already exists`. A cambio, contra una base completamente nueva
   falla en la primera línea (`DROP POLICY ... ON public.venues`: ese IF EXISTS protege la
   policy, no la tabla). No "arregles" el flag — ajusta el procedimiento.

3. **Todo se hace como `supabase_admin`, no como `postgres`.** En el stack autoalojado
   `postgres` no es superusuario y la restauración falla con
   `must be able to SET ROLE "supabase_admin"`.

Y aparte: **las fotos no están en la base.** El esquema `storage` del volcado son solo los
metadatos; los ficheros viven en el volumen de Storage. `backup-db.sh` los empaqueta en
`suarex-FECHA.storage.tgz` **con sus xattr**, y `restore-db.sh` los mete en el contenedor de
Storage con `docker cp`, con una confirmación aparte. Los xattr no son un detalle: Storage
guarda ahí el tipo y la caché de cada foto, y sin ellos responde 500 aunque el fichero esté. Un
`tar` a mano sin `--xattrs` restaura fotos que no se ven.

### El procedimiento

```bash
# 1. Levanta el stack de Supabase en el servidor nuevo (crea esquemas y roles base).
# 2. Aplica las migraciones (crea el esquema public).
./deploy/scripts/apply-migrations.sh

# 3. Restaura. Carga los roles si encuentra el .roles.sql.gz al lado y, si escribes 'fotos',
#    las fotos del .storage.tgz.
DB_CONTAINER=supabase-db STORAGE_CONTAINER=supabase-storage \
  ./deploy/scripts/restore-db.sh /var/backups/suarex/suarex-FECHA.sql.gz

# 4. Abre la carta restaurada de un cliente y comprueba que se VE una foto.
```

Termina imprimiendo un recuento de tenants, productos, pedidos, usuarios, dispositivos y fotos
(`storage.objects`), y tras las fotos, cuántos ficheros hay en Storage: al menos tantos como
`storage.objects`. **Compáralo con lo que esperabas tener.** Una restauración que acaba sin
error pero deja las tablas vacías es el peor resultado posible, porque parece que funcionó.

### Para ensayar sin tocar producción

Un Postgres desechable con la misma imagen **y un Storage desechable a su lado**. Postgres solo
no basta: las migraciones tocan `storage.buckets`, y esas tablas las crea Storage al arrancar,
no la imagen de Postgres. El Storage recibe además las fotos y deja comprobar que se sirven.
Los números tienen que cuadrar con los de producción y la foto tiene que dar `200`:

```bash
cd /opt/suarex
V=/var/backups/suarex/suarex-FECHA.sql.gz
docker network create drill-net
docker run -d --name drill --network drill-net -e POSTGRES_PASSWORD=x \
  public.ecr.aws/supabase/postgres:17.6.1.106
# (espera a que `docker logs drill` diga "PostgreSQL init process complete")
docker exec drill psql -U supabase_admin -d postgres \
  -c "alter role supabase_storage_admin with login password 'x'"

# Storage con la imagen y el entorno del de producción, apuntando a la base desechable.
# El .env lleva las claves de Supabase: 600, y se borra al acabar.
(umask 077; docker inspect supabase-storage --format '{{range .Config.Env}}{{println .}}{{end}}' |
  grep -vE '^(PATH|NODE_VERSION|YARN_VERSION|DATABASE_URL|FILE_STORAGE_BACKEND_PATH|IMGPROXY_URL)=|^$' \
  >/tmp/drill-storage.env)
docker run -d --name drill-fotos --network drill-net --env-file /tmp/drill-storage.env \
  -e DATABASE_URL=postgresql://supabase_storage_admin:x@drill:5432/postgres \
  -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -v drill-storage:/var/lib/storage \
  "$(docker inspect supabase-storage --format '{{.Config.Image}}')"

# Roles y migraciones (los "ERROR ... already exists" de los roles son normales).
gunzip -c "${V%.sql.gz}.roles.sql.gz" | docker exec -i drill psql -U supabase_admin -d postgres -q
for f in supabase/migrations/*.sql; do
  docker exec -i drill psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q --single-transaction <"$f"
done

# Restaura base y fotos (escribe 'restaurar' y luego 'fotos').
DB_CONTAINER=drill STORAGE_CONTAINER=drill-fotos ./deploy/scripts/restore-db.sh "$V"

# Una foto de producto, servida: tiene que dar 200 y content-type image/webp.
F="$(docker exec drill psql -U postgres -tAc \
  "select name from storage.objects where bucket_id = 'catalog' and name like '%/products/%' limit 1")"
docker exec drill-fotos wget -S -O /dev/null "http://127.0.0.1:5000/object/public/catalog/$F"

docker rm -f drill drill-fotos && docker volume rm drill-storage && docker network rm drill-net
rm /tmp/drill-storage.env
```

No lo ensayes restaurando en una base con OTRO NOMBRE dentro del mismo Postgres: `pg_cron`
solo puede existir en la base llamada `postgres` y la restauración se para ahí.

### RPO y RTO

| | |
|---|---|
| **RPO** (datos que se pierden) | Hasta **24 h**, datos y fotos — `backup-db.sh` corre a las 3:30. Con más volumen, baja el cron a cada 6 h. |
| **RTO** (tiempo hasta volver) | **~45 min** en servidor nuevo: instalar el stack (20) + migraciones (2) + restaurar (5) + fotos (~5, según lo que pesen) + DNS y certificados (10). |

Si esos números no te valen para un cliente, la respuesta no es hacer más backups: es una
réplica de Postgres, y eso es otra fase.

## Los otros dos crons del sistema

Mismo patrón que el de expirar pedidos, mismo `CRON_SECRET`, y los dos fallan cerrado si el
secreto no está configurado.

```bash
# Retencion de datos del comensal (90 dias las notas, 24 meses el pedido).
# NO es limpieza opcional: son los plazos que la politica de privacidad publicada promete.
15 4 * * * CRON_SECRET=xxx APP_URL=https://admin.<tu-dominio> /opt/suarex/deploy/scripts/purge-orders.sh

# Cierra las ventanas de gracia vencidas: suspende a quien lleva 7 dias sin pagar.
0 5 * * * CRON_SECRET=xxx APP_URL=https://admin.<tu-dominio> /opt/suarex/deploy/scripts/suspend-overdue.sh
```

**Apúntalos al host de la consola (`admin.<tu-dominio>`), no al de un tenant.** Dos motivos, y
el segundo es grave:

1. El proxy resuelve tenant por Host en todas las rutas salvo `api/tls-check`. Con el dominio
   raíz, `findTenantByHost` devuelve null y el cron recibe un 404 sin barrer nada, en silencio.
2. Si apuntas al host de un tenant y ese tenant acaba suspendido —justo lo que provoca
   `suspend-overdue`— el proxy devuelve 503 en esas rutas, el `curl -fsS` falla y el cron
   **muere para todos los demás clientes**. Se autodestruye.

Revisa también el cron de `expire-orders` que ya tengas instalado: si apunta al dominio raíz,
lleva tiempo sin barrer nada.

## Limpiar fotos huérfanas del bucket

Reimportar el catálogo de un cliente (`import-catalog --reemplazar`) borra sus filas y resube
las fotos a rutas nuevas, dejando las viejas sin dueño en Storage. También pasa al editar
fotos desde el panel. Nadie las mira y nadie las borra: el bucket crece sin techo (un solo
cliente reimportado dejó ~10 MB muertos).

El script las localiza y las borra. **Borrar es irreversible, así que por defecto SIMULA** y
no toca nada:

```bash
# Ver qué sobra y cuánto pesa, SIN borrar:
node scripts/limpiar-storage.mjs <slug>

# Borrar de verdad los huérfanos de ese cliente:
node scripts/limpiar-storage.mjs <slug> --confirmar

# Simular sobre todos los clientes:
node scripts/limpiar-storage.mjs --todos
```

Una foto es huérfana si su objeto no lo referencia ninguna fila del cliente (producto,
categoría, logo o foto de bienvenida). El borrado está acotado al prefijo del cliente: una
sola ruta fuera de `tenant/{id}/` aborta el lote entero, para no tocar la foto de otro.

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

## La consola de plataforma

La consola vive en su propio host, `admin.<tu-dominio>`, y el comodín de DNS del paso 2 ya lo
cubre: **no hay que tocar ni DNS ni Caddy** para ella.

Bajo ese host no se sirve nada del producto (ni carta, ni panel de cliente, ni tablero de
personal), y `/plataforma` no se sirve NUNCA bajo el host de un cliente. Las dos direcciones
están comprobadas en `tests/e2e/plataforma-host.spec.ts`.

Crea el primer superadmin, una vez por instalación:

```bash
node scripts/seed-platform-admin.mjs --email tu-correo@suarex.app
```

Imprime la contraseña generada. Es el **único** camino para crear un superadmin, y exige acceso
al servidor a propósito: si la consola pudiera crearlos, comprometer una sola cuenta
comprometería la plataforma entera. Los superadmins viven en `platform_admins`, una tabla
aparte de `memberships` con RLS sin policies — un superadmin no tiene membership de ningún
cliente, así que su JWT no lleva `tenant_id`.

## Dar de alta un cliente

Desde la consola, en el navegador: `https://admin.<tu-dominio>/plataforma`.

El procedimiento completo —qué datos pedirle al cliente antes de empezar, la importación del
catálogo, las mesas, la impresora y la comprobación final— está en
[`docs/dar-de-alta-un-cliente.md`](../docs/dar-de-alta-un-cliente.md).

`scripts/create-tenant.mjs` queda para la primera instalación (cuando aún no hay superadmin) y
para recuperación ante desastres. Para todo lo demás, la consola.

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
