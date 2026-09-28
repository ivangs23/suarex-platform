/**
 * QUE LAS VARIABLES QUE EL CÓDIGO LEE LLEGUEN AL CONTENEDOR DE PRODUCCIÓN.
 *
 * Esto existe por un fallo real. `deploy/docker-compose.app.yml` es LO ÚNICO que llega al
 * proceso -- no hay `env_file`, y `--env-file` solo alimenta la interpolación `${...}` del
 * propio compose. Una variable que el código lee y el compose no pasa no existe en producción,
 * y el fallo es silencioso: en desarrollo se lee de `apps/web/.env.local`, así que las tres
 * suites pasan en verde mientras producción está rota.
 *
 * Ya pasó: faltaban `STRIPE_BILLING_WEBHOOK_SECRET` y `CRON_SECRET`, el webhook de facturación
 * devolvía 500 siempre y los cuatro crons 503. Se arreglaron añadiéndolas, y el compose se
 * quedó con un comentario pidiendo que nadie se olvide la próxima vez. Un comentario no es una
 * garantía: esto sí.
 *
 * Dos vías distintas, y confundirlas es justo el error fácil:
 *
 * - Las `NEXT_PUBLIC_*` se hornean en el bundle del NAVEGADOR en tiempo de build. Necesitan un
 *   `ARG` en el Dockerfile **y** que el compose las pase en `build.args`. Cualquiera de las dos
 *   mitades sin la otra deja la variable vacía sin decir nada.
 * - El resto se lee en el servidor en tiempo de EJECUCIÓN: basta con que estén en el
 *   `environment:` del servicio web o en un `ENV` del Dockerfile.
 */

/**
 * Quita los comentarios antes de escanear.
 *
 * Este repositorio está muy comentado y los comentarios NOMBRAN variables de entorno al
 * explicarlas. Sin esto, una frase como "se lee con process.env.ALGO" se contaría como un
 * acceso real y el test pediría añadir al compose una variable que nadie lee.
 *
 * Los `//` precedidos de `:` se conservan a propósito: son las URLs (`https://...`), no
 * comentarios. Si alguna forma rara se colara, el fallo sería un test rojo pidiendo una
 * variable de más -- ruidoso, pero nunca un despliegue roto en silencio, que es lo que esto
 * existe para evitar.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((linea) => {
      const i = linea.search(/(?<!:)\/\//);
      return i === -1 ? linea : linea.slice(0, i);
    })
    .join("\n");
}

/** Nombres de variable que un texto fuente lee de verdad (los comentarios no cuentan). */
export function variablesLeidas(fuentes: string[]): string[] {
  const encontradas = new Set<string>();
  for (const fuente of fuentes) {
    for (const m of sinComentarios(fuente).matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
      encontradas.add(m[1] as string);
    }
  }
  return [...encontradas].sort();
}

/**
 * Claves de un bloque YAML con forma de mapa (`environment:`, `args:`), a partir de su
 * cabecera y hasta que la indentación vuelve a su nivel o menos.
 *
 * Es un parser mínimo a propósito: meter una dependencia de YAML para leer dos listas de
 * claves sería más superficie de la que ahorra. A cambio, `variablesDelCompose` comprueba que
 * encontró algo -- si esto dejara de parsear, el test falla en vez de pasar con listas vacías.
 */
function clavesDeBloque(lineas: string[], nombreBloque: string): string[] {
  const claves: string[] = [];
  const cabecera = lineas.findIndex((l) => new RegExp(`^(\\s*)${nombreBloque}:\\s*$`).test(l));
  if (cabecera === -1) return claves;

  const sangriaCabecera = (lineas[cabecera] as string).search(/\S/);
  for (const linea of lineas.slice(cabecera + 1)) {
    if (linea.trim() === "" || linea.trim().startsWith("#")) continue;
    const sangria = linea.search(/\S/);
    if (sangria <= sangriaCabecera) break;
    const m = linea.match(/^\s*([A-Z][A-Z0-9_]*):/);
    if (m) claves.push(m[1] as string);
  }
  return claves;
}

