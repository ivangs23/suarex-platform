-- El panel de comandas se suscribe a los cambios de `orders`. Realtime respeta
-- RLS para `postgres_changes` cuando el cliente está autenticado, así que cada
-- usuario solo debe recibir eventos de su propio tenant. Eso NO se da por
-- supuesto: `tests/integration/realtime-isolation.test.ts` lo demuestra.
alter publication supabase_realtime add table public.orders;

-- `replica identity full` hace que el payload de UPDATE incluya la fila
-- anterior completa. Sin esto, un UPDATE solo trae las columnas modificadas y
-- el filtrado por tenant del lado del cliente no puede confiarse.
alter table public.orders replica identity full;
