-- MÉTODOS DE PAGO CONFIGURABLES: el esquema deja de hablar en Paytef.
--
-- `tenant_payment_config` nació con las columnas de Paytef metidas dentro (`access_key`,
-- `secret_key`, `company_id`) y `devices.pinpad_id` con su vocabulario. Funciona perfectamente
-- para Paytef y no sirve para nada más: el día que un cliente quiera cobrar por otro sitio habría
-- que añadir columnas de ESE proveedor al lado, y así hasta convertir la tabla en la unión de
-- todos los proveedores que han pasado por aquí.
--
-- A partir de esta migración lo que se guarda son DOS objetos: `config` (lo que se puede enseñar)
-- y `secrets` (lo que no vuelve nunca al panel). Qué claves llevan dentro lo decide el propio
-- proveedor, que las declara en su `configFields` (ver `payment-provider.ts` en el agente). El
-- esquema deja de tener opinión sobre eso, que es justo lo que permite añadir un proveedor sin
-- tocar la base.
--
-- ---------------------------------------------------------------- compatibilidad
--
-- NADA se borra aquí, y es deliberado. En el local de un cliente hay un Electron corriendo una
-- build que llama a `get_payment_config_self()` esperando seis columnas concretas. Si esa función
-- cambiara de forma, ESE TOTEM DEJARÍA DE COBRAR hasta actualizarse -- y hay auto-update, pero no
-- es instantáneo y un totem parado en horario de servicio es dinero que no entra.
--
-- Así que la función vieja se queda viva y devolviendo exactamente lo de siempre (se reescribe
-- solo por dentro, para leer la columna renombrada), y la forma nueva vive en
-- `get_payment_config_self_v2`. La retirada de lo viejo va en su propia migración, cuando conste
-- que todos los agentes están actualizados.

-- ---------------------------------------------------------------- config y secretos genéricos

alter table public.tenant_payment_config
  add column config jsonb not null default '{}'::jsonb,
  add column secrets jsonb not null default '{}'::jsonb;

-- El `check (provider in ('paytef'))` obligaba a una migración por cada proveedor nuevo, que es
-- exactamente el acoplamiento que se está quitando. Quien decide si un proveedor existe es el
-- REGISTRO del agente, que además ya sabe responder a un id desconocido sin reventar (devuelve
-- `null` y el cobro sale como rechazado con motivo). Aquí solo se impide el vacío.
alter table public.tenant_payment_config drop constraint tenant_payment_config_provider_check;
alter table public.tenant_payment_config
  add constraint tenant_payment_config_provider_check check (provider <> '');

-- Los datos que ya existen, a su sitio. Las claves son las que declara `paytefProvider`
-- (`accessKey`, `secretKey`, `companyId`): es el ÚNICO punto donde el esquema y el vocabulario de
-- un driver se tocan, y ocurre una vez, aquí. En tiempo de ejecución nadie vuelve a saberlo.
update public.tenant_payment_config
   set config = jsonb_strip_nulls(
         jsonb_build_object('accessKey', nullif(access_key, ''), 'companyId', nullif(company_id, ''))
       ),
       secrets = jsonb_strip_nulls(jsonb_build_object('secretKey', nullif(secret_key, '')))
 where provider = 'paytef';

-- Las viejas dejan de ser obligatorias: a partir de la fase siguiente el alta escribe solo los
-- objetos, y un `not null` aquí obligaría a rellenar campos de Paytef para configurar otro
-- proveedor cualquiera.
alter table public.tenant_payment_config alter column access_key drop not null;
alter table public.tenant_payment_config alter column secret_key drop not null;

-- ---------------------------------------------------------------- el terminal, sin marca

-- "pinpad" es como llama Paytef a su aparato. El concepto -- cuál de mis terminales es este -- lo
-- tienen todos los proveedores de terminal desatendido, así que la columna se queda (sigue siendo
-- por dispositivo: un comercio con dos totems tiene dos terminales y una sola cuenta) y lo que
-- cambia es el nombre. `rename` conserva los datos: ningún totem pierde su datáfono.
alter table public.devices rename column pinpad_id to payment_terminal_id;

-- ---------------------------------------------------------------- RPC vieja: intacta por fuera

-- Misma firma y mismas columnas de salida que antes -- incluido el nombre `pinpad_id`, del que
-- dependen los agentes ya desplegados. Solo cambia de dónde lee. Se reescribe porque, si no, la
-- columna renombrada la habría dejado rota, que es precisamente lo que esta migración evita.
create or replace function public.get_payment_config_self()
returns table (
  provider text,
  access_key text,
  secret_key text,
  company_id text,
  mock boolean,
  pinpad_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_terminal text;
begin
  select d.tenant_id, d.payment_terminal_id into v_tenant, v_terminal
  from public.devices d
  where d.auth_user_id = auth.uid();

  if v_tenant is null then
    return; -- quien llama no es un device emparejado: sin config
  end if;

  /* Se sirve desde los objetos nuevos, con caída a las columnas viejas: así un agente antiguo
     sigue viendo la config aunque el panel ya la haya guardado en el formato nuevo. Sin esto, la
     compatibilidad duraría solo hasta la primera vez que alguien tocara los ajustes de pago. */
  return query
  select
    c.provider,
    coalesce(c.config ->> 'accessKey', c.access_key),
    coalesce(c.secrets ->> 'secretKey', c.secret_key),
    coalesce(c.config ->> 'companyId', c.company_id),
    c.mock,
    v_terminal
  from public.tenant_payment_config c
  where c.tenant_id = v_tenant;
end;
$$;

-- ---------------------------------------------------------------- RPC nueva: genérica

-- Mismo aislamiento que la vieja y que `reserve_printed_self`: SECURITY DEFINER acotada por
-- `auth.uid()` -> la fila `devices` del propio dispositivo -> su tenant. Quien no sea un device
-- emparejado no obtiene nada, y ningún device puede leer la tabla directamente (no hay policy que
-- le aplique). Los secretos salen SOLO por aquí.
create or replace function public.get_payment_config_self_v2()
returns table (
  provider text,
  config jsonb,
  secrets jsonb,
  mock boolean,
  terminal_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_terminal text;
begin
  select d.tenant_id, d.payment_terminal_id into v_tenant, v_terminal
  from public.devices d
  where d.auth_user_id = auth.uid();

  if v_tenant is null then
    return;
  end if;

  return query
  select c.provider, c.config, c.secrets, c.mock, v_terminal
  from public.tenant_payment_config c
  where c.tenant_id = v_tenant;
end;
$$;

revoke execute on function public.get_payment_config_self_v2 () from anon, public;
grant execute on function public.get_payment_config_self_v2 () to authenticated;
