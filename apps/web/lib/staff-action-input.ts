/**
 * Validación del formulario de alta de personal, construida sobre `form-parse.ts` (mismo
 * patrón que `settings-action-input.ts`). Supabase Auth exige una contraseña de al menos 6
 * caracteres por defecto; aquí se pide un mínimo de 8 como suelo propio, rechazado en el
 * borde de la Server Action con un mensaje claro antes de llamar a `createStaff`.
 */
import { InvalidFormFieldError, requiredString } from "./form-parse";

const MIN_PASSWORD_LENGTH = 8;

export function parseStaffPassword(formData: FormData): string {
  const password = requiredString(formData, "password");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new InvalidFormFieldError(
      `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    );
  }
  return password;
}
