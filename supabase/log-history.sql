-- Keep the previous content in the decision log, so anything changed or deleted by mistake can be restored exactly.
-- Safe to run more than once.

alter table decisions add column if not exists previous jsonb;

-- Notes: remember the old note before changing it.
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
  v_old jsonb;
  v_text text;
  v_tag text := nullif(btrim(coalesce(p_tag, '')), '');
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if v_tag = 'none' then v_tag := null; end if;
  if v_tag is not null and v_tag not in ('fallacy', 'overclaims', 'evidence', 'value', 'strong') then
    raise exception 'Unknown note type';
  end if;
  select jsonb_build_object('tag', tag, 'tag_detail', tag_detail, 'tag_why', tag_why, 'tag_fix', tag_fix)
    into v_old from reasons where id = p_id;
  update reasons set
    tag        = v_tag,
    tag_detail = case when v_tag = 'fallacy' then nullif(btrim(left(coalesce(p_detail, ''), 60)), '') end,
    tag_why    = case when v_tag is not null then nullif(btrim(left(coalesce(p_why, ''), 400)), '') end,
    tag_fix    = case when v_tag is not null then nullif(btrim(left(coalesce(p_fix, ''), 400)), '') end
  where id = p_id
  returning text into v_text;
  if v_text is null then raise exception 'Unknown argument'; end if;
  insert into decisions (kind, item_id, item_text, decision, by_email, previous)
    values ('reason', p_id::text, v_text, 'note', v_by, v_old);
end;
$$;

-- Summaries: remember the old summary before replacing it.
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
  v_old jsonb;
  v_text text;
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if char_length(coalesce(p_supported, '')) > 600 or char_length(coalesce(p_disputed, '')) > 600
     or char_length(coalesce(p_resolve, '')) > 600 or char_length(coalesce(p_status, '')) > 80 then
    raise exception 'Each part of the summary must be under 600 characters';
  end if;
  select jsonb_build_object('stands_supported', stands_supported, 'stands_disputed', stands_disputed,
           'stands_resolve', stands_resolve, 'stands_depends', stands_depends, 'stands_status', stands_status,
           'stands_basis', stands_basis, 'stands_reviewed_at', stands_reviewed_at)
    into v_old from statements where id = p_id;
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
  insert into decisions (kind, item_id, item_text, decision, by_email, previous)
    values ('statement', p_id::text, v_text, 'summary', v_by, v_old);
end;
$$;

-- Deletions: keep a full copy of what was deleted (with its debates and arguments).
create or replace function admin_delete(p_kind text, p_id text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_by text := (select email from auth.users where id = auth.uid());
  v_text text;
  v_old jsonb;
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if p_kind = 'reason' then
    select to_jsonb(r) into v_old from reasons r where id = p_id::bigint;
    delete from reasons where id = p_id::bigint returning text into v_text;
  elsif p_kind = 'statement' then
    select to_jsonb(s) || jsonb_build_object('arguments', coalesce((select jsonb_agg(to_jsonb(r)) from reasons r where r.statement_id = s.id), '[]'::jsonb))
      into v_old from statements s where id = p_id::bigint;
    delete from statements where id = p_id::bigint returning text into v_text;
  elsif p_kind = 'topic' then
    select to_jsonb(t) || jsonb_build_object('debates', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('arguments',
             coalesce((select jsonb_agg(to_jsonb(r)) from reasons r where r.statement_id = s.id), '[]'::jsonb)))
           from statements s where s.topic_id = t.id), '[]'::jsonb))
      into v_old from topics t where id = p_id::bigint;
    delete from topics where id = p_id::bigint returning title into v_text;
  elsif p_kind = 'country' then
    select to_jsonb(c) || jsonb_build_object('topics', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object('debates',
             coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('arguments',
               coalesce((select jsonb_agg(to_jsonb(r)) from reasons r where r.statement_id = s.id), '[]'::jsonb)))
             from statements s where s.topic_id = t.id), '[]'::jsonb)))
           from topics t where t.country = c.code), '[]'::jsonb))
      into v_old from countries c where code = p_id;
    delete from topics where country = p_id;
    delete from countries where code = p_id returning name into v_text;
  else
    raise exception 'Bad kind';
  end if;
  if v_text is not null then
    insert into decisions (kind, item_id, item_text, decision, by_email, previous)
      values (p_kind, p_id, v_text, 'deleted', v_by, v_old);
  end if;
end;
$$;

revoke all on function admin_set_tag(bigint, text, text, text, text) from public, anon;
revoke all on function admin_set_summary(bigint, text, text, text, text) from public, anon;
revoke all on function admin_delete(text, text) from public, anon;
grant execute on function admin_set_tag(bigint, text, text, text, text) to authenticated;
grant execute on function admin_set_summary(bigint, text, text, text, text) to authenticated;
grant execute on function admin_delete(text, text) to authenticated;
