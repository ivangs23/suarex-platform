import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clavesDelEjemplo,
  variablesDelCompose,
  variablesDelDockerfile,
  variablesInterpoladas,
  variablesLeidas,
  variablesQueNoLlegan,
} from "./deploy-env";

describe("variablesLeidas", () => {
  it("encuentra los accesos a process.env", () => {
    const fuentes = ["const a = process.env.CRON_SECRET;", "if (process.env.NODE_ENV) {}"];
    expect(variablesLeidas(fuentes)).toEqual(["CRON_SECRET", "NODE_ENV"]);
  });

  it("los comentarios NO cuentan como accesos", () => {
    // Este repositorio nombra variables al explicarlas. Sin esto, el test pediría añadir al
    // compose variables que nadie lee.
    expect(variablesLeidas(["// se lee con process.env.INVENTADA"])).toEqual([]);
    expect(variablesLeidas(["/** doc con process.env.INVENTADA dentro */"])).toEqual([]);
    expect(variablesLeidas(["const a = process.env.REAL; // y process.env.COMENTADA"])).toEqual([
      "REAL",
    ]);
  });

  it("una URL con // no se confunde con un comentario", () => {
    expect(variablesLeidas(['const u = "https://x.dev"; const a = process.env.REAL;'])).toEqual([
      "REAL",
    ]);
  });

  it("no confunde una propiedad parecida", () => {
    expect(variablesLeidas(["obj.process.envio"])).toEqual([]);
    expect(variablesLeidas(["process.env.minuscula"])).toEqual([]);
  });
});

describe("variablesDelCompose", () => {
  const yaml = `services:
  web:
    build:
      context: ..
      args:
        NEXT_PUBLIC_SUPABASE_URL: \${NEXT_PUBLIC_SUPABASE_URL}
    environment:
      SUPABASE_URL: \${SUPABASE_URL}
      # Un comentario en medio no rompe nada.
      CRON_SECRET: \${CRON_SECRET}
    expose:
      - "3000"
  caddy:
    environment:
      ACME_EMAIL: \${ACME_EMAIL}
`;

  it("lee el entorno y los args de build del servicio web", () => {
    const { entorno, argsDeBuild } = variablesDelCompose(yaml);
    expect(entorno).toEqual(["SUPABASE_URL", "CRON_SECRET"]);
    expect(argsDeBuild).toEqual(["NEXT_PUBLIC_SUPABASE_URL"]);
  });

  it("NO se lleva las de otro servicio", () => {
    // Caddy tiene su propio `environment:`. Mezclarlos daría por buena una variable que el
    // contenedor de la web no recibe.
    expect(variablesDelCompose(yaml).entorno).not.toContain("ACME_EMAIL");
  });
});

describe("variablesDelDockerfile", () => {
  it("distingue ARG de ENV", () => {
    const dockerfile = "FROM node\nARG NEXT_PUBLIC_X\nENV NODE_ENV=production\nENV PORT=3000\n";
    const { args, env } = variablesDelDockerfile(dockerfile);
    expect(args).toEqual(["NEXT_PUBLIC_X"]);
    expect(env).toEqual(["NODE_ENV", "PORT"]);
  });
});

describe("variablesQueNoLlegan", () => {
  const vacio = {
    composeEntorno: [],
    composeArgsDeBuild: [],
    dockerfileArgs: [],
    dockerfileEnv: [],
  };

  it("una variable de servidor en el environment del compose llega", () => {
    expect(
      variablesQueNoLlegan(["CRON_SECRET"], { ...vacio, composeEntorno: ["CRON_SECRET"] }),
    ).toEqual([]);
  });

  it("un ENV del Dockerfile también la entrega", () => {
    // `NODE_ENV` no está en el compose y no hace falta: lo fija el Dockerfile.
    expect(variablesQueNoLlegan(["NODE_ENV"], { ...vacio, dockerfileEnv: ["NODE_ENV"] })).toEqual(
      [],
    );
  });

  it("una variable de servidor que nadie pasa se reporta", () => {
    const faltan = variablesQueNoLlegan(["CRON_SECRET"], vacio);
    expect(faltan).toHaveLength(1);
    expect(faltan[0]?.motivo).toContain("environment");
  });

  it("una NEXT_PUBLIC_ necesita las DOS mitades", () => {
    // Es el fallo difícil: con una sola mitad la variable queda vacía en el bundle y no hay
    // ningún error en ninguna parte.
    const soloDockerfile = variablesQueNoLlegan(["NEXT_PUBLIC_K"], {
      ...vacio,
      dockerfileArgs: ["NEXT_PUBLIC_K"],
    });
    expect(soloDockerfile[0]?.motivo).toContain("build.args");

    const soloCompose = variablesQueNoLlegan(["NEXT_PUBLIC_K"], {
      ...vacio,
      composeArgsDeBuild: ["NEXT_PUBLIC_K"],
    });
    expect(soloCompose[0]?.motivo).toContain("ARG");

    expect(
      variablesQueNoLlegan(["NEXT_PUBLIC_K"], {
        ...vacio,
        dockerfileArgs: ["NEXT_PUBLIC_K"],
        composeArgsDeBuild: ["NEXT_PUBLIC_K"],
      }),
    ).toEqual([]);
  });

  it("una NEXT_PUBLIC_ en el environment NO cuenta", () => {
    // Pasarla en ejecución no la hornea en el bundle: el navegador nunca la ve.
    const faltan = variablesQueNoLlegan(["NEXT_PUBLIC_K"], {
      ...vacio,
      composeEntorno: ["NEXT_PUBLIC_K"],
    });
    expect(faltan).toHaveLength(1);
  });
});

