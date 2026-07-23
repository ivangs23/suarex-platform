/**
 * Traducciones al inglés y al portugués de la carta de Manuela.
 *
 * POR QUÉ ESTO EXISTE. El selector de idioma es FUNCIONALIDAD -- la tiene todo cliente -- pero
 * solo se pinta en los idiomas en los que ese cliente TIENE carta (ver `availableLangs` en
 * `apps/web/lib/i18n.ts`): ofrecer "EN" para acabar enseñando la carta en español es peor que
 * no ofrecerlo. El catálogo real de Manuela entró solo en español, así que su selector no
 * aparecía. Aquí están sus traducciones para que sí tenga las tres.
 *
 * QUÉ SE TRADUCE. Las descripciones (listas de ingredientes) y los nombres de categoría
 * genéricos. Los nombres de PLATO se dejan como están -- son de marca ("La Bonita", "Mollefit")
 * y no se traducen -- y los de categoría que son marca o topónimo ("Rioja", "Fanta",
 * "Salobreña") se copian igual en los tres idiomas: en inglés y en portugués se llaman igual.
 *
 * Se casa por el texto en español, no por id: así sigue valiendo aunque se reimporte el
 * catálogo (que reasigna ids). Ejecutar `scripts/traducir-manuela.mjs` después de cada import.
 */

/** Nombre de categoría en español -> { en, pt }. Marcas y topónimos se copian igual. */
export const CATEGORIAS = {
  Agua: { en: "Water", pt: "Água" },
  Aquarius: { en: "Aquarius", pt: "Aquarius" },
  Batidos: { en: "Milkshakes", pt: "Batidos" },
  "Bittle kass": { en: "Bittle kass", pt: "Bittle kass" },
  Blanco: { en: "White", pt: "Branco" },
  Bollería: { en: "Pastries", pt: "Pastelaria" },
  Botella: { en: "Bottle", pt: "Garrafa" },
  Cafés: { en: "Coffees", pt: "Cafés" },
  Cavas: { en: "Cavas", pt: "Cavas" },
  Cervezas: { en: "Beers", pt: "Cervejas" },
  Cocacola: { en: "Coca-Cola", pt: "Coca-Cola" },
  Copa: { en: "Glass", pt: "Taça" },
  Fanta: { en: "Fanta", pt: "Fanta" },
  Montados: { en: "Montados", pt: "Montados" },
  Nestea: { en: "Nestea", pt: "Nestea" },
  "Pinchos Manuelita": { en: "Manuelita tapas", pt: "Petiscos Manuelita" },
  Poke: { en: "Poke", pt: "Poke" },
  Redbull: { en: "Red Bull", pt: "Red Bull" },
  Refrescos: { en: "Soft drinks", pt: "Refrigerantes" },
  "Ribera del duero": { en: "Ribera del Duero", pt: "Ribera del Duero" },
  "Ribera del guadiana": { en: "Ribera del Guadiana", pt: "Ribera del Guadiana" },
  Rioja: { en: "Rioja", pt: "Rioja" },
  Rosado: { en: "Rosé", pt: "Rosé" },
  Salobreña: { en: "Salobreña", pt: "Salobreña" },
  Sprite: { en: "Sprite", pt: "Sprite" },
  Spritz: { en: "Spritz", pt: "Spritz" },
  "Tazones fitt": { en: "Fit bowls", pt: "Taças fit" },
  Tea: { en: "Tea", pt: "Chá" },
  Tinto: { en: "Red", pt: "Tinto" },
  Tostadas: { en: "Toasts", pt: "Torradas" },
  "Tostadas Especiales": { en: "Special toasts", pt: "Torradas especiais" },
  "Tostadas Healthy": { en: "Healthy toasts", pt: "Torradas saudáveis" },
  "Tostadas tradicionales": { en: "Traditional toasts", pt: "Torradas tradicionais" },
  Trina: { en: "Trina", pt: "Trina" },
  Vermut: { en: "Vermouth", pt: "Vermute" },
  Vinos: { en: "Wines", pt: "Vinhos" },
  Zumos: { en: "Juices", pt: "Sumos" },
};

/**
 * Nombre de extra (opción de plato) en español -> { en, pt }. Los lee el comensal en la ficha,
 * así que se traducen igual que las descripciones. Se listan todas las variantes de mayúscula y
 * plural que trae el catálogo para que ninguna fila quede sin casar.
 */
