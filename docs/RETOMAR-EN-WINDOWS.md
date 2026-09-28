# Retomar el proyecto en Windows

_Escrito el 2026-09-28, al final de una sesión larga en macOS. Para la siguiente sesión de
Claude Code, que arrancará en Windows. Si lees esto, empieza aquí._

No sustituye a `CLAUDE.md` (cómo trabajar en este repo) ni a `docs/HANDOFF.md` (estado por
fases y backlog). Dice **dónde estamos hoy**, **cómo levantarlo todo** y **qué hacer y en qué
orden**. Léelos así: `CLAUDE.md` → este fichero → `docs/HANDOFF.md`.

---

## 0. Antes de nada: comprueba que `main` no se ha movido

**Esto ya ha costado caro dos veces.** El proyecto se ha desarrollado en dos máquinas a la vez,
y las dos veces una rama larga se cortó de un `main` que luego avanzó sin que nadie lo notara.

La segunda vez fue peor: un merge unió las dos líneas y **su resolución se quedó con un solo
lado**, borrando del árbol tres fases enteras de trabajo. La historia no se pierde en estos
casos —los commits siguen ahí— pero el árbol sí, y en silencio.

Antes de auditar nada, planificar nada o dar por bueno ningún estado:

```bash
git fetch origin
git log --oneline HEAD..origin/main     # ¿hay algo que no tengo?
git log --oneline origin/main..HEAD     # ¿tengo algo sin subir?
```

Y si vas a resolver un merge entre dos líneas largas, **comprueba después que no falta nada**:

```bash
git diff --stat <antes> <despues>   # un saldo muy negativo es una señal de alarma
```

Hay una etiqueta `septiembre-antes-del-merge` apuntando al estado previo a ese incidente, por
si hiciera falta volver a mirar.

---

## 1. Dónde estamos

`main` en `6c23b5c`, con **cero PRs abiertas**. Contiene las dos líneas de trabajo ya
integradas:

- **De julio–agosto**: modo totem / canal kiosko con Paytef, IVA por línea, grupos de opciones,
  proveedores de pago y Stripe por cliente, cierre de caja, checklist de puesta en marcha,
  menú de la app de escritorio, portado a Windows.
- **De septiembre**: las fases 1, 2 y 3 del plan de viabilidad — recibo con desglose fiscal,
  marco legal y retención de datos, suscripción con corte por impago, consola de plataforma,
  log estructurado, reembolsos, informes de ventas, histórico, "se acabó hoy", franjas horarias
  de carta y analítica de conversión del QR.

Verde de punta a punta, medido sobre este árbol con la base reseteada desde cero:

| | |
|---|---|
| lint · typecheck | limpio · 10/10 |
| unit | 9 paquetes, **665** |
| integración | **472** en 70 ficheros |
| e2e | **132** |
| migraciones | 44, aplican limpias desde cero |

---

## 2. Montar el entorno

### En la máquina

Node 22, pnpm 10, Docker Desktop corriendo, y la **CLI de Supabase ≥ 2.109** (una versión vieja
de scoop no parsea el `config.toml` de este proyecto).

### El paso que solo hace falta en Windows

macOS y Linux resuelven `*.localhost` a loopback gratis; **Windows no**. Sin esto,
`pnpm test:e2e` muere con "Timed out waiting from config.webServer". Una vez, en PowerShell
como administrador, en `C:\Windows\System32\drivers\etc\hosts`:

```
127.0.0.1 garum.localhost
127.0.0.1 manuela.localhost
127.0.0.1 admin.localhost
127.0.0.1 notadmin.localhost
127.0.0.1 admin.garum.localhost
```

Las tres últimas son de la consola de plataforma: sin ellas, `plataforma-host.spec.ts` cae con
`ENOTFOUND` y todo lo demás pasa, que es justo el tipo de rojo que se descarta por "de entorno".

El porqué, y las otras tres fricciones de portabilidad (CRLF, `tsc`, grants), en `CLAUDE.md` →
"En Windows (setup por máquina)".

### Arrancar, en este orden

```bash
pnpm install
pnpm exec playwright install chromium   # navegador de la versión de Playwright del lockfile
pnpm db:start                 # Supabase local; imprime las claves
pnpm db:reset                 # migraciones + seed
pnpm db:env && pnpm seed:staff
node scripts/seed-platform-admin.mjs --email superadmin@suarex.local
```

