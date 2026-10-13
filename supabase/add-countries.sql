-- Adds a "countries" list so you can add new countries from the dashboard.
-- Run ONCE in Supabase → SQL Editor → New query → Run.
-- Safe to run on a database that already has topics, statements and reasons.

create table if not exists countries (
  code       text primary key check (code ~ '^[a-z0-9-]{2,40}$'),  -- short id, e.g. 'uk', 'brazil'
  name       text not null,                                       -- shown on the tab, e.g. 'United Kingdom'
  sort       int  not null default 100,                           -- lower numbers appear first
  created_at timestamptz not null default now()
);

insert into countries (code, name, sort) values
  ('india', 'India', 1),
  ('us',    'United States', 2)
on conflict (code) do nothing;

-- Topics can now belong to any country in the list (not just India and the US).
alter table topics drop constraint if exists topics_country_check;
alter table topics drop constraint if exists topics_country_fkey;
alter table topics
  add constraint topics_country_fkey
  foreign key (country) references countries(code) on update cascade;

alter table countries enable row level security;
drop policy if exists "Anyone can read countries" on countries;
create policy "Anyone can read countries" on countries for select using (true);
grant select on countries to anon, authenticated;
