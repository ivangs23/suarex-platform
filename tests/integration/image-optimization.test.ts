import { uploadProductImage } from "@suarex/db";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { admin } from "./helpers/tenants.js";

/**
 * LO QUE ACABA EN STORAGE ES LA VERSIÓN OPTIMIZADA, NO EL ORIGINAL.
 *
 * El catálogo real de un cliente dejó 89 MB de fotos -- 610 KB de media, originales de hasta
 * 6250 px de ancho -- para pintarlas en tarjetas de 250. Una categoría eran ~8 MB, que en la
 * terraza con datos móviles es lo que más se nota de toda la carta.
 *
 * Se comprueba descargando de vuelta el objeto y mirándolo con sharp: que la función no
 * reviente no dice nada sobre lo que quedó guardado, y el peso es justo el punto.
 */

const uploadedPaths: string[] = [];

afterAll(async () => {
  if (uploadedPaths.length === 0) return;
  const { error } = await admin.storage.from("catalog").remove(uploadedPaths);
  if (error) throw error;
});

/** Una foto grande y realista: 4000 × 3000 con ruido, para que no comprima a nada. */
async function fotoGrande(width = 4000, height = 3000): Promise<Uint8Array> {
  const pixeles = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixeles.length; i++) pixeles[i] = (i * 2654435761) % 256;
  const jpeg = await sharp(pixeles, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return new Uint8Array(jpeg);
}

async function descargar(path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from("catalog").download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

describe("optimización de imágenes al subir", () => {
  it("guarda una versión reescalada y en WebP, no el original", async () => {
    const original = await fotoGrande();
    const tenantId = crypto.randomUUID();

    const path = await uploadProductImage(tenantId, {
      bytes: original,
      contentType: "image/jpeg",
    });
    uploadedPaths.push(path);

    const guardada = await descargar(path);
    const meta = await sharp(guardada).metadata();

    expect(meta.format).toBe("webp");
    // 900 px de lado máximo: las tarjetas miden ~250 y la franja de foto ~145, así que cubre
    // una pantalla de densidad 3× sin pagar por píxeles que nadie ve.
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(900);
    // La proporción se respeta: 4000×3000 es 4:3, así que a 900 de ancho tocan 675 de alto.
    expect(meta.width).toBe(900);
    expect(meta.height).toBe(675);
    expect(guardada.byteLength).toBeLessThan(original.byteLength / 4);
  });

  it("la extensión del objeto guardado dice la verdad sobre su contenido", async () => {
    // Guardar bytes WebP bajo un nombre `.jpg` funciona igual en un navegador, pero convierte
    // el bucket en un sitio donde no te puedes fiar de lo que lees.
    const tenantId = crypto.randomUUID();
    const path = await uploadProductImage(tenantId, {
      bytes: await fotoGrande(1200, 1200),
      contentType: "image/jpeg",
    });
    uploadedPaths.push(path);

    expect(path.endsWith(".webp")).toBe(true);
  });

  it("una foto que ya es pequeña no se agranda", async () => {
    // Estirarla solo añadiría peso y se vería borrosa.
    const tenantId = crypto.randomUUID();
    const path = await uploadProductImage(tenantId, {
      bytes: await fotoGrande(300, 200),
      contentType: "image/jpeg",
    });
    uploadedPaths.push(path);

    const meta = await sharp(await descargar(path)).metadata();
    expect(meta.width).toBe(300);
    expect(meta.height).toBe(200);
  });

  it("un fichero que no es una imagen se rechaza en vez de guardarse tal cual", async () => {
    // Guardarlo "por si acaso" es exactamente cómo se llega a un bucket lleno de basura que
    // nadie mira y nadie se atreve a borrar.
    const basura = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    await expect(
      uploadProductImage(crypto.randomUUID(), { bytes: basura, contentType: "image/png" }),
    ).rejects.toThrow();
  });
});
