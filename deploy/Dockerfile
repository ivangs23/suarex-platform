# Imagen de la web (apps/web) para el VPS. Multi-etapa: la etapa `builder` tiene todo el
# monorepo y las devDependencies; la imagen final solo lleva la salida `standalone` de Next
# (ver `output: "standalone"` en apps/web/next.config.ts).
#
# El contexto de build es la RAÍZ del repo, no este directorio:
#   docker build -f deploy/Dockerfile -t suarex-web .

FROM node:22-alpine AS builder
WORKDIR /repo

RUN corepack enable

# Se copia el repo entero (el .dockerignore de la raíz deja fuera node_modules, .next,
# .git y los .env). Instalar por capas copiando solo los package.json daría mejor caché,
# pero con 9 paquetes en el workspace la lista se desincroniza en silencio en cuanto se
# añade uno: se prefiere un build reproducible a uno rápido, que aquí se lanza a mano.
COPY . .

RUN pnpm install --frozen-lockfile

# Las NEXT_PUBLIC_* se hornean en el bundle del navegador EN TIEMPO DE BUILD: no basta con
# pasarlas al contenedor en runtime. La anon key es pública por diseño (RLS es lo que acota
# qué ve cada usuario), así que no hay problema en que acabe en la imagen. La service role
# key NO se pasa aquí ni se usa en build: solo entra como variable de entorno en runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# TENANT_ROOT_DOMAINS se lee en runtime (proxy.ts), pero `resolveRootDomains` lanza fuera de
# `development` si falta, y Next evalúa el módulo del proxy durante el build. Un valor de
# relleno basta: el de verdad llega por entorno al arrancar.
ENV TENANT_ROOT_DOMAINS=build.invalid
ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --filter @suarex/web build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Usuario sin privilegios: el proceso no necesita root para servir.
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 -G nodejs nextjs

# La traza de standalone reproduce la estructura del monorepo: server.js queda bajo
# apps/web/ y los node_modules deduplicados en la raíz.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000

CMD ["node", "apps/web/server.js"]
