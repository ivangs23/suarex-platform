import { findTenantByHost } from "@suarex/db";
import { type NextRequest, NextResponse } from "next/server";

const ROOT_DOMAINS = (process.env.TENANT_ROOT_DOMAINS ?? "localhost").split(",");

export async function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";

  let tenant: Awaited<ReturnType<typeof findTenantByHost>>;
  try {
    tenant = await findTenantByHost(host, ROOT_DOMAINS);
  } catch {
    // Fallo de infraestructura: 503, nunca servir el tenant equivocado.
    return new NextResponse("Servicio no disponible", { status: 503 });
  }

  if (!tenant) {
    return NextResponse.rewrite(new URL("/not-found", request.url), { status: 404 });
  }

  if (tenant.status === "suspended") {
    return NextResponse.rewrite(new URL("/suspended", request.url), { status: 503 });
  }

  const headers = new Headers(request.headers);
  headers.set("x-suarex-tenant-id", tenant.id);
  headers.set("x-suarex-tenant-slug", tenant.slug);

  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
