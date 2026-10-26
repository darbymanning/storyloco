# Storyloco

A collection of slick Storyblok field plugins built with Svelte 5, TypeScript, and Tailwind CSS. Each plugin is designed to be lightweight, performant, and a joy to use.

## 🚀 What's Included

### Field Plugins

- **🎬 Mux Video** - Upload, manage, and configure videos with Mux integration
- **📎 Asset Plus** - Enhanced asset picker with search, filters, and previews
- **📝 Heading** - Simple heading editor with level selection (H1-H6)
- **🎨 Theme** - Color theme selector with visual previews
- **🔗 Link** - Link editor with support for internal, external, email, and asset links
- **🔍 SEO** - SEO metadata editor with support for title, description, OG tags, and Twitter cards
- **🏗️ Plans** - Floor plan manager with drag-and-drop sorting for types, floors, dimensions, and rooms
- **📝 Input** - Comprehensive form input field with support for all HTML input types, checkboxes, radio buttons, selects, and textareas
- **⏰ Time** - Simple time input field with step control
- **💷 Currency** - Amount input with a currency selector; configure allowed codes via the `currencies` and `default_currency` options
- **📅 Dates** - List of dates, each with an optional time, end date and end time, plus a timezone picker; configure via the `min`, `max` and `auto_sort` options
- **⛪ ChurchSuite Categories** - Multi-select of ChurchSuite calendar categories, read from your site's endpoint via the `endpoint` option

### Vite Plugins

- **📋 Storyblok Schema** - Automatically generate TypeScript types from your Storyblok components
- **🔄 Storyblok Redirects** - Generate and handle redirects from Storyblok datasource entries

### Storyblok Client

- **🎯 StoryblokClient** - Reactive wrapper for Storyblok with Svelte 5 integration
- **🔧 Utilities** - `attrs` for wiring a block to the visual editor, plus re-exported `editable`, `Block`, and `richtext` functions

### Shared Components

A comprehensive UI component library built with:

- **Svelte 5** - Latest reactive framework
- **Tailwind CSS** - Utility-first styling
- **Bits UI** - Headless component primitives
- **TypeScript** - Full type safety

## 📦 Installation

```bash
bun add storyloco
```

## 🎯 Usage

### Import Types

```typescript
// Import specific plugin types
import type { Video } from 'storyloco/mux'
import type { Heading } from 'storyloco/heading'
import type { Link } from 'storyloco/link'
import type { Input } from 'storyloco/input'
import type { Asset } from 'storyloco/asset'
import type { SEO } from 'storyloco/seo'

// Or import everything
import type { Video, Heading, Link, Input, Asset, SEO } from 'storyloco'
```

### Write Currency Values

Map spreadsheet cells or plain numbers to the currency field's stored shape, e.g. for a Management API import:

```ts
import { to_currency } from 'storyloco/currency/utils'

to_currency('£1,234.50') // currency defaults to GBP
// { plugin: 'uiloco-currency', currency: 'GBP', amount: 1234.5, formatted: '£1,234.50' }
to_currency('', 'GBP') // null
to_currency('POA', 'GBP') // throws, as do negatives and too many decimal places
```

`format_currency(amount, code)` gives the same `formatted` string the plugin writes.

### Display Dates

Timed entries carry UTC instants, so the site formats them natively in the field's zone. All-day entries are dates, not moments: use `start_date`/`end_date` as they are.

```ts
import type { DateEntry, Dates } from 'storyloco/dates'

const show = ({ timezone }: Dates, entry: DateEntry) =>
	entry.utc_start
		? new Intl.DateTimeFormat('en-GB', {
				timeZone: timezone,
				dateStyle: 'medium',
				timeStyle: 'short'
			}).formatRange(new Date(entry.utc_start), new Date(entry.utc_end ?? entry.utc_start))
		: [entry.start_date, entry.end_date].filter(Boolean).join(' – ')
```

