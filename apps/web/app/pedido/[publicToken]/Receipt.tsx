"use client";

import type { OrderReceipt } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { useState } from "react";
import type { Strings } from "@/lib/i18n";
import styles from "./pedido.module.css";
import { descargarReciboPdf } from "./receipt-pdf";

/**
 * RECIBO DEL COMENSAL: el desglose de su pedido, para guardarlo o imprimirlo. Todo sale de los
 * snapshots congelados en la compra (ver `getOrderReceipt`), no del catálogo de hoy: un recibo
 * refleja lo que se pidió y se pagó, pase lo que pase después con los precios.
 *
 * Client component por el botón de descarga: arma un PDF del recibo en el navegador (jsPDF,
 * cargado solo al pulsar). Antes hacía `window.print()`, que en el móvil del comensal a menudo
 * no abría nada; un PDF que se descarga funciona en cualquier dispositivo y se imprime luego.
 */
export function Receipt({
  receipt,
  businessName,
  locale,
  strings: t,
}: {
  receipt: OrderReceipt;
  businessName: string;
  locale: string;
  strings: Strings;
}) {
  const [descargando, setDescargando] = useState(false);

  const descargar = async () => {
    setDescargando(true);
    try {
      await descargarReciboPdf(receipt, {
        businessName,
        fecha: new Date(receipt.createdAt).toLocaleDateString(locale),
        strings: t,
        formatearDinero: (cents) => formatCents(cents, locale, receipt.currency),
      });
    } finally {
      setDescargando(false);
    }
  };

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

      {/* `noPrint`: el botón no sale en el recibo descargado. */}
      <button
        type="button"
        className={`${styles.receiptPrint} ${styles.noPrint}`}
        onClick={descargar}
        disabled={descargando}
        data-testid="receipt-download"
      >
        {t.receiptDownload}
      </button>
    </section>
  );
}
