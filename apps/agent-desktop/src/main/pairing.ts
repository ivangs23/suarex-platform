export type PairResult = { deviceId: string; email: string; password: string; tenantId: string };
export type PairError = { kind: "invalid-code" | "rate-limited" | "network" };

function pairError(kind: PairError["kind"]): PairError {
  return { kind };
}

/**
 * Empareja el dispositivo contra `POST ${origin}/api/devices/pair`. El endpoint colapsa
 * cualquier código inválido/caducado a 404 (oráculo uniforme, ver el route de la web) y
 * un exceso de intentos a 429 (rate-limit de C2a). `fetchFn` se inyecta para los tests.
 */
export async function pairDevice(
  origin: string,
  pairingCode: string,
  fetchFn: typeof fetch = fetch,
): Promise<PairResult> {
  let res: Response;
  try {
    res = await fetchFn(`${origin}/api/devices/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pairingCode }),
    });
  } catch {
    throw pairError("network");
  }

  if (res.status === 404) throw pairError("invalid-code");
  if (res.status === 429) throw pairError("rate-limited");
  if (!res.ok) throw pairError("network");

  try {
    const data = (await res.json()) as Partial<PairResult>;
    if (!data.deviceId || !data.email || !data.password || !data.tenantId) {
      throw pairError("network");
    }
    return {
      deviceId: data.deviceId,
      email: data.email,
      password: data.password,
      tenantId: data.tenantId,
    };
  } catch {
    throw pairError("network");
  }
}
