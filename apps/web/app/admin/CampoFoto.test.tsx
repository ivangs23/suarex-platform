import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_BYTES_IMAGEN } from "@suarex/domain";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { avisoDeTamano, CampoFoto } from "./CampoFoto";

/**
 * El campo de foto avisa ANTES de enviar si la foto pasa del máximo que acepta el servidor. Lo
 * que hace en el navegador (bloquear el envío) lo prueba el e2e de `admin-catalogo-editar`.
 */

describe("avisoDeTamano", () => {
  it("una foto en el máximo cabe", () => {
    expect(avisoDeTamano(MAX_BYTES_IMAGEN)).toBe("");
    expect(avisoDeTamano(0)).toBe("");
  });

  it("una foto que se pasa dice cuánto pesa y cuál es el máximo", () => {
    expect(avisoDeTamano(16_000_000)).toBe(
      "La foto pesa 15,3 MB y el máximo son 15 MB. Elige otra o redúcela.",
    );
    expect(avisoDeTamano(MAX_BYTES_IMAGEN + 1)).not.toBe("");
  });
});

describe("CampoFoto", () => {
  it("pide solo los tipos que acepta el servidor", () => {
    const html = renderToStaticMarkup(<CampoFoto name="logo" />);
    expect(html).toContain('type="file"');
    expect(html).toContain('name="logo"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp"');
  });

  it("es el único campo de fichero de la web", () => {
    // Un `<input type="file">` suelto subiría sin avisar del tamaño ni acotar los tipos.
    const app = join(import.meta.dirname, "..");
    const sueltos: string[] = [];
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(entrada.name) && !/CampoFoto(\.test)?\.tsx$/.test(entrada.name)) {
          if (/type="file"/.test(readFileSync(ruta, "utf8"))) sueltos.push(ruta);
        }
      }
    };
    recorrer(app);
    expect(sueltos).toEqual([]);
  });
});
