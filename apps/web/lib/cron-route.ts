import { NextResponse } from "next/server";
import { log } from "./log";
import { timingSafeEqualStr } from "./timing-safe-equal";

/**
 * LA MISMA IDEA QUE `guardedAction`, EN LA CAPA HTTP.
 *
 * Los endpoints de `/api/internal/*` borran datos personales de forma irreversible, cancelan
 * pedidos y suspenden a todos los clientes a la vez. Repetían el mismo bloque de ~14 líneas
 * —leer el secreto, 503 si falta, parsear el Bearer, comparar en tiempo constante, 401,
 * try/catch— copiado cuatro veces. Una Server Action sin guard expone el panel de un tenant;
 * un quinto `/api/internal/*` sin guard es un endpoint destructivo abierto a internet.
 *
 * Con esto, escribir el quinto endpoint no puede olvidar la barrera: no hay dónde olvidarla.
 *
 * FALLA CERRADO sin `CRON_SECRET` configurado (503, sin ejecutar nada): un despliegue a medio
 * configurar no puede dejar el endpoint abierto por accidente. Y compara en tiempo constante
 * porque una comparación normal filtra por su tiempo cuántos caracteres iniciales acertó
 * quien llama, y este secreto no rota.
 *
 * `evento` es el identificador estable que se registra si el trabajo lanza
 * (`cron.purge_orders_fallo`), no una frase: ver `log.ts` sobre por qué eso importa.
 */
export function cronRoute(
  evento: string,
  trabajo: () => Promise<Record<string, unknown>>,
): (request: Request) => Promise<NextResponse> {
  return async (request: Request) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Cron no configurado" }, { status: 503 });
    }

    const auth = request.headers.get("authorization") ?? "";
    const enviado = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    if (!timingSafeEqualStr(enviado, secret)) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    try {
      return NextResponse.json(await trabajo());
    } catch (error) {
      log.error(evento, { error });
      return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
  };
}
