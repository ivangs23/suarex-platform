-- C2a: rate-limit del endpoint público POST /api/devices/pair. Los códigos ya son de 192
-- bits + TTL de 15 min (fuerza bruta inviable); esto es defensa en profundidad contra
-- abuso de volumen. Contador por ventana fija en Postgres (durable y compartido entre
-- instancias -- un límite en memoria de proceso sería inútil en serverless). No es una
-- tabla tenant-scoped (no tiene `tenant_id`): la RLS se habilita y se deniega todo a
-- anon/authenticated; solo el service role (vía la RPC + el endpoint) la toca.
create table public.pair_attempts (
  ip text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.pair_attempts enable row level security;
revoke all on public.pair_attempts from anon, authenticated;

-- Incrementa el contador de `p_ip` en su ventana actual y devuelve si el intento está
-- permitido. Si la ventana venció (window_start más viejo que p_window_seconds), reinicia
-- a 1. Todo en una sola sentencia con ON CONFLICT: el UPDATE toma el lock de fila, así que
-- dos peticiones concurrentes de la misma IP se serializan y ninguna pierde su cuenta.
create or replace function public.check_pair_rate_limit(
  p_ip text,
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
  insert into public.pair_attempts (ip, window_start, count)
    values (p_ip, now(), 1)
  on conflict (ip) do update set
    window_start = case
      when public.pair_attempts.window_start < now() - make_interval(secs => p_window_seconds)
        then now()
      else public.pair_attempts.window_start
    end,
    count = case
      when public.pair_attempts.window_start < now() - make_interval(secs => p_window_seconds)
        then 1
      else public.pair_attempts.count + 1
    end
  returning count into v_count;

  return v_count <= p_max;
end;
$$;

revoke execute on function public.check_pair_rate_limit (text, int, int) from anon, authenticated, public;
grant execute on function public.check_pair_rate_limit (text, int, int) to service_role;
