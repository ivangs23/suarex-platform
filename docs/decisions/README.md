# Decisiones de arquitectura (ADR)

Por qué el código es como es, cuando el porqué no cabe en dos líneas de comentario.

**Regla:** un comentario de más de 8 líneas es un ADR. En el código quedan 1-2 líneas y el
enlace: `Ver docs/decisions/NNNN-titulo.md`. El código dice QUÉ hace; el ADR, POR QUÉ y qué se
descartó. Un comentario largo se desincroniza en silencio; un ADR se enlaza y se revisa.

## Formato

Un fichero por decisión, `NNNN-titulo-en-minusculas.md`, numerado en orden de creación (nunca
se renumera). 20-40 líneas; una tabla de registro, como la de exenciones del 0007, no cuenta.

```markdown
# NNNN — Título

**Estado:** vigente | sustituido por NNNN · **Fecha:** AAAA-MM-DD

## Contexto
Qué problema había y qué restricciones lo acotaban.

## Decisión
Qué se hizo, en concreto (ficheros, valores).

## Consecuencias
Qué se gana, qué se paga y qué hay que vigilar. Lo descartado y por qué.
```

Una decisión que cambia no se edita para que diga otra cosa: se marca **sustituido por NNNN**
y se escribe la nueva.

## Índice

| ADR | Decisión |
|---|---|
| [0001](0001-refresco-de-sesion-en-el-proxy.md) | El proxy refresca la sesión del personal sin autorizar, y nunca la convierte en un 500 |
| [0002](0002-proxy-503-y-cabeceras-forjadas.md) | Fallo al resolver el tenant: 503 terminal, sin cabeceras; cabeceras de tenant forjadas fuera |
| [0003](0003-tls-check-fuera-del-proxy.md) | `api/tls-check` queda fuera del matcher del proxy |
| [0004](0004-build-de-la-web.md) | Build de la web: webpack, `standalone` con la raíz del monorepo, imágenes sin optimizador |
| [0005](0005-variables-de-entorno-del-contenedor.md) | La lista `environment` del compose es lo único que llega a la web |
| [0006](0006-reintentos-y-pool-de-la-integracion.md) | Integración: `retry: 2` para el entorno, contado, y pool de hilos |
| [0007](0007-tenantscoped-y-sus-exenciones.md) | Todo acceso a datos pasa por `tenantScoped` o por una exención nombrada y numerada |
| [0008](0008-panel-web-aislado-en-el-agente.md) | El panel web del agente es contenido remoto aislado (sin preload, sandbox, dos sesiones, solo su origen) |
| [0009](0009-carta-publica-en-la-raiz.md) | `/` es la carta en consulta, mismo render que `/{mesa}`; sin canal QR no hay portada |