export const EXTRAS = {
  "leche sin lactosa": { en: "Lactose-free milk", pt: "Leite sem lactose" },
  "Leche sin lactosa": { en: "Lactose-free milk", pt: "Leite sem lactose" },
  "leche de avena": { en: "Oat milk", pt: "Leite de aveia" },
  "Leche de avena": { en: "Oat milk", pt: "Leite de aveia" },
  "leche de almendra": { en: "Almond milk", pt: "Leite de amêndoa" },
  "leche de almendras": { en: "Almond milk", pt: "Leite de amêndoa" },
  "Leche de almendra": { en: "Almond milk", pt: "Leite de amêndoa" },
  "Pan sin gluten": { en: "Gluten-free bread", pt: "Pão sem glúten" },
  "Pan togo sarraceno": { en: "Buckwheat bread", pt: "Pão de trigo-sarraceno" },
  "Pan integral": { en: "Wholemeal bread", pt: "Pão integral" },
  "Pan de centeno": { en: "Rye bread", pt: "Pão de centeio" },
};

/** Descripción de producto en español -> { en, pt }. Casada por el texto exacto en español. */
export const DESCRIPCIONES = {
  "Pan de centeno, crema de cacahuete, queso ricota, manzana, canela y chocolate": {
    en: "Rye bread, peanut butter, ricotta cheese, apple, cinnamon and chocolate",
    pt: "Pão de centeio, manteiga de amendoim, ricota, maçã, canela e chocolate",
  },
  "Pan sin gluten, pate de zanahoria con pistacho, queso fresco, tiras de zanahoria, oregano y semillas de calabaza":
    {
      en: "Gluten-free bread, carrot and pistachio pâté, fresh cheese, carrot strips, oregano and pumpkin seeds",
      pt: "Pão sem glúten, patê de cenoura com pistácio, queijo fresco, tiras de cenoura, orégãos e sementes de abóbora",
    },
  "Pan integral con base de pimenton,yogurt y pipas de girasol, pavo, pimienta molida y limón": {
    en: "Wholemeal bread with a paprika base, yogurt and sunflower seeds, turkey, ground pepper and lemon",
    pt: "Pão integral com base de colorau, iogurte e sementes de girassol, peru, pimenta moída e limão",
  },
  "Jamón ibérico, lomo, tomate, aceite y pimiento ": {
    en: "Iberian ham, pork loin, tomato, olive oil and pepper",
    pt: "Presunto ibérico, lombo, tomate, azeite e pimento",
  },
  "(preguntar al chef) Yogurt, avena y fruta de temporada": {
    en: "(ask the chef) Yogurt, oats and seasonal fruit",
    pt: "(perguntar ao chef) Iogurte, aveia e fruta da época",
  },
  "Yogurt, avena, kiwi, pistacho y chocolate negro 85%": {
    en: "Yogurt, oats, kiwi, pistachio and 85% dark chocolate",
    pt: "Iogurte, aveia, kiwi, pistácio e chocolate negro 85%",
  },
  "Manzana, avena, canela, proteina de vainilla y sirope de ágave": {
    en: "Apple, oats, cinnamon, vanilla protein and agave syrup",
    pt: "Maçã, aveia, canela, proteína de baunilha e xarope de agave",
  },
  "Café solo con licor a elegir": {
    en: "Black coffee with a liqueur of your choice",
    pt: "Café com licor à escolha",
  },
  "Café solo con leche condensada y cacao en polvo": {
    en: "Black coffee with condensed milk and cocoa powder",
    pt: "Café com leite condensado e cacau em pó",
  },
  "Café solo largo": { en: "Long black coffee", pt: "Café longo (americano)" },
  "un espresso (30 ml), leche caliente y espuma de leche, servido a menudo con cacao en polvo": {
    en: "an espresso (30 ml), hot milk and milk foam, often served with cocoa powder",
    pt: "um espresso (30 ml), leite quente e espuma de leite, servido muitas vezes com cacau em pó",
  },
  "Petroni, cava y agua con gas": {
    en: "Petroni, cava and sparkling water",
    pt: "Petroni, cava e água com gás",
  },
  "Ingredientes según temporada": {
    en: "Ingredients depending on the season",
    pt: "Ingredientes conforme a época",
  },
  "Pan sin gluten, queso ricota, un huevo plancha, aguacate machacado y semillas de chia": {
    en: "Gluten-free bread, ricotta cheese, a griddled egg, mashed avocado and chia seeds",
    pt: "Pão sem glúten, ricota, um ovo estrelado na chapa, abacate amassado e sementes de chia",
  },
  "pan de centeno, requesón, huevo a la plancha, pepino en láminas con eneldo fresco y semillas de calabaza tostadas":
    {
      en: "rye bread, curd cheese, griddled egg, sliced cucumber with fresh dill and toasted pumpkin seeds",
      pt: "pão de centeio, requeijão, ovo na chapa, pepino às fatias com endro fresco e sementes de abóbora torradas",
    },
  "Aceite, rodajas de tomate, ricote, aguacate y frutos secos": {
    en: "Olive oil, tomato slices, ricotta, avocado and nuts",
    pt: "Azeite, rodelas de tomate, ricota, abacate e frutos secos",
  },
  "Aceite, coppa 100% iberica": {
    en: "Olive oil, 100% Iberian coppa",
    pt: "Azeite, coppa 100% ibérica",
  },
  "Mollete integral, hummus con remolacha, atún al natural, tiras pimiento del piquillo y semillas de girasol":
    {
      en: "Wholemeal mollete bun, beetroot hummus, tuna in brine, piquillo pepper strips and sunflower seeds",
      pt: "Mollete integral, húmus com beterraba, atum ao natural, tiras de pimento piquillo e sementes de girassol",
    },
  "Pan brioche, crema de queso, salmón ahumado y huevo revuelto": {
    en: "Brioche bread, cream cheese, smoked salmon and scrambled egg",
    pt: "Pão brioche, queijo creme, salmão fumado e ovo mexido",
  },
  "Aperol, cava, agua con gas": {
    en: "Aperol, cava, sparkling water",
    pt: "Aperol, cava, água com gás",
  },
  "Aceite, aguacate, fiambre de pavo casero a las finas hiervas y queso brie": {
    en: "Olive oil, avocado, homemade herb turkey cold cut and brie cheese",
    pt: "Azeite, abacate, fiambre de peru caseiro com ervas finas e queijo brie",
  },
  "Salmón marinado, aguacate, edamame, zanahoria, pipas de calabaza y sésamo": {
    en: "Marinated salmon, avocado, edamame, carrot, pumpkin seeds and sesame",
    pt: "Salmão marinado, abacate, edamame, cenoura, sementes de abóbora e sésamo",
  },
  "Per se, cava y agua con gas": {
    en: "Per se, cava and sparkling water",
    pt: "Per se, cava e água com gás",
  },
  "Mantequilla, york y queso": {
    en: "Butter, cooked ham and cheese",
    pt: "Manteiga, fiambre e queijo",
  },
  "zanahoria, atún, lechuga, mahonesa y pavo": {
    en: "carrot, tuna, lettuce, mayonnaise and turkey",
    pt: "cenoura, atum, alface, maionese e peru",
  },
  "Pan de trigo sarraceno, tortilla de un huevo con atún al natural, canonigos con limón exprimido, aceite de oliva y sésamo negro":
    {
      en: "Buckwheat bread, one-egg omelette with tuna in brine, lamb's lettuce with squeezed lemon, olive oil and black sesame",
      pt: "Pão de trigo-sarraceno, omelete de um ovo com atum ao natural, canónigos com limão espremido, azeite e sésamo preto",
    },
  "Tomate rallado, tortilla francesa y jamón gran reserva": {
    en: "Grated tomato, plain omelette and gran reserva ham",
    pt: "Tomate ralado, omelete simples e presunto gran reserva",
  },
  "Crema de queso, bacon plancheado, queso curado y pimentón de La Vera": {
    en: "Cream cheese, griddled bacon, cured cheese and La Vera paprika",
    pt: "Queijo creme, bacon na chapa, queijo curado e colorau de La Vera",
  },
  "Tomate, aceite, jamón iberico y queso curado": {
    en: "Tomato, olive oil, Iberian ham and cured cheese",
    pt: "Tomate, azeite, presunto ibérico e queijo curado",
  },
};

