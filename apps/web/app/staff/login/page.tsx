"use client";

import { createBrowserClient } from "@suarex/realtime";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

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
      setError("Email o contraseña incorrectos");
      return;
    }

    router.push("/staff");
  }

  return (
    <main>
      <h1>Acceso del personal</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />

        <button type="submit" disabled={submitting}>
          Entrar
        </button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </main>
  );
}
