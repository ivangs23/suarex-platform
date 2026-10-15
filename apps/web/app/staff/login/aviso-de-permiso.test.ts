import { describe, expect, it } from "vitest";
import { avisoDePermiso } from "./aviso-de-permiso";

describe("avisoDePermiso", () => {
  it("al personal que pide una sección de gestión le dice por qué está en el login", () => {
    expect(avisoDePermiso({ role: "staff" }, "/admin/catalogo")).toMatch(/encargado/);
    expect(avisoDePermiso({ role: "staff" }, "/admin")).toMatch(/encargado/);
  });

  it("sin sesión no dice nada: es el login de siempre", () => {
    expect(avisoDePermiso(null, "/admin/catalogo")).toBeNull();
  });

  it("a quien ya gestiona no le hace falta", () => {
    expect(avisoDePermiso({ role: "owner" }, "/admin/catalogo")).toBeNull();
    expect(avisoDePermiso({ role: "admin" }, "/admin/cierre")).toBeNull();
  });

  it("si no iba a gestión, no hay nada que explicar", () => {
    expect(avisoDePermiso({ role: "staff" }, "/staff")).toBeNull();
    // Un prefijo parecido no es gestión.
    expect(avisoDePermiso({ role: "staff" }, "/administracion")).toBeNull();
  });
});
