import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { ChargeEvent } from "./charge-journal.js";
import { createChargeJournal, foldEvents, parseEvents } from "./charge-journal.js";

const started = (ref: string, orderId = "o1"): ChargeEvent => ({
  t: "started",
  ref,
  orderId,
  amountCents: 1200,
  at: 1000,
});

describe("foldEvents", () => {
  it("un cobro solo empezado queda a medias", () => {
    expect(foldEvents([started("r1")])).toEqual([
      { ref: "r1", orderId: "o1", amountCents: 1200, startedAt: 1000 },
    ]);
  });

  it("guarda la sesión: es lo que permite volver a preguntar al datáfono tras un reinicio", () => {
    const [cobro] = foldEvents([
      started("r1"),
      { t: "session", ref: "r1", sessionId: "S-9", at: 1001 },
    ]);
    expect(cobro?.sessionId).toBe("S-9");
  });

  it("un aprobado sin registrar sigue a medias, y conserva el código de autorización", () => {
    const [cobro] = foldEvents([
      started("r1"),
      { t: "approved", ref: "r1", authCode: "AUTH-1", at: 1002 },
    ]);
    expect(cobro?.authCode).toBe("AUTH-1");
  });

  it("registrado cierra el cobro", () => {
    expect(
      foldEvents([
        started("r1"),
        { t: "approved", ref: "r1", authCode: "AUTH-1", at: 1002 },
        { t: "settled", ref: "r1", at: 1003 },
      ]),
    ).toEqual([]);
  });

  it("denegado cierra el cobro igual de bien: no se ha movido dinero", () => {
    expect(
      foldEvents([started("r1"), { t: "declined", ref: "r1", reason: "Fondos", at: 1002 }]),
    ).toEqual([]);
  });

  it("varios cobros a la vez no se mezclan", () => {
    const vivos = foldEvents([
      started("r1", "o1"),
      started("r2", "o2"),
      { t: "settled", ref: "r1", at: 1005 },
      { t: "approved", ref: "r2", authCode: "AUTH-2", at: 1006 },
    ]);
    expect(vivos).toHaveLength(1);
    expect(vivos[0]?.orderId).toBe("o2");
    expect(vivos[0]?.authCode).toBe("AUTH-2");
  });

  it("un evento huérfano (sin su 'started') se ignora en vez de inventar un cobro", () => {
    // Puede pasar tras una compactación o un fichero recortado: no se sabe ni el pedido ni el
    // importe, así que no hay nada que recuperar -- y fabricar una entrada a medias sería peor.
    expect(foldEvents([{ t: "approved", ref: "fantasma", authCode: "X", at: 1 }])).toEqual([]);
  });
});

describe("parseEvents", () => {
  it("descarta la última línea a medias, que es justo lo que deja un corte de corriente", () => {
    const raw = `${JSON.stringify(started("r1"))}\n{"t":"appro`;
    const events = parseEvents(raw);
    expect(events).toHaveLength(1);
    expect(events[0]?.t).toBe("started");
  });

  it("ignora líneas vacías y basura sin tirar el resto", () => {
    const raw = `\n${JSON.stringify(started("r1"))}\n\nno-es-json\n{"sin":"tipo"}\n`;
    expect(parseEvents(raw)).toHaveLength(1);
  });
});

describe("createChargeJournal (fichero real)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "diario-cobros-"));
  });

  it("sin fichero todavía, no hay nada a medias", async () => {
    const journal = createChargeJournal(dir);
    expect(await journal.pending()).toEqual([]);
  });

  it("lo escrito sobrevive a releer el diario desde cero", async () => {
    const journal = createChargeJournal(dir);
    await journal.append(started("r1"));
    await journal.append({ t: "approved", ref: "r1", authCode: "AUTH-1", at: 1002 });

    // Otra instancia, como haría el siguiente arranque de la app.
    const otra = createChargeJournal(dir);
    const vivos = await otra.pending();
    expect(vivos).toHaveLength(1);
    expect(vivos[0]?.authCode).toBe("AUTH-1");
  });

  it("un cobro cerrado desaparece", async () => {
    const journal = createChargeJournal(dir);
    await journal.append(started("r1"));
    await journal.append({ t: "settled", ref: "r1", at: 1003 });
    expect(await journal.pending()).toEqual([]);
  });

  it("una línea truncada no se lleva por delante los cobros anteriores", async () => {
    const journal = createChargeJournal(dir);
    await journal.append(started("r1"));
    // Simula el corte: media línea al final del fichero.
    const path = join(dir, "cobros.jsonl");
    await writeFile(path, `${await readFile(path, "utf8")}{"t":"appro`, "utf8");

    const vivos = await journal.pending();
    expect(vivos).toHaveLength(1);
    expect(vivos[0]?.ref).toBe("r1");
  });

  it("compactar deja solo lo vivo, y lo vivo sigue estando entero", async () => {
    const journal = createChargeJournal(dir);
    await journal.append(started("cerrado", "o-cerrado"));
    await journal.append({ t: "settled", ref: "cerrado", at: 2 });
    await journal.append(started("vivo", "o-vivo"));
    await journal.append({ t: "session", ref: "vivo", sessionId: "S-1", at: 3 });
    await journal.append({ t: "approved", ref: "vivo", authCode: "AUTH-9", at: 4 });

    await journal.compact();

    const raw = await readFile(join(dir, "cobros.jsonl"), "utf8");
    expect(raw).not.toContain("o-cerrado");

    const vivos = await createChargeJournal(dir).pending();
    expect(vivos).toHaveLength(1);
    expect(vivos[0]).toMatchObject({ orderId: "o-vivo", sessionId: "S-1", authCode: "AUTH-9" });
  });

  it("compactar sin nada vivo deja el diario vacío, no roto", async () => {
    const journal = createChargeJournal(dir);
    await journal.append(started("r1"));
    await journal.append({ t: "settled", ref: "r1", at: 2 });

    await journal.compact();

    expect(await readFile(join(dir, "cobros.jsonl"), "utf8")).toBe("");
    expect(await createChargeJournal(dir).pending()).toEqual([]);
  });
});
