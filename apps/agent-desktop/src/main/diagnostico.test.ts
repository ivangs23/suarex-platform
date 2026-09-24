import { describe, expect, it } from "vitest";
import { componerDiagnostico, nombreDeFicheroDiagnostico } from "./diagnostico.js";

const DATOS = {
  version: "1.4.2",
  plataforma: "win32",
  emparejado: true,
  enMarcha: true,
  deviceId: "dev-123",
  tenantId: "ten-456",
  impresorasCaidas: ["EPSON TM-T20"],
  ultimoError: "fetch failed",
  generadoEn: new Date("2026-09-24T18:30:00Z"),
};

describe("componerDiagnostico", () => {
  it("lleva delante lo que soporte pregunta siempre", () => {
    // Versión, plataforma y si está emparejado y en marcha. Sin esto, el primer correo de
    // vuelta es siempre el mismo: "¿qué versión tienes?".
    const texto = componerDiagnostico(DATOS, "");
    expect(texto).toContain("1.4.2");
    expect(texto).toContain("win32");
    expect(texto).toContain("dev-123");
    expect(texto).toContain("ten-456");
    expect(texto).toContain("EPSON TM-T20");
    expect(texto).toContain("fetch failed");
  });

  it("NO lleva las credenciales del dispositivo", () => {
    // Este fichero se manda por correo. La contraseña del dispositivo vive cifrada con DPAPI
    // justo al lado, en el mismo directorio; que salga de ahí por un botón de ayuda sería
    // deshacer esa protección.
    const texto = componerDiagnostico(DATOS, 'linea con {"password":"secretísima"}');
    expect(texto).not.toContain("secretísima");
    expect(texto).not.toMatch(/@devices\.local/);
  });

  it("redacta también el log que se le pasa", () => {
    // El log del disco ya va redactado al escribirse, pero una versión vieja del fichero pudo
    // escribirse antes de que existiera la redacción. Se vuelve a pasar al exportar.
    const texto = componerDiagnostico(DATOS, "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc");
    expect(texto).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("dice que no hay log en vez de dejar el hueco vacío", () => {
    // Un fichero que acaba en blanco parece truncado, y la primera respuesta sería "mándamelo
    // otra vez". Que diga por qué está vacío ahorra ese viaje.
    expect(componerDiagnostico(DATOS, "")).toContain("sin entradas");
  });

  it("sin emparejar lo dice, y no inventa ids", () => {
    const texto = componerDiagnostico(
      { ...DATOS, emparejado: false, enMarcha: false, deviceId: null, tenantId: null },
      "",
    );
    expect(texto).toContain("no");
    expect(texto).not.toContain("null");
  });
});

describe("nombreDeFicheroDiagnostico", () => {
  it("lleva la fecha, para que dos envíos no se pisen en la carpeta de soporte", () => {
    expect(nombreDeFicheroDiagnostico(new Date("2026-09-24T18:30:00Z"))).toBe(
      "suarex-diagnostico-2026-09-24-1830.txt",
    );
  });
});
