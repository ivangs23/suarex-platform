import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  instalarLogDeFichero,
  type LogBackend,
  redactar,
  registrarLinea,
  TAMANO_MAXIMO,
} from "./log-file.js";

/** Backend en memoria con la misma forma que el de disco. */
function backendFalso(): LogBackend & { actual: string; anterior: string } {
  return {
    actual: "",
    anterior: "",
    size() {
      return Buffer.byteLength(this.actual, "utf8");
    },
    append(linea: string) {
      this.actual += linea;
    },
    rotate() {
      this.anterior = this.actual;
      this.actual = "";
    },
    read() {
      return this.anterior + this.actual;
    },
  };
}

const AHORA = new Date("2026-09-24T18:30:00Z");

describe("registrarLinea", () => {
  it("escribe nivel, hora y mensaje en una línea", () => {
    const b = backendFalso();
    registrarLinea(b, "error", "la impresora no responde", AHORA);

    expect(b.actual).toContain("2026-09-24T18:30:00.000Z");
    expect(b.actual).toContain("ERROR");
    expect(b.actual).toContain("la impresora no responde");
    expect(b.actual.endsWith("\n"), "una línea por entrada").toBe(true);
  });

  it("rota cuando el fichero pasa del tope", () => {
    // El agente corre meses sin que nadie mire. Sin rotación, el log crece hasta llenar el
    // disco del PC de la cocina -- que es el único disco que hay.
    const b = backendFalso();
    b.actual = "x".repeat(TAMANO_MAXIMO + 1);

    registrarLinea(b, "info", "nueva", AHORA);

    expect(b.anterior.length, "lo viejo se conserva UNA generación").toBe(TAMANO_MAXIMO + 1);
    expect(b.actual).toContain("nueva");
    expect(b.actual.length, "el actual arranca limpio").toBeLessThan(200);
  });

  it("no rota por debajo del tope", () => {
    const b = backendFalso();
    b.actual = "x".repeat(TAMANO_MAXIMO - 1000);
    registrarLinea(b, "info", "cabe", AHORA);
    expect(b.anterior).toBe("");
  });

  it("un backend que revienta no propaga el fallo", () => {
    // Disco lleno, permisos, antivirus. Perder el log es malo; dejar de imprimir es peor.
    const roto: LogBackend = {
      size: () => {
        throw new Error("disco lleno");
      },
      append: () => {
        throw new Error("disco lleno");
      },
      rotate: () => {
        throw new Error("disco lleno");
      },
      read: () => "",
    };
    expect(() => registrarLinea(roto, "error", "algo", AHORA)).not.toThrow();
  });
});

describe("redactar", () => {
  // El log se escribe para que se pueda MANDAR a soporte por correo. Si puede llevar un
  // secreto dentro, no se puede mandar, y entonces no sirve para nada.
  it("tapa un JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
    const salida = redactar(`fallo con token ${jwt} al refrescar`);
    expect(salida).not.toContain(jwt);
    expect(salida).toContain("[oculto]");
    expect(salida, "el resto de la línea sigue siendo legible").toContain("al refrescar");
  });

  it("tapa el valor de una clave sensible, escrita de varias formas", () => {
    expect(redactar('{"password":"abc123"}')).not.toContain("abc123");
    expect(redactar("password=abc123")).not.toContain("abc123");
    expect(redactar('apikey: "sk_live_xyz"')).not.toContain("sk_live_xyz");
    expect(redactar('{"authorization":"Bearer zzz"}')).not.toContain("zzz");
  });

  it("no toca un texto normal", () => {
    const normal = "impresas 3 comandas en EPSON TM-T20";
    expect(redactar(normal)).toBe(normal);
  });
});

describe("instalarLogDeFichero", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("captura lo que ya se escribe por consola, sin tocar los sitios que lo escriben", () => {
    // Se intercepta `console` en vez de reescribir los nueve puntos que hoy loguean: así
    // cualquier traza que alguien añada mañana acaba en el fichero sin que tenga que
    // acordarse de nada.
    const b = backendFalso();
    const espia = vi.spyOn(console, "error").mockImplementation(() => {});
    const antesDeInstalar = console.error;

    const desinstalar = instalarLogDeFichero(b, () => AHORA);
    console.error("[main] excepción no capturada:", "detalle");
    desinstalar();

    expect(b.actual).toContain("[main] excepción no capturada:");
    expect(b.actual).toContain("detalle");
    expect(espia, "sigue llegando a la consola de siempre").toHaveBeenCalled();
    expect(console.error, "al desinstalar se devuelve lo que había").toBe(antesDeInstalar);
  });

  it("redacta también lo que llega por consola", () => {
    const b = backendFalso();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const desinstalar = instalarLogDeFichero(b, () => AHORA);
    console.error('credenciales {"password":"secretísima"}');
    desinstalar();

    expect(b.actual).not.toContain("secretísima");
  });

  it("un fallo escribiendo el log no rompe la llamada a console", () => {
    const roto: LogBackend = {
      size: () => 0,
      append: () => {
        throw new Error("disco lleno");
      },
      rotate: () => {},
      read: () => "",
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    const desinstalar = instalarLogDeFichero(roto, () => AHORA);
    expect(() => console.error("algo")).not.toThrow();
    desinstalar();
  });
});
