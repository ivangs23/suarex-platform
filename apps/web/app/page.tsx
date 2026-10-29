import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/tenant-context";
import { metadatosDeLaPagina, type QueryDeLaCarta, renderCarta } from "./[mesa]/Carta";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<QueryDeLaCarta>;
}): Promise<Metadata> {
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) return {};
  return metadatosDeLaPagina({ tenant, mesa: null, query: await searchParams });
}

/**
 * Portada del cliente: su carta, en consulta (sin mesa no se pide). Ver
 * docs/decisions/0009-carta-publica-en-la-raiz.md.
 */
export default async function PortadaPage({
  searchParams,
}: {
  searchParams: Promise<QueryDeLaCarta>;
}) {
  // Sin tenant (host de plataforma o desconocido) el proxy ya reescribe a /not-found; esto es
  // la misma defensa en profundidad que `/{mesa}`.
  const tenant = await requireTenant().catch(() => null);
  if (!tenant) {
    notFound();
  }

  return renderCarta({ tenant, mesa: null, query: await searchParams });
}
