# Product

## Register

product

## Users

- **Dueño o encargado del local.** La abre unos segundos para comprobar que la cocina recibe
  las comandas, arreglar una impresora o vincular el equipo. Llega con prisa y, muchas veces,
  porque algo va mal.
- **Camareros, a diario.** Entran a Comandas, Productos y Cierre de caja, que son el panel web
  de la plataforma incrustado en la app.

El PC está en el mostrador, la barra o la cocina, y se maneja con ratón y teclado. La luz
cambia mucho: de día, un local luminoso; de noche, luz cálida y tenue.

## Product Purpose

Un agente de impresión desatendido: vive en la bandeja de Windows, arranca solo y saca los
pedidos por las impresoras de cocina y barra. La ventana existe para contestar en un vistazo
«¿se está imprimiendo?», y si no, decir qué pasa, qué pasa con los pedidos y qué hacer.

Si funciona, nadie piensa en ella. Lo que no puede pasar es que la cocina se quede sin
comandas y la app diga que todo va bien.

## Brand Personality

Sobria, fiable y precisa. Habla como un buen técnico: frases cortas, en el idioma del local,
sin jerga ni dramatismo. Transmite calma cuando todo va bien y claridad cuando no.

## Anti-references

- Emojis como iconos, y rejillas de tarjetas iguales como menú.
- Pedir al usuario datos técnicos (identificadores, rutas, variables) o que toque la
  configuración de Windows.
- Dejar el estado solo en el icono de la bandeja: Windows lo esconde.
- Errores sin salida: un mensaje que no dice qué hacer, o que aparece en otro sitio que el
  botón que lo provocó.
- Alarmas que parpadean con un corte de red de unos segundos.

## Design Principles

1. **El estado, primero y siempre verdadero.** Un solo modelo de estado alimenta la cabecera,
   la pantalla Estado y la bandeja; nunca se contradicen.
2. **Cada problema trae su salida.** Qué pasa con los pedidos y qué hacer, junto al problema.
3. **La herramienta desaparece en la tarea.** Navegación estándar, componentes conocidos y nada
   de decoración que no informe.
4. **Responder donde se actúa.** El resultado de una acción aparece junto a su botón.

## Accessibility & Inclusion

WCAG 2.2 AA. El color nunca va solo: cada estado lleva su palabra. Foco visible en todo lo
interactivo. Sin animaciones si Windows pide reducir el movimiento. Sigue el tema claro u
oscuro del sistema.
