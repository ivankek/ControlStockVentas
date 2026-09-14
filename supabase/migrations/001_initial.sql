-- Apply once in the SQL editor of a dedicated Supabase project.
-- API clients cannot read/write these tables. All access goes through authenticated server routes.
create table public.account_states (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 version bigint not null default 1,
 state jsonb not null,
 updated_at timestamptz not null default now()
);
alter table public.account_states enable row level security;
revoke all on public.account_states from anon, authenticated;

create table public.meli_connections (
 owner_id uuid primary key references auth.users(id) on delete cascade,
 seller_id text not null unique,
 encrypted_tokens text not null,
 updated_at timestamptz not null default now()
);
alter table public.meli_connections enable row level security;
revoke all on public.meli_connections from anon, authenticated;

-- Compare-and-swap makes each full account mutation atomic. A second payment
-- retries against fresh state and sees that the orders were already paid.
create function public.save_account_state(p_owner uuid,p_expected bigint,p_state jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare changed integer;
begin
 if p_expected=0 then
  insert into account_states(owner_id,version,state) values(p_owner,1,p_state)
   on conflict(owner_id) do nothing;
 else
  update account_states set state=p_state,version=version+1,updated_at=now()
   where owner_id=p_owner and version=p_expected;
 end if;
 get diagnostics changed = row_count;
 return changed=1;
end;
$$;
revoke all on function public.save_account_state(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_account_state(uuid,bigint,jsonb) to service_role;
