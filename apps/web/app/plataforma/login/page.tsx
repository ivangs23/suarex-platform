"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "../plataforma.module.css";

/**
 * Acceso a la consola de plataforma.
 *
 * Está FUERA del guard a propósito (ver `layout.tsx`): si el layout lo protegiera, esta página
 * redirigiría a sí misma en bucle.
 *
 * El mensaje de error es el mismo para credenciales incorrectas y para una cuenta que existe
 * pero no es del equipo: quien no es superadmin no debe poder deducir qué correos tienen acceso
 * a la plataforma. La comprobación real de `platform_admins` la hace `requirePlatformAdmin()`
 * al llegar a `/plataforma`.
 */
export default function PlataformaLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(formData: FormData) {
    setEnviando(true);
    setError(null);
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    );
    const { error: fallo } = await supabase.auth.signInWithPassword({
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    });
    setEnviando(false);
    if (fallo) {
      setError("No se ha podido entrar. Revisa el correo y la contraseña.");
      return;
    }
    router.replace("/plataforma");
    router.refresh();
  }

  return (
    <form action={entrar} className={styles.alta} data-testid="plataforma-login">
      <h2>Acceso de plataforma</h2>
      <div className={styles.campos}>
        <label className={styles.campo}>
          Correo
          <input name="email" type="email" required autoComplete="username" />
        </label>
        <label className={styles.campo}>
          Contraseña
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
      </div>
      {error ? (
        <p role="alert" data-testid="plataforma-login-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className={styles.boton} disabled={enviando}>
        {enviando ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
