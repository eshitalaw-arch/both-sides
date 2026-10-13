-- Both Sides: database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a new project.

-- 1. Tables ---------------------------------------------------------------

create table if not exists countries (
  code       text primary key check (code ~ '^[a-z0-9-]{2,40}$'),  -- short id, e.g. 'uk', 'brazil'
  name       text not null,                                       -- shown on the tab
  sort       int  not null default 100,                           -- lower numbers appear first
  created_at timestamptz not null default now()
);

create table if not exists topics (
  id         bigint generated always as identity primary key,
  country    text not null references countries(code) on update cascade,
  title      text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists statements (
  id         bigint generated always as identity primary key,
  topic_id   bigint not null references topics(id) on delete cascade,
  text       text not null,
  context    text,
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  -- "Where the debate stands" (filled in by an admin; leave empty to hide the strip)
  stands_supported text,
  stands_disputed  text,
  stands_depends   text,
  stands_status    text,   -- e.g. 'No new arguments since 8 Oct'
  stands_basis     text,   -- e.g. 'Drafted from 7 approved reasons, approved 9 Oct.'
  created_at timestamptz not null default now()
);

create table if not exists reasons (
  id           bigint generated always as identity primary key,
  statement_id bigint not null references statements(id) on delete cascade,
  side         text not null check (side in ('favor', 'against')),
  text         text not null,
  author       text not null default 'Anonymous',
  source_label text,
  source_url   text,
  -- Tag (set by an admin; most reasons have none)
  tag          text check (tag in ('fallacy', 'overclaims', 'evidence', 'value', 'strong')),
  tag_detail   text,   -- e.g. 'Appeal to ignorance' for a fallacy
  tag_why      text,
  tag_fix      text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at   timestamptz not null default now()
);

-- 2. Security: the public can read approved content and submit new items ---

alter table countries  enable row level security;
alter table topics     enable row level security;
alter table statements enable row level security;
alter table reasons    enable row level security;

create policy "Anyone can read countries"
  on countries for select using (true);

create policy "Anyone can read topics"
  on topics for select using (true);

create policy "Anyone can read approved statements"
  on statements for select using (status = 'approved');

create policy "Anyone can read approved reasons"
  on reasons for select using (status = 'approved');

-- Submissions always arrive as 'pending' with no summary, so an admin approves them first.
create policy "Anyone can submit a statement for review"
  on statements for insert
  with check (
    status = 'pending'
    and char_length(text) between 10 and 300
    and (context is null or char_length(context) <= 300)
    and stands_supported is null and stands_disputed is null and stands_depends is null
    and stands_status is null and stands_basis is null
  );

-- Reasons arrive as 'pending', untagged, and only on approved statements.
create policy "Anyone can submit a reason for review"
  on reasons for insert
  with check (
    status = 'pending'
    and char_length(text) between 10 and 280
    and char_length(author) between 1 and 60
    and tag is null and tag_detail is null and tag_why is null and tag_fix is null
    and exists (select 1 from statements s where s.id = statement_id and s.status = 'approved')
  );

-- Let the website (the "anon" role) read and submit, nothing more.
-- The policies above still decide WHICH rows it can see or add.
grant usage on schema public to anon, authenticated;
grant select on countries, topics, statements, reasons to anon, authenticated;
grant insert on statements, reasons to anon, authenticated;

-- 3. Starting topics ---------------------------------------------------------

insert into countries (code, name, sort) values
  ('india', 'India', 1),
  ('us',    'United States', 2);

insert into topics (country, title, sort) values
  ('india', 'Election Commission protests', 1),
  ('us',    'Immigration',                  1);
