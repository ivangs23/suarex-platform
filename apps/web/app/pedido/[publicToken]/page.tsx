import { getOrderByPublicToken } from "@suarex/db";
import { notFound } from "next/navigation";
import { StatusPoller } from "./StatusPoller";

export default async function PedidoPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  const order = await getOrderByPublicToken(publicToken);
  if (!order) notFound();

  return (
    <main>
      <h1>Pedido {order.orderNumber}</h1>
      <StatusPoller publicToken={publicToken} initialOrder={order} />
    </main>
  );
}
