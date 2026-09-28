# Retomar el proyecto en Windows

_Escrito el 2026-09-28, al final de una sesión larga en macOS. Para la siguiente sesión de
Claude Code, que arrancará en Windows. Si lees esto, empieza aquí._

Este documento NO sustituye a `CLAUDE.md` (cómo trabajar en este repo) ni a `docs/HANDOFF.md`
(estado por fases y backlog). Los complementa: dice **dónde estamos hoy**, **qué hacer para
tenerlo todo corriendo** y **qué está pendiente y en qué orden**.

Léelos en este orden: `CLAUDE.md` → este fichero → `docs/HANDOFF.md`.

---

## 1. Dónde estamos

`main` está en `a4f0802`, con **cero PRs abiertas**. Todo lo de las últimas sesiones está
mergeado: las fases 1, 2 y 3 del plan de viabilidad, el modo totem, los arreglos de los huecos
entre ambos, y una auditoría de producción.

Verde de punta a punta, medido sobre `main` con la base reseteada:

| | |
|---|---|
| lint · typecheck | limpio · 9/9 |
| unit | 7 paquetes, 230 en `apps/web` |
| integración | 423 en 67 ficheros |
| e2e | 112 |

Hay **un aviso de lint conocido y aceptado**: `useRef` sin usar en
`apps/web/app/totem/[token]/TotemFlow.tsx`. Es un warning, no rompe el build. No lo arregles
"de paso" en una rama de otra cosa.

---

## 2. Montar el entorno

### Lo que hace falta en la máquina

Node 22, pnpm 10, Docker Desktop corriendo, y la **CLI de Supabase ≥ 2.109** (una versión vieja
de scoop no parsea el `config.toml` de este proyecto).

### El paso que solo hace falta en Windows

macOS y Linux resuelven `*.localhost` a loopback gratis; **Windows no**. Sin esto,
`pnpm test:e2e` muere con "Timed out waiting from config.webServer". Una vez, en PowerShell
como administrador, editando `C:\Windows\System32\drivers\etc\hosts`:

```
127.0.0.1 garum.localhost
127.0.0.1 manuela.localhost
```

El detalle de por qué, y las otras tres fricciones de portabilidad (CRLF, `tsc`, grants), está
en `CLAUDE.md` → "En Windows (setup por máquina)".

### Arrancar, en este orden

```bash
pnpm install
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

### Comprobar que todo va

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e
```

Si algo sale rojo, mira primero la sección 4 antes de investigar: hay tres fallos de entorno
que parecen bugs y no lo son.

---

## 3. Qué hacer, por orden

### 3.1. Rotar el `GH_TOKEN` de Manuela — lo único urgente

`kiosko-manuela` empaquetaba `.env` dentro del instalador (`build.files`), y ese `.env`
contiene un `GH_TOKEN`. **Está dentro de cada `.exe` ya distribuido**, y el `.asar` de Electron
no va cifrado. Además sigue en el historial de git de ese repo.

La rama `seguridad/sacar-el-token-del-instalador` (ya subida, repo privado) impide que vuelva a
salir, pero **no deshace nada de lo repartido**. Hay que revocarlo en GitHub y emitir uno
nuevo, fine-grained y de solo lectura. No hace falta comprobar si sigue vivo: comprobarlo
significa usarlo.

Consecuencia de esa rama, deliberada y documentada en su `SEGURIDAD.md`: el actualizador deja
de recibir el token y los kioscos **no se actualizarán solos** hasta que se decida por dónde va
el feed. Hay tres opciones propuestas ahí; la recomendada es un feed estático, que es lo que ya
planea este producto.

### 3.2. Aplicar la migración 007 de Manuela

`web-manuela/supabase/migrations/007_rls_acotar_lectura_publica.sql`, escrita y **sin aplicar**.
Hoy, con la anon key —que es pública por diseño— cualquiera puede:

- leer el histórico entero de `pedidos`,
- leer `cierres_dia`, que guarda `usuario_email` y por tanto **es dato personal**,
- leer, **modificar y borrar** `order_counter`.

La migración cierra la lectura sin romper el servicio (el panel va autenticado; el agente solo
lee lo reciente). Lo que NO cierra, y está explicado en el propio fichero: el INSERT anónimo
sigue abierto, así que cualquiera puede inyectar un pedido que la cocina imprime. Eso necesita
credenciales propias para agente y kiosko, como el rol `device` de este producto.

Revísala y córrela con los logs del agente delante.

### 3.3. Desplegar suarex-platform

Nada de esto está hecho todavía:

1. `STRIPE_BILLING_WEBHOOK_SECRET` y `CRON_SECRET` con valor real en `.env.app`. Sin ellas, el
   webhook de facturación devuelve 500 siempre y los cuatro crons 503, **en silencio**.
2. **Reconstruir la imagen, no reiniciar.** `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` no llegaba al
   build hasta hace dos días: cualquier imagen anterior tiene el formulario de pago muerto. Las
   `NEXT_PUBLIC_*` se hornean en el bundle.
