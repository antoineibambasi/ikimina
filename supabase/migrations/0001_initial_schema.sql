create type public.app_role as enum ('admin', 'participant');
create type public.member_status as enum ('active', 'inactive');
create type public.period_status as enum ('draft', 'closed');
create type public.export_kind as enum ('pdf', 'xlsx');

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'EUR',
  start_month date not null,
  end_month date not null,
  contribution_cents integer not null default 10000 check (contribution_cents >= 0),
  saving_cents integer not null default 2000 check (saving_cents >= 0),
  mutual_insurance_cents integer not null default 500 check (mutual_insurance_cents >= 0),
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  succession_order integer not null,
  status public.member_status not null default 'active',
  created_at timestamptz not null default now(),
  unique (name),
  unique (succession_order)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role public.app_role not null default 'participant',
  member_id uuid references public.members(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.periods (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  label text not null,
  month date not null,
  status public.period_status not null default 'draft',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (cycle_id, month)
);

create table public.opening_balances (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  credit_cents integer not null default 0,
  travel_saving_cents integer not null default 0,
  created_at timestamptz not null default now(),
  unique (cycle_id, member_id)
);

create table public.monthly_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  contribution_cents integer not null default 0 check (contribution_cents >= 0),
  saving_cents integer not null default 0 check (saving_cents >= 0),
  mutual_insurance_cents integer not null default 0 check (mutual_insurance_cents >= 0),
  loan_cents integer not null default 0 check (loan_cents >= 0),
  repayment_cents integer not null default 0 check (repayment_cents >= 0),
  travel_cents integer not null default 0,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (period_id, member_id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.periods(id) on delete cascade,
  kind public.export_kind not null,
  file_name text not null,
  storage_path text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_periods_cycle_month on public.periods(cycle_id, month);
create index idx_monthly_entries_period on public.monthly_entries(period_id);
create index idx_monthly_entries_member on public.monthly_entries(member_id);
create index idx_audit_events_created_at on public.audit_events(created_at desc);

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  );
$$;

create or replace function public.period_is_draft(target_period_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.periods
    where id = target_period_id
      and status = 'draft'
  );
$$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger monthly_entries_touch_updated_at
before update on public.monthly_entries
for each row execute function public.touch_updated_at();

alter table public.cycles enable row level security;
alter table public.members enable row level security;
alter table public.profiles enable row level security;
alter table public.periods enable row level security;
alter table public.opening_balances enable row level security;
alter table public.monthly_entries enable row level security;
alter table public.audit_events enable row level security;
alter table public.exports enable row level security;

create policy "authenticated can read cycles"
on public.cycles for select
to authenticated
using (true);

create policy "admin can manage cycles"
on public.cycles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authenticated can read members"
on public.members for select
to authenticated
using (true);

create policy "admin can manage members"
on public.members for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "users can read own profile"
on public.profiles for select
to authenticated
using (id = auth.uid() or public.is_admin());

create policy "admin can manage profiles"
on public.profiles for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authenticated can read periods"
on public.periods for select
to authenticated
using (true);

create policy "admin can manage periods"
on public.periods for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authenticated can read opening balances"
on public.opening_balances for select
to authenticated
using (true);

create policy "admin can manage opening balances"
on public.opening_balances for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "authenticated can read monthly entries"
on public.monthly_entries for select
to authenticated
using (true);

create policy "admin can insert draft monthly entries"
on public.monthly_entries for insert
to authenticated
with check (public.is_admin() and public.period_is_draft(period_id));

create policy "admin can update draft monthly entries"
on public.monthly_entries for update
to authenticated
using (public.is_admin() and public.period_is_draft(period_id))
with check (public.is_admin() and public.period_is_draft(period_id));

create policy "admin can read audit events"
on public.audit_events for select
to authenticated
using (public.is_admin());

create policy "admin can insert audit events"
on public.audit_events for insert
to authenticated
with check (public.is_admin());

create policy "authenticated can read exports"
on public.exports for select
to authenticated
using (true);

create policy "admin can manage exports"
on public.exports for all
to authenticated
using (public.is_admin())
with check (public.is_admin());
