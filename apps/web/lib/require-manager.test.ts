import { describe, expect, it, vi } from "vitest";
import { isManagerRole, type ManagerSession, managerAction } from "./require-manager.js";

describe("isManagerRole", () => {
  it("owner y admin gestionan", () => {
    expect(isManagerRole("owner")).toBe(true);
    expect(isManagerRole("admin")).toBe(true);
  });
  it("staff y device no gestionan", () => {
    expect(isManagerRole("staff")).toBe(false);
    expect(isManagerRole("device")).toBe(false);
  });
});

/**
 * Fix round 1 (Finding 1): prueba que `managerAction` hace estructuralmente imposible que
 * el cuerpo de una action se ejecute sin que la comprobación de rol haya pasado antes --
 * en vez de confiar en que cada action recuerde escribir
 * `const session = await requireManager();` como primera línea a mano.
 *
 * `checkManager` se inyecta como stub (segundo argumento, ver el docstring de
 * `managerAction`) para no depender de cookies/headers de una request real de Next: lo
 * que se prueba aquí es la composición del wrapper, no `requireManager` en sí (esa ya
 * tiene su propio contrato -- redirige a `/staff/login` -- documentado y usado por el
 * resto de la app).
 */
describe("managerAction", () => {
  const session: ManagerSession = { userId: "u1", tenantId: "t1", role: "owner" };

  it("compone correctamente: llama al checker y pasa su sesión al cuerpo de la action", async () => {
    const checker = vi.fn().mockResolvedValue(session);
    const body = vi.fn().mockResolvedValue(undefined);
    const action = managerAction(body, checker);

    const formData = new FormData();
    await action(formData);

    expect(checker).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledTimes(1);
    expect(body).toHaveBeenCalledWith(session, formData);
  });

  it("el cuerpo de la action NO se ejecuta si el checker rechaza (no hay sesión de manager)", async () => {
    const checker = vi.fn().mockRejectedValue(new Error("redirect a /staff/login"));
    const body = vi.fn().mockResolvedValue(undefined);
    const action = managerAction(body, checker);

    await expect(action(new FormData())).rejects.toThrow("redirect a /staff/login");

    expect(checker).toHaveBeenCalledTimes(1);
    expect(body).not.toHaveBeenCalled();
  });

  it("preserva la firma (formData: FormData) => Promise<void> que usan los <form action>", async () => {
    const checker = vi.fn().mockResolvedValue(session);
    let seenTenantId: string | undefined;
    const action = managerAction(async (s, _formData: FormData) => {
      seenTenantId = s.tenantId;
    }, checker);

    const result = await action(new FormData());

    expect(result).toBeUndefined();
    expect(seenTenantId).toBe("t1");
  });
});