/**
 * Funde traducciones en un campo i18n SIN pisar lo que ya hay. El español manda: si el mapa
 * trae un `es`, se ignora -- el de la base es la fuente. Devuelve el objeto nuevo, o el mismo
 * si no cambia nada (para no escribir de más).
 */
export function fundirI18n(actual, traduccion) {
  const base = actual && typeof actual === "object" ? actual : {};
  const siguiente = { ...base };
  for (const lang of ["en", "pt"]) {
    const valor = traduccion?.[lang]?.trim();
    if (valor) siguiente[lang] = valor;
  }
  const cambia = ["en", "pt"].some((lang) => siguiente[lang] !== base[lang]);
  return cambia ? siguiente : null;
}

/**
 * Planea las actualizaciones: para cada fila cuya versión española esté en `mapa`, calcula el
 * campo i18n fundido. Devuelve solo las que cambian, como `{ id, valor }`. Puro: no toca la red,
 * así se prueba sin base de datos.
 */
export function planear(filas, campo, mapa) {
  const updates = [];
  for (const fila of filas) {
    const es = fila[campo]?.es?.trim();
    if (!es) continue;
    const traduccion = mapa[es];
    if (!traduccion) continue;
    const fundido = fundirI18n(fila[campo], traduccion);
    if (fundido) updates.push({ id: fila.id, valor: fundido });
  }
  return updates;
}
