import { beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-1111-1111-111111111111";
const OTRO = "22222222-2222-2222-2222-222222222222";

const auth = vi.hoisted(() => ({
  setSession: vi.fn(),
  getClaims: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase-server", () => ({ staffServerClient: async () => ({ auth }) }));
vi.mock("@/lib/tenant-context", () => ({
  requireTenant: async () => ({ id: TENANT, slug: "garum" }),
}));

const { DELETE, GET, POST } = await import("./route");

/** Lo que devuelve `getClaims` para una cuenta con este rol en este tenant. */
function cuenta(role: string, tenantId = TENANT) {
  return {
    data: { claims: { sub: "u1", tenant_id: tenantId, tenant_role: role, email: "ana@garum.es" } },
    error: null,
  };
}

const SIN_SESION = { data: null, error: new Error("sin sesión") };

function post(cuerpo: unknown, tipo = "application/json") {
  return new Request("http://garum.localhost/api/sesion", {
    method: "POST",
    headers: { "content-type": tipo },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

const TOKENS = { accessToken: "a.b.c", refreshToken: "r1" };

beforeEach(() => {
  vi.clearAllMocks();
  auth.signOut.mockResolvedValue({ error: null });
  auth.setSession.mockResolvedValue({
    data: { session: { access_token: "a.b.c-nuevo" } },
    error: null,
  });
});

describe("GET /api/sesion", () => {
  it("dice quién está dentro y con qué rol, sin cachear", async () => {
    auth.getClaims.mockResolvedValue(cuenta("staff"));
    const respuesta = await GET();
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ rol: "staff", email: "ana@garum.es" });
    expect(respuesta.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["sin sesión", SIN_SESION],
    ["con una cuenta de otro negocio", cuenta("owner", OTRO)],
    ["con las credenciales del dispositivo", cuenta("device")],
  ])("%s: 401", async (_, claims) => {
    auth.getClaims.mockResolvedValue(claims);
    const respuesta = await GET();
    expect(respuesta.status).toBe(401);
  });
});

describe("POST /api/sesion", () => {
  it("abre la sesión con los tokens y verifica el token que queda en ella", async () => {
    auth.getClaims.mockResolvedValue(cuenta("owner"));
    const respuesta = await POST(post(TOKENS));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual({ rol: "owner", email: "ana@garum.es" });
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "a.b.c", refresh_token: "r1" });
    expect(auth.getClaims).toHaveBeenCalledWith("a.b.c-nuevo");
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it.each([
    ["una cuenta de otro negocio", cuenta("owner", OTRO)],
    ["las credenciales del dispositivo", cuenta("device")],
    ["un token que no se puede verificar", SIN_SESION],
  ])("con %s la cierra y responde 401", async (_, claims) => {
    auth.getClaims.mockResolvedValue(claims);
    const respuesta = await POST(post(TOKENS));
    expect(respuesta.status).toBe(401);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("si Auth no acepta los tokens, 401", async () => {
    auth.setSession.mockResolvedValue({ data: { session: null }, error: new Error("caducado") });
    const respuesta = await POST(post(TOKENS));
    expect(respuesta.status).toBe(401);
    expect(auth.getClaims).not.toHaveBeenCalled();
  });

  it.each([
    ["JSON roto", "{no", "application/json"],
    ["sin el refresh token", { accessToken: "a.b.c" }, "application/json"],
    ["tokens vacíos", { accessToken: "", refreshToken: "" }, "application/json"],
    // Lo que puede mandar un formulario de otra web sin pasar por CORS.
    ["como texto plano", TOKENS, "text/plain"],
    ["como formulario", TOKENS, "application/x-www-form-urlencoded"],
  ])("%s: 400 sin tocar Auth", async (_, cuerpo, tipo) => {
    const respuesta = await POST(post(cuerpo, tipo));
    expect(respuesta.status).toBe(400);
    expect(auth.setSession).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/sesion", () => {
  it("cierra la sesión también en Auth", async () => {
    const respuesta = await DELETE();
    expect(respuesta.status).toBe(204);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("sin sesión no falla", async () => {
    auth.signOut.mockRejectedValue(new Error("sin sesión"));
    expect((await DELETE()).status).toBe(204);
  });
});
