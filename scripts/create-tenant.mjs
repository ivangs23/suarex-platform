/**
 * Da de alta un cliente nuevo: su fila `tenants`, sus ajustes de marca, su sede por defecto y
 * su PRIMER owner (usuario de Auth + membership). Es el paso que faltaba: hasta ahora un
 * cliente nuevo exigía SQL a mano contra producción, y el panel solo deja crear personal a un
 * owner que ya exista -- el huevo y la gallina del primer owner.
 *
 *   node scripts/create-tenant.mjs --slug bar-paco --nombre "Bar Paco" --email dueno@barpaco.com
 *
 * Opcionales: --password (si no, se genera), --dominio, --tema (por defecto generic),
 * --idioma (es), --moneda (EUR).
 *
 * IDEMPOTENTE: reejecutar no duplica nada -- reutiliza lo que ya exista y crea lo que falte.
 * Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Imprime al final las credenciales del
 * owner para entregárselas. NUNCA toca los repos/proyectos en producción: solo la base
 * configurada en el entorno.
 */
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { validarEmail, validarIdioma, validarSlug } from "./lib/tenant-input.mjs";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

function arg(nombre) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : undefined;
}

let slug;
let nombre;
let email;
try {
  slug = validarSlug(arg("slug") ?? "");
  nombre = arg("nombre");
  email = validarEmail(arg("email") ?? "");
  if (!nombre) throw new Error("Falta --nombre (el nombre visible del negocio).");
} catch (e) {
  console.error(`\n${e.message}\n`);
  console.error(
    'Uso: node scripts/create-tenant.mjs --slug <slug> --nombre "<Nombre>" --email <email> [--password ...] [--dominio ...] [--tema generic] [--idioma es] [--moneda EUR]',
  );
  process.exit(1);
}

const dominio = arg("dominio") ?? null;
const tema = arg("tema") ?? "generic";
const idioma = validarIdioma(arg("idioma") ?? "es");
const moneda = (arg("moneda") ?? "EUR").toUpperCase();
const password = arg("password") ?? randomBytes(18).toString("base64url");

// 1. Cliente. Upsert por slug: reejecutar no crea otro ni falla por el índice único.
let tenantId;
{
  const { data: existe } = await db.from("tenants").select("id").eq("slug", slug).maybeSingle();
  if (existe) {
    tenantId = existe.id;
    console.log(`Cliente '${slug}' ya existía (${tenantId}), se reutiliza.`);
  } else {
    const { data, error } = await db
      .from("tenants")
      .insert({ slug, name: nombre, custom_domain: dominio, status: "active" })
      .select("id")
      .single();
    if (error) throw new Error(`No se pudo crear el cliente: ${error.message}`);
    tenantId = data.id;
    console.log(`Cliente '${slug}' creado (${tenantId}).`);
  }
}

// 2. Ajustes. Solo si no los tiene: reejecutar no pisa una marca que el cliente ya editó.
{
  const { data: existe } = await db
    .from("tenant_settings")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (existe) {
    console.log("Ajustes ya existían, se respetan (no se pisan).");
  } else {
    const { error } = await db.from("tenant_settings").insert({
      tenant_id: tenantId,
      branding: { name: nombre },
      locale: idioma,
      currency: moneda,
      channels: ["qr-mesa"],
      theme: tema,
    });
    if (error) throw new Error(`No se pudieron crear los ajustes: ${error.message}`);
    console.log(`Ajustes creados (tema '${tema}', idioma ${idioma}, moneda ${moneda}).`);
  }
}

// 3. Sede por defecto. La carta y las mesas cuelgan de una sede; sin una, no se puede operar.
{
  const { data: existe } = await db
    .from("venues")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .maybeSingle();
  if (existe) {
    console.log("Sede por defecto ya existía.");
  } else {
    const { error } = await db
      .from("venues")
      .insert({ tenant_id: tenantId, slug: "principal", name: "Principal", is_default: true });
    if (error) throw new Error(`No se pudo crear la sede: ${error.message}`);
    console.log("Sede por defecto creada.");
  }
}

// 4. Owner. Usuario de Auth (reutilizado si el email ya existe) + membership rol owner.
let ownerCreado = false;
{
  const { data: lista, error: listErr } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw new Error(`No se pudo listar usuarios: ${listErr.message}`);
  let userId = lista.users.find((u) => u.email === email)?.id;

  if (!userId) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw new Error(`No se pudo crear el owner: ${error.message}`);
    userId = data.user.id;
    ownerCreado = true;
    console.log(`Owner ${email} creado.`);
  } else {
    console.log(`El email ${email} ya tenía cuenta, se reutiliza (no se cambia su contraseña).`);
  }

  const { data: membresia } = await db
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (membresia) {
    console.log(`${email} ya era del equipo de '${slug}'.`);
  } else {
    const { error } = await db
      .from("memberships")
      .insert({ user_id: userId, tenant_id: tenantId, role: "owner" });
    if (error) throw new Error(`No se pudo dar de alta al owner en el cliente: ${error.message}`);
    console.log(`${email} añadido como owner de '${slug}'.`);
  }
}

console.log("\n─── LISTO ───");
console.log(`Cliente:  ${nombre}  (${slug})`);
console.log(`Panel:    https://${dominio ?? `${slug}.<tu-dominio>`}/admin`);
console.log(`Owner:    ${email}`);
if (ownerCreado) {
  console.log(`Password: ${password}   ← entrégasela; no se vuelve a mostrar`);
} else {
  console.log("Password: (la cuenta ya existía; usa su contraseña actual)");
}
console.log(
  "\nSiguiente: importa su carta con  node scripts/import-catalog.mjs <volcado> " +
    `${slug} --reemplazar`,
);
