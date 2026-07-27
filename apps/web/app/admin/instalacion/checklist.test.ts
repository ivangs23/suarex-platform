import { describe, expect, it } from "vitest";
import type { SetupFacts } from "./checklist";
import { buildSetupChecklist, isSetupComplete } from "./checklist";

/**
 * Lo que se prueba aquí no es que la lista se pinte, sino que DIGA LA VERDAD: que no dé por listo
 * un cliente al que le falta algo, y que no le pida a un cliente de solo QR cosas de totem.
 *
 * Las dos direcciones importan por igual. Un falso "listo" se descubre con la cocina esperando
 * comandas; un falso "falta" hace que la lista deje de leerse, y entonces ya da igual lo que diga.
 */

/** Un cliente completo de solo QR: una instalación viva, cocina y barra cubiertas. */
function base(over: Partial<SetupFacts> = {}): SetupFacts {
  return {
    channels: ["qr-mesa"],
    venueCount: 1,
    productCount: 12,
    tableCount: 8,
    devices: [
      {
        id: "d1",
        name: "Mostrador",
        roles: ["agente"],
        paired: true,
        lastSeenAgoMs: 5_000,
        terminalId: null,
      },
    ],
    printers: [
      {
        id: "p1",
        name: "Cocina",
        destination: "all",
        enabled: true,
        deviceId: "d1",
        network: true,
      },
    ],
    payment: { configured: false, missing: [], mock: true },
    ...over,
  };
}

const estado = (items: ReturnType<typeof buildSetupChecklist>, id: string) =>
  items.find((item) => item.id === id)?.status;
const ids = (items: ReturnType<typeof buildSetupChecklist>) => items.map((item) => item.id);

describe("un cliente de solo QR bien montado", () => {
  it("no le falta nada", () => {
    const items = buildSetupChecklist(base());
    expect(isSetupComplete(items)).toBe(true);
  });

  it("NO se le pide nada del totem", () => {
    /* Pedirle un datáfono a quien solo tiene carta por QR es la forma más rápida de que la lista
       se lea como ruido y deje de mirarse. */
    const items = ids(buildSetupChecklist(base()));
    expect(items).not.toContain("rol-totem");
    expect(items).not.toContain("pago");
    expect(items).not.toContain("recibo");
    expect(items).not.toContain("modo-real");
  });
});

describe("lo que impide dar por terminada una instalación", () => {
  it("sin ningún canal encendido", () => {
    const items = buildSetupChecklist(base({ channels: [] }));
    expect(estado(items, "canales")).toBe("falta");
    expect(isSetupComplete(items)).toBe(false);
  });

  it("sin productos en la carta", () => {
    expect(estado(buildSetupChecklist(base({ productCount: 0 })), "carta")).toBe("falta");
  });

  it("con canal QR y sin mesas: no hay QR que pegar", () => {
    expect(estado(buildSetupChecklist(base({ tableCount: 0 })), "mesas")).toBe("falta");
  });

  it("sin mesas pero SIN canal QR no se dice nada: no hacen falta", () => {
    const items = buildSetupChecklist(base({ channels: ["kiosko"], tableCount: 0 }));
    expect(ids(items)).not.toContain("mesas");
  });

  it("sin ninguna instalación emparejada", () => {
    expect(estado(buildSetupChecklist(base({ devices: [] })), "dispositivo")).toBe("falta");
  });

  it("sin impresora para un destino: esas comandas no salen por ningún sitio", () => {
    const soloCocina = base({
      printers: [
        {
          id: "p1",
          name: "Cocina",
          destination: "cocina",
          enabled: true,
          deviceId: "d1",
          network: true,
        },
      ],
    });
    const items = buildSetupChecklist(soloCocina);
    expect(estado(items, "impresoras")).toBe("falta");
    expect(items.find((i) => i.id === "impresoras")?.detail).toContain("barra");
  });

  it("una impresora deshabilitada no cuenta como cubierta", () => {
    const apagada = base({
      printers: [
        {
          id: "p1",
          name: "Cocina",
          destination: "all",
          enabled: false,
          deviceId: "d1",
          network: true,
        },
      ],
    });
    expect(estado(buildSetupChecklist(apagada), "impresoras")).toBe("falta");
  });
});

describe("un dispositivo emparejado pero mudo", () => {
  it("sale como AVISO, no como falta: está instalado, pero no da señales", () => {
    /* Emparejado no es lo mismo que vivo: un PC apagado o sin red sigue constando emparejado para
       siempre. Es la diferencia entre irse del local tranquilo o volver mañana. */
    const mudo = base({
      devices: [
        {
          id: "d1",
          name: "Mostrador",
          roles: ["agente"],
          paired: true,
          lastSeenAgoMs: 60 * 60 * 1000,
          terminalId: null,
        },
      ],
    });
    const items = buildSetupChecklist(mudo);
    expect(estado(items, "dispositivo")).toBe("aviso");
    expect(items.find((i) => i.id === "dispositivo")?.detail).toContain("Mostrador");
    // Un aviso no bloquea: puede estar apagado a propósito mientras se configura.
    expect(isSetupComplete(items)).toBe(true);
  });

  it("uno que nunca dio señal también avisa", () => {
    const nunca = base({
      devices: [
        {
          id: "d1",
          name: "Mostrador",
          roles: ["agente"],
          paired: true,
          lastSeenAgoMs: null,
          terminalId: null,
        },
      ],
    });
    expect(estado(buildSetupChecklist(nunca), "dispositivo")).toBe("aviso");
  });
});