/**
 * EL TEST QUE IMPORTA: contra los ficheros de despliegue REALES.
 *
 * Los de arriba comprueban las piezas; este comprueba el repositorio. Si alguien añade un
 * `process.env.LO_QUE_SEA` y no lo pasa en el compose, esto se pone rojo aquí y no en
 * producción tres semanas después.
 */
describe("el despliegue entrega lo que el código lee", () => {
  const raiz = join(import.meta.dirname, "../../..");

  /** Ficheros `.ts`/`.tsx` de producción (sin tests) bajo un directorio. */
  function fuentesDe(dir: string): string[] {
    const salida: string[] = [];
    const recorrer = (actual: string) => {
      for (const entrada of readdirSync(actual, { withFileTypes: true })) {
        if (entrada.name === "node_modules" || entrada.name.startsWith(".")) continue;
        const ruta = join(actual, entrada.name);
        if (entrada.isDirectory()) recorrer(ruta);
        else if (/\.tsx?$/.test(entrada.name) && !/\.test\.tsx?$/.test(entrada.name)) {
          salida.push(readFileSync(ruta, "utf8"));
        }
      }
    };
    recorrer(dir);
    return salida;
  }

  it("ninguna variable que el código lee se queda fuera del contenedor", () => {
    // Se miran `apps/web` y los paquetes que declara como dependencia: son exactamente los que
    // corren DENTRO del contenedor web. `agent`/`agent-desktop`/`printing`/`ticket` no, porque
    // corren en el PC del cliente y su configuración no sale de este compose.
    const pkg = JSON.parse(readFileSync(join(raiz, "apps/web/package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const paquetes = Object.keys(pkg.dependencies ?? {})
      .filter((d) => d.startsWith("@suarex/"))
      .map((d) => join(raiz, "packages", d.replace("@suarex/", ""), "src"));

    const fuentes = [fuentesDe(join(raiz, "apps/web")), ...paquetes.map(fuentesDe)].flat();
    const leidas = variablesLeidas(fuentes);
    expect(leidas.length, "no se leyó ninguna fuente: ¿cambió la estructura?").toBeGreaterThan(5);

    const compose = readFileSync(join(raiz, "deploy/docker-compose.app.yml"), "utf8");
    const dockerfile = readFileSync(join(raiz, "deploy/Dockerfile"), "utf8");
    const { entorno, argsDeBuild } = variablesDelCompose(compose);
    const { args, env } = variablesDelDockerfile(dockerfile);

    // Si el parser del compose dejara de funcionar, todo "faltaría" o nada faltaría según el
    // caso. Este ancla hace que una regresión del parser falle aquí en vez de pasar en falso.
    expect(entorno, "el parser del compose no encontró el servicio web").toContain(
      "SUPABASE_SERVICE_ROLE_KEY",
    );

    const faltan = variablesQueNoLlegan(leidas, {
      composeEntorno: entorno,
      composeArgsDeBuild: argsDeBuild,
      dockerfileArgs: args,
      dockerfileEnv: env,
    });

    expect(
      faltan,
      `Variables que el código lee y el despliegue NO entrega:\n${faltan
        .map((f) => `  - ${f.nombre}: ${f.motivo}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

describe("el ejemplo documenta lo que el compose necesita", () => {
  const raiz = join(import.meta.dirname, "../../..");

  it("toda variable interpolada por el compose está en deploy/.env.app.example", () => {
    // Docker sustituye por cadena VACÍA una variable que no esté en `.env.app`, con un aviso
    // en el log de arranque que nadie lee. El efecto es el mismo que no pasarla: roto y solo
    // en producción. Si el ejemplo no la nombra, quien despliega no la pone.
    const compose = readFileSync(join(raiz, "deploy/docker-compose.app.yml"), "utf8");
    const ejemplo = readFileSync(join(raiz, "deploy/.env.app.example"), "utf8");

    const interpoladas = variablesInterpoladas(compose);
    expect(interpoladas.length, "el compose no interpola nada: ¿cambió de forma?").toBeGreaterThan(
      5,
    );

    const documentadas = new Set(clavesDelEjemplo(ejemplo));
    const sinDocumentar = interpoladas.filter((v) => !documentadas.has(v));

    expect(
      sinDocumentar,
      `El compose las necesita y deploy/.env.app.example no las documenta, así que llegarán vacías:\n${sinDocumentar
        .map((v) => `  - ${v}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});
