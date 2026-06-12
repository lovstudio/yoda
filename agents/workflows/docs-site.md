# Docs Site (yoda.lovstudio.ai)

The public site is split across two Vercel projects (scope `lovstudio`). Neither is the in-repo `docs-fumadocs/` stub.

## Where Things Live

| Piece | Location | Stack |
| --- | --- | --- |
| Landing page | `docs/` in this repo | Vite static site |
| Docs content | `/Users/mark/lovstudio/coding/yoda-docs` (separate directory, NOT in this repo) | Next.js + Fumadocs, basePath `/docs` |
| Agent/dev docs | `agents/` in this repo | Markdown for AI agents and contributors, not published |

- The domain `yoda.lovstudio.ai` is attached to the `yoda` Vercel project (landing page). `docs/vercel.json` rewrites `/docs/*` to the `yoda-docs` Vercel project.
- `docs-fumadocs/` in this repo is a leftover stub from the migration; the real content is in the external `yoda-docs` directory.

## Updating Docs Content

1. Edit `yoda-docs/content/docs/*.mdx` (outside this repo).
2. Build: `env -u NODE_ENV pnpm build` (a `NODE_ENV=development` leaking from the shell breaks React prerender).
3. Deploy: `vercel --prod` from the `yoda-docs` directory.

## Updating the Landing Page

1. Edit `docs/` in this repo.
2. Build locally (`npm run build` inside `docs/`) — the Vercel cloud build fails because `docs/package.json` declares no dependencies.
3. Deploy the prebuilt output from `docs/dist/`.
