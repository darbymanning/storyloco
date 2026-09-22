import {
	storyblokInit,
	apiPlugin,
	renderRichText as richtext,
	useStoryblokBridge,
	StoryblokComponent as Block,
	storyblokEditable as editable,
	useStoryblokApi,
	type ISbStoryData,
	type SbBlokData,
} from "@storyblok/svelte"
import type { Component } from "svelte"
import { SvelteMap } from "svelte/reactivity"
import { createAttachmentKey as attach } from "svelte/attachments"
import { error } from "@sveltejs/kit"

/**
 * Wrapper interface for storyblok stories with reactive state management
 * @template T - The story data type extending ISbStoryData
 *
 * @example
 * ```typescript
 * // In a page component (+page.svelte)
 * let { data: _data } = $props()
 *
 * const data = $derived(client.connect(_data.story))
 *
 * // Now you have full type safety for the story content
 * if (data.story?.content.title) {
 *   // TypeScript knows this is a string
 *   console.log(data.story.content.title)
 * }
 * ```
 */
export interface Storyblok<T extends ISbStoryData> {
	/** The current story data, can be null */
	story: T | null
}

/** Type for dynamic component imports */
type Import<T = unknown> = () => Promise<T>

/** Everything a client needs, so a project doesn't have to subclass to configure one. */
export interface ClientOptions {
	/** Your Storyblok access token */
	token: string
	/**
	 * The block and template components to register.
	 *
	 * Call `import.meta.glob` at your own call site and pass the result — Vite has to see
	 * the literal pattern to rewrite it, so the glob can't live in here.
	 */
	components?: Record<string, Import>
	/** Relation fields to resolve on every request, e.g. `["shared.items"]` */
	relations?: Array<string>
	/**
	 * Content types that render through another component, e.g. `{ news: "blog" }` when
	 * news posts reuse the blog template. Applied by `template`.
	 */
	aliases?: Record<string, string>
}

/** Type alias for the storyblok api instance */
type API = ReturnType<typeof useStoryblokApi>

/**
 * Main Storyblok client class that handles component registration, API calls, and story bridging
 * Provides a unified interface for working with Storyblok in Svelte applications
 */
export class StoryblokClient {
	/** Map of registered Svelte components by name */
	components = new SvelteMap<string, Component>()
	/** The in-flight or settled setup, shared by every caller of `init` */
	#ready: Promise<void> | undefined
	/** Array of relation field names to resolve when fetching stories */
	relations: Array<string> = []
	/** Content types that render through another component's template */
	aliases: Record<string, string> = {}

	/**
	 * Check if the current URL is in Storyblok preview mode
	 * @param url - The URL to check
	 * @returns True if in preview mode
	 */
	is_preview(url: URL): boolean {
		return url.searchParams.has("_storyblok")
	}

	/**
	 * Resolve a story to its component by `component` name.
	 *
	 * Falls back when the name isn't registered, so a content type added in Storyblok
	 * before its component exists renders as a generic page rather than blanking.
	 */
	template(story: ISbStoryData | null, fallback = "page"): Component | null | undefined {
		if (!story) return null

		const name = story.content.component || fallback

		return this.components.get(this.aliases[name] ?? name) ?? this.components.get(fallback)
	}

	/** Storyblok access token for API authentication */
	#access_token: string
	/** Map of component import functions */
	#component_imports: Record<string, Import>