describe("reparto de impresoras entre instalaciones", () => {
  const dosInstalaciones = (deviceId: string | null) =>
    base({
      channels: ["qr-mesa", "kiosko"],
      devices: [
        {
          id: "d1",
          name: "Mostrador",
          roles: ["agente"],
          paired: true,
          lastSeenAgoMs: 1000,
          terminalId: null,
        },
        {
          id: "d2",
          name: "Totem",
          roles: ["agente", "kiosko"],
          paired: true,
          lastSeenAgoMs: 1000,
          terminalId: "TERM-1",
        },
      ],
      printers: [
        { id: "p1", name: "Cocina", destination: "all", enabled: true, deviceId, network: true },
        {
          id: "p2",
          name: "Recibos",
          destination: "recibo",
          enabled: true,
          deviceId: "d2",
          network: true,
        },
      ],
      payment: { configured: true, missing: [], mock: false },
    });

  it("con dos instalaciones y una impresora sin dueño, avisa de que se duplicará", () => {
    const items = buildSetupChecklist(dosInstalaciones(null));
    expect(estado(items, "reparto")).toBe("falta");
    expect(items.find((i) => i.id === "reparto")?.detail).toContain("repetido");
  });

  it("asignada, no se dice nada", () => {
    expect(ids(buildSetupChecklist(dosInstalaciones("d1")))).not.toContain("reparto");
  });

  it("con UNA sola instalación no se molesta: no hay nada que repartir", () => {
    const una = base({
      printers: [
        {
          id: "p1",
          name: "Cocina",
          destination: "all",
          enabled: true,
          deviceId: null,
          network: true,
        },
      ],
    });
    expect(ids(buildSetupChecklist(una))).not.toContain("reparto");
  });
});

describe("lo propio del totem", () => {
  const conTotem = (over: Partial<SetupFacts> = {}) =>
    buildSetupChecklist(
      base({
        channels: ["qr-mesa", "kiosko"],
        devices: [
          {
            id: "d1",
            name: "Totem",
            roles: ["agente", "kiosko"],
            paired: true,
            lastSeenAgoMs: 1000,
            terminalId: "TERM-1",
          },
        ],
        printers: [
          {
            id: "p1",
            name: "Cocina",
            destination: "all",
            enabled: true,
            deviceId: "d1",
            network: true,
          },
          {
            id: "p2",
            name: "Recibos",
            destination: "recibo",
            enabled: true,
            deviceId: "d1",
            network: true,
          },
        ],
        payment: { configured: true, missing: [], mock: false },
        ...over,
      }),
    );

  it("bien montado, no le falta nada", () => {
    expect(isSetupComplete(conTotem())).toBe(true);
  });

  it("con el canal encendido pero sin ninguna instalación con rol de totem", () => {
    const items = conTotem({
      devices: [
        {
          id: "d1",
          name: "Mostrador",
          roles: ["agente"],
          paired: true,
          lastSeenAgoMs: 1000,
          terminalId: null,
        },
      ],
    });
    expect(estado(items, "rol-totem")).toBe("falta");
  });

  it("con rol de totem pero sin datáfono asignado", () => {
    const items = conTotem({
      devices: [
        {
          id: "d1",
          name: "Totem",
          roles: ["agente", "kiosko"],
          paired: true,
          lastSeenAgoMs: 1000,
          terminalId: null,
        },
      ],
    });
    expect(estado(items, "rol-totem")).toBe("falta");
    expect(items.find((i) => i.id === "rol-totem")?.detail).toContain("Totem");
  });

  it("sin impresora de recibos: el cliente se va sin su código", () => {
    const items = conTotem({
      printers: [
        {
          id: "p1",
          name: "Cocina",
          destination: "all",
          enabled: true,
          deviceId: "d1",
          network: true,
        },
      ],
    });
    expect(estado(items, "recibo")).toBe("falta");
  });

  it("sin método de pago configurado", () => {
    const items = conTotem({ payment: { configured: false, missing: [], mock: false } });
    expect(estado(items, "pago")).toBe("falta");
  });

  it("con el método puesto pero campos sin rellenar, dice CUÁLES", () => {
    const items = conTotem({
      payment: { configured: true, missing: ["Clave secreta"], mock: false },
    });
    expect(estado(items, "pago")).toBe("falta");
    expect(items.find((i) => i.id === "pago")?.detail).toContain("Clave secreta");
  });

  it("el modo pruebas es un AVISO, no una falta: es como debe estar mientras se instala", () => {
    const items = conTotem({ payment: { configured: true, missing: [], mock: true } });
    expect(estado(items, "modo-real")).toBe("aviso");
    // No bloquea, pero se queda a la vista: irse dejándolo puesto es un totem que regala comida.
    expect(isSetupComplete(items)).toBe(true);
  });

  it("quitado el modo pruebas, el aviso desaparece", () => {
    expect(ids(conTotem())).not.toContain("modo-real");
  });
});

describe("isSetupComplete", () => {
  it("una falta lo impide; un aviso no", () => {
    expect(isSetupComplete([{ id: "x", label: "X", status: "falta" }])).toBe(false);
    expect(isSetupComplete([{ id: "x", label: "X", status: "aviso" }])).toBe(true);
    expect(isSetupComplete([{ id: "x", label: "X", status: "ok" }])).toBe(true);
  });
});
