/**
 * Configuración de electron-builder. En JS y no en YAML por una sola razón: `publish` tiene que
 * ser OPCIONAL. electron-builder 26 aborta el empaquetado si un `${env.X}` del YAML no está
 * definido, y un build sin `UPDATE_FEED_URL` es legítimo (la app funciona; solo se queda sin
 * auto-update, ver `src/main/updater.ts`).
 */
const UPDATE_FEED_URL = process.env.UPDATE_FEED_URL;

module.exports = {
  appId: "app.suarex.agent",
  productName: "SuarEx Agente",
  directories: { output: "release", buildResources: "build" },
  files: ["out/**"],
  // koffi trae un binario nativo (.node): debe salir del asar para poder cargarse en runtime.
  asarUnpack: ["**/node_modules/koffi/**"],
  // El icono sale de scripts/generar-iconos.mjs. El instalador y el desinstalador usan el mismo.
  win: { target: [{ target: "nsis", arch: ["x64"] }], icon: "build/icon.ico" },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  // Auto-update (electron-updater). Proveedor "generic": una carpeta que sirve `latest.yml` + el
  // instalador. La URL es la misma que se hornea en la app para `autoUpdater.setFeedURL`; sin
  // ella el instalador no queda ligado a ningún feed (`null`: que no deduzca uno por su cuenta).
  publish: UPDATE_FEED_URL ? { provider: "generic", url: UPDATE_FEED_URL } : null,
};
