alter table fuel_trucks add column if not exists description text not null default '';
alter table fuel_trucks add column if not exists driver_user_id uuid;
alter table fuel_trucks add column if not exists km_initial numeric(12, 1) not null default 0;

alter table fuel_pumps add column if not exists number integer;
alter table fuel_pumps add column if not exists active boolean not null default true;

with numbered as (
  select id, row_number() over (partition by company_id order by name, id) as n
  from fuel_pumps
  where number is null
)
update fuel_pumps p set number = numbered.n from numbered where p.id = numbered.id;

alter table fuel_pumps alter column number set not null;
create unique index if not exists fuel_pumps_company_number_uidx on fuel_pumps (company_id, number);

alter table fuel_tanks add column if not exists active boolean not null default true;

create table if not exists fuel_meter_resets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  nozzle_id uuid not null references fuel_nozzles (id),
  reading numeric(14, 3) not null,
  reset_at timestamptz not null default now(),
  note text
);

alter table fuel_meter_resets enable row level security;
alter table fuel_meter_resets force row level security;
drop policy if exists fuel_meter_resets_select on fuel_meter_resets;
drop policy if exists fuel_meter_resets_insert on fuel_meter_resets;
create policy fuel_meter_resets_select on fuel_meter_resets for select
  using (company_id = app_company_id() and app_has_permission('estacion.ver'));
create policy fuel_meter_resets_insert on fuel_meter_resets for insert
  with check (company_id = app_company_id() and app_has_permission('estacion.editar'));

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'talon_app') then
    grant select, insert, update, delete on fuel_meter_resets to talon_app;
  end if;
end $$;
