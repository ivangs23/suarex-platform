import type { FichaDeLaSede } from "@suarex/db";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type Lang, strings } from "@/lib/i18n";
import { FichaDelLocal } from "./FichaDelLocal";

/**
 * La ficha del local al pie de la carta. Lo que el cliente no ha guardado no se pinta: ni un
 * hueco, ni un «sin horario».
 */
const VACIA: FichaDeLaSede = {
  venueId: "sede",
  timezone: "Europe/Madrid",
  street: null,
  postalCode: null,
  city: null,
  region: null,
  phone: null,
  openingHours: null,
};

// Jueves 29-10-2026 a las 12:00 en Madrid.
const JUEVES = new Date("2026-10-29T11:00:00Z");

const render = (ficha: FichaDeLaSede | null, lang: Lang = "es", ahora = JUEVES) =>
  renderToStaticMarkup(
    <FichaDelLocal ficha={ficha} lang={lang} strings={strings(lang)} ahora={ahora} />,
  );

describe("FichaDelLocal", () => {
  it("sin ficha, o con la ficha vacía, no pinta nada", () => {
    expect(render(null)).toBe("");
    expect(render(VACIA)).toBe("");
  });

  it("solo con teléfono, pinta el teléfono y nada más", () => {
    const html = render({ ...VACIA, phone: "+34 952 000 000" });
    expect(html).toContain('href="tel:+34952000000"');
    expect(html).not.toContain("ficha-direccion");
    expect(html).not.toContain("<details");
  });

  it("dirección, horario de hoy y la semana con solo los días publicados", () => {
    const html = render({
      ...VACIA,
      street: "Calle Larios 5",
      postalCode: "29005",
      city: "Málaga",
      openingHours: {
        mo: [],
        th: [
          ["13:00", "16:00"],
          ["20:00", "23:30"],
        ],
      },
    });
    expect(html).toContain("Calle Larios 5, 29005 Málaga");
    expect(html).toContain("Hoy: 13:00–16:00, 20:00–23:30");
    expect(html).toContain("Ver horario");
    expect(html).toContain("<dt>lunes</dt><dd>Cerrado</dd>");
    expect(html).not.toContain("martes");
  });

  it("hoy es el de la sede: en Canarias aún es jueves cuando en Madrid ya es viernes", () => {
    const ficha: FichaDeLaSede = {
      ...VACIA,
      openingHours: { th: [["20:00", "02:00"]], fr: [] },
    };
    const instante = new Date("2026-10-29T23:30:00Z");
    expect(render(ficha, "es", instante)).toContain("Hoy: Cerrado");
    expect(render({ ...ficha, timezone: "Atlantic/Canary" }, "es", instante)).toContain(
      "Hoy: 20:00–2:00",
    );
  });

  it("un día sin publicar no se presenta como «hoy»: sale solo «Horario»", () => {
    const html = render({ ...VACIA, openingHours: { mo: [["13:00", "16:00"]] } });
    expect(html).toContain("Horario");
    expect(html).not.toContain("Hoy:");
  });

  it("habla el idioma de la carta", () => {
    const html = render({ ...VACIA, openingHours: { th: [] } }, "en");
    expect(html).toContain("Today: Closed");
    expect(html).toContain("See opening hours");
    expect(html).toContain("<dt>Thursday</dt>");
  });
});
