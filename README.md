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
| `supabase/add-countries.sql`, `supabase/add-suggestions.sql` | One-time upgrades for a database created before these features |

## Setup

1. **Database:** in Supabase, open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**. Optionally do the same with `supabase/sample-content.sql`.
2. **Keys:** put your Project URL and anon/publishable key into `config.js`. Never put the service_role/secret key in this project.
3. **Go live:** on vercel.com, sign in with GitHub → **Add New → Project** → import `both-sides` → **Deploy**. No settings needed.

## What visitors can suggest

Anyone can suggest, at every level. Nothing appears until an admin approves it.

| Level | Where on the site | Table |
|---|---|---|
| Country | "+ Suggest a country" in the header | `countries` |
| Topic (any number per country) | "+ Propose a new topic for …" at the bottom of a country | `topics` |
| Statement | "+ Propose a statement" under a topic | `statements` |
| Reason | "+ Add a reason in favor / against" | `reasons` |

## Running it day to day (Supabase → Table Editor)

- **Approve something:** open the table, find the row with status `pending`, change it to `approved` (or `rejected`). For a new country, also set its `sort` number so the tab appears where you want it (lower comes first). The `note` column shows which debate the person wanted.
- **Add something yourself:** insert a row and set `status` to `approved`. A country needs a short lowercase `code` (e.g. `uk`, `south-africa`); a topic's `country` must be one of those codes.
- **Tag a reason:** set `tag` to one of `fallacy`, `overclaims`, `evidence`, `value`, `strong`, then fill in `tag_why` (and `tag_fix`, and `tag_detail` for the fallacy's name). Leave `tag` empty for most reasons.
- **Write "Where the debate stands":** fill in `stands_supported`, `stands_disputed`, `stands_depends`, and optionally `stands_status` and `stands_basis` on the statement. Leave them empty to hide the strip.

Visitors can only read approved content and submit new items as pending; the database rules enforce this. Suggestions can only go under something already approved (no topics under a pending country, no statements under a pending topic).

## Upgrading an older database

If your database was set up before countries or suggestions existed, run these once each, in order, in the SQL Editor: `supabase/add-countries.sql`, then `supabase/add-suggestions.sql`. Both are safe to run again.
