import { findTenantByHost } from "@suarex/db";
import { type NextRequest, NextResponse } from "next/server";

const ROOT_DOMAINS = (process.env.TENANT_ROOT_DOMAINS ?? "localhost").split(",");

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

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
