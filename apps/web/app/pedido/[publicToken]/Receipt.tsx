"use client";

import type { OrderReceipt } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import type { Strings } from "@/lib/i18n";
import styles from "./pedido.module.css";

/**
 * RECIBO DEL COMENSAL: el desglose de su pedido, para guardarlo o imprimirlo. Todo sale de los
 * snapshots congelados en la compra (ver `getOrderReceipt`), no del catálogo de hoy: un recibo
 * refleja lo que se pidió y se pagó, pase lo que pase después con los precios.
 *
 * Client component solo por el botón de imprimir (`window.print`); los datos vienen ya
 * resueltos del servidor y no cambian.
 */
export function Receipt({
  receipt,
  locale,
  strings: t,
}: {
  receipt: OrderReceipt;
  locale: string;
  strings: Strings;
}) {
  return (
    <section className={styles.receipt} data-testid="receipt" aria-label={t.receiptTitle}>
      <div className={styles.receiptHead}>
        <span className={styles.receiptTitle}>{t.receiptTitle}</span>
        {receipt.tableLabel ? (
          <span className={styles.receiptTable}>
            {t.receiptTable} {receipt.tableLabel}
          </span>
        ) : null}
      </div>

      <ul className={styles.receiptLines}>
        {receipt.lines.map((line) => (
          <li key={line.id} className={styles.receiptLine} data-testid="receipt-line">
            <span className={styles.receiptQty}>{line.quantity}×</span>
            <span className={styles.receiptName}>
              {line.name}
              {line.extras.length > 0 ? (
                <span className={styles.receiptExtras}>
                  {line.extras.map((e) => e.name).join(" · ")}
                </span>
              ) : null}
              {line.notes ? <span className={styles.receiptExtras}>“{line.notes}”</span> : null}
            </span>
            <span className={styles.receiptLineTotal}>
              {formatCents(line.lineTotalCents, locale, receipt.currency)}
            </span>
          </li>
        ))}
      </ul>

      <p className={styles.receiptTotal}>
        <span>{t.total}</span>
        <span>{formatCents(receipt.totalCents, locale, receipt.currency)}</span>
      </p>

      {/* `noPrint`: el botón no sale en el papel al imprimir. */}
      <button
        type="button"
        className={`${styles.receiptPrint} ${styles.noPrint}`}
        onClick={() => window.print()}
      >
        {t.receiptPrint}
      </button>
    </section>
  );
}
