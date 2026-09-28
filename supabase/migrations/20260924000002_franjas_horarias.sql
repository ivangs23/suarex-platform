-- FRANJAS HORARIAS DE CARTA.
--
-- Un local con dos servicios no quiere que a las 13:00 se vean los desayunos, ni que a las
-- 10:00 se pueda pedir la carta de cena. Hoy la carta es la misma a todas horas.
--
-- Va en CATEGORÍAS y no en productos porque es como piensa un hostelero: "la carta de
-- mediodía", no "este plato de 13 a 16". Y porque marcarlo plato a plato sería un trabajo que
-- nadie va a mantener.
--
-- `time` sin zona, no `timestamptz`: es una hora del día que se repite, no un instante. La
-- zona la pone la sede al comparar (`venues.timezone`).
alter table public.categories
  add column visible_desde time,
  add column visible_hasta time;

comment on column public.categories.visible_desde is
  'Hora local a partir de la cual se ve esta categoría. NULL = siempre. Si visible_hasta es menor, la franja cruza medianoche.';

-- Las dos a la vez o ninguna: media franja no significa nada, y dejarla a medias produciría
-- una carta que aparece y no desaparece (o al revés) sin que nadie entienda por qué.
alter table public.categories
  add constraint categories_franja_completa
  check ((visible_desde is null) = (visible_hasta is null));

-- Y `desde` distinto de `hasta`: "de 12:00 a 12:00" no significa nada obvio -- ¿24 horas o
-- ninguna? -- y la interpretación que elija el código sería una sorpresa la mitad de las veces.
alter table public.categories
  add constraint categories_franja_no_vacia
  check (visible_desde is null or visible_desde <> visible_hasta);
