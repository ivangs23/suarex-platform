import { getOrderByPublicToken, getOrderLocale } from "@suarex/db";
import { notFound } from "next/navigation";
import { resolveLang, strings } from "@/lib/i18n";
import { StatusPoller } from "./StatusPoller";

export default async function PedidoPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  // El pedido y el locale del cliente se leen en paralelo: el total se formatea y los estados
  // se traducen con el idioma del tenant, no con uno fijo. Ninguno cambia entre sondeos, así
  // que se resuelven una vez en el servidor y se pasan como prop.
  const [order, locale] = await Promise.all([
    getOrderByPublicToken(publicToken),
    getOrderLocale(publicToken),
  ]);
  if (!order) notFound();

  const t = strings(resolveLang(locale, locale));

  return (
    <StatusPoller publicToken={publicToken} initialOrder={order} locale={locale} strings={t} />
  );
}
