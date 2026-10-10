create table public.dispatch_query_jobs (
 owner_id uuid not null references auth.users(id) on delete cascade,
 account_id uuid not null references public.meli_accounts(id) on delete cascade,
 id uuid not null default gen_random_uuid(),
 date_from date not null, date_to date not null,
 status text not null check (status in ('running','done','failed')),
 progress jsonb not null default '{}', result jsonb, error text,
 expires_at timestamptz not null,
 primary key(owner_id,account_id),
 check(date_from<=date_to)
);
alter table public.dispatch_query_jobs enable row level security;
revoke all on public.dispatch_query_jobs from public,anon,authenticated;
grant all on public.dispatch_query_jobs to service_role;
create function public.start_dispatch_query(p_owner uuid,p_account uuid,p_from date,p_to date)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare j dispatch_query_jobs%rowtype; fresh uuid:=gen_random_uuid();
begin
 if not exists(select 1 from meli_accounts where id=p_account and owner_id=p_owner) then raise exception 'account_not_owned'; end if;
 if p_from>p_to then raise exception 'invalid_dates'; end if;
 insert into dispatch_query_jobs(owner_id,account_id,id,date_from,date_to,status,expires_at)
 values(p_owner,p_account,fresh,p_from,p_to,'running',now()+interval '6 minutes')
 on conflict(owner_id,account_id) do nothing;
 select * into j from dispatch_query_jobs where owner_id=p_owner and account_id=p_account for update;
 if j.id=fresh then return jsonb_build_object('started',true,'job',to_jsonb(j)); end if;
 if j.status='running' and j.expires_at>now() then return jsonb_build_object('started',false,'job',to_jsonb(j)); end if;
 update dispatch_query_jobs set id=fresh,date_from=p_from,date_to=p_to,status='running',progress='{}',result=null,error=null,expires_at=now()+interval '6 minutes'
 where owner_id=p_owner and account_id=p_account returning * into j;
 return jsonb_build_object('started',true,'job',to_jsonb(j));
end $$;
revoke all on function public.start_dispatch_query(uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.start_dispatch_query(uuid,uuid,date,date) to service_role;
-- Expired results are never served; remove their payloads on a short schedule.
select cron.schedule('cleanup-dispatch-query-results','*/5 * * * *',
 $cleanup$delete from public.dispatch_query_jobs where expires_at<now() and status<>'running';
 update public.dispatch_query_jobs set status='failed',result=null,error='La consulta excedió el tiempo disponible. Volvé a consultar.',expires_at=now()+interval '15 minutes' where status='running' and expires_at<now();$cleanup$);

