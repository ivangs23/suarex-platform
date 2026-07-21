import { getOrderByPublicToken } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { notFound } from "next/navigation";

export default async function PedidoPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  const order = await getOrderByPublicToken(publicToken);
  if (!order) notFound();

  return (
    <main>
      <h1>Pedido {order.orderNumber}</h1>
      <p data-testid="order-status">{order.status}</p>
      <p>{formatCents(order.totalCents, "es-ES", order.currency)}</p>
    </main>
  );
}
