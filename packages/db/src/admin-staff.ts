import { authAdminForStaffCreation, tenantScoped } from "./client.js";

export type CreateStaffInput = { email: string; password: string };
export type CreateStaffResult = { userId: string; email: string };

/** Códigos de `@supabase/auth-js` que significan "ya existe una cuenta con este email". */
const EMAIL_ALREADY_EXISTS_CODES = new Set(["email_exists", "user_already_exists"]);

function isEmailAlreadyExistsError(
  error: { code?: string | null; message?: string | null } | null,
): boolean {
  if (!error) return false;
  if (error.code && EMAIL_ALREADY_EXISTS_CODES.has(error.code)) return true;
  return (
    typeof error.message === "string" &&
    error.message.toLowerCase().includes("already been registered")
  );
}

/**
 * Da de alta un camarero: un usuario de Auth NUEVO más una membership `role='staff'` en el
 * tenant indicado. Ambas escrituras usan el service role (el alta de personal salta RLS por
 * diseño, ver la spec de D3), así que la comprobación de rol owner/admin vive en la Server
 * Action que llama aquí (`app/admin/personal/actions.ts`), no en este repositorio.
 *
 * A DIFERENCIA del emparejamiento de dispositivos (`src/devices.ts`, que recupera una cuenta
 * huérfana si el email determinista ya existe), aquí un email ya registrado es un CONFLICTO
 * real -- dos personas distintas no comparten cuenta -- y se LANZA con un mensaje claro, sin
 * intentar reutilizar ni resetear nada.
 *
 * El `custom_access_token_hook` elige la membership más ANTIGUA (`order by created_at asc
 * limit 1`, ver `20260721000001_core_tenancy.sql`): por eso cada camarero es un usuario
 * NUEVO con exactamente UNA membership -- una segunda membership sobre un usuario existente
 * quedaría inalcanzable por el JWT. No se reutilizan usuarios entre tenants ni roles.
 *
 * Si el INSERT de la membership falla tras crear el usuario, se borra el usuario recién
 * creado antes de relanzar: así un fallo parcial no deja una cuenta de Auth sin membership
 * (que, con un email humano, nadie recuperaría automáticamente).
 */
export async function createStaff(
  tenantId: string,
  input: CreateStaffInput,
): Promise<CreateStaffResult> {
  const authAdmin = authAdminForStaffCreation();

  const { data: created, error: createError } = await authAdmin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  });
  if (createError) {
    if (isEmailAlreadyExistsError(createError)) {
      throw new Error(`Ya existe una cuenta con el email ${input.email}.`);
    }
    throw createError;
  }

  const userId = created.user.id;

  const { error: membershipError } = await tenantScoped("memberships", tenantId).insert({
    user_id: userId,
    role: "staff",
  });
  if (membershipError) {
    // Rollback de la cuenta de Auth para no dejar un usuario sin membership.
    await authAdmin.deleteUser(userId).catch(() => {});
    throw membershipError;
  }

  return { userId, email: input.email };
}

export type StaffMember = { userId: string; email: string; role: string; createdAt: string };

type MembershipRowDb = { user_id: string; role: string; created_at: string };

/**
 * Personal humano del tenant (excluye `device`), con el email resuelto vía la Admin API de
 * Auth (la tabla `memberships` no guarda email). El volumen de personal de un local de
 * hostelería es pequeño, así que resolver el email fila a fila con `getUserById` es
 * aceptable; si en el futuro crece, se pagina `listUsers` una vez y se cruza en memoria.
 */
export async function listStaff(tenantId: string): Promise<StaffMember[]> {
  const { data, error } = await tenantScoped("memberships", tenantId)
    .select("user_id, role, created_at")
    .neq("role", "device")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const authAdmin = authAdminForStaffCreation();
  const rows = data as MembershipRowDb[];
  const members: StaffMember[] = [];
  for (const row of rows) {
    const { data: user } = await authAdmin.getUserById(row.user_id);
    members.push({
      userId: row.user_id,
      email: user?.user?.email ?? "(sin email)",
      role: row.role,
      createdAt: row.created_at,
    });
  }
  return members;
}
