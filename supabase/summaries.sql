-- "Where the discussion stands": a reviewed date, a "what would help resolve it" part,
-- and a function so reviewers can write summaries from the review page.
-- Run ONCE in Supabase → SQL Editor → New query → Run. Safe to run again.

alter table statements add column if not exists stands_resolve     text;
alter table statements add column if not exists stands_reviewed_at timestamptz;

-- Visitors can't slip a summary into a new debate.
drop policy if exists "Anyone can submit a statement for review" on statements;
create policy "Anyone can submit a statement for review"
  on statements for insert
  with check (
    status = 'pending'
    and char_length(text) between 10 and 300
    and (context is null or char_length(context) <= 300)
    and stands_supported is null and stands_disputed is null and stands_depends is null
    and stands_status is null and stands_basis is null
    and stands_resolve is null and stands_reviewed_at is null
    and exists (select 1 from topics t where t.id = topic_id and t.status = 'approved')
  );

alter table decisions drop constraint if exists decisions_decision_check;
alter table decisions add constraint decisions_decision_check
  check (decision in ('approved', 'rejected', 'deleted', 'summary'));

create or replace function admin_set_summary(
  p_id        bigint,
  p_supported text,
  p_disputed  text,
  p_resolve   text,
  p_status    text default null
) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_by text := (select email from auth.users where id = auth.uid());
  v_text text;
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if char_length(coalesce(p_supported, '')) > 600 or char_length(coalesce(p_disputed, '')) > 600
     or char_length(coalesce(p_resolve, '')) > 600 or char_length(coalesce(p_status, '')) > 80 then
    raise exception 'Each part of the summary must be under 600 characters';
  end if;
  update statements set
    stands_supported   = nullif(btrim(p_supported), ''),
    stands_disputed    = nullif(btrim(p_disputed), ''),
    stands_resolve     = nullif(btrim(p_resolve), ''),
    stands_status      = nullif(btrim(p_status), ''),
    stands_depends     = null,
    stands_basis       = null,
    stands_reviewed_at = now()
  where id = p_id
  returning text into v_text;
  if v_text is null then raise exception 'Unknown debate'; end if;
  insert into decisions (kind, item_id, item_text, decision, by_email)
    values ('statement', p_id::text, v_text, 'summary', v_by);
end;
$$;

revoke all on function admin_set_summary(bigint, text, text, text, text) from public, anon;
grant execute on function admin_set_summary(bigint, text, text, text, text) to authenticated;
