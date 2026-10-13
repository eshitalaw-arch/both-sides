-- Lets anyone SUGGEST countries and topics (statements and reasons already work this way).
-- Everything suggested arrives as 'pending' and only appears after an admin approves it.
-- Run ONCE in Supabase → SQL Editor → New query → Run, AFTER add-countries.sql.
-- Safe to run again.

-- Countries -----------------------------------------------------------------
-- Existing countries stay live (approved); new suggestions arrive as pending.
alter table countries add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));
alter table countries alter column status set default 'pending';
alter table countries add column if not exists note text check (note is null or char_length(note) <= 300);

drop policy if exists "Anyone can read countries" on countries;
drop policy if exists "Anyone can read approved countries" on countries;
create policy "Anyone can read approved countries"
  on countries for select using (status = 'approved');

drop policy if exists "Anyone can suggest a country for review" on countries;
create policy "Anyone can suggest a country for review"
  on countries for insert
  with check (
    status = 'pending'
    and code ~ '^[a-z0-9-]{2,40}$'
    and char_length(name) between 2 and 60
    and sort = 100
  );

-- Topics --------------------------------------------------------------------
-- Existing topics stay live; new suggestions arrive as pending.
alter table topics add column if not exists status text not null default 'approved'
  check (status in ('pending', 'approved', 'rejected'));
alter table topics alter column status set default 'pending';
alter table topics alter column sort set default 100;

drop policy if exists "Anyone can read topics" on topics;
drop policy if exists "Anyone can read approved topics" on topics;
create policy "Anyone can read approved topics"
  on topics for select using (status = 'approved');

drop policy if exists "Anyone can suggest a topic for review" on topics;
create policy "Anyone can suggest a topic for review"
  on topics for insert
  with check (
    status = 'pending'
    and char_length(title) between 3 and 100
    and sort = 100
    and exists (select 1 from countries c where c.code = country and c.status = 'approved')
  );

-- Statements can only be suggested under an approved topic.
drop policy if exists "Anyone can submit a statement for review" on statements;
create policy "Anyone can submit a statement for review"
  on statements for insert
  with check (
    status = 'pending'
    and char_length(text) between 10 and 300
    and (context is null or char_length(context) <= 300)
    and stands_supported is null and stands_disputed is null and stands_depends is null
    and stands_status is null and stands_basis is null
    and exists (select 1 from topics t where t.id = topic_id and t.status = 'approved')
  );

grant insert on countries, topics, statements, reasons to anon, authenticated;
