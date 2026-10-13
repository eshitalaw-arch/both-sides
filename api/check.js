// Tone check for new debates and arguments, run when someone presses "Submit".
// It only WARNS and suggests a rewrite; the writer can still post, and a human reviewer decides.
// GET  /api/check  -> { enabled: true|false }   (lets pages know whether AI is switched on)
// POST /api/check  { fields: { statement?, favor?, against?, text? } } -> { flags: { field: {...} } }

const { aiEnabled, askJson, readBody, clip } = require('./_ai');

const SYSTEM = `You check short contributions to a neutral debate website before a human moderator reviews them.
Flag a field ONLY if it contains one of these:
- "insult": insults, mockery or personal attacks aimed at people or groups (e.g. calling opponents idiots)
- "threat": threats or incitement to violence
- "hate": slurs or hateful language about a protected group
- "personal_info": a private person's contact details, address or other private information
- "spam": advertising, links unrelated to the debate, or gibberish
- "profanity": swearing
Never flag a field for its opinion or political side, for being one-sided, for strong but civil language, or for factual claims you think are wrong. Those are for the debate itself.
When you flag a field, write a respectful rewrite that keeps the writer's point and side, in the same language, as short as the original.
Reply with JSON only, no other text, in this shape:
{"flags": {"<field name>": {"reason": "insult|threat|hate|personal_info|spam|profanity", "explanation": "<one short, polite sentence to the writer>", "suggestion": "<rewrite, or empty string if no rewrite is possible>"}}}
Include only flagged fields. If nothing is flagged, reply {"flags": {}}.`;

// Light protection against someone hammering the endpoint (per server instance).
const hits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 12;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ enabled: aiEnabled() });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!aiEnabled()) return res.status(200).json({ enabled: false, flags: {} });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (tooMany(ip)) return res.status(429).json({ error: 'Too many checks, please wait a minute.' });

  const body = await readBody(req);
  const input = {};
  ['statement', 'context', 'favor', 'against', 'text', 'topic'].forEach(k => {
    const v = clip(body.fields && body.fields[k], 400).trim();
    if (v) input[k] = v;
  });
  if (!Object.keys(input).length) return res.status(200).json({ enabled: true, flags: {} });

  try {
    const out = await askJson(SYSTEM, 'Fields to check (JSON):\n' + JSON.stringify(input), 700);
    const flags = {};
    Object.keys(out.flags || {}).forEach(k => {
      if (!input[k]) return;
      const f = out.flags[k] || {};
      flags[k] = {
        reason: clip(f.reason, 30),
        explanation: clip(f.explanation, 300),
        suggestion: clip(f.suggestion, 400)
      };
    });
    return res.status(200).json({ enabled: true, flags });
  } catch (e) {
    console.error(e);
    // If the AI is down, never block posting: the human review still happens.
    return res.status(200).json({ enabled: true, flags: {}, unavailable: true });
  }
};
