// Drafting help for REVIEWERS only. Nothing is published by this function:
// it returns suggestions that a reviewer edits and saves on the review page.
// POST /api/assist  { task: "summary" | "notes", statementId }  with the reviewer's sign-in token.

const { aiEnabled, askJson, dbGet, isReviewer, readBody } = require('./_ai');

const I = require('../ai-instructions.js');

const SUMMARY = I.general + '\n\n' + I.summary + '\nReply with JSON only: {"supported": "...", "disputed": "...", "resolve": "..."}';

const NOTES = I.general + '\n\n' + I.notes + '\nUse lowercase tags in JSON (fallacy, overclaims, evidence, value, strong, none).\nReply with JSON only: {"notes": [{"id": <argument number>, "tag": "...", "detail": "", "why": "", "fix": ""}]}';

const TAGS = ['fallacy', 'overclaims', 'evidence', 'value', 'strong', 'none'];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!aiEnabled()) return res.status(503).json({ error: 'AI is not switched on yet. Add ANTHROPIC_API_KEY in Vercel.' });
  if (!(await isReviewer(req))) return res.status(403).json({ error: 'Reviewers only' });

  const body = await readBody(req);
  const id = Number(body.statementId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Missing debate' });

  try {
    const stmt = (await dbGet('statements?select=id,text,context,topic_id&id=eq.' + id))[0];
    if (!stmt) return res.status(404).json({ error: 'Debate not found (it must be live).' });
    const topic = (await dbGet('topics?select=title&id=eq.' + stmt.topic_id))[0] || {};
    const args = await dbGet('reasons?select=id,side,text,source_label,source_url&statement_id=eq.' + id + '&order=id');
    const debate = {
      topic: topic.title || '',
      statement: stmt.text,
      context: stmt.context || '',
      arguments: args.map(a => ({ id: a.id, side: a.side === 'favor' ? 'in favor' : 'against', text: a.text, source: a.source_label || a.source_url || '' }))
    };
    const input = 'Debate (JSON):\n' + JSON.stringify(debate);

    if (body.task === 'summary') {
      if (!args.length) return res.status(400).json({ error: 'This debate has no arguments yet.' });
      const out = await askJson(SUMMARY, input, 600);
      return res.status(200).json({
        supported: String(out.supported || '').slice(0, 600),
        disputed: String(out.disputed || '').slice(0, 600),
        resolve: String(out.resolve || '').slice(0, 600)
      });
    }
    if (body.task === 'notes') {
      if (!args.length) return res.status(400).json({ error: 'This debate has no arguments yet.' });
      const out = await askJson(NOTES, input, 1500);
      const known = new Set(args.map(a => a.id));
      const notes = (out.notes || []).filter(n => known.has(Number(n.id)) && TAGS.includes(n.tag)).map(n => ({
        id: Number(n.id), tag: n.tag,
        detail: n.tag === 'fallacy' ? String(n.detail || '').slice(0, 60) : '',
        why: String(n.why || '').slice(0, 400),
        fix: String(n.fix || '').slice(0, 400)
      }));
      return res.status(200).json({ notes });
    }
    return res.status(400).json({ error: 'Unknown task' });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'The AI could not help just now. Please try again.' });
  }
};
