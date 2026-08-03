import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NotFoundDeRuta from "./not-found";
import NotFoundDeHost from "./not-found/page";

/**
 * Hay DOS páginas de "no encontrado" y responden a preguntas distintas:
 *
 *  - `not-found/page.tsx` lo sirve `proxy.ts` cuando el HOST no es de nadie: el dominio está mal.
 *  - `not-found.tsx` lo sirve Next cuando la RUTA no existe en un cliente que sí existe.
 *
 * Decían lo mismo, y por eso un enlace del panel con un carácter de más contestaba que el dominio
 * no correspondía a ningún establecimiento -- mandando a revisar la configuración del cliente
 * cuando lo que sobraba era una coma en la URL. El test existe para que no vuelvan a unificarse.
 */
const texto = (nodo: React.ReactElement) => renderToStaticMarkup(nodo).replace(/<[^>]+>/g, " ");

describe("las dos páginas de 'no encontrado'", () => {
  it("la de host desconocido habla del establecimiento", () => {
    expect(texto(<NotFoundDeHost />)).toContain("establecimiento");
  });

  it("la de ruta inexistente NO dice que el establecimiento no exista", () => {
    // El cliente existe; lo que no existe es la página. Decir lo otro manda a mirar el dominio.
    const t = texto(<NotFoundDeRuta />);
    expect(t).not.toContain("no corresponde a ningún establecimiento");
    expect(t).toContain("no existe en este establecimiento");
  });

  it("no dicen lo mismo", () => {
    expect(texto(<NotFoundDeRuta />)).not.toBe(texto(<NotFoundDeHost />));
  });
});
