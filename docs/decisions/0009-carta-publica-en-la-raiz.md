# 0009 — La carta pública vive en la raíz

**Estado:** vigente · **Fecha:** 2026-10-29

## Contexto
`GET /` de cada cliente era un 404 con `noindex`. La única carta era `/{mesa}`, a la que se
llega por el QR impreso (`/m/{token}` fija la cookie de mesa y redirige). Cuando un cliente
apunta su dominio al VPS, su portada pasa de indexable (la web que tenía) a 404, y el dominio
sale del índice. Hacía falta una portada sin pedir a cada cliente contenido nuevo.

## Decisión
- `/` es la carta en consulta: el mismo render de servidor que `/{mesa}`
  (`app/[mesa]/Carta.tsx`, `renderCarta`) con `mesa: null`. Sin mesa no se lee la cookie,
  `canOrder` es `false` y sale el aviso de escanear el QR.
- Tiene el mismo paso de bienvenida que `/{mesa}`: es un paso del flujo, no un adorno.
- `/{mesa}` no cambia. Es la única entrada que puede pedir.
- Un cliente sin el canal `qr-mesa` no tiene portada (404), igual que no tiene `/{mesa}`. Un
  cliente solo de totem sigue sin carta pública.

## Consecuencias
- Todo cliente con dominio tiene una portada indexable sin configurar nada, y su contenido es
  el que ya mantiene: la carta.
- Hay una sola carta: lo que cambie en `renderCarta` llega a las dos entradas, y
  `contract.test.tsx` sigue cubriendo el tema de ambas.
- 30 mesas son 30 URLs con la misma carta. El canonical a `/` lo resuelve la tarea 0.3 del plan
  de visibilidad.
- En `/` la bienvenida solo tiene nombre, lema y «Entrar». Las categorías están en
  `/?ver=carta` y `?cat=`; el sitemap (tarea 0.4) las lista.

Descartado:
- **Una landing aparte** (galería, «sobre nosotros», reservas). Es contenido nuevo por cliente y
  otro producto; la portada es la carta.
- **Redirigir `/` a `/1`.** Pinta «Mesa 1» a quien no está sentado en ninguna mesa y ata la
  portada a una mesa que puede no existir.
- **Quitar `/{mesa}` y dejar la mesa solo en la cookie.** Hay QR pegados en mesas que redirigen
  ahí, y tener la mesa en la URL es lo que permite comprobar que la cookie designa ESA mesa: la
  cookie de la 3 no pide desde la 7.
