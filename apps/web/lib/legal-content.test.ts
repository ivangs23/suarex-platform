import { describe, expect, it } from "vitest";
import { DOCUMENTOS_LEGALES, documentoLegal, esDocumentoLegal } from "./legal-content";

const DATOS = {
  businessName: "Bar Paco",
  legalName: "Paco SL",
  cif: "B12345678",
  address: "Calle Falsa 1, Madrid",
  phone: "600111222",
};

describe("esDocumentoLegal", () => {
  it("reconoce exactamente los tres slugs publicados", () => {
    expect(DOCUMENTOS_LEGALES).toEqual(["privacidad", "aviso-legal", "condiciones"]);
    for (const slug of DOCUMENTOS_LEGALES) expect(esDocumentoLegal(slug)).toBe(true);
  });

  it("rechaza cualquier otra cosa, incluido un slug manipulado en la URL", () => {
    // La ruta es /legal/[documento]: sin lista cerrada, un slug desconocido acabaría
    // sirviendo una página vacía con 200 en vez de un 404.
    expect(esDocumentoLegal("politica")).toBe(false);
    expect(esDocumentoLegal("../../etc/passwd")).toBe(false);
    expect(esDocumentoLegal("")).toBe(false);
    expect(esDocumentoLegal("PRIVACIDAD")).toBe(false);
  });
});

describe("documentoLegal", () => {
  it("nombra al restaurante como responsable y a SuarEx como encargado", () => {
    // El reparto de papeles es lo que hace válido el documento: el restaurante decide para
    // qué se usan los datos (responsable), SuarEx solo los trata por cuenta suya (encargado,
    // art. 28 RGPD). Invertirlo sería falso.
    const texto = JSON.stringify(documentoLegal("privacidad", DATOS));
    expect(texto).toContain("Paco SL");
    expect(texto).toContain("B12345678");
    expect(texto).toContain("responsable");
    expect(texto).toContain("SuarEx");
    expect(texto).toContain("encargado");
  });

  it("sigue siendo publicable si el tenant no ha rellenado sus datos fiscales", () => {
    // Un tenant recién dado de alta no tiene CIF. La página no puede romperse ni imprimir
    // "undefined" en un documento legal: cae al nombre comercial y omite lo que no hay.
    const texto = JSON.stringify(documentoLegal("privacidad", { businessName: "Bar Paco" }));
    expect(texto).toContain("Bar Paco");
    expect(texto).not.toContain("undefined");
    expect(texto).not.toContain("CIF");
  });

  it("los tres documentos traen título y al menos una sección con contenido", () => {
    for (const slug of DOCUMENTOS_LEGALES) {
      const doc = documentoLegal(slug, DATOS);
      expect(doc.titulo.trim(), `${slug} sin título`).not.toBe("");
      expect(doc.secciones.length, `${slug} sin secciones`).toBeGreaterThan(0);
      for (const seccion of doc.secciones) {
        expect(seccion.titulo.trim(), `${slug}: sección sin título`).not.toBe("");
        expect(seccion.parrafos.length, `${slug}/${seccion.titulo} sin párrafos`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it("la política de privacidad declara los plazos de retención que el cron ejecuta", () => {
    // Estos dos números no son decorativos: `purge_order_personal_data` (Task 7) los aplica.
    // Si alguien cambia uno sin el otro, la política miente. El test los ata.
    const texto = JSON.stringify(documentoLegal("privacidad", DATOS));
    expect(texto).toContain("90 días");
    expect(texto).toContain("24 meses");
  });

  it("las condiciones dicen que el justificante no es una factura", () => {
    // Misma decisión D1 que el recibo: el documento legal y el papel que recibe el comensal
    // tienen que decir lo mismo.
    expect(JSON.stringify(documentoLegal("condiciones", DATOS))).toContain("no es una factura");
  });
});
