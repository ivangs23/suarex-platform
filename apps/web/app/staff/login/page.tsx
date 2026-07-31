"use client";

import { createBrowserClient } from "@suarex/realtime";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import styles from "../staff.module.css";
import { mensajeDeErrorDeLogin } from "./login-error";
import { destinoTrasLogin } from "./next-path";

// Construido una sola vez por montaje del módulo: NEXT_PUBLIC_* se inlinea en
// build time, así que estos valores están disponibles en el navegador sin
// tocar ninguna clave de servicio (ver packages/realtime/src/browser-client.ts).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const client = createBrowserClient(supabaseUrl, supabaseAnonKey);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });

    setSubmitting(false);
    if (signInError) {
      setError(mensajeDeErrorDeLogin(signInError));
      return;
    }

    // A donde se iba antes de toparse con el login. Se lee de `window` y no con
    // `useSearchParams` para no arrastrar la frontera de Suspense que ese hook obliga a poner:
    // aquí solo hace falta en el momento de enviar, no durante el render.
    router.push(destinoTrasLogin(new URLSearchParams(window.location.search).get("next")));
  }

  return (
    <main className={styles.login}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <h1 className={styles.loginTitle}>Acceso del personal</h1>
        <label className={styles.field} htmlFor="email">
          Email
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            className={styles.input}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className={styles.field} htmlFor="password">
          Contraseña
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className={styles.input}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <button type="submit" className={styles.submit} disabled={submitting}>
          Entrar
        </button>
        {error ? (
          <p className={styles.alert} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
