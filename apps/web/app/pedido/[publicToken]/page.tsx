import { getOrderByPublicToken, getOrderLocale } from "@suarex/db";
import { notFound } from "next/navigation";
import { StatusPoller } from "./StatusPoller";

export default async function PedidoPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  // El pedido y el locale del cliente se leen en paralelo: el total se formatea con el locale
  // del tenant, no con uno fijo -- un cliente en portugués no debe ver su cuenta con formato
  // español. El locale no cambia entre sondeos, así que se pasa como prop una sola vez.
  const [order, locale] = await Promise.all([
    getOrderByPublicToken(publicToken),
    getOrderLocale(publicToken),
  ]);
  if (!order) notFound();

  return (
    <main>
      <h1>Pedido {order.orderNumber}</h1>
      <StatusPoller publicToken={publicToken} initialOrder={order} locale={locale} />
    </main>
  );
}
