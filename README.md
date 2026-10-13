# Both Sides

One table per debate: a statement, reasons in favor, reasons against, and a short "Where the debate stands" summary.

It's a plain website (HTML, CSS and JavaScript, no build step) with a Supabase database behind it.

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `style.css` | All colours, fonts and layout |
| `app.js` | Loads the table and handles the "add" forms |
| `config.js` | Your Supabase Project URL and anon key |
| `supabase/schema.sql` | Creates the database tables and rules (run once) |
| `supabase/sample-content.sql` | Optional placeholder content for demos |

## Setup

1. **Database:** in Supabase, open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**. Optionally do the same with `supabase/sample-content.sql`.
2. **Keys:** put your Project URL and anon/publishable key into `config.js`. Never put the service_role/secret key in this project.
3. **Go live:** on vercel.com, sign in with GitHub → **Add New → Project** → import `both-sides` → **Deploy**. No settings needed.

## Running it day to day (Supabase → Table Editor)

- **Approve something:** open `statements` or `reasons`, find the row with status `pending`, change it to `approved`. Use `rejected` to turn it down.
- **Add a topic:** add a row to `topics` with `country` set to `india` or `us`.
- **Tag a reason:** set `tag` to one of `fallacy`, `overclaims`, `evidence`, `value`, `strong`, then fill in `tag_why` (and `tag_fix`, and `tag_detail` for the fallacy's name). Leave `tag` empty for most reasons.
- **Write "Where the debate stands":** fill in `stands_supported`, `stands_disputed`, `stands_depends`, and optionally `stands_status` and `stands_basis` on the statement. Leave them empty to hide the strip.

Visitors can only read approved content and submit new items as pending; the database rules enforce this.
