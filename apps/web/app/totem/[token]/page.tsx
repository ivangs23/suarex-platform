import { parseBranding } from "@suarex/config";
import {
  findDeviceByTotemToken,
  getCategories,
  getProducts,
  getTenantSettings,
  listAssignableAllergens,
} from "@suarex/db";
import { notFound } from "next/navigation";
import { availableLangs, LANG_LABELS, resolveLang, strings } from "@/lib/i18n";
import { requireTenant } from "@/lib/tenant-context";
import { buildMenuView } from "../../[mesa]/menu-view";
import { resolveTheme } from "../../[mesa]/themes";
import { TotemFlow } from "./TotemFlow";

/**
 * TOTEM / KIOSKO. La ventana kiosko del agente carga `https://<tenant>/totem/<token>`; el token
 * resuelve el dispositivo (y con él tenant+venue) y solo abre si el device tiene rol `kiosko`
 * (`findDeviceByTotemToken`). A diferencia del canal QR, aquí NO hace falta cookie de mesa: estás
 * físicamente ante el datáfono, así que `canOrder` es siempre `true`.
 *
 * La CARTA es la misma que la de la mesa -- el mismo tema del cliente, la misma navegación por
 * niveles (`?cat=`), los mismos datos. Lo que el totem añade es el ENVOLTORIO del flujo (elegir
 * para llevar / en mesa, teclear la mesa, pagar por datáfono, recoger): funcionalidad genérica,
 * pintada con la marca del cliente. Ese envoltorio vive en `TotemFlow` (cliente); esta página
 * solo carga los datos y resuelve el tema, igual que `[mesa]/page.tsx`.
 */
export default async function TotemPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  // El token resuelve el dispositivo. Solo un device con rol `kiosko` abre un totem; cualquier
  // otro (o un token inexistente) es un 404 limpio, sin revelar qué tokens existen.
  const entry = await findDeviceByTotemToken(token).catch(() => null);
  if (!entry) {
    notFound();
  }

  // El tenant lo pone el host (cabeceras del proxy). Debe COINCIDIR con el dueño del token: un
  // token de otro cliente cargado en este dominio no puede pintar la carta de nadie. Toda la
  // carga de datos usa `entry.tenantId` (el dueño real del totem), no el host, como autoridad.
  const tenant = await requireTenant().catch(() => null);
  if (!tenant || tenant.id !== entry.tenantId) {
    notFound();
  }

  const [categories, products, settings, allergens] = await Promise.all([
    getCategories(entry.tenantId),
    getProducts(entry.tenantId),
    getTenantSettings(entry.tenantId).catch(() => null),
    listAssignableAllergens(entry.tenantId),
  ]);

  const branding = parseBranding(settings?.branding);
  const businessName = branding.name ?? tenant.slug;
  const basePath = `/totem/${token}`;

  const rawCat = query.cat;
  const currentSlug = (Array.isArray(rawCat) ? rawCat[0] : rawCat) ?? null;

  const rawLang = Array.isArray(query.lang) ? query.lang[0] : query.lang;
  const porDefecto = resolveLang(undefined, settings?.locale);
  const lang = resolveLang(rawLang, settings?.locale);

  const idiomas = availableLangs(
    [...categories.map((c) => c.nameI18n), ...products.map((p) => p.nameI18n)],
    porDefecto,
  );

  const view = buildMenuView({
    categories,
    products,
    currentSlug,
    basePath,
    locale: settings?.locale,
    currency: settings?.currency,
    storageOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL,
    allergens,
    lang,
  });

  // Cambiar de idioma conserva DÓNDE estabas, igual que en la mesa, pero sobre la ruta del totem.
  const langs = idiomas.map((code) => {
    const partes = [
      currentSlug ? `cat=${encodeURIComponent(currentSlug)}` : null,
      code === porDefecto ? null : `lang=${code}`,
    ].filter(Boolean);
    return {
      code,
      label: LANG_LABELS[code],
      href: partes.length > 0 ? `${basePath}?${partes.join("&")}` : basePath,
      active: code === lang,
    };
  });

  const Theme = resolveTheme(settings?.theme);
  const t = strings(lang);

  // La carta se pinta con el tema del cliente, SIN su pantalla de bienvenida (el totem tiene la
  // suya, con los pasos previos) y con la mesa vacía: en el totem la mesa la elige el comensal en
  // el flujo, no viene fijada. El envoltorio del totem (pasos + pago) lo pone `TotemFlow`.
  const carta = (
    <Theme
      tenantSlug={tenant.slug}
      businessName={businessName}
      mesa=""
      branding={branding}
      view={view}
      welcome={{ active: false, href: basePath }}
      langs={langs}
      strings={t}
    />
  );

  return (
    <TotemFlow
      token={token}
      businessName={businessName}
      hasHero={branding.heroUrl !== null}
      locale={settings?.locale ?? "es"}
      currency={settings?.currency ?? "EUR"}
      strings={t}
    >
      {carta}
    </TotemFlow>
  );
}
