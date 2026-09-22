-- Run AFTER deploying the sales worker and applying 20260922202559_sales_shared_stock.sql.
-- Re-running replaces the schedule; it does NOT reset the activation date or stock.
create extension if not exists pg_cron;
create extension if not exists pg_net;
-- Hourly recovery only; incoming sale notifications still start work immediately.
select cron.schedule('despachos-shared-stock', '0 * * * *', $job$
  select net.http_post(
    url := 'https://control-stock-ventas-despachos.vercel.app/api/inventory/worker',
    headers := jsonb_build_object('Content-Type','application/json','Authorization',
      'Bearer ' || (select worker_token from public.sales_stock_config where id)),
    body := '{}'::jsonb,
    timeout_milliseconds := 180000
  )
  where exists (
    select 1 from public.sales_stock_jobs
    where status <> 'done' and next_attempt <= now()
      and (lease_until is null or lease_until < now())
  ) or exists (
    select 1 from public.listing_stock_jobs
    where (status in ('pending','running')
      or (status = 'error' and updated_at < now() - interval '5 minutes'))
      and (lease_until is null or lease_until < now())
  );
$job$);
