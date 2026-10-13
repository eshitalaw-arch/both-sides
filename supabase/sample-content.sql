-- OPTIONAL: illustrative sample content so the table isn't empty when you demo it.
-- These are placeholders, not verified claims. Delete them before a real launch:
--   delete from statements;   (this also deletes their reasons)
-- Run AFTER schema.sql, in Supabase → SQL Editor.

with t as (select id from topics where country = 'india' and title = 'Election Commission protests'),
s1 as (
  insert into statements (topic_id, text, context, status,
    stands_supported, stands_disputed, stands_depends, stands_status, stands_basis)
  select id,
    'The current Chief Election Commissioner should resign.',
    'Raised in opposition protests over voter-roll accuracy. About this office-holder, not how commissioners are appointed.',
    'approved',
    'The constitutional protection of the office is not disputed. No cited source yet establishes how widespread voter-roll errors are.',
    'Whether the complaints show error, misconduct, or neither.',
    'How much weight to give institutional stability versus the appearance of independence, and what an independent check of the rolls finds.',
    'No new arguments since 8 Oct',
    'Sample summary.'
  from t returning id
),
s2 as (
  insert into statements (topic_id, text, context, status)
  select id,
    'The appointment process for India''s election commissioners should include a judicial member.',
    'About the selection process, not the conduct of any individual commissioner.',
    'approved'
  from t returning id
)
insert into reasons (statement_id, side, text, author, source_label, source_url, tag, tag_detail, tag_why, tag_fix, status)
select s1.id, 'favor', 'An inquiry into voter-roll complaints should be led by someone who is not responsible for those rolls.', 'Anonymous', null, null, null, null, null, null, 'approved' from s1
union all select s1.id, 'favor', 'Public trust in the Election Commission has collapsed.', 'Anonymous', null, null, 'evidence', null, 'The key claim, a collapse in trust, is stated without any survey or data.', 'Link a survey that measures trust in the Commission over time.', 'approved' from s1
union all select s1.id, 'favor', 'Staying in office while under question makes the Commission look like it is defending itself rather than investigating.', 'Anonymous', null, null, null, null, null, null, 'approved' from s1
union all select s1.id, 'against', 'The Constitution allows removal only through the same process as a Supreme Court judge, so the office is shielded from political pressure.', 'Anonymous', 'Constitution of India, Art. 324(5)', null, 'strong', null, 'Relevant and sourced. It shows that resigning on demand has a real cost. It does not by itself show the complaints are wrong.', null, 'approved' from s1
union all select s1.id, 'against', 'The complaints have not been proven, so they must be false.', 'Anonymous', null, null, 'fallacy', 'Appeal to ignorance', 'Something not yet proven is not automatically false. This can argue for waiting for an inquiry, not for dismissing the concern.', 'Say what evidence would change your view, or cite an inquiry that found nothing.', 'approved' from s1
union all select s1.id, 'against', 'An independent audit of the voter rolls could settle the concern without anyone resigning.', 'Anonymous', null, null, null, null, null, null, 'approved' from s1
union all select s2.id, 'favor', 'A judicial member would make it harder for the government of the day to choose the Commission on its own.', 'Anonymous', null, null, null, null, null, null, 'approved' from s2
union all select s2.id, 'against', 'Appointments are an executive job; putting judges on selection panels blurs the separation of powers.', 'Anonymous', null, null, 'value', null, 'Not a weak point. Both sides can accept the same facts and still weigh independence against separation of powers differently.', null, 'approved' from s2;