/** Bloque del servicio `web` del compose (desde `  web:` hasta el siguiente servicio). */
function bloqueDelServicioWeb(yaml: string): string[] {
  const lineas = yaml.split("\n");
  const inicio = lineas.findIndex((l) => /^\s{2}web:\s*$/.test(l));
  if (inicio === -1) return [];
  const resto = lineas.slice(inicio + 1);
  const fin = resto.findIndex((l) => /^\s{2}\S/.test(l));
  return fin === -1 ? resto : resto.slice(0, fin);
}

export function variablesDelCompose(yaml: string): { entorno: string[]; argsDeBuild: string[] } {
  const bloque = bloqueDelServicioWeb(yaml);
  return {
    entorno: clavesDeBloque(bloque, "environment"),
    argsDeBuild: clavesDeBloque(bloque, "args"),
  };
}

export function variablesDelDockerfile(texto: string): { args: string[]; env: string[] } {
  const args: string[] = [];
  const env: string[] = [];
  for (const linea of texto.split("\n")) {
    const arg = linea.match(/^ARG\s+([A-Z][A-Z0-9_]*)/);
    if (arg) args.push(arg[1] as string);
    const e = linea.match(/^ENV\s+([A-Z][A-Z0-9_]*)=/);
    if (e) env.push(e[1] as string);
  }
  return { args, env };
}

export type VariableQueNoLlega = { nombre: string; motivo: string };

export function variablesQueNoLlegan(
  leidas: string[],
  entrega: {
    composeEntorno: string[];
    composeArgsDeBuild: string[];
    dockerfileArgs: string[];
    dockerfileEnv: string[];
  },
): VariableQueNoLlega[] {
  const enEjecucion = new Set([...entrega.composeEntorno, ...entrega.dockerfileEnv]);
  const argsCompose = new Set(entrega.composeArgsDeBuild);
  const argsDockerfile = new Set(entrega.dockerfileArgs);

  const faltan: VariableQueNoLlega[] = [];
  for (const nombre of leidas) {
    if (nombre.startsWith("NEXT_PUBLIC_")) {
      const enDockerfile = argsDockerfile.has(nombre);
      const enCompose = argsCompose.has(nombre);
      if (enDockerfile && enCompose) continue;
      // Se distingue QUÉ mitad falta: con una sola, la variable queda vacía en el bundle sin
      // ningún error, que es el fallo más difícil de ver de los dos.
      const motivo =
        !enDockerfile && !enCompose
          ? "se hornea en el bundle del navegador: falta el `ARG` en deploy/Dockerfile Y pasarla en `build.args` del compose"
          : enDockerfile
            ? "tiene `ARG` en el Dockerfile pero el compose no la pasa en `build.args`: llega vacía al bundle"
            : "el compose la pasa en `build.args` pero el Dockerfile no la declara con `ARG`: Docker la ignora";
      faltan.push({ nombre, motivo });
      continue;
    }
    if (!enEjecucion.has(nombre)) {
      faltan.push({
        nombre,
        motivo:
          "se lee en el servidor: añádela al `environment:` del servicio web en deploy/docker-compose.app.yml",
      });
    }
  }
  return faltan;
}

/**
 * Variables que el compose interpola (`${VAR}`).
 *
 * El otro tramo del mismo camino: el código lee una variable, el compose la pasa... y su valor
 * sale de `.env.app` en el servidor. Si `deploy/.env.app.example` no la documenta, quien
 * despliega no la pone, y Docker sustituye la cadena VACÍA con un aviso que nadie lee en un log
 * de arranque. El resultado es idéntico a no pasarla: roto, y solo en producción.
 */
export function variablesInterpoladas(yaml: string): string[] {
  const encontradas = new Set<string>();
  for (const m of yaml.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)) encontradas.add(m[1] as string);
  return [...encontradas].sort();
}

/** Claves declaradas en un fichero de ejemplo de entorno (`CLAVE=` o `CLAVE:`), comentarios no. */
export function clavesDelEjemplo(texto: string): string[] {
  const claves = new Set<string>();
  for (const linea of texto.split("\n")) {
    const limpia = linea.trim();
    if (limpia === "" || limpia.startsWith("#")) continue;
    const m = limpia.match(/^([A-Z][A-Z0-9_]*)\s*=/);
    if (m) claves.add(m[1] as string);
  }
  return [...claves].sort();
}
