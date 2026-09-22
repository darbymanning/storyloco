import { getRequestEvent } from "$app/server"
import { error } from "@sveltejs/kit"
import type { ISbStoriesParams, ISbStoryParams } from "@storyblok/svelte"
import type { ISbLink, ISbLinks, ISbLinksParams } from "storyblok-js-client"
import {
	handle_error,
	type Content,
	type ContentFor,
	type Story,
	type StoryblokClient,
	type Version,
} from "./storyblok.svelte.js"

function is_not_found(err: unknown) {
	return typeof err === "object" && err !== null && "status" in err && err.status === 404
}

/** The content version for the current request, as set by the `version` hook. */
export function version(): Version {
	return getRequestEvent().locals.version
}

/**
 * Bind a client to the current request.
 *
 * Returns a callable: call it for the client and version to reach anything the methods
 * don't cover, or use `.story` / `.stories` for the common reads. Those carry the
 * request's version and the resolve options a Storyblok read almost always wants; the
 * caller's params are spread last, so every default can be overridden. `resolve_links`
 * is on because `href` depends on it.
 *
 * @example
 * ```ts
 * // $lib/storyblok.server.ts
 * export const storyblok = setup(client)
 *
 * // anywhere on the server
 * await storyblok.story("layout")
 * await storyblok.find<Product>(`products/${slug}`) // null when missing
 * await storyblok.find<Product | Category>(slug) // a union of stories; narrow with is_component
 * await storyblok.stories({ content_type: "blog", per_page: 2 }) // typed from the generated schema
 * await storyblok.all<Product>({ content_type: "product" }) // every page
 *
 * const { client, version } = storyblok()
 * await client.get("cdn/links", { version })
 * ```
 */
export function setup(client: StoryblokClient) {
	const context = () => ({ client, version: version() })

	/**
	 * A single story by full slug, or `null` when there isn't one. Resolves the client's
	 * `relations`, unlike `stories`. For slugs that are allowed not to exist — a miss is
	 * routine, so it's neither raised nor logged. `T` is the story's content type.
	 */
	async function find<T = Content>(slug: string, params: ISbStoryParams = {}) {
		const response = await client
			.get(`cdn/stories/${slug}`, {
				version: version(),
				resolve_links: "url",
				resolve_relations: client.relations,
				resolve_assets: 1,
				...params,
			})
			.catch((err: unknown) => {
				if (is_not_found(err)) return null
				return handle_error(err)
			})

		return (response?.data.story ?? null) as Story<T> | null
	}

	/** A single story by full slug; a missing one is a 404. `find` for stories that may not exist. */
	async function story<T = Content>(slug: string, params: ISbStoryParams = {}) {
		const found = await find<T>(slug, params)
		if (!found) error(404, "Story not found")
		return found
	}

	type Listing<T> = { stories: Array<Story<T>>; total: number }

	/**
	 * A list of stories. `total` is the unpaged count, for "showing n of m".
	 *
	 * With a `content_type` the generated schema registers, the stories are typed as it —
	 * no type argument needed. Otherwise `T`, defaulting to the SDK's permissive content.
	 */
	function stories<K extends string>(
		params: ISbStoriesParams & { content_type: K }
	): Promise<Listing<ContentFor<K>>>
	function stories<T = Content>(params?: ISbStoriesParams): Promise<Listing<T>>
	async function stories(params: ISbStoriesParams = {}) {
		const response = await client
			.get("cdn/stories", {
				version: version(),
				resolve_links: "url",
				resolve_assets: 1,
				...params,
			})
			.catch(handle_error)

		return { stories: response.data.stories, total: response.total ?? 0 }
	}

	/**
	 * Every story matching the params, paged through the API's 100-per-page cap.
	 * `stories` for one page with a total; this for the whole set. Typed like `stories`.
	 */
	function all<K extends string>(
		params: ISbStoriesParams & { content_type: K }
	): Promise<Array<Story<ContentFor<K>>>>
	function all<T = Content>(params?: ISbStoriesParams): Promise<Array<Story<T>>>
	async function all(params: ISbStoriesParams = {}) {
		return client
			.getAll("cdn/stories", {
				version: version(),
				resolve_links: "url",
				resolve_assets: 1,
				per_page: 100,
				...params,
			})
			.catch(handle_error)
	}

	return Object.assign(context, {
		story,
		find,
		stories,
		all,

		/**
		 * The link tree as a flat array — Storyblok returns it keyed by uuid, which is
		 * almost never what you want. Filtering and ordering are left to the caller.
		 */
		async links(params: ISbLinksParams = {}) {
			const response = await client
				.get("cdn/links", { version: version(), per_page: 1000, ...params })
				.catch(handle_error)

			return Object.values((response.data as ISbLinks).links ?? {}) as Array<ISbLink>
		},
	})
}
