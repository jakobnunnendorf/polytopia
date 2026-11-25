# Supabase

Project `polytopia-ai-research` (ref `psoszgbrtxnltlmderip`, eu-west-1) on Jakob's personal Supabase account.
It holds a public, read-only copy of what the arena server on the Mac serves, so the hosted web game
(https://polytopia.expo.app) can show the rankings and the game list.

## Schema changes: only through migrations in git

The database structure changes only through files in `supabase/migrations/`, so every change has a
commit and a pull request. Never change it with the dashboard's SQL editor, the table editor, or
`supabase db push`.

1. `supabase migration new <name>` and write the SQL (enable RLS and grant explicitly in the same file).
2. Pull request into `dev`. CI ("Supabase migrations") applies every migration to an empty database and
   checks that visitors can read but not write.
3. The Supabase GitHub integration ("Deploy to production", production branch `main`) applies the new
   migrations when the release from `dev` merges into `main`.

## Data

- `ratings`, `models`, `profiles`, `games`: written only by `npm run supabase:sync` (the arena server runs it
  every 5 minutes and after each saved game) with the secret key from `~/.config/polytopia/supabase.env`.
- The app reads them with the publishable key in `/.env` (public by design).
- The research record stays in git: `data/results.jsonl` and `elo/<date>/`.
