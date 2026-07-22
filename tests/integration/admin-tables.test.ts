import { createTable, deleteTable, findTableByToken, listTables, updateTable } from "@suarex/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin as adminClient,
  createTenantFixture,
  deleteTenantFixture,
  nonce,
  seedCatalog,
  type TenantFixture,
} from "./helpers/tenants.js";

let tenantA: TenantFixture;
let tenantB: TenantFixture;
let venueA: string;
let venueB: string;

beforeAll(async () => {
  tenantA = await createTenantFixture(`admin-tables-a-${nonce()}`);
  tenantB = await createTenantFixture(`admin-tables-b-${nonce()}`);
  venueA = (await seedCatalog(tenantA.tenantId, "a")).venueId;
  venueB = (await seedCatalog(tenantB.tenantId, "b")).venueId;
});

afterAll(async () => {
  for (const fixture of [tenantA, tenantB]) {
    if (fixture) await deleteTenantFixture(fixture);
  }
});

describe("createTable + listTables", () => {
  it("crea una fila con un token uuid y listTables la devuelve", async () => {
    const { id, token } = await createTable(tenantA.tenantId, {
      venueId: venueA,
      label: `mesa-${nonce()}`,
    });

    expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const tables = await listTables(tenantA.tenantId);
    const table = tables.find((t) => t.id === id);
    expect(table).toBeDefined();
    expect(table?.venueId).toBe(venueA);
    expect(table?.tenantId).toBe(tenantA.tenantId);
    expect(table?.isActive).toBe(true);
  });
});

describe("findTableByToken", () => {
  it("el token de una mesa creada resuelve a su fila vía findTableByToken (lectura reutilizada, no duplicada)", async () => {
    const label = `mesa-token-${nonce()}`;
    const { id, token } = await createTable(tenantA.tenantId, { venueId: venueA, label });

    const found = await findTableByToken(token);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(id);
    expect(found?.tenantId).toBe(tenantA.tenantId);
    expect(found?.venueId).toBe(venueA);
    expect(found?.label).toBe(label);
  });
});

describe("aislamiento entre tenants", () => {
  it("createTable con un venueId de otro tenant es rechazado (trigger assert_same_tenant)", async () => {
    await expect(
      createTable(tenantA.tenantId, { venueId: venueB, label: `intruso-${nonce()}` }),
    ).rejects.toThrow(/cross-tenant/i);

    const tables = await listTables(tenantA.tenantId);
    expect(tables.some((t) => t.venueId === venueB)).toBe(false);
  });

  it("updateTable con el id de otro tenant no afecta ninguna fila y B queda intacta", async () => {
    const label = `cross-upd-${nonce()}`;
    const { id } = await createTable(tenantB.tenantId, { venueId: venueB, label });

    await updateTable(tenantA.tenantId, id, { label: "Hackeada por A" });

    const { data: rowB } = await adminClient.from("tables").select("label").eq("id", id).single();
    expect(rowB?.label).toBe(label);
  });

  it("deleteTable con el id de otro tenant no borra la fila de B", async () => {
    const label = `cross-del-${nonce()}`;
    const { id } = await createTable(tenantB.tenantId, { venueId: venueB, label });

    await deleteTable(tenantA.tenantId, id);

    const { data: rowB } = await adminClient.from("tables").select("id").eq("id", id).maybeSingle();
    expect(rowB?.id).toBe(id);
  });
});

describe("label duplicado", () => {
  it("un label duplicado en el mismo venue es rechazado (unique tenant_id, venue_id, label)", async () => {
    const label = `dup-${nonce()}`;
    await createTable(tenantA.tenantId, { venueId: venueA, label });

    await expect(createTable(tenantA.tenantId, { venueId: venueA, label })).rejects.toThrow();
  });
});

describe("update/delete de mesas", () => {
  it("updateTable cambia los campos, deleteTable borra la fila", async () => {
    const { id } = await createTable(tenantA.tenantId, {
      venueId: venueA,
      label: `upd-${nonce()}`,
    });

    await updateTable(tenantA.tenantId, id, {
      label: "Actualizada",
      sortOrder: 5,
      isActive: false,
    });
    let tables = await listTables(tenantA.tenantId);
    const table = tables.find((t) => t.id === id);
    expect(table?.label).toBe("Actualizada");
    expect(table?.isActive).toBe(false);

    await deleteTable(tenantA.tenantId, id);
    tables = await listTables(tenantA.tenantId);
    expect(tables.some((t) => t.id === id)).toBe(false);
  });
});
