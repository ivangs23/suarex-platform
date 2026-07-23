-- Rate-limit de la creación de pedidos (POST /api/orders).
--
-- El agujero: crear un pedido no exige más que la cookie httpOnly que fija el QR al
-- escanearlo. Quien fotografíe un QR puede repetir la petición sin límite y saturar la
-- cocina de comandas. Ahora que el pago es real el daño es menor -- quedan pending sin
-- cobrar -- pero la impresora de cocina no distingue un pending de un pagado (ver
-- `listActiveOrders`: la comanda se ve en cuanto existe), así que el flood sigue llegando al
-- papel. Esto lo acota.
--
-- Contador por ventana fija en Postgres, mismo patrón que `pair_attempts`
-- (20260722000010): durable y compartido entre instancias -- un límite en memoria de
-- proceso sería inútil en cuanto haya más de un proceso web. A diferencia de aquel, esta
-- tabla es GENÉRICA (`bucket` + `key`): un endpoint nuevo que necesite rate-limit reusa la
-- misma función en vez de duplicar tabla y lógica. El emparejamiento se deja sobre su propia
-- tabla a propósito: es un camino de seguridad que ya funciona y no se toca.
--
-- No es tenant-scoped (no tiene `tenant_id`): la RLS se habilita y se deniega todo a
-- anon/authenticated; solo el service role (vía la RPC + el endpoint) la toca.
create table public.rate_limit_hits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null default now(),
  count int not null default 0,
  primary key (bucket, key)
);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Incrementa el contador de (`p_bucket`, `p_key`) en su ventana actual y devuelve si el
-- intento está permitido. Si la ventana venció, reinicia a 1. Todo en una sentencia con
-- ON CONFLICT: el UPDATE toma el lock de fila, así que dos peticiones concurrentes de la
-- misma clave se serializan y ninguna pierde su cuenta. Idéntica lógica que
-- `check_pair_rate_limit`, generalizada a un par (bucket, key).
create or replace function public.check_rate_limit(
  p_bucket text,
  p_key text,
  p_window_seconds int,
  p_max int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  insert into public.rate_limit_hits (bucket, key, window_start, count)
    values (p_bucket, p_key, now(), 1)
  on conflict (bucket, key) do update set
    window_start = case
      when public.rate_limit_hits.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else public.rate_limit_hits.window_start
    end,
    count = case
      when public.rate_limit_hits.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else public.rate_limit_hits.count + 1
    end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.check_rate_limit (text, text, int, int) from anon, authenticated, public;
grant execute on function public.check_rate_limit (text, text, int, int) to service_role;
