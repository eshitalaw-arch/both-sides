-- Both Sides: one-step debate submission + the admin review page.
-- Run ONCE in Supabase → SQL Editor → New query → Run (after add-suggestions.sql).
-- Safe to run again.

-- 1. Who can review ---------------------------------------------------------
-- Add a reviewer by inserting their email here (Table Editor → admins → Insert row),
-- then create their login under Authentication → Users → Add user.
create table if not exists admins (
  email      text primary key check (email = lower(email)),
  added_at   timestamptz not null default now()
);
alter table admins enable row level security;   -- no public access at all

insert into admins (email) values ('eshita.law@gmail.com') on conflict do nothing;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from public.admins a
    join auth.users u on lower(u.email) = a.email
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;

-- 2. Decision log ------------------------------------------------------------
create table if not exists decisions (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('country', 'topic', 'statement', 'reason')),
  item_id    text not null,
  item_text  text,
  decision   text not null check (decision in ('approved', 'rejected')),
  by_email   text,
  at         timestamptz not null default now()
);
alter table decisions enable row level security;  -- read through review_queue() only

-- 3. One-step submission: a debate (and, if needed, a new topic) with its first arguments
create or replace function submit_debate(
  p_country   text,
  p_topic_id  bigint,
  p_new_topic text,
  p_statement text,
  p_context   text default null,
  p_favor     text default null,
  p_against   text default null,
  p_author    text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_topic  bigint;
  v_stmt   bigint;
  v_author text := coalesce(nullif(btrim(p_author), ''), 'Anonymous');
  v_favor  text := nullif(btrim(p_favor), '');
  v_ag     text := nullif(btrim(p_against), '');
  v_ctx    text := nullif(btrim(p_context), '');
begin
  if not exists (select 1 from countries where code = p_country and status = 'approved') then
    raise exception 'Unknown country';
  end if;
  if char_length(btrim(coalesce(p_statement, ''))) not between 10 and 300 then
    raise exception 'The statement must be 10 to 300 characters';
  end if;
  if v_ctx is not null and char_length(v_ctx) > 300 then raise exception 'Context is too long'; end if;
  if v_favor is not null and char_length(v_favor) not between 10 and 280 then
    raise exception 'Each argument must be 10 to 280 characters';
  end if;
  if v_ag is not null and char_length(v_ag) not between 10 and 280 then
    raise exception 'Each argument must be 10 to 280 characters';
  end if;
  if char_length(v_author) > 60 then raise exception 'Name is too long'; end if;

  if p_topic_id is not null then
    select id into v_topic from topics
      where id = p_topic_id and country = p_country and status = 'approved';
    if v_topic is null then raise exception 'Unknown topic'; end if;
  else
    if char_length(btrim(coalesce(p_new_topic, ''))) not between 3 and 100 then
      raise exception 'The topic must be 3 to 100 characters';
    end if;
    insert into topics (country, title, status, sort)
      values (p_country, btrim(p_new_topic), 'pending', 100) returning id into v_topic;
  end if;

  insert into statements (topic_id, text, context, status)
    values (v_topic, btrim(p_statement), v_ctx, 'pending') returning id into v_stmt;

  if v_favor is not null then
    insert into reasons (statement_id, side, text, author, status) values (v_stmt, 'favor', v_favor, v_author, 'pending');
  end if;
  if v_ag is not null then
    insert into reasons (statement_id, side, text, author, status) values (v_stmt, 'against', v_ag, v_author, 'pending');
  end if;
end;
$$;

-- 4. Everything waiting for review (admins only) ---------------------------
create or replace function review_queue() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  return json_build_object(
    'countries', coalesce((select json_agg(json_build_object(
        'code', c.code, 'name', c.name, 'note', c.note, 'created_at', c.created_at) order by c.created_at)
      from countries c where c.status = 'pending'), '[]'::json),
    'topics', coalesce((select json_agg(json_build_object(
        'id', t.id, 'title', t.title, 'country', t.country,
        'country_name', (select name from countries where code = t.country),
        'country_status', (select status from countries where code = t.country),
        'created_at', t.created_at) order by t.created_at)
      from topics t where t.status = 'pending'
        and not exists (select 1 from statements s where s.topic_id = t.id and s.status = 'pending')), '[]'::json),
    'statements', coalesce((select json_agg(json_build_object(
        'id', s.id, 'text', s.text, 'context', s.context, 'created_at', s.created_at,
        'topic_id', t.id, 'topic_title', t.title, 'topic_status', t.status,
        'country_name', (select name from countries where code = t.country),
        'reasons', coalesce((select json_agg(json_build_object(
            'id', r.id, 'side', r.side, 'text', r.text, 'author', r.author, 'source_url', r.source_url) order by r.id)
          from reasons r where r.statement_id = s.id and r.status = 'pending'), '[]'::json)
      ) order by s.created_at)
      from statements s join topics t on t.id = s.topic_id where s.status = 'pending'), '[]'::json),
    'reasons', coalesce((select json_agg(json_build_object(
        'id', r.id, 'side', r.side, 'text', r.text, 'author', r.author, 'source_url', r.source_url,
        'created_at', r.created_at, 'statement_text', s.text,
        'topic_title', t.title, 'country_name', (select name from countries where code = t.country)) order by r.created_at)
      from reasons r join statements s on s.id = r.statement_id join topics t on t.id = s.topic_id
      where r.status = 'pending' and s.status = 'approved'), '[]'::json),
    'recent', coalesce((select json_agg(x order by x.at desc) from (
        select kind, item_text, decision, by_email, at from decisions order by at desc limit 15) x), '[]'::json)
  );
end;
$$;

-- 5. Approve or reject one item (admins only) -------------------------------
-- Approving also approves what it depends on; rejecting also rejects what depends on it.
create or replace function review_item(p_kind text, p_id text, p_decision text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_by text := (select email from auth.users where id = auth.uid());
  v_topic bigint; v_country text; v_sort int;
  r record;
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'Bad decision'; end if;

  if p_kind = 'country' then
    if p_decision = 'approved' then
      select coalesce(max(sort), 0) + 1 into v_sort from countries where status = 'approved' and sort < 100;
      update countries set status = 'approved', sort = case when sort = 100 then v_sort else sort end
        where code = p_id and status = 'pending';
    else
      update countries set status = 'rejected' where code = p_id and status = 'pending';
      for r in select id from topics where country = p_id and status = 'pending' loop
        perform review_item('topic', r.id::text, 'rejected');
      end loop;
    end if;
    insert into decisions (kind, item_id, item_text, decision, by_email)
      select 'country', p_id, name, p_decision, v_by from countries where code = p_id;

  elsif p_kind = 'topic' then
    select country into v_country from topics where id = p_id::bigint;
    if p_decision = 'approved' then
      if exists (select 1 from countries where code = v_country and status = 'pending') then
        perform review_item('country', v_country, 'approved');
      end if;
      update topics set status = 'approved' where id = p_id::bigint and status = 'pending';
    else
      update topics set status = 'rejected' where id = p_id::bigint and status = 'pending';
      for r in select id from statements where topic_id = p_id::bigint and status = 'pending' loop
        perform review_item('statement', r.id::text, 'rejected');
      end loop;
    end if;
    insert into decisions (kind, item_id, item_text, decision, by_email)
      select 'topic', p_id, title, p_decision, v_by from topics where id = p_id::bigint;

  elsif p_kind = 'statement' then
    select topic_id into v_topic from statements where id = p_id::bigint;
    if p_decision = 'approved' then
      if exists (select 1 from topics where id = v_topic and status = 'pending') then
        perform review_item('topic', v_topic::text, 'approved');
      end if;
      update statements set status = 'approved' where id = p_id::bigint and status = 'pending';
      -- the arguments submitted with it go live too (reject any you don't want first)
      update reasons set status = 'approved' where statement_id = p_id::bigint and status = 'pending';
    else
      update statements set status = 'rejected' where id = p_id::bigint and status = 'pending';
      update reasons set status = 'rejected' where statement_id = p_id::bigint and status = 'pending';
    end if;
    insert into decisions (kind, item_id, item_text, decision, by_email)
      select 'statement', p_id, text, p_decision, v_by from statements where id = p_id::bigint;

  elsif p_kind = 'reason' then
    update reasons set status = p_decision where id = p_id::bigint and status = 'pending';
    insert into decisions (kind, item_id, item_text, decision, by_email)
      select 'reason', p_id, text, p_decision, v_by from reasons where id = p_id::bigint;

  else
    raise exception 'Bad kind';
  end if;
end;
$$;

-- 6. Delete live content (admins only) -------------------------------------
alter table decisions drop constraint if exists decisions_decision_check;
alter table decisions add constraint decisions_decision_check check (decision in ('approved', 'rejected', 'deleted'));

create or replace function admin_delete(p_kind text, p_id text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare
  v_by text := (select email from auth.users where id = auth.uid());
  v_text text;
begin
  if not is_admin() then raise exception 'Not a reviewer'; end if;
  if p_kind = 'reason' then
    delete from reasons where id = p_id::bigint returning text into v_text;
  elsif p_kind = 'statement' then          -- its arguments go with it
    delete from statements where id = p_id::bigint returning text into v_text;
  elsif p_kind = 'topic' then              -- its debates and arguments go with it
    delete from topics where id = p_id::bigint returning title into v_text;
  elsif p_kind = 'country' then            -- its topics, debates and arguments go with it
    delete from topics where country = p_id;
    delete from countries where code = p_id returning name into v_text;
  else
    raise exception 'Bad kind';
  end if;
  if v_text is not null then
    insert into decisions (kind, item_id, item_text, decision, by_email) values (p_kind, p_id, v_text, 'deleted', v_by);
  end if;
end;
$$;

-- 7. Who may call what -------------------------------------------------------
revoke all on function is_admin() from public, anon;
revoke all on function review_queue() from public, anon;
revoke all on function review_item(text, text, text) from public, anon;
revoke all on function admin_delete(text, text) from public, anon;
revoke all on function submit_debate(text, bigint, text, text, text, text, text, text) from public;
grant execute on function is_admin() to authenticated;
grant execute on function review_queue() to authenticated;
grant execute on function review_item(text, text, text) to authenticated;
grant execute on function admin_delete(text, text) to authenticated;
grant execute on function submit_debate(text, bigint, text, text, text, text, text, text) to anon, authenticated;
