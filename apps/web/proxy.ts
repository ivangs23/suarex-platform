import { resolveRootDomains } from "@suarex/config";
import { findTenantByHost } from "@suarex/db";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

// Ver resolveRootDomains (@suarex/config/tenant-host.ts): recorta y descarta entradas
// vacías, y lanza fuera de `development` si la variable no está definida en vez de
// defaultear en silencio a "localhost" (ver su docstring para los dos modos de fallo que
// esto cierra).
const ROOT_DOMAINS = resolveRootDomains(process.env);

const TENANT_ID_HEADER = "x-suarex-tenant-id";
const TENANT_SLUG_HEADER = "x-suarex-tenant-slug";

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

  // `getUser()` verifica el JWT contra el servidor de Auth y, si hace falta,
  // rota el refresh token -- exactamente lo que hace falta aquí (mantener viva
  // la sesión), sin tomar ninguna decisión de autorización: esa decisión sigue
  // viviendo en `getStaffSession()` (apps/web/lib/supabase-server.ts), que lee
  // el claim `tenant_id` ya verificado, nunca en este middleware.
  //
  // Envuelto en try/catch a propósito, en profundidad: `@supabase/auth-js`
  // (verificado contra su fuente instalada, v2.110.7) ya envuelve internamente
  // los fallos de red del propio fetch como `AuthRetryableFetchError` (un
  // `AuthError` reconocido) y los devuelve como `{ data, error }` en vez de
  // lanzarlos -- confirmado también empíricamente aquí apuntando
  // `NEXT_PUBLIC_SUPABASE_URL` a un host inalcanzable/inexistente con el dev
  // server real corriendo (ver informe, sección "Fix round 1"): ninguna de
  // esas pruebas produjo un throw sin capturar. Pero esa garantía es interna
  // de auth-js, no de este código: `_getUser` solo evita relanzar errores que
  // `isAuthError` reconoce, así que cualquier excepción de OTRO tipo --p. ej.
  // una que viniera de nuestro propio adaptador de cookies (`request.cookies.getAll()`/
  // `response.cookies.set()`), o de una versión futura de la librería que ya
  // no envuelva algún fallo como AuthError-- sí se propagaría sin capturar.
  // Este try/catch cierra esa vía de una vez, para que NINGÚN fallo al
  // refrescar la sesión pueda convertirse en un 500 incondicional para CADA
  // petición a /staff/*, incluida /staff/login -- eso bloquearía incluso el
  // intento de volver a iniciar sesión. Degradamos con gracia: la sesión
  // simplemente no se refresca en esta petición (el usuario podría necesitar
  // reautenticarse si su access token ya expiró), pero la petición sigue
  // sirviéndose con normalidad. Esto no relaja ninguna autorización:
  // `getStaffSession()` sigue fallando cerrado si el JWT ya no es válido.
  try {
    await supabase.auth.getUser();
  } catch {
    // Degradación intencional -- ver comentario de arriba. Nada que
    // propagar: la petición continúa sin la sesión refrescada.
  }
}

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  let tenant: Awaited<ReturnType<typeof findTenantByHost>>;
  try {
    tenant = await findTenantByHost(host, ROOT_DOMAINS);
  } catch {
    // Fallo de infraestructura: 503, nunca servir el tenant equivocado.
    //
    // No pasamos `request: { headers }` aquí a propósito, y no es un
    // descuido: `new NextResponse(...)` (constructor plano, no `.rewrite()`/
    // `.next()`) nunca activa `x-middleware-override-headers` -- de hecho su
    // tipo (`ResponseInit`, no `MiddlewareResponseInit`) ni siquiera acepta
    // `request` en TypeScript estricto. Pero eso no importa para la seguridad
    // de esta rama: como esta respuesta no fija `x-middleware-rewrite` ni
    // `x-middleware-next` ni `location`, el router de Next la trata como
    // terminal (`x-middleware-refresh`) y devuelve su body tal cual, sin
    // enrutar a ninguna página/layout. Ninguna cabecera de request -- forjada
    // o no -- llega nunca a `requireTenant()` por esta vía porque ninguna
    // página se renderiza. Verificado contra el código fuente de Next
    // (`resolve-routes.js`) y con curl (ver informe).
    return new NextResponse("Servicio no disponible", { status: 503 });
  }

  if (!tenant) {
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

  const response = NextResponse.next({ request: { headers } });

  if (request.nextUrl.pathname.startsWith("/staff")) {
    await refreshStaffSession(request, response);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
