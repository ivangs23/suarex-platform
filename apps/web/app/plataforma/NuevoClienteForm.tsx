import styles from "./plataforma.module.css";

/**
 * Alta de cliente. Sustituye a `scripts/create-tenant.mjs` por SSH: tres minutos en el
 * navegador en vez de treinta con la service key en una sesión remota.
 *
 * El dueño NO recibe una contraseña: recibe una invitación por correo y pone la suya. Ninguna
 * contraseña se teclea aquí ni se dicta por teléfono.
 */
export function NuevoClienteForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return (
    <form action={action} className={styles.alta} data-testid="alta-cliente">
      <h2>Nuevo cliente</h2>
      <div className={styles.campos}>
        <label className={styles.campo}>
          Slug (subdominio)
          <input name="slug" required placeholder="bar-paco" data-testid="alta-slug" />
        </label>
        <label className={styles.campo}>
          Nombre del negocio
          <input name="name" required placeholder="Bar Paco" data-testid="alta-name" />
        </label>
        <label className={styles.campo}>
          Correo del dueño
          <input
            name="owner_email"
            type="email"
            required
            placeholder="dueno@barpaco.com"
            data-testid="alta-email"
          />
        </label>
        <label className={styles.campo}>
          Tema
          <select name="theme" defaultValue="generic">
            <option value="generic">generic</option>
            <option value="garum">garum</option>
            <option value="manuela">manuela</option>
          </select>
        </label>
        <label className={styles.campo}>
          Idioma
          <select name="locale" defaultValue="es">
            <option value="es">es</option>
            <option value="en">en</option>
            <option value="pt">pt</option>
          </select>
        </label>
        <label className={styles.campo}>
          Moneda
          <input name="currency" defaultValue="EUR" maxLength={3} />
        </label>
      </div>
      <button type="submit" className={styles.boton}>
        Dar de alta
      </button>
      <p>Al dueño le llegará un correo para poner su propia contraseña.</p>
    </form>
  );
}