### Use Storyblok Client

#### 1. Create your Storyblok client

**`$lib/storyblok.ts`:**

```typescript
import { StoryblokClient } from 'storyloco'
import { PUBLIC_STORYBLOK_ACCESS_TOKEN } from '$env/static/public'

export const client = new StoryblokClient({
	token: PUBLIC_STORYBLOK_ACCESS_TOKEN,
	relations: ['shared.items'],
	components: import.meta.glob(['$blocks/**/*.svelte', '$templates/*.svelte'])
})
```

Everything is configured here rather than by subclassing, and `init()` runs on its own — the
API methods await it, so you never call it on the server. `components` takes the result of
`import.meta.glob`: Vite has to see the literal pattern to rewrite it, so the glob has to stay
at your call site rather than move into the client.

`api` goes to the SDK as its `apiOptions`. To keep the token off the browser, read through a
proxy of your own that adds it, and give the client a stand-in:

```typescript
export const client = new StoryblokClient({
	token: 'proxy',
	// the SDK wants a whole URL
	api: { endpoint: `${browser ? location.origin : 'http://localhost'}/api/storyblok` }
})
```

The editor then takes the real token from `STORYBLOK_ACCESS_TOKEN`.

`client.handle_error` is on the instance, so `.catch(client.handle_error)` works without
wrapping anything.

Errors carry only a `message` by default. If your `App.Error` needs more, pass `error` to shape
the body of every 404 and 500 storyloco raises — it's typed against your own `App.Error`:

```typescript
export const client = new StoryblokClient({
	token: PUBLIC_STORYBLOK_ACCESS_TOKEN,
	error: status => ({
		message: status === 404 ? 'Story not found' : 'Storyblok request failed',
		code: status === 404 ? 'NOT_FOUND' : 'STORYBLOK'
	})
})
```

#### 2. Use in your Svelte components

**`+page.svelte`:**

```svelte
<script lang="ts">
	import { Block } from 'storyloco'
	import { client } from '$lib/storyblok.js'

	let { data: _data } = $props()

	// Connect story for live preview updates
	const data = $derived(client.connect(_data.story))
</script>

<!-- Render blocks -->
{#each data.story?.content.blocks || [] as blok}
	<Block {blok} />
{/each}
```

#### 3. Create your component structure

**`$lib/blocks/hero.svelte`:**

```svelte
<script lang="ts">
	import { attrs } from 'storyloco'

   // This is auto-generated by the Storyblok Schema plugin
   import type { Blok, Hero } from '$lib/components.schema.js'

   interface Props {
      blok: Blok<Hero>
   }

	let { blok } = $props()
</script>

<section {...attrs(blok)}>
	<h1>{blok.headline}</h1>
	<p>{blok.subheadline}</p>
</section>
```

`attrs` makes the block editable in the visual editor and gives it a stable `id` — the
block's `anchor` field when it has one, so sections can be linked to, otherwise its `_uid`.

Prefer it to `use:editable`. Being an attachment rather than an action it spreads, so the
element keeps its own attributes, and you can wrap it to add project-specific ones in one
place rather than repeating them in every block:

```typescript
// Mapping section fields onto CSS custom properties is left to you — the field names and
// the design tokens are yours. Wrap `attrs` rather than reaching past it:
//
// export function section<T extends SectionFields>(blok: Blok<T>) {
//    let style = ''
//    if (blok.theme) style += `--theme: var(--c-${blok.theme});`
//    if (blok.pad_top) style += `--pt: var(--s-${blok.pad_top});`
//    return { ...attrs(blok), style }
// }
```

`editable` is still exported for anything `attrs` doesn't cover.

### Read Content on the Server

`storyloco/server` binds a client to the current request, so reads carry the version from
the `version` hook and the resolve options you'd otherwise repeat everywhere. Server-only,
since it reads the active request.

**`$lib/storyblok.server.ts`:**