3. Registrar en Stripe los eventos de suscripción, reembolso y disputa.
4. Instalar los tres crons nuevos apuntando al host de plataforma; comprobar el `APP_URL` del
   `expire-orders` que ya existía.
5. `node scripts/seed-platform-admin.mjs --email ...` para el primer superadmin.

### 3.4. Lo que desbloquea funcionalidad

- **Credenciales SMTP.** Desbloquean el bloque C entero de la Fase 1 (recuperación de
  contraseña y alta de personal por invitación). Las tres tareas están escritas y validadas en
  el plan, listas para ejecutar el día que haya proveedor.
- **Validar el watchdog en un Windows real.** Está implementado y sin verificar: la tarea
  programada solo se registra en un build EMPAQUETADO (`app.isPackaged`), no en dev. El
  procedimiento paso a paso está en `docs/agent-desktop-validacion.md`, incluido buscar
  `password` dentro del diagnóstico exportado.

**Ahora que la sesión corre EN Windows, esto último por fin se puede hacer.** Es lo más
valioso que desbloquea el cambio de máquina.

### 3.5. Deuda anotada, sin urgencia

- **Electron 33 está fuera de soporte.** Los avisos piden ≥ 38.8.6 (varios use-after-free).
  Cinco majors es un proyecto, no un parche, pero el agente corre desatendido en el PC de cada
  cliente.
- **Sin cabecera anti-clickjacking.** `deploy/Caddyfile` pone HSTS, `X-Content-Type-Options` y
  `Referrer-Policy`, pero no `X-Frame-Options` ni CSP: `/admin` se puede meter en un iframe. Ya
  está comprobado que el panel incrustado del agente usa `WebContentsView` y no un iframe, así
  que añadir la cabecera **no** rompería la app de escritorio.
- **Un flaky con causa conocida**: `admin-d2.spec.ts:110`. Navega con la Server Action todavía
  en vuelo y `page.goto` pinta una vez, así que la página nueva llega sin el campo que el test
  va a rellenar. El arreglo es esperar sobre algo que pinte el servidor; ya se hizo igual en
  `admin-pagos.spec.ts` y en el e2e de franjas horarias.

---

## 4. Gotchas que cuestan horas

Además de los de `CLAUDE.md`, estos salieron en las últimas sesiones:

- **Tras `pnpm db:reset`, Kong se queda con la IP vieja de Auth.** `/rest/v1` responde 200 pero
  `/auth/v1/*` da 502, y los tests de integración fallan con `AuthRetryableFetchError` dentro de
  `createTenantFixture`. **No es tu código.** `docker restart supabase_kong_suarex-platform`.
- **Un test que deja pedidos sin borrar rompe OTRO fichero.** `listOrderHistory` no filtra por
  estado, así que cualquier pedido que sobre tumba el test del histórico vacío de
  `informes.spec.ts`. Si creas pedidos en un e2e, bórralos en un `finally`
  (`deleteOrdersForTenant`). Pasó, y el síntoma aparece en un fichero que no has tocado.
- **Las suites corren EN SERIE a propósito**: e2e con `workers: 1` (más `retries: 2` para
  absorber flakiness de entorno, no para tapar bugs) e integración con `fileParallelism: false`.
  Una sola base, un solo dev server, un solo catálogo sembrado. Si ves fallos raros y dispersos por
  ficheros que no tocaste, sospecha de la semilla antes que del código: `pnpm db:reset`.
- **`web-manuela` tiene DOS URLs de push en `origin`**: el repo privado y **uno público**. Un
  `git push` normal empuja a los dos y solo enseña la última línea. Mira `git remote -v` antes
  de empujar nada ahí, o usa la URL explícita.
- **Hay dos repos parecidos en la máquina.** `Documents/proyectos/suarex-platform` es este;
  `Documents/Mis proyectos/web-prueba` es otro producto. Usa rutas absolutas o `git -C`.
- **`gh` puede resolver al repo equivocado**: pasa siempre `--repo ivangs23/suarex-platform`.

---

## 5. Qué NO se ha podido verificar, y por qué

Para que no lo des por probado ni lo vuelvas a intentar a ciegas:

- **Todo lo de Electron**: impresión USB por winspool, el watchdog como tarea programada, el
  kiosko, el instalador. Necesita Windows con entorno gráfico. **Esto ya lo puedes hacer tú.**
- **Un cobro real por Stripe Connect.** La rama está cubierta en sus tres tramos (el
  repositorio, el navegador y la costura), pero confirmar un cargo de verdad necesita una
  cuenta de pruebas conectada real.
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
| Seguridad del kiosko de Manuela | `kiosko-manuela/SEGURIDAD.md` (rama de seguridad) |

Ramas de Manuela, ya subidas y **sin mergear**:

- `web-manuela` → `seguridad/acotar-rls`, solo en el remoto **privado**
  (`web-manuela-vercel`). Se quitó del público a propósito: describía un agujero sin arreglar.
- `kiosko-manuela` → `seguridad/sacar-el-token-del-instalador`, repo privado.
