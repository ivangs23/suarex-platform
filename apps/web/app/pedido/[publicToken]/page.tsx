import { parseBranding } from "@suarex/config";
import {
  getOrderByPublicToken,
  getOrderLocale,
  getOrderReceipt,
  getTenantSettings,
} from "@suarex/db";
import { notFound } from "next/navigation";
import { resolveLang, strings } from "@/lib/i18n";
import { requireTenant } from "@/lib/tenant-context";
import styles from "./pedido.module.css";
import { Receipt } from "./Receipt";
import { StatusPoller } from "./StatusPoller";

export default async function PedidoPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  // El pedido, el locale y el desglose del recibo se leen en paralelo: el total se formatea y
  // los estados se traducen con el idioma del tenant, y el recibo trae las líneas congeladas
  // en la compra. Nada de esto cambia entre sondeos, así que se resuelve una vez.
  const [order, locale] = await Promise.all([
    getOrderByPublicToken(publicToken),
    getOrderLocale(publicToken),
  ]);
  if (!order) notFound();

  const t = strings(resolveLang(locale, locale));
  // El recibo y el nombre del negocio (para la cabecera del PDF descargable) se resuelven en
  // paralelo. El nombre sale de la marca del tenant, con el slug como respaldo.
  const tenant = await requireTenant().catch(() => null);
  const [receipt, settings] = await Promise.all([
    getOrderReceipt(publicToken, locale),
    tenant ? getTenantSettings(tenant.id).catch(() => null) : Promise.resolve(null),
  ]);
  const businessName = parseBranding(settings?.branding).name ?? tenant?.slug ?? "";

  return (
    <main className={styles.page}>
      <StatusPoller publicToken={publicToken} initialOrder={order} locale={locale} strings={t} />
      {receipt && receipt.lines.length > 0 ? (
        <Receipt receipt={receipt} businessName={businessName} locale={locale} strings={t} />
      ) : null}
    </main>
  );
}