```typescript
import { setup } from 'storyloco/server'
import { client } from './storyblok.js'

export const storyblok = setup(client)
```

Then anywhere on the server:

```typescript
import { storyblok } from '$lib/storyblok.server.js'

// A single story, with the client's `relations` resolved
await storyblok.story('layout')

// A list. `total` is the unpaged count, for "showing n of m"
const { stories, total } = await storyblok.stories({ content_type: 'blog', per_page: 2 })

// Everything that matches, paged through the API's 100-per-page cap
const products = await storyblok.all({ content_type: 'product' })

// The link tree, flattened — Storyblok returns it keyed by uuid
const links = await storyblok.links({ starts_with: 'blog/' })
```

Reads with a `content_type` are typed from your generated schema: the plugin registers
the space's content types with storyloco, so `stories({ content_type: 'product' })` yields
product stories and `content_type: 'product,category'` a union of both — no type argument
needed, and unknown names are rejected. Until a schema has been generated, any name is
accepted and the content is the SDK's permissive type. An explicit type argument always wins.

Your params are spread last, so any default can be overridden:

```typescript
await storyblok.story('layout', { resolve_assets: 0 })
```

`story` treats a missing story as a 404. Where a slug is allowed not to exist, `find` returns
`null` instead — the miss is then neither raised nor logged:

```typescript
const product = await storyblok.find<Product>(`products/${slug}`)
if (!product) error(404, 'Product not found')
```

The content type can be a union. Each member becomes its own story type, so `is_component`
can narrow the result — checking `story.content.component` yourself narrows only `content`,
not the story:

```typescript
import { is_component } from 'storyloco'

const story = await storyblok.find<Product | Category>(`products/${slug}`)
if (is_component(story, 'product')) story.content.sku // ISbStoryData<Product>
if (is_component(story, 'category')) story.content.description // ISbStoryData<Category>
```

It's callable too, for anything the methods don't cover:

```typescript
const { client, version } = storyblok()
await client.get('cdn/datasource_entries', { version })
```

Errors go through `client.handle_error`, so a missing story is a 404 and anything else a 500, shaped by the client's `error` option.

### Edit on the Site

Anyone with a role in the space can edit the real site in place, signed in with their own
Storyblok account, so their permissions apply and every change is credited to them. Changes
save as drafts; Publish in the corner badge lists what will go live, block by block, first.

It needs the **Site Editor** app installed in the space (Storyblok › Apps), with the site's
origin allowed on the app's page. `localhost` always is, and a pattern like
`https://*-team.vercel.app` covers every preview. Then three lines:

```typescript
// hooks.server.ts
import { editor } from 'storyloco/editor/server'

export const handle = sequence(editor, version /* , ...the rest */)
```

```svelte
<!-- +layout.svelte -->
<script lang="ts">
	import { EditBar } from 'storyloco/editor'
</script>

<EditBar />
```

```typescript
// app.d.ts
interface Locals {
	editor?: import('storyloco/editor/server').Editor
}
```

A site with a Content Security Policy needs `wss://moxy.uilo.co` in its `connect-src`, for the
multiplayer socket, and `'self'` in its `frame-ancestors`, for the phone and tablet preview.

A site that picks its own content version rather than using `version` asks `editor_version(event)`
first: draft for editors and guests, published for the live view. A site that caches pages at
its CDN (`s-maxage`) needs editors, and guests (`sl_guest…`), on a cache key of their own, or
whoever signs in on the live site is handed the cached visitor page, with no edit bar. The CDN
answers before the hook runs and won't vary on cookies, so it takes Routing Middleware: when a
request carries an `sl_editor…` cookie, rewrite it onto a `?_storyloco=1` URL, and never cache
responses there.

