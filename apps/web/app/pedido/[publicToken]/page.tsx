import { getOrderByPublicToken, getOrderLocale, getOrderReceipt } from "@suarex/db";
import { notFound } from "next/navigation";
import { resolveLang, strings } from "@/lib/i18n";
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
  const receipt = await getOrderReceipt(publicToken, locale);

  return (
    <main className={styles.page}>
      <StatusPoller publicToken={publicToken} initialOrder={order} locale={locale} strings={t} />
      {receipt && receipt.lines.length > 0 ? (
        <Receipt receipt={receipt} locale={locale} strings={t} />
      ) : null}
    </main>
  );
}
