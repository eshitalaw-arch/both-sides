-- Lets reviewers add or remove the note (tag) on an argument from the review page.
-- Run ONCE in Supabase → SQL Editor → New query → Run. Safe to run again.

alter table decisions drop constraint if exists decisions_decision_check;
alter table decisions add constraint decisions_decision_check
  check (decision in ('approved', 'rejected', 'deleted', 'summary', 'note'));

create or replace function admin_set_tag(
  p_id     bigint,
  p_tag    text,
  p_detail text default null,
  p_why    text default null,
  p_fix    text default null
) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_by text := (select email from auth.users where id = auth.uid());
  v_text text;
  v_tag text := nullif(btrim(coalesce(p_tag, '')), '');
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if v_tag = 'none' then v_tag := null; end if;
  if v_tag is not null and v_tag not in ('fallacy', 'overclaims', 'evidence', 'value', 'strong') then
    raise exception 'Unknown note type';
  end if;
  update reasons set
    tag        = v_tag,
    tag_detail = case when v_tag = 'fallacy' then nullif(btrim(left(coalesce(p_detail, ''), 60)), '') end,
    tag_why    = case when v_tag is not null then nullif(btrim(left(coalesce(p_why, ''), 400)), '') end,
    tag_fix    = case when v_tag is not null then nullif(btrim(left(coalesce(p_fix, ''), 400)), '') end
  where id = p_id
  returning text into v_text;
  if v_text is null then raise exception 'Unknown argument'; end if;
  insert into decisions (kind, item_id, item_text, decision, by_email)
    values ('reason', p_id::text, v_text, 'note', v_by);
end;
$$;

revoke all on function admin_set_tag(bigint, text, text, text, text) from public, anon;
grant execute on function admin_set_tag(bigint, text, text, text, text) to authenticated;
