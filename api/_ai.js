// Shared helpers for the AI functions. Files starting with "_" are not public URLs on Vercel.
// The AI key lives ONLY in Vercel → Project → Settings → Environment Variables (ANTHROPIC_API_KEY).

const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rtnxxhzyuwaqsubzwyyq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__Y1mYE4QEHDcUq4DBi0Ilg_IaR8IXco';

function aiEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Ask Claude and return parsed JSON from its reply.
async function askJson(system, user, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 600,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error('AI request failed (' + res.status + '): ' + detail.slice(0, 300));
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('AI reply was not JSON');
  return JSON.parse(text.slice(start, end + 1));
}

// Read from the database with the public key (approved content only).
async function dbGet(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }
  });
  if (!res.ok) throw new Error('Database read failed (' + res.status + ')');
  return res.json();
}

// Is the person calling a reviewer? Uses their own sign-in token.
async function isReviewer(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/is_admin', {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: auth, 'content-type': 'application/json' },
    body: '{}'
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return {};
}

function clip(s, n) {
  return String(s == null ? '' : s).slice(0, n);
}

module.exports = { MODEL, aiEnabled, askJson, dbGet, isReviewer, readBody, clip };
