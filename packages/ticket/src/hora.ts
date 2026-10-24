/** `HH:MM` del instante en la zona de la sede del pedido: ni la del PC ni la del servidor. */
export function horaLocal(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}
