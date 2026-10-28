# The Site Editor, shipped without bumping every site

## Why

Every change to the Site Editor is a storyloco release, then a bump, a commit, a PR and a deploy on each
site. This week went from 2.16 to 2.23.2, each release bumped across up to eight sites, and nearly all of it
was editor code that only signed-in editors ever load: overlay matching, inferred menu items, hover menus staying open, link
and image fields, Page history. Visitors never run any of it.

The goal is to deploy editor changes once, to moxy, and have every site pick them up on the next page load,
with no bump and no rebuild. The small part each site installs should change rarely.

## The split

storyloco becomes three parts:

| Part                          | Where it runs                                                                 | Changes               |
| ----------------------------- | ----------------------------------------------------------------------------- | --------------------- |
| **Site kit**: npm `storyloco` | the site's bundle and server                                                  | rarely                |
| **Editor app**: one JS bundle | published with the package, served through the site at the version moxy names | freely, without bumps |
| **Editor ops**                | moxy's worker                                                                 | freely, without bumps |

### Site kit (stays in npm)

- `attrs`, `connect`, `unless_editing`, `in_place`, and the `bloks` registry they fill
- the editor state the site reads: `editor.editing`, `being_edited()`, `data-storyloco-editing`
- the server hook: the sign-in cookie, `/admin`, `?edit`, `editor_version`, cache and robots headers
- a thin `/__storyloco/*` proxy to moxy (sign-in, callback and the api routes)
- the **loader**, which adds the editor app's `<script>` for editors, guests and draft previews
- `EditBar`, now only a shell: it takes `accent` and `accent_ink` and hands them to the editor app
- the **bridge** (below)

### Editor app (loads at the latest release)

Everything the edit bar imports lazily today, plus the bar itself:

- `edit_bar.svelte`, `overlay.ts`, `inspector.svelte`, `tools.svelte`, `block_bar.svelte`, `image_picker.svelte`
- `richtext.ts` (Tiptap), `time_machine.svelte`, `compare.svelte`, `comments.svelte`
- `live.ts`, `presence.ts`, `together.ts`, `anchor.ts`
- `content.ts`: the shared helpers, `is_text`, `set_text` and the rest

That's about 18,000 of the editor's 21,000 lines. The app bundles its own Svelte runtime and mounts its UI
in a root of its own, so it never depends on the site's Svelte version.

### Editor ops (move to moxy)

The `/__storyloco/api` ops (`set`, `fields`, `insert`, `move`, `publish`, `versions` and the rest) run in
each site's server today, inside `editor/server.ts`. They only call Storyblok's Management API with the
editor's own token, which moxy already holds against the session handle. They move to a moxy endpoint, and
the site's route becomes a pass-through.

The ops need two things only the site has:

- **The space:** from `STORYBLOK_SPACE_ID`, or worked out from the site's token.
- **The site's public token:** `changes` uses it to read the published version for comparison. It's a public
  CDN token, so it can travel with the request.

The proxy forwards both with each request, as headers.

## The bridge, version 1

The site's `client.ts` and the app's own copy of it share one state object, `globalThis.__storyloco`: edit
mode, the connected story, the marked blocks, presence, undo, and each Svelte runtime's subscriber, so a
change in either runtime redraws both. SvelteKit reaches the app only through `kit`, which the site's
`EditBar` sets: `goto`, `refresh` (`refreshAll` on SvelteKit 3, `invalidateAll` on 2), `replace_state` and
`page()`. The app exports `bridge = 1`, `mount`, `install` and `welcome`.

Within a version, changes to the shared state are additive only. A site that loads an app built for another
bridge uses its own installed copy instead.

## Loading and versions (as built in 2.24)

- **Build:** the package build also builds the editor app (`vite.editor.config.ts`) as a code-split bundle
  in `packages/vite/dist-editor/`: the badge first; the overlay, inspector, rich text and Page history as
  chunks. It's published to npm with the package, so every release's build is on jsDelivr.
- **Served by the site:** `/__storyloco/editor/<file>` passes the file on from
  `cdn.jsdelivr.net/npm/storyloco@<version>/packages/vite/dist-editor/`. The page loads the app from its own
  origin, so a site's Content Security Policy needs nothing new: Trace's, which names its script sources,
  blocked the first, cross-origin, version. `app.js` is cached for a minute; the chunks are named by their
  content, so they're cached for a year.
- **Which version:** moxy's `/editor/version` says, npm's latest by default (looked up once a minute), or
  `EDITOR_VERSION` when set, to pin or roll back. Every site follows within a minute or two.
- **Falling back:** if the app can't load, or was built for another bridge, the site uses the copy in its
  installed package. If moxy has no `/apps/editor/ops` yet (a reply without `x-storyloco-ops`), the site
  runs the operation itself. So storyloco, moxy and the sites can each go out in any order.
- **Local dev:** `STORYLOCO_EDITOR=local` uses the installed package's copy; a base URL there takes the
  files from another build, like `packages/vite/dist-editor` served locally.

## What still needs a bump

- a new bridge version, or anything the app needs from the site that the bridge doesn't offer
- the server hook: sign-in, cookies, `/admin`, `?edit`, `editor_version`, headers
- `attrs`, `connect` or `unless_editing` changing what they do

All of these should be rare. Renovate, with auto-merge once CI passes, takes care of them on every site, so
even those need no hands.

## Risks

- **Blast radius:** a bad editor release reaches every site at once. Canary on EA first, quick promotion
  and a one-step rollback keep that short.
- **Bridge drift:** the contract has to stay additive. The app checks the version it's given.
- **Trust:** the editor's script now comes from npm, by way of jsDelivr and the site's own server, at the
  version moxy names. It's only ever loaded for signed-in editors, guests and previews.
- **Uploads:** asset and Mux uploads go through the site's server today. Sent to moxy instead, they get
  moxy's request limits rather than each host's. Check those before moving `upload` and `mux_upload`.

## Rollout

All of it went out as one release, 2.24: the bridge, the app build, the loader with its fallbacks, and the
ops moved to moxy. Each site takes it with one last bump; after that an editor change is a storyloco release,
which every site loads within a couple of minutes.

## Not built (yet)

- Per-space pins and a canary channel: one `EDITOR_VERSION` pins every site for now.
- Renovate on the sites, for the rarer site-kit bumps.

## Open questions

- Does Page history's framed copy of the page load the app from moxy too, or ask its parent frame for it?
- Do guests on a shared draft get the full app, or a smaller viewer bundle?
- Should the AI op stay behind the site's proxy, or go straight to moxy with the session handle?
