import { parseBranding } from "@suarex/config";
import { getTenantSettings } from "@suarex/db";
import { notFound } from "next/navigation";
import { documentoLegal, esDocumentoLegal } from "@/lib/legal-content";
import { requireTenant } from "@/lib/tenant-context";
import styles from "../legal.module.css";

/**
 * Las tres páginas legales del tenant, en una sola ruta.
 *
 * El slug se valida contra la lista CERRADA de `esDocumentoLegal` antes de tocar nada: un slug
 * desconocido es 404, nunca una página vacía servida con 200.
 *
 * `requireTenant()` solo expone `{ id, slug }` -- el proxy no propaga el nombre en cabeceras --
 * así que el nombre del negocio sale de la marca, con el slug como respaldo, igual que la carta
 * (`app/[mesa]/page.tsx`).
 */
export default async function LegalPage({ params }: { params: Promise<{ documento: string }> }) {
  const { documento } = await params;
  if (!esDocumentoLegal(documento)) notFound();

  const tenant = await requireTenant();
  const settings = await getTenantSettings(tenant.id).catch(() => null);
  const fiscal = (settings?.fiscal ?? {}) as {
    legalName?: string;
    cif?: string;
    address?: string;
    phone?: string;
  };

  const doc = documentoLegal(documento, {
    businessName: parseBranding(settings?.branding).name ?? tenant.slug,
    legalName: fiscal.legalName,
    cif: fiscal.cif,
    address: fiscal.address,
    phone: fiscal.phone,
  });

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{doc.titulo}</h1>
      {doc.secciones.map((seccion) => (
        <section key={seccion.titulo} className={styles.section}>
          <h2 className={styles.sectionTitle}>{seccion.titulo}</h2>
          {seccion.parrafos.map((parrafo) => (
            <p key={parrafo} className={styles.paragraph}>
              {parrafo}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
