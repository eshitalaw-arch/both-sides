# Both Sides

One table per debate: a statement, reasons in favor, reasons against, and a short "Where the debate stands" summary.

It's a plain website (HTML, CSS and JavaScript, no build step) with a Supabase database behind it.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | All colours, fonts and layout |
| `app.js` | Loads the table and handles the "add" forms |
| `review.html`, `review.js`, `review.css` | The reviewer page |
| `config.js` | Your Supabase Project URL and anon key |
| `supabase/schema.sql` | Creates the database tables and rules (run once) |
| `supabase/sample-content.sql` | Optional placeholder content for demos |
| `supabase/add-countries.sql`, `supabase/add-suggestions.sql` | One-time upgrades for a database created before these features |

## Setup

1. **Database:** in Supabase, open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**. Optionally do the same with `supabase/sample-content.sql`.
2. **Keys:** put your Project URL and anon/publishable key into `config.js`. Never put the service_role/secret key in this project.
3. **Go live:** on vercel.com, sign in with GitHub → **Add New → Project** → import `both-sides` → **Deploy**. No settings needed.

## What visitors can do

Anyone can suggest, at every level. Nothing appears until a reviewer approves it, and the person who submitted it sees their own item marked "Waiting for review" in the meantime.

- **Suggest a country:** button in the header.
- **Start a debate:** one form with the topic (existing or new), the statement, and a first argument in favor and against.
- **Add an argument** in favor or against on any live debate.

## Reviewing (the review page: /review.html)

Sign in at **/review.html** (link in the site footer). First time: choose "First time? Create a password" with an email that is on the reviewer list.

- **Waiting for review:** Approve or Reject new countries, debates and arguments. Approving a debate also approves its new topic and the arguments that came with it; use "Remove" on any argument you don't want first.
- **Live content:** delete a debate, an argument, a whole topic, or a country tab.
- **Decision log:** every approval, rejection and deletion, with who made it.

**Adding a reviewer:** add their email to the `admins` table (Supabase → Table Editor → admins → Insert row). They then create a password on the review page and confirm their email.

- **Where the discussion stands:** in Live content, use "Write summary" / "Edit summary" under any debate. Saving sets today as the reviewed date.

You can still edit anything directly in Supabase → Table Editor, e.g. to add tags to arguments.

## Upgrading an older database

For a database set up before these features, run these once each, in order, in the SQL Editor: `supabase/add-countries.sql`, `supabase/add-suggestions.sql`, `supabase/review-and-debates.sql`, `supabase/summaries.sql`. All are safe to run again. A brand-new database needs `schema.sql`, then `review-and-debates.sql`, then `summaries.sql`.

## AI features

AI runs in two small server functions on Vercel (`api/check.js`, `api/assist.js`). The key is never in the code.

- **Tone check** (visitors): when someone submits a debate or argument, AI checks for insults, threats, hate, private details, spam or swearing, and suggests kinder wording. It only warns; the writer can post anyway and a reviewer decides. It never judges viewpoints. If the AI is unavailable, posting works as normal.
- **Drafts** (reviewers only): "Draft with AI" in the summary editor and "Suggest notes with AI" under each live debate. Nothing is saved until a reviewer presses Save / Apply.

**To switch it on:** create an API key at console.anthropic.com, then in Vercel → the `both-sides` project → Settings → Environment Variables, add `ANTHROPIC_API_KEY` with the key, and redeploy. Remove the variable to switch AI off; the About page updates itself either way. Optional: `AI_MODEL` to use a different Claude model.

For saving notes from the review page, run `supabase/notes.sql` once in the SQL Editor.