Los dos últimos no son opcionales si vas a correr la suite: sin `seed:staff` los e2e de panel
se caen, y sin el superadmin **`plataforma.spec.ts` se SALTA en silencio** — en un resumen de
Playwright, un test saltado se parece mucho a uno que pasa.

Los secretos (`apps/web/.env.local`) no están en git. Se recrean con las claves que imprime
`pnpm db:start` más las de Stripe en modo test; la plantilla es `.env.example`.

### Comprobar

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e
```

Si algo sale rojo, mira la sección 4 antes de investigar: hay fallos de entorno que parecen
bugs y no lo son.

---

## 3. Qué hacer, por orden

### 3.1. Rotar el `GH_TOKEN` de Manuela — lo único urgente

`kiosko-manuela` empaquetaba `.env` dentro del instalador, y ese `.env` lleva un `GH_TOKEN`.
**Está dentro de cada `.exe` ya distribuido** y el `.asar` de Electron no va cifrado; además
sigue en el historial de git de ese repo.

La rama `seguridad/sacar-el-token-del-instalador` (subida, repo privado) impide que vuelva a
salir, pero **no deshace nada de lo repartido**. Revócalo en GitHub y emite uno nuevo,
fine-grained y de solo lectura. No compruebes antes si sigue vivo: comprobarlo es usarlo.

Consecuencia deliberada de esa rama, documentada en su `SEGURIDAD.md`: el actualizador deja de
recibir el token y los kioscos **no se actualizarán solos** hasta que se decida por dónde va el
feed. Hay tres opciones ahí; la recomendada es un feed estático.

### 3.2. Aplicar la migración 007 de Manuela

`web-manuela/supabase/migrations/007_rls_acotar_lectura_publica.sql`, escrita y **sin aplicar**.
Hoy, con la anon key —pública por diseño— cualquiera puede leer el histórico de `pedidos`, leer
`cierres_dia` (que guarda `usuario_email`, **dato personal**) y leer, **modificar y borrar**
`order_counter`.

Cierra la lectura sin romper el servicio. Lo que **no** cierra, explicado en el propio fichero:
el INSERT anónimo sigue abierto, así que cualquiera puede inyectar un pedido que la cocina
imprime. Eso necesita credenciales propias para agente y kiosko, como el rol `device` de este
producto.

### 3.3. Desplegar suarex-platform

1. `STRIPE_BILLING_WEBHOOK_SECRET` y `CRON_SECRET` con valor real en `.env.app`. Sin ellas, el
   webhook de facturación devuelve 500 siempre y los cuatro crons 503, **en silencio**.
2. **Reconstruir la imagen, no reiniciar.** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` se hornea en el
   bundle en tiempo de build: cualquier imagen anterior a este arreglo tiene el formulario de
   pago muerto.
3. Registrar en Stripe los eventos de suscripción, reembolso y disputa.
4. Instalar los tres crons nuevos apuntando al host de plataforma; comprobar el `APP_URL` del
   `expire-orders` que ya existía.
5. `node scripts/seed-platform-admin.mjs --email ...` para el primer superadmin.

### 3.4. Lo que desbloquea el estar en Windows

**Validar el watchdog y el diagnóstico del agente en un build empaquetado real.** Está
implementado y sin verificar: la tarea programada solo se registra con `app.isPackaged`, no en
dev. El procedimiento paso a paso está en `docs/agent-desktop-validacion.md`, incluido buscar
`password` y `@devices.local` dentro del fichero de diagnóstico exportado.

**Es lo más valioso que desbloquea el cambio de máquina.** Todo lo de Electron llevaba meses sin
poder probarse.

### 3.5. Lo demás

- **Credenciales SMTP**: desbloquean el bloque C entero de la Fase 1 (recuperación de contraseña
  y alta de personal por invitación). Las tres tareas están escritas y validadas en el plan.
- **Electron 33 está fuera de soporte**: los avisos piden ≥ 38.8.6. Cinco majors es un proyecto,
  no un parche, pero el agente corre desatendido en el PC de cada cliente.
