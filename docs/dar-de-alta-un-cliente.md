# Dar de alta un cliente

Proceso completo desde que un restaurante dice que sí hasta que sus comensales pueden pedir.

Se hace desde la **consola de plataforma**, en el navegador. Ya no hace falta entrar por SSH
al VPS ni manejar la service key a mano.

---

## Antes de abrir la consola: lo que hay que pedirle al cliente

Estos datos no son burocracia — cada uno acaba en una pantalla que ve el comensal, y si
faltan, se nota:

| Dato | Dónde acaba | Si falta |
|---|---|---|
| Nombre comercial | Cabecera de la carta y del recibo | Se enseña el slug (`bar-paco`) |
| Razón social y CIF | Recibo y páginas legales | El recibo sale sin emisor |
| Dirección y teléfono | Recibo y páginas legales | Faltan en la política de privacidad |
| Correo del dueño | Su cuenta de acceso | No hay alta |
| Tipo de IVA | Desglose del recibo | Sin desglose |

El nombre comercial y el correo se piden en el alta; el resto lo rellena el dueño en
**Ajustes**, o tú por él. Que estén ANTES de que el local abra al público: las páginas legales
salen publicadas desde el primer minuto, y una política de privacidad sin responsable
identificado no cumple nada.

> **Elige el slug con cuidado.** Es el subdominio por el que se sirve ese cliente **para
> siempre** (`bar-paco.suarex.app`) y va impreso en los QR de todas sus mesas. Cambiarlo
> después obliga a reimprimir. La consola rechaza mayúsculas, espacios, guiones bajos y los
> subdominios reservados (`www`, `api`, `admin`, `app`).

---

## 1. El alta

Entra en `https://admin.<tu-dominio>/plataforma` con tu cuenta de superadmin y rellena
**Nuevo cliente**: slug, nombre, correo del dueño, tema, idioma y moneda.

Eso crea, de una vez:

- su fila de cliente (`tenants`), en estado `active` y plan `trialing`;
- su **sede por defecto** — sin ella no se puede crear ningún pedido;
- sus ajustes, con el nombre comercial ya sembrado;
- su **primer owner**, invitado por correo;
- su cliente en Stripe, para poder cobrarle la suscripción.

**Es idempotente.** Si algo falla a mitad, vuelve a darle: reutiliza lo que ya exista y crea
lo que falte. No pisa nada de lo que el dueño haya configurado.

Si Stripe falla, el alta **no se aborta**: el cliente se sirve igual y el identificador se
engancha después. Un problema de facturación no puede dejar a un restaurante sin carta.

## 2. El dueño entra

Le llega un correo con un enlace para poner **su propia contraseña**. Tú no le mandas
ninguna: no se teclean ni se dictan contraseñas por teléfono.

Con ella entra en `https://<slug>.<tu-dominio>/admin`.

> Si el correo no llega, mira el SMTP antes de volver a invitar. Sin SMTP configurado, Auth no
> envía nada y no da error visible. Ver la sección de correo del README de deploy.

## 3. Su carta

```bash
node scripts/import-catalog.mjs <volcado> <slug> --reemplazar
```

El proceso de sacar el volcado de su sistema anterior está en
[`migrar-un-cliente.md`](migrar-un-cliente.md).

Si su catálogo entra solo en español, el selector de idioma **no aparecerá** — es deliberado:
ofrecer "EN" para acabar enseñando la carta en español es peor que no ofrecerlo.

## 4. Sus mesas y sus QR

En `/admin/mesas`. Cada mesa genera su token y su QR. Ese token es lo que fija la cookie que
permite pedir: sin escanear, la carta se consulta pero no se pide.

## 5. Si lleva impresora

Genera su instalador del agente con `PLATFORM_WEB_ORIGIN=https://<slug>.<tu-dominio>` **antes**
de enviárselo: el origen va horneado en la build y cambiarlo obliga a regenerarlo.

Luego, en `/admin/dispositivos`, genera el código de emparejamiento y dáselo. Aparece una sola
vez. Detalle en [`agent-desktop-validacion.md`](agent-desktop-validacion.md).

## 6. Cobrarle

El alta deja al cliente en `trialing`. La suscripción se crea a mano en Stripe sobre el
cliente que la consola ya generó.

A partir de ahí el ciclo es automático: si un recibo falla, el webhook abre **7 días de
gracia** y el panel del dueño se lo avisa con fecha; si vencen sin pagar, el barrido diario lo
suspende. Pagar reactiva y borra la ventana.

---

## Comprobación final

Antes de decirle al cliente que está listo:

- [ ] Su carta se ve en `https://<slug>.<tu-dominio>/<mesa>`
- [ ] Escaneando un QR se puede pedir; sin escanear, sale el aviso "Escanea el QR"
- [ ] Un pedido de prueba llega al tablero de `/staff` — y a la impresora, si la tiene
- [ ] El recibo lleva su razón social y su CIF
- [ ] `/legal/privacidad` le nombra a él como responsable del tratamiento
- [ ] El dueño ha entrado con su propia contraseña

Borra el pedido de prueba cuando termines.

---

## El script antiguo

`scripts/create-tenant.mjs` sigue existiendo, pero **solo para dos casos**: la primera
instalación (cuando aún no hay ningún superadmin que pueda entrar en la consola) y la
recuperación ante desastres. Para todo lo demás, la consola.

Y el primer superadmin se crea así, una única vez por instalación:

```bash
node scripts/seed-platform-admin.mjs --email tu-correo@suarex.app
```

Exige acceso al servidor a propósito. Si la consola pudiera crear superadmins, comprometer una
sola cuenta comprometería la plataforma entera.
