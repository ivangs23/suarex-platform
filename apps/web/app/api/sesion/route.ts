import { NextResponse } from "next/server";
import { parseJsonBody, peticionInvalida, sesionSchema } from "@/lib/api-input";
import { resolveStaffSession, type StaffAuthClient } from "@/lib/staff-session";
import { staffServerClient } from "@/lib/supabase-server";
import { type ResolvedTenant, requireTenant } from "@/lib/tenant-context";

/**
 * `/api/sesion`: la sesión de una PERSONA en las páginas que incrusta la app de escritorio
 * (Comandas, Productos, Cierre). La app inicia sesión en Auth y entrega aquí los tokens, nunca
 * la contraseña; la web los guarda en sus cookies, igual que tras `/staff/login`.
 *
 * - `POST { accessToken, refreshToken }`: abre la sesión si la cuenta es del personal de ESTE
 *   negocio. Si no, la cierra y responde el mismo 401 en todos los casos (ver
 *   `resolveStaffSession`, que no distingue por qué no vale).
 * - `GET`: quién está dentro, `{ rol, email }`, o 401.
 * - `DELETE`: cierra la sesión, también en Auth.
 *
 * El rol `device` no abre sesión aquí: sus credenciales son del PC, no de una persona.
 */

const SIN_CACHE = { "Cache-Control": "no-store" };

type Quien = { rol: "owner" | "admin" | "staff"; email: string | null };

function sinAcceso() {
  return NextResponse.json(
    { error: "Sin acceso a este negocio" },
    { status: 401, headers: SIN_CACHE },
  );
}

/** Solo `application/json`: un formulario de otra web no puede mandarlo sin preflight de CORS. */
function esJson(request: Request): boolean {
  const tipo = request.headers.get("content-type") ?? "";
  return tipo.split(";")[0]?.trim().toLowerCase() === "application/json";
}

async function quien(
  client: StaffAuthClient,
  tenant: ResolvedTenant,
  jwt?: string,
): Promise<Quien | null> {
  const sesion = await resolveStaffSession(client, tenant, jwt);
  if (!sesion || sesion.role === "device") return null;
  const { data } = await client.auth.getClaims(jwt);
  const email = data?.claims.email;
  return { rol: sesion.role, email: typeof email === "string" ? email : null };
}

export async function GET() {
  const tenant = await requireTenant();
  const client = await staffServerClient();
  const persona = await quien(client, tenant);
  if (!persona) return sinAcceso();
  return NextResponse.json(persona, { headers: SIN_CACHE });
}

export async function POST(request: Request) {
  if (!esJson(request)) return peticionInvalida();
  const body = await parseJsonBody(request, sesionSchema);
  if (!body.ok) return body.response;

  const tenant = await requireTenant();
  const client = await staffServerClient();
  const { data, error } = await client.auth.setSession({
    access_token: body.data.accessToken,
    refresh_token: body.data.refreshToken,
  });
  if (error || !data.session) return sinAcceso();

  // Con el token que acaba de quedar en la sesión: releer las cookies en esta misma petición
  // dependería de que Next devuelva lo recién escrito.
  const persona = await quien(client, tenant, data.session.access_token);
  if (!persona) {
    await client.auth.signOut({ scope: "local" }).catch(() => {});
    return sinAcceso();
  }
  return NextResponse.json(persona, { headers: SIN_CACHE });
}

export async function DELETE() {
  const client = await staffServerClient();
  // Sin sesión no hay nada que cerrar, y no es un error.
  await client.auth.signOut({ scope: "local" }).catch(() => {});
  return new NextResponse(null, { status: 204, headers: SIN_CACHE });
}
