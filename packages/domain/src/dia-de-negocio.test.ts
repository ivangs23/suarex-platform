import { describe, expect, it } from "vitest";
import { diaEnZona, horaEnZona, limitesDelDia } from "./dia-de-negocio.js";

const MADRID = "Europe/Madrid";
const CANARIAS = "Atlantic/Canary";

const horas = ({ desde, hasta }: { desde: Date; hasta: Date }) =>
  (hasta.getTime() - desde.getTime()) / 3_600_000;

describe("limitesDelDia", () => {
  it("un día normal de verano en Madrid empieza a las 22:00 UTC del anterior", () => {
    const dia = limitesDelDia("2026-10-23", MADRID);
    expect(dia.desde.toISOString()).toBe("2026-10-22T22:00:00.000Z");
    expect(dia.hasta.toISOString()).toBe("2026-10-23T22:00:00.000Z");
  });

  it("el día que acaba el horario de verano dura 25 horas", () => {
    // 25-oct-2026: a las 03:00 se vuelve a las 02:00. Con `+02:00` fijo, desde ese día cada
    // cierre se llevaba la última hora del anterior y perdía la suya.
    const dia = limitesDelDia("2026-10-25", MADRID);
    expect(dia.desde.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(dia.hasta.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(horas(dia)).toBe(25);
  });

  it("en invierno el día empieza a las 23:00 UTC del anterior", () => {
    const dia = limitesDelDia("2026-10-26", MADRID);
    expect(dia.desde.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(horas(dia)).toBe(24);
  });

  it("el día que empieza el horario de verano dura 23 horas", () => {
    const dia = limitesDelDia("2026-03-29", MADRID);
    expect(dia.desde.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(dia.hasta.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(horas(dia)).toBe(23);
  });

  it("en Canarias va una hora por detrás de la península", () => {
    expect(limitesDelDia("2026-10-23", CANARIAS).desde.toISOString()).toBe(
      "2026-10-22T23:00:00.000Z",
    );
  });

  it("cruza meses y años", () => {
    expect(limitesDelDia("2026-12-31", MADRID).hasta.toISOString()).toBe(
      "2026-12-31T23:00:00.000Z",
    );
  });
});

describe("diaEnZona y horaEnZona", () => {
  it("las 23:30 UTC ya son el día siguiente en Madrid", () => {
    // Un pedido a las 00:30 en el local es de ESE día, aunque en UTC sea todavía el anterior.
    const instante = new Date("2026-10-22T22:30:00Z");
    expect(diaEnZona(instante, MADRID)).toBe("2026-10-23");
    expect(horaEnZona(instante, MADRID)).toBe(0);
  });

  it("la misma hora UTC es distinta en Madrid y en Canarias", () => {
    const instante = new Date("2026-10-23T12:00:00Z");
    expect(horaEnZona(instante, MADRID)).toBe(14);
    expect(horaEnZona(instante, CANARIAS)).toBe(13);
  });

  it("la hora repetida del cambio de hora se cuenta como 02:00 las dos veces", () => {
    expect(horaEnZona(new Date("2026-10-25T00:30:00Z"), MADRID)).toBe(2);
    expect(horaEnZona(new Date("2026-10-25T01:30:00Z"), MADRID)).toBe(2);
  });
});
