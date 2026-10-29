import { type FichaPublica, fichaPublicaDeLaSede, guardarFichaPublica } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  type SeedResult,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

/**
 * La ficha pública de la sede (`venues`: dirección, teléfono y horario), con el aislamiento de
 * siempre: un cliente no lee ni escribe la sede de otro.
 */

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let seedA: SeedResult;
let seedB: SeedResult;

const FICHA: FichaPublica = {
  street: "Calle Larios 5",
  postalCode: "29005",
  city: "Málaga",
  region: "Málaga",
  phone: "+34 952 000 000",
  openingHours: {
    mo: [],
    tu: [
      ["13:00", "16:00"],
      ["20:00", "23:30"],
    ],
    sa: [["20:00", "02:00"]],
  },
};

const VACIA: FichaPublica = {
  street: null,
  postalCode: null,
  city: null,
  region: null,
  phone: null,
  openingHours: null,
};

beforeAll(async () => {
  tenantA = await createTenantFixture(`ficha-a-${nonce()}`);
  tenantB = await createTenantFixture(`ficha-b-${nonce()}`);
  seedA = await seedCatalog(tenantA.tenantId, "fa");
  seedB = await seedCatalog(tenantB.tenantId, "fb");
});

afterAll(async () => {
  if (tenantA) await deleteTenantFixture(tenantA);
  if (tenantB) await deleteTenantFixture(tenantB);
});

describe("ficha pública de la sede", () => {
  it("sin rellenar, todo es null: no se publica nada por defecto", async () => {
    expect(await fichaPublicaDeLaSede(tenantB.tenantId)).toEqual({
      venueId: seedB.venueId,
      timezone: "Europe/Madrid",
      ...VACIA,
    });
  });

  it("se guarda y se lee de vuelta, con un día cerrado y un tramo que cruza la medianoche", async () => {
    await guardarFichaPublica(tenantA.tenantId, seedA.venueId, FICHA);
    expect(await fichaPublicaDeLaSede(tenantA.tenantId)).toEqual({
      venueId: seedA.venueId,
      timezone: "Europe/Madrid",
      ...FICHA,
    });
  });

  it("un cliente no lee la sede de otro", async () => {
    const deB = await fichaPublicaDeLaSede(tenantB.tenantId);
    expect(deB?.venueId).toBe(seedB.venueId);
    expect(deB?.street).toBeNull();
  });

  it("el panel lee una sede concreta por su id, pero nunca la de otro cliente", async () => {
    expect((await fichaPublicaDeLaSede(tenantA.tenantId, seedA.venueId))?.street).toBe(
      FICHA.street,
    );
    expect(await fichaPublicaDeLaSede(tenantB.tenantId, seedA.venueId)).toBeNull();
  });

  it("un cliente no escribe la sede de otro aunque pase su id", async () => {
    await guardarFichaPublica(tenantB.tenantId, seedA.venueId, { ...VACIA, phone: "666" });
    expect(await fichaPublicaDeLaSede(tenantA.tenantId)).toMatchObject(FICHA);
  });

  it("la base rechaza un horario sin forma de tramos", async () => {
    const malo = { ...FICHA, openingHours: { mo: ["13:00", "16:00"] } } as unknown as FichaPublica;
    await expect(guardarFichaPublica(tenantA.tenantId, seedA.venueId, malo)).rejects.toMatchObject({
      code: "23514",
    });
    expect(await fichaPublicaDeLaSede(tenantA.tenantId)).toMatchObject(FICHA);
  });
});
