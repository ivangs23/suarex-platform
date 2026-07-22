/// <reference types="electron-vite/node" />

// electron-vite's ambient `ImportMetaEnv` (see `electron-vite/node.d.ts`) only declares
// `MODE`/`DEV`/`PROD`. The custom keys baked at build time via `define` in
// `electron.vite.config.ts` (see `baked-config.ts`) need to be declared here so
// `import.meta.env.SUPABASE_URL`/`SUPABASE_ANON_KEY` typecheck.
interface ImportMetaEnv {
  readonly SUPABASE_URL?: string;
  readonly SUPABASE_ANON_KEY?: string;
  readonly PLATFORM_WEB_ORIGIN?: string;
}
