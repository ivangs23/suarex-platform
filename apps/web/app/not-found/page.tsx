// Ruta estática literal para "/not-found", el mismo patrón que app/suspended/page.tsx.
// Necesaria porque proxy.ts reescribe el host desconocido a la URL literal
// "/not-found" (no al límite especial reservado app/not-found.tsx, que Next
// solo usa automáticamente para notFound()/rutas sin ningún archivo que las
// sirva). Sin esta ruta estática, el segmento dinámico app/[mesa]/page.tsx
// capturaría "/not-found" como mesa="not-found" y lanzaría en requireTenant(),
// devolviendo 500 en vez del 404 que fija proxy.ts.
export default function NotFoundRoute() {
  return (
    <main>
      <h1>Carta no encontrada</h1>
      <p>Esta dirección no corresponde a ningún establecimiento.</p>
    </main>
  );
}
