import { describe, expect, it } from "vitest";
import {
  diaEnLaSede,
  direccionEnTexto,
  enlaceDeTelefono,
  nombresDeLosDias,
  tramoEnTexto,
} from "./ficha.js";

describe("diaEnLaSede", () => {
  it("el día es el de la zona de la sede: Canarias va una hora por detrás de Madrid", () => {
    // Jueves 29-10-2026 a las 23:30 UTC: en Madrid ya son las 00:30 del viernes.
    const instante = new Date("2026-10-29T23:30:00Z");
    expect(diaEnLaSede(instante, "Europe/Madrid")).toBe("fr");
    expect(diaEnLaSede(instante, "Atlantic/Canary")).toBe("th");
  });

  it("el domingo es el último día de la semana", () => {
    expect(diaEnLaSede(new Date("2026-11-01T12:00:00Z"), "Europe/Madrid")).toBe("su");
    expect(diaEnLaSede(new Date("2026-11-02T12:00:00Z"), "Europe/Madrid")).toBe("mo");
  });
});

describe("nombresDeLosDias", () => {
  it("salen del idioma de la carta, empezando en lunes", () => {
    expect(nombresDeLosDias("es").mo).toBe("lunes");
    expect(nombresDeLosDias("en").su).toBe("Sunday");
    expect(nombresDeLosDias("pt").th).toBe("quinta-feira");
  });
});

describe("tramoEnTexto", () => {
  it("formatea las horas en el idioma de la carta, también pasada la medianoche", () => {
    expect(tramoEnTexto(["13:00", "16:00"], "es")).toBe("13:00–16:00");
    expect(tramoEnTexto(["20:00", "02:00"], "en")).toBe("8:00 PM–2:00 AM");
  });
});

describe("direccionEnTexto", () => {
  const vacia = { street: null, postalCode: null, city: null, region: null, phone: null };

  it("calle, código postal y ciudad; la provincia solo si no es la ciudad", () => {
    expect(
      direccionEnTexto({
        ...vacia,
        street: "Calle Larios 5",
        postalCode: "29005",
        city: "Málaga",
        region: "Málaga",
        openingHours: null,
      }),
    ).toBe("Calle Larios 5, 29005 Málaga");
    expect(
      direccionEnTexto({ ...vacia, city: "Marbella", region: "Málaga", openingHours: null }),
    ).toBe("Marbella, Málaga");
  });

  it("sin datos, no hay dirección", () => {
    expect(direccionEnTexto({ ...vacia, openingHours: null })).toBeNull();
  });
});

describe("enlaceDeTelefono", () => {
  it("deja solo dígitos y el +", () => {
    expect(enlaceDeTelefono("+34 952.00.00-00")).toBe("tel:+34952000000");
  });
});