No secrets: sign-in runs through moxy, and the space comes from `STORYBLOK_SPACE_ID` or the
site's public token. Blocks that spread `attrs(blok)` are editable as they are; nothing marks
fields up. With edit mode on (the badge's switch, or **E**):

- **Text** edits where it is, matched to its field by what it shows. Body copy edits in place
  as rich text, with the site's own styles.
- **Images** offer Replace: the space's library or an upload, with alt text and a focus point.
- **Blocks** get a toolbar on hover to move, duplicate, add after or delete (with Undo), and a
  click opens every field of the block from its schema, nested blocks included. Drag a block
  by its name in the toolbar to put it anywhere in its list.
- **AI** suggests an image's alt text in the image picker, and rewrites a selection or
  paragraph of rich text shorter, friendlier, clearer, or with its spelling fixed.
- **Other stories** shown on the page, like cards listing the latest articles, edit as those
  stories: their text and images where they show, and a click opens them.
- **Video** uploads to Mux when the space has the Mux app connected.
- **Undo** takes back any change made from the page, and Redo makes it again: **⌘Z** and
  **⇧⌘Z** (Ctrl+Z and Ctrl+Y) outside a field, or the badge's arrows.
- **Someone else** saving the page in Storyblok while it's open shows a note with Refresh.
- **⌘K** (Ctrl+K), or the badge's ⌘ button, finds a page, a block on this one, or something
  to do: make a new page, ask someone to review this one, or preview it at phone or tablet size.
- **History** goes back through the page's saves on a timeline, the page showing itself as it
  was at each one, and restores any of them as the draft (with Undo). Pages that `connect()`
  their story show it in place; others list what restoring would change.
- **Compare with live** (⌘K, or from Publish) flips the page between the draft and what
  visitors see now, scrolled to the same place (**L**), with the blocks that aren't live yet
  marked on the draft.
- **Share** the draft, like a Google Doc, with people who don't edit in Storyblok: invite them
  by email (they sign in from the link, once), or let anyone with the link look. Guests see the
  draft and, if they can comment, comment; someone from the link confirms their email with a
  code first, so no comment is anonymous. Guests never edit, resolve, or get a Storyblok token,
  and their pages aren't cached or indexed.

Everyone editing a site at once sees each other. Each person has a colour: their pointer and
name move over the page, what they've selected is outlined, and their avatars sit by the
badge. Text and rich text type together, letters merging as they're typed with everyone's
caret showing, and saves to the same story take turns, so no one's change is lost.

- **Follow** someone by clicking their avatar: the page goes where they go and scrolls with
  them. Scroll yourself, or press Escape, to stop.
- **Say something** by your pointer with **/**; the others see it as it's typed.
- **Comment** with **C**, or the badge's speech bubble, then click where it goes. Threads take
  replies, @mentions and Resolve. Anyone in one, or mentioned, finds it under the badge's bell,
  its unread count on the badge, and gets a browser notification too once they've chosen
  Notify me. A review request lands there too, and anything left unread for 15 minutes is
  emailed, guests' included.

Visitors never see any of it. On the live site, press **⌘⇧E** (Ctrl+Shift+E) or add `?edit` to
any address to sign in; once signed in, the badge shows on every page, and ⌘⇧E or **E** turns
edit mode on and off. In development the badge is always there.

Links inside content don't navigate in edit mode; hold ⌘ or Ctrl to follow one. Match the
editor to a site with `--editor-bg`, `-ink`, `-muted`, `-line`, `-shadow`, `-font`,
`--editor-accent` (and `-accent-ink`), `--editor-good`, `--editor-danger`, and `--editor-pill`
for the toast and the format bar, or build a bar of your own from `editor`, `set_editing`,
`publish`, `signin` and `signout`.

A CDN in front of the site answers editors with the page it cached for visitors, before any of
the site's code runs. Routing middleware runs first, and `storyloco/middleware` moves an editor
onto a key of their own:

```ts
// middleware.ts
export { default } from 'storyloco/middleware'
export const config = { matcher: '/((?!_app/|api/).*)' }
```

`middleware(keys)` takes other cookies too, the first a request has winning: say a shop's
customers, `[{ cookies: [/^session$/, EDITOR_COOKIE], param: '_signed_in' }]`. Never cache
a response for a key's parameter.

`bun run smoke <site url>…` (in `packages/vite`) checks each site loads and, signed in, that a
click on a block opens its settings. Sign in once per site with `--signin`, which opens a
window; later runs reuse it without one.

### Use Shared Components

```typescript
import { Input, Label, Switch, Skeleton, Select, Separator } from 'storyloco/shared'
import { cn } from 'storyloco/shared/utils'
```

### Vite Plugins

#### Storyblok Schema Plugin

Automatically generate TypeScript types from your Storyblok components during development:

```typescript
// vite.config.ts
import { schema } from 'storyloco/vite'

export default defineConfig({
	plugins: [
		schema({
			output_path: 'src/lib',
			interval_ms: 60_000 // regenerate every minute
		})
	]
})
```

**Options:**

- `storyblok_personal_access_token` - Your Storyblok personal access token (defaults to `STORYBLOK_PERSONAL_ACCESS_TOKEN` env var)
- `storyblok_space_id` - Your Storyblok space ID (defaults to `STORYBLOK_SPACE_ID` env var)
- `output_path` - Where to output generated files (defaults to `src/lib`)
- `filename` - Name of the generated file (defaults to `components.schema.ts`)
- `interval_ms` - How often to regenerate types (defaults to 60000ms)

The plugin will create a file called `components.schema.ts` (auto-generated) in the `src/lib` directory. This file will be updated automatically when you make changes to your Storyblok components as per the interval specified.

**Custom Plugin Types:**

You can define custom types for Storyblok field plugins by exporting an interface in your vite config:

```typescript
// vite.config.ts
import { schema } from 'storyloco/vite'

export interface StoryblokCustomPlugins {
	'theme-field': string
	'heading-field': import('storyloco/heading').Heading
	'loco-link-field': import('storyloco/link').Link
	'mux-field': import('storyloco/mux').Video
	'loco-input': import('storyloco/input').Input
	'seo-metatags': {
		plugin: 'seo_metatags'
		_uid: import('crypto').UUID
		title?: string
		og_image?: string
		og_title?: string
		description?: string
		twitter_image?: string
		twitter_title: string
		og_description: string
		twitter_description: string
	}
	'loco-time': string
	'loco-currency': import('storyloco/currency').Currency
	'loco-dates': import('storyloco/dates').Dates
	'loco-asset': import('storyloco/asset').Asset
}

export default defineConfig({
	plugins: [
		schema({
			output_path: 'src/lib',
			interval_ms: 60000
		})
	]
})
```

The plugin will:

- Pull your component schema from Storyblok
- Generate TypeScript definitions with proper types
- Use your custom plugin types when available
- Format the output with oxfmt
- Lock the generated file to prevent manual edits
- Regenerate automatically when components change

#### Storyblok Redirects Plugin

Generate and handle redirects from Storyblok datasource entries:

```typescript
// vite.config.ts
import { redirects } from 'storyloco/vite'

export default defineConfig({
	plugins: [
		redirects({
			datasource: 'redirects',
			public_storyblok_access_token: 'your-token'
		})
	]
})
```

**Options:**

- `datasource` - The Storyblok datasource name (defaults to 'redirects')
- `public_storyblok_access_token` - Your public access token (defaults to `PUBLIC_STORYBLOK_ACCESS_TOKEN` env var)

**SvelteKit Integration:**

```typescript
// src/hooks.server.ts
import { handle_redirects } from 'storyloco/vite'

export const handle = handle_redirects
```

The plugin will:

- Fetch redirect entries from your Storyblok datasource
- Bake them into the build as a fallback
- Support exact matches and wildcard patterns, with or without a trailing slash (SvelteKit strips it before hooks run, so `/old/` matches a request for `/old`)
- Handle both internal and external redirects

Redirects stay live without a rebuild: the handle fetches the datasource on a server's first request, then serves from memory and refreshes in the background once the list is a minute old. If Storyblok can't be reached, it keeps the last list it had, or the one baked in at build.

## 🔧 Development

### Prerequisites

- **Bun** (recommended) or Node.js 18+
- **Storyblok** account for field plugin development

### Setup

```bash
# Clone the repo
git clone <your-repo-url>
cd storyloco

# Install dependencies
bun install

# Start development
bun run dev
```

### Project Structure

```
storyloco/
├── packages/
│   ├── mux/          # Video upload & management plugin
│   ├── heading/      # Heading editor plugin
│   ├── theme/        # Theme selector plugin
│   ├── link/         # Link editor plugin
│   ├── seo/          # SEO metadata editor plugin
│   ├── input/        # Form input field plugin
│   └── shared/       # UI component library
├── src/
│   └── index.ts      # Type exports
└── package.json      # Root workspace config
```

### Adding New Plugins

1. **Create plugin package**:

   ```bash
   bun run add-plugin
   ```

2. **Export types** in your plugin:

   Create a `types.ts` file in your plugin package:

   ```typescript
   // packages/your-plugin/types.ts
   export interface YourType {
   	// your interface here
   }
   ```

3. **Add to root exports** in `package.json`:

   ```json
   {
   	"exports": {
   		"./your-plugin": {
   			"types": "./packages/your-plugin/types.ts",
   			"import": "./packages/your-plugin/src/app.svelte"
   		}
   	}
   }
   ```

4. **Re-export in `src/index.ts`**:
   ```typescript
   export type { YourType } from '../packages/your-plugin/types'
   ```

## 🎨 Shared Components

The shared package provides a comprehensive set of UI components:

### Form Components

- `Input` - Text input with proper styling
- `Label` - Accessible form labels
- `Switch` - Toggle switch component
- `Select` - Select component
- `Separator` - Separator component

### Display Components

- `Skeleton` - Loading skeleton component

### Utilities

- `cn()` - Class name utility (clsx + tailwind-merge)
- `setup()` - Global setup function

## 🔌 Field Plugin Development

Each plugin follows the Storyblok field plugin pattern:

```svelte
<script lang="ts">
  import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'

  interface YourData {
    // your data structure
  }

  type Plugin = FieldPluginResponse<YourData | null>

  let plugin: Plugin | null = $state(null)
  let content: YourData = $state(initial_value)

  onMount(() => {
    createFieldPlugin({
      enablePortalModal: true,
      validateContent: (c) => {
        // validation logic
        return { content: validated_content }
      },
      onUpdateState: (state) => {
        plugin = state as Plugin
      },
    })
  })
</script>
```

## 🚀 Deployment

### Deploy Individual Plugins

```bash
# From the plugin directory
cd packages/mux
bun run deploy
```

### Build Shared Package

```bash
cd packages/shared
bun run build
```

## 🛠️ Tech Stack

- **Framework**: Svelte 5 with TypeScript
- **Styling**: Tailwind CSS
- **Components**: Shadcn Svelte, Bits UI primitives
- **Build Tool**: Vite
- **Package Manager**: Bun (recommended)
- **Linting**: ESLint + oxfmt

## 📄 License

MIT License - feel free to use this however you want, you absolute legend! 🎯

## 🤝 Contributing

1. Fork the repo
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Releasing

A release is a merge. Label a PR `release:patch`, `release:minor` or `release:major` before merging
it, and the Release workflow bumps the version, checks and builds it, commits "Release X.Y.Z: <the
PR's title>" to main with its tag, and publishes it to npm through trusted publishing, with no
token or login. To release main as it stands, run Actions → Release → Run workflow.

---

Built with ❤️ and a lot of swearing by the Storyloco team
