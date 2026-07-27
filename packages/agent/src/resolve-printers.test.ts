import { describe, expect, it } from "vitest";
import { resolvePrintersFromRows } from "./run-agent.js";

/**
 * DE QUÉ IMPRESORAS SE ENCARGA CADA INSTALACIÓN.
 *
 * Un local puede tener varias instalaciones del mismo programa: el PC del mostrador con la carta
 * por QR y el totem con su datáfono. Las impresoras físicas son las MISMAS para los dos -- la de
 * cocina es una sola -- y lo que no puede ser compartido es quién le manda los bytes: si los dos
 * agentes entregan el mismo ticket, la cocina recibe la comanda dos veces.
 *
 * Y no es una carrera improbable: los dos reciben el mismo aviso de Realtime en el mismo instante
 * al pasar un pedido a pagado, así que sin esta regla el duplicado es lo normal, no lo raro.
 */

const MOSTRADOR = "dev-mostrador";
const TOTEM = "dev-totem";
const VENUE = "v1";

type Fila = Parameters<typeof resolvePrintersFromRows>[0][number];

function red(id: string, deviceId: string | null, destination: Fila["destination"]): Fila {
  return {
    id,
    venue_id: VENUE,
    device_id: deviceId,
    destination,
    connection: { type: "network", host: "10.0.0.1", port: 9100 },
  };
}

function usb(id: string, deviceId: string | null): Fila {
  return {
    id,
    venue_id: VENUE,
    device_id: deviceId,
    destination: "recibo",
    connection: { type: "usb", printerName: "TM-T20" },
  };
}

const ids = (rows: Fila[], deviceId: string | null) =>
  resolvePrintersFromRows(rows, deviceId).map((p) => p.id);

describe("reparto de impresoras entre instalaciones", () => {
  /** El caso real: un cliente con carta por QR en el mostrador y un totem con su recibo. */
  const local = [
    red("cocina", MOSTRADOR, "cocina"),
    red("barra", MOSTRADOR, "barra"),
    red("recibo", TOTEM, "recibo"),
  ];

  it("el mostrador saca cocina y barra, y NO el recibo del totem", () => {
    expect(ids(local, MOSTRADOR)).toEqual(["cocina", "barra"]);
  });

  it("el totem saca SOLO su recibo, aunque las de cocina estén en la misma red", () => {
    // Aquí es donde se evitaba el duplicado: el totem las alcanza perfectamente y aun así no las
    // toca, porque no son suyas.
    expect(ids(local, TOTEM)).toEqual(["recibo"]);
  });

  it("entre los dos cubren todas las impresoras, y ninguna sale dos veces", () => {
    const repartidas = [...ids(local, MOSTRADOR), ...ids(local, TOTEM)];
    expect(repartidas.sort()).toEqual(["barra", "cocina", "recibo"]);
    expect(new Set(repartidas).size).toBe(repartidas.length);
  });
});

describe("impresoras sin dueño", () => {
  const sinDuenno = [red("cocina", null, "cocina")];

  it("las saca cualquier agente: ningún cliente en marcha se queda mudo al desplegar esto", () => {
    expect(ids(sinDuenno, MOSTRADOR)).toEqual(["cocina"]);
    expect(ids(sinDuenno, TOTEM)).toEqual(["cocina"]);
  });

  it("y por eso con dos agentes SÍ se duplicaría: es lo que el panel tiene que avisar", () => {
    // Se deja escrito a propósito: no es un descuido, es el precio de no romper lo que ya rueda.
    const losDos = [...ids(sinDuenno, MOSTRADOR), ...ids(sinDuenno, TOTEM)];
    expect(losDos).toEqual(["cocina", "cocina"]);
  });

  it("un agente sin fila en devices sigue sacando las de red sin dueño", () => {
    // Instalación recién emparejada cuya fila aún no resuelve: mejor que imprima a que no.
    expect(ids(sinDuenno, null)).toEqual(["cocina"]);
  });
});

describe("impresoras USB", () => {
  it("solo las saca el PC al que están enchufadas", () => {
    const filas = [usb("usb-mostrador", MOSTRADOR)];
    expect(ids(filas, MOSTRADOR)).toEqual(["usb-mostrador"]);
    expect(ids(filas, TOTEM)).toEqual([]);
  });

  it("una USB SIN dueño no la reclama nadie, al revés que las de red", () => {
    /* En una USB el dueño no es una preferencia sino un hecho físico: está en UN cable. Sacarla
       desde otra máquina sería imprimir en un puerto que allí no existe. */
    expect(ids([usb("huerfana", null)], MOSTRADOR)).toEqual([]);
    expect(ids([usb("huerfana", null)], null)).toEqual([]);
  });
});

describe("filas que no se entienden", () => {
  it("un tipo de conexión desconocido se ignora en vez de romper el tick", () => {
    const rara = {
      id: "x",
      venue_id: VENUE,
      device_id: MOSTRADOR,
      destination: "cocina" as const,
      connection: { type: "bluetooth" },
    };
    expect(ids([rara], MOSTRADOR)).toEqual([]);
  });
});
