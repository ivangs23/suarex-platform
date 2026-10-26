import { dominioSinWww, isPlatformHost, resolveRootDomains } from "@suarex/config";
import { findTenantByHost } from "@suarex/db";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { necesitaRefresco } from "./lib/session-refresh";

// Ver resolveRootDomains (@suarex/config/tenant-host.ts): recorta y descarta entradas
// vacías, y lanza fuera de `development` si la variable no está definida en vez de
// defaultear en silencio a "localhost" (ver su docstring para los dos modos de fallo que
// esto cierra).
const ROOT_DOMAINS = resolveRootDomains(process.env);

const TENANT_ID_HEADER = "x-suarex-tenant-id";
const TENANT_SLUG_HEADER = "x-suarex-tenant-slug";
/** Ruta pedida. Un componente de servidor no puede saberla de otra forma, y `requireManager`
 * la necesita para que el login devuelva a donde se iba. Se fija SIEMPRE aquí, así que lo que
 * mande el cliente con este nombre nunca sobrevive. */
const PATH_HEADER = "x-suarex-path";

// `NextResponse.rewrite`/`.next` only strip a client's own request headers when
// `request: { headers }` is passed: that's what makes Next set
// `x-middleware-override-headers` and actually substitute the header set the
// downstream page sees. Without it, a client-supplied `x-suarex-tenant-*`
// header sails straight through to `requireTenant()` untouched. Every branch
// below that rewrites to a page MUST build its headers through this helper so
// a forged tenant header can never survive an error path.
function stripForgedTenantHeaders(request: NextRequest): Headers {
  const stripped = new Headers(request.headers);
  stripped.delete(TENANT_ID_HEADER);
  stripped.delete(TENANT_SLUG_HEADER);
  stripped.delete(PATH_HEADER);
  return stripped;
}

// Refresca la sesión de Supabase Auth del personal (rota el access token si
// expiró) leyendo/escribiendo las cookies de sesión sobre la respuesta ya
// construida por `proxy()`. NO participa en la resolución de tenant ni en el
// borrado de cabeceras forjadas de arriba -- eso sigue siendo enteramente
// responsabilidad de `stripForgedTenantHeaders`/`findTenantByHost`. Se invoca
// solo para rutas `/staff`, después de que el tenant ya se resolvió con éxito.
async function refreshStaffSession(request: NextRequest, response: NextResponse): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Mantiene viva la sesión sin autorizar nada (eso es `getStaffSession()`), y ningún fallo
  // aquí puede volverse un 500 de /staff. Ver docs/decisions/0001-refresco-de-sesion-en-el-proxy.md.
  try {
    // Antes de tocar la red, mirar si hace falta. `getSession()` lee la cookie que ya viene
    // en la petición y cuesta 0 ms; `getUser()` es una ida y vuelta a Supabase (32 ms
    // medidos, vista subir a 579 ms) que con un token de una hora sobra en casi todas las
    // peticiones. Ver `necesitaRefresco` para por qué esto no relaja ninguna comprobación.
    const { data } = await supabase.auth.getSession();
    if (!necesitaRefresco(data.session?.expires_at, Date.now())) return;
    await supabase.auth.getUser();
  } catch {
    // Degradación intencional -- ver comentario de arriba. Nada que
    // propagar: la petición continúa sin la sesión refrescada.
  }
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const pathname = request.nextUrl.pathname;

  // LA CONSOLA DE PLATAFORMA VIVE EN SU PROPIO HOST ("admin.<raiz>"), y las dos direcciones se
  // comprueban aqui. La segunda es la que importa: sin ella, "garum.suarex.app/plataforma"
  // llegaria a la pagina con un tenant resuelto y toda la defensa quedaria en manos del guard
  // de rol -- una sola barrera para la superficie que ve a TODOS los clientes.
  const esRutaDePlataforma = pathname === "/plataforma" || pathname.startsWith("/plataforma/");
  // El cron del sistema llega a /api/internal/* sin tenant: ni lo necesita ni lo usa. Se
  // permite por los dos hosts -- por el de plataforma (lo natural, y lo que evita que un
  // tenant suspendido tumbe el cron) y por el de un tenant (como esta instalado hoy en el
  // VPS), para no romper el cron ya desplegado.
  const esRutaDeCron = pathname.startsWith("/api/internal/");

  if (isPlatformHost(host, ROOT_DOMAINS)) {
    // Bajo el host de plataforma NO se resuelve ningun tenant, y cualquier otra ruta es 404:
    // la carta, el panel del cliente y el tablero de personal no existen aqui.
    if (!esRutaDePlataforma && !esRutaDeCron) {
      return NextResponse.rewrite(new URL("/not-found", request.url), {
        status: 404,
        request: { headers: stripForgedTenantHeaders(request) },
      });
    }
    const response = NextResponse.next({
      request: { headers: stripForgedTenantHeaders(request) },
    });
    if (esRutaDePlataforma) await refreshStaffSession(request, response);
    return response;
  }

  // LA OTRA DIRECCION. La consola no se sirve NUNCA bajo el host de un cliente.
  if (esRutaDePlataforma) {
    return NextResponse.rewrite(new URL("/not-found", request.url), {
      status: 404,
      request: { headers: stripForgedTenantHeaders(request) },
    });
  }

  let tenant: Awaited<ReturnType<typeof findTenantByHost>>;
  try {
    tenant = await findTenantByHost(host, ROOT_DOMAINS);
  } catch {
    // Fallo de infraestructura: 503 TERMINAL (no renderiza ninguna página, así que ninguna
    // cabecera llega a `requireTenant()`). Ver docs/decisions/0002-proxy-503-y-cabeceras-forjadas.md.
    return new NextResponse("Servicio no disponible", { status: 503 });
  }

  if (!tenant) {
    // `www.<dominio propio>` -> el dominio, si es de un cliente: solo se guarda uno de los dos.
    const sinWww = dominioSinWww(host, ROOT_DOMAINS);
    if (sinWww) {
      let destino: Awaited<ReturnType<typeof findTenantByHost>>;
      try {
        destino = await findTenantByHost(sinWww, ROOT_DOMAINS);
      } catch {
        return new NextResponse("Servicio no disponible", { status: 503 });
      }
      if (destino) {
        const url = new URL(`${pathname}${request.nextUrl.search}`, `https://${sinWww}`);
        return NextResponse.redirect(url, 308);
      }
    }
    return NextResponse.rewrite(new URL("/not-found", request.url), {
      status: 404,
      request: { headers: stripForgedTenantHeaders(request) },
    });
  }

  if (tenant.status === "suspended") {
    return NextResponse.rewrite(new URL("/suspended", request.url), {
      status: 503,
      request: { headers: stripForgedTenantHeaders(request) },
    });
  }

  const headers = new Headers(request.headers);
  headers.set(TENANT_ID_HEADER, tenant.id);
  headers.set(TENANT_SLUG_HEADER, tenant.slug);
  headers.set(PATH_HEADER, request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers } });

  if (pathname.startsWith("/staff")) {
    await refreshStaffSession(request, response);
  }

  return response;
}

// `api/tls-check` queda FUERA del proxy: lo llama Caddy con `Host: web:3000`, que no es ningún
// tenant. Ver docs/decisions/0003-tls-check-fuera-del-proxy.md.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/tls-check).*)"],
};