- **Sin cabecera anti-clickjacking**: `deploy/Caddyfile` pone HSTS, `X-Content-Type-Options` y
  `Referrer-Policy`, pero no `X-Frame-Options` ni CSP, así que `/admin` se puede meter en un
  iframe. Comprobado que el panel incrustado del agente usa `WebContentsView` y no un iframe,
  así que añadirla **no** rompería la app de escritorio.
- **Un flaky con causa conocida**: en `admin-d2.spec.ts`, "un owner da de alta un dispositivo
  y ve el código una vez". Navega con la Server Action todavía en
  vuelo y `page.goto` pinta una vez, así que la página nueva llega sin el campo que el test va a
  rellenar. El arreglo es esperar sobre algo que pinte el servidor; ya se hizo igual en
  `admin-pagos.spec.ts` y en el e2e de franjas horarias.

---

## 4. Gotchas que cuestan horas

Además de los de `CLAUDE.md`:

- **Tras `pnpm db:reset`, Kong se queda con la IP vieja de Auth.** `/rest/v1` responde 200 pero
  `/auth/v1/*` da 502, y la integración falla con `AuthRetryableFetchError` dentro de
  `createTenantFixture`. **No es tu código**: `docker restart supabase_kong_suarex-platform`.
- **Un test que deja pedidos sin borrar rompe OTRO fichero.** `listOrderHistory` no filtra por
  estado, así que cualquier pedido que sobre tumba el test del histórico vacío de
  `informes.spec.ts`. Si creas pedidos en un e2e, bórralos en un `finally`
  (`deleteOrdersForTenant`). El síntoma aparece en un fichero que no has tocado.
- **Las suites corren EN SERIE a propósito**: e2e con `workers: 1` (más `retries: 2` para
  absorber flakiness de entorno, no para tapar bugs) e integración con `fileParallelism: false`.
  Una sola base, un solo dev server, un solo catálogo sembrado. Ante fallos dispersos en
  ficheros que no tocaste, sospecha de la semilla antes que del código: `pnpm db:reset`.
- **`web-manuela` tiene DOS URLs de push en `origin`**: el repo privado y **uno público**. Un
  `git push` normal empuja a los dos y solo enseña la última línea. Mira `git remote -v` antes.
- **Dos repos parecidos en la máquina**: `Documents/proyectos/suarex-platform` es este;
  `Documents/Mis proyectos/web-prueba` es otro producto. Usa rutas absolutas o `git -C`.
- **`gh` puede resolver al repo equivocado**: pasa siempre `--repo ivangs23/suarex-platform`.

---

## 5. Qué NO se ha podido verificar, y por qué

Para que no lo des por probado ni lo intentes a ciegas:

- **Todo lo de Electron**: impresión USB por winspool, el watchdog como tarea programada, el
  kiosko, el instalador. Necesita Windows con entorno gráfico. **Esto ya lo puedes hacer tú.**
- **Un cobro real por Stripe Connect.** La rama está cubierta en sus tres tramos (repositorio,
  navegador y costura), pero confirmar un cargo de verdad necesita una cuenta de pruebas
  conectada real.
- **El VPS y la Supabase de producción.** Sin acceso, y tocar producción está prohibido por
  `CLAUDE.md`.
- **El datáfono Paytef.** Necesita hardware.
- **Si el `GH_TOKEN` sigue vivo.** Comprobarlo sería usarlo. Se revoca sin comprobar.

---

## 6. Dónde está cada cosa

| | |
|---|---|
| Cómo trabajar aquí, doctrina, patrones | `CLAUDE.md` |
| Estado por fases y backlog completo | `docs/HANDOFF.md` |
| Decisiones de cada fase, con su porqué | `docs/superpowers/specs/` |
| Validar el agente en Windows | `docs/agent-desktop-validacion.md` |
| Dar de alta un cliente | `docs/dar-de-alta-un-cliente.md` |
| Seguridad del kiosko de Manuela | `kiosko-manuela/SEGURIDAD.md` (en su rama) |

Ramas de Manuela, subidas y **sin mergear**:

- `web-manuela` → `seguridad/acotar-rls`, solo en el remoto **privado**
  (`web-manuela-vercel`). Se quitó del público a propósito: describía un agujero sin arreglar.
- `kiosko-manuela` → `seguridad/sacar-el-token-del-instalador`, repo privado.