	/** Every API method below goes through here, so callers never `await init()` first. */
	async #api(): Promise<API> {
		await this.init()
		return useStoryblokApi()
	}

	/** Fetch a single story or collection of stories */
	get: API["get"] = async (...args) => (await this.#api()).get(...args)
	/** Fetch all stories matching criteria (handles pagination automatically) */
	getAll: API["getAll"] = async (...args) => (await this.#api()).getAll(...args)
	/** Fetch a specific story by slug */
	getStory: API["getStory"] = async (...args) => (await this.#api()).getStory(...args)
	/** Make a POST request to the Storyblok API */
	post: API["post"] = async (...args) => (await this.#api()).post(...args)
	/** Make a PUT request to the Storyblok API */
	put: API["put"] = async (...args) => (await this.#api()).put(...args)
	/** Make a DELETE request to the Storyblok API */
	delete: API["delete"] = async (...args) => (await this.#api()).delete(...args)

	/** The standalone `handle_error`, on the instance so `.catch(client.handle_error)` works */
	handle_error = handle_error

	/**
	 * Configured here rather than by subclassing, so setup is one expression.
	 *
	 * @example
	 * ```typescript
	 * export const client = new StoryblokClient({
	 * 	token: PUBLIC_STORYBLOK_ACCESS_TOKEN,
	 * 	relations: ["shared.items"],
	 * 	components: import.meta.glob(["$blocks/**\/*.svelte", "$templates/*.svelte"]),
	 * })
	 * ```
	 */
	constructor({ token, components = {}, relations = [], aliases = {} }: ClientOptions) {
		this.#access_token = token
		this.#component_imports = components
		this.relations = relations
		this.aliases = aliases

		// Eager, but handled so a failure surfaces to whoever awaits `init` rather than
		// as an unhandled rejection
		this.init().catch(() => {})
	}

	/**
	 * Load the components and set up the SDK.
	 *
	 * Safe to call any number of times, including concurrently — the first call starts the
	 * work and every later one awaits that same promise. Server callers never need it; the
	 * API methods await it themselves. The browser does, since `components` must be
	 * populated before the first render.
	 */
	init(): Promise<void> {
		return (this.#ready ??= this.#setup())
	}

	async #setup(): Promise<void> {
		// Load all components from the provided imports
		for (const [path, fn] of Object.entries(this.#component_imports)) {
			const name = path.split("/").pop()?.replace(".svelte", "") ?? ""
			if (name) {
				const component = (await fn()) as { default: Component }
				this.components.set(name, component.default)
			}
		}

		// Initialize the Storyblok SDK
		storyblokInit({
			accessToken: this.#access_token,
			use: [apiPlugin],
			components: Object.fromEntries(this.components),
		})
	}

	/** Storyblok editable function for making content editable in preview mode */
	editable = editable

	/**
	 * Connect a story to Storyblok's live preview system for real-time updates
	 * @param current - The current story data
	 * @returns A reactive wrapper with the story data
	 * @template T - The story data type
	 *
	 * @example
	 * ```typescript
	 * const data = $derived(client.connect(story))
	 * // data.story will update automatically when content changes in Storyblok
	 * ```
	 */
	connect<T extends ISbStoryData>(current: T): Storyblok<T> {
		let story = $state<T | null>(current)

		$effect(() => {
			if (!current) return

			useStoryblokBridge(current.id, (updated) => (story = updated as T), {
				resolveLinks: "url",
				resolveRelations: this.relations,
			})
		})

		return {
			get story() {
				return story
			},
		}
	}
}

/** The Storyblok content version to read. `event.locals.version` from `storyloco/hooks`. */
export type Version = "draft" | "published"

/**
 * Richtext, with `attrs` typed so an embedded blok's fields are reachable — the CLI types
 * it as `Record<string, unknown>`. `Blocks` is your generated block union.
 */
export interface Richtext<Blocks = unknown> {
	type: string
	text?: string
	attrs?: { body: Blocks }
	content?: Array<Richtext<Blocks>>
	marks?: Array<Richtext<Blocks>>
}

/**
 * Content types by component name, for narrowing reads by `content_type`. Empty here;
 * the schema plugin's generated file merges the space's `ContentTypes` into it, so
 * `storyblok.stories({ content_type: "product" })` is typed as products without a type
 * argument. Until a schema is generated every name falls back to the SDK's content type.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Registry {}

/** The SDK's permissive content type: any component, any fields. */
export type Content = ISbStoryData["content"]

/** Each name in a comma-separated `content_type`. */
type Names<S extends string> = S extends `${infer A},${infer B}` ? A | Names<B> : S

/**
 * The content behind a `content_type` param. Registered names map to their generated
 * types (a list to their union); anything else is the permissive `Content`.
 */
export type ContentFor<K extends string> = [Names<K>] extends [keyof Registry]
	? Registry[Names<K>]
	: Content

/**
 * A story per member of `T`, so a union of content types is a union of stories —
 * `Story<Product | Category>` is `ISbStoryData<Product> | ISbStoryData<Category>`, which
 * `is_component` can narrow. `ISbStoryData<Product | Category>` can't be.
 */
export type Story<T> = T extends unknown ? ISbStoryData<T> : never

/**
 * Narrow a story (or a union of them) by its content's `component`. TypeScript won't
 * narrow the story through the nested discriminant on its own.
 *
 * @example
 * ```ts
 * const story = await storyblok.find<Product | Category>(`products/${slug}`)
 * if (is_component(story, "product")) story.content.sku // ISbStoryData<Product>
 * ```
 */
export function is_component<S extends ISbStoryData<{ component?: string }>, K extends string>(
	story: S | null | undefined,
	component: K
): story is Extract<S, { content: { component?: K } }> {
	return story?.content.component === component
}

/** Adds the `story.url` that `resolve_links: "url"` injects but the CLI doesn't declare. */
export type Resolved<T extends { story?: unknown }> = T & {
	story?: NonNullable<T["story"]> & { url?: string }
}

/** Structural, so a generated `StoryblokMultilink` satisfies it. */
interface Link {
	linktype?: string
	url?: string
	cached_url?: string
	// The index signature stops TypeScript rejecting the generated `story` as a weak type
	story?: { url?: string; [key: string]: unknown }
}

/**
 * Resolve a multilink to an href. Story links become root-relative, everything else passes
 * through. Prefers `story.url` over `cached_url`, which goes stale when a target moves —
 * so pair with `resolve_links: "url"`.
 */
export function href(link?: Link): string | undefined {
	if (!link) return undefined

	return link.linktype === "story"
		? `/${link.story?.url || link.cached_url}`
		: link.url || link.cached_url
}

/**
 * Turn a Storyblok error into a SvelteKit one, for `.catch(handle_error)`.
 *
 * A missing story is a 404; anything else is a 500, since the CMS being unreachable isn't
 * something to show a visitor a Storyblok status code for.
 */
export function handle_error(err: unknown): never {
	console.error(err)

	const status = typeof err === "object" && err !== null && "status" in err ? err.status : undefined

	if (status === 404) error(404, "Story not found")

	error(500, "Internal server error")
}

/** Declaring these keeps `SbBlokData`'s index signature from widening every access. */
interface BlokFields {
	anchor?: string
}

/**
 * Spread onto a block's root element to wire it up for the visual editor.
 *
 * Prefer this to `use:editable`: being an attachment it spreads, so the element keeps its
 * own attributes and a project can wrap it. Also sets a stable `id` from the block's
 * `anchor`, falling back to `_uid`.
 *
 * @example
 * ```svelte
 * <script lang="ts">
 * 	import { attrs } from "storyloco"
 * 	import type { Blok, Hero } from "$lib/components.schema.js"
 *
 * 	let { blok }: { blok: Blok<Hero> } = $props()
 * </script>
 *
 * <section {...attrs(blok)}>
 * 	<h1>{blok.headline}</h1>
 * </section>
 * ```
 */
export function attrs<T extends BlokFields>(blok: T & { _uid?: string; _editable?: string }) {
	return {
		[attach()](node: HTMLElement) {
			// SbBlokData is nominal ceremony here — editable only reads `_editable`.
			editable(node, blok as unknown as SbBlokData)
		},
		id: blok.anchor || blok._uid,
	}
}

// Map section fields onto CSS custom properties by wrapping `attrs`, rather than reaching
// past it — the field names and design tokens are yours:
//
// interface SectionFields extends BlokFields {
// 	theme?: number | string
// 	pad_top?: number | string
// }
//
// export function section<T extends SectionFields>(blok: Blok<T>) {
// 	let style = ""
// 	if (blok.theme) style += `--theme: var(--c-${blok.theme});`
// 	if (blok.pad_top) style += `--pt: var(--s-${blok.pad_top});`
// 	return { ...attrs(blok), style }
// }

/** Re-export commonly used Storyblok utilities */
export { editable, Block, richtext }
