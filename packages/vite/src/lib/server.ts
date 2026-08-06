import { getRequestEvent } from "$app/server"
import type { ISbStoriesParams, ISbStoryData, ISbStoryParams } from "@storyblok/svelte"
import type { ISbLink, ISbLinks, ISbLinksParams } from "storyblok-js-client"
import { handle_error, type StoryblokClient, type Version } from "./storyblok.svelte.js"

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
 * await storyblok.stories<Blog>({ content_type: "blog", per_page: 2 })
 *
 * const { client, version } = storyblok()
 * await client.get("cdn/links", { version })
 * ```
 */
export function setup(client: StoryblokClient) {
	const context = () => ({ client, version: version() })

	return Object.assign(context, {
		/**
		 * A single story by full slug. Resolves the client's `relations`, unlike `stories`.
		 *
		 * `T` is the story's content type; it defaults to the SDK's permissive one, so an
		 * unparameterised call behaves as before.
		 */
		async story<T = ISbStoryData["content"]>(slug: string, params: ISbStoryParams = {}) {
			const response = await client
				.get(`cdn/stories/${slug}`, {
					version: version(),
					resolve_links: "url",
					resolve_relations: client.relations,
					resolve_assets: 1,
					...params,
				})
				.catch(handle_error)

			return response.data.story as ISbStoryData<T>
		},

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

		/** A list of stories. `total` is the unpaged count, for "showing n of m". */
		async stories<T>(params: ISbStoriesParams = {}) {
			const response = await client
				.get("cdn/stories", {
					version: version(),
					resolve_links: "url",
					resolve_assets: 1,
					...params,
				})
				.catch(handle_error)

			return {
				stories: response.data.stories as Array<ISbStoryData<T>>,
				total: response.total ?? 0,
			}
		},
	})
}
