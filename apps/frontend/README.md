# gaze frontend

Next.js frontend for the look → speak → change workspace. The landing page's
blueprint grid, Jost typography, and indigo/teal glass aesthetic carry into the
project editor, following Figma's Lofi frame `14:848`.

Run `pnpm dev` in this directory. Open `/projects` to select the demo or enter
a project name and a running localhost URL. Projects open at `/{projectname}`;
the preview URL stays in the query string so reloads preserve the connection.
The project dev server must permit iframe embedding.

For `/demo`, also run `pnpm dev` from `apps/desktop` in another terminal. The
frontend proxies the existing harness at `http://127.0.0.1:5173` (override with
`HARNESS_URL` before starting Next.js). The workspace reuses the harness client
for click selection, browser speech, editing, undo, and version history; full
page navigation resets that client's subscriptions. Other localhost projects
support preview only because the backend currently edits the fixed demo tree.
The UI does not simulate source editing or versions for custom projects.

Checks:

```sh
pnpm exec tsc --noEmit
node --experimental-strip-types --test src/app/project-url.test.mjs
pnpm lint
```

The landing page currently has existing `no-html-link-for-pages` lint errors.
