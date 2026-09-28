"use client";

import type { OrderReceipt } from "@suarex/db";
import { formatCents } from "@suarex/domain";
import { useState } from "react";
import type { Strings } from "@/lib/i18n";
import styles from "./pedido.module.css";
import { descargarReciboPdf, type ReciboFiscal } from "./receipt-pdf";

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
  fiscal,
  locale,
  strings: t,
}: {
  receipt: OrderReceipt;
  businessName: string;
  fiscal: ReciboFiscal;
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
        fiscal,
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

      {receipt.taxCents > 0 ? (
        <p className={styles.receiptTaxBreakdown} data-testid="receipt-tax-breakdown">
          <span>
            {t.receiptSubtotal}: {formatCents(receipt.subtotalCents, locale, receipt.currency)}
          </span>
          <span>
            {t.receiptTax}: {formatCents(receipt.taxCents, locale, receipt.currency)}
          </span>
        </p>
      ) : null}

      <p className={styles.receiptTotal}>
        <span>{t.total}</span>
        <span>{formatCents(receipt.totalCents, locale, receipt.currency)}</span>
      </p>

      {/* INCONDICIONAL, para todos los tenants (decisión D1 del spec de la Fase 1). Va en
          pantalla, no solo en el PDF: el comensal que mira y se va también tiene que saber
          que esto no es una factura. */}
      <p className={styles.receiptNotInvoice} data-testid="receipt-not-invoice">
        {t.receiptNotInvoice}
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
