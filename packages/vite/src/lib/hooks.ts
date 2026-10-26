import type { Handle } from "@sveltejs/kit"
import type { Version } from "./storyblok.svelte.js"
import { dev } from "$app/environment"

export { handle_redirects as redirects } from "./redirects/handle.js"

/** Kept in step with `LIVE` in `editor/server.ts` */
const LIVE = "_storyloco_live"

/**
 * The content version the editor decides for a request, or null to leave it to the site: published
 * for the editor's view of the live page (`?_storyloco_live`), whatever else applies; draft for
 * someone signed in through the `editor` hook, or a guest they've shared the draft with.
 *
 * @example
 * ```ts
 * event.locals.version = editor_version(event) ?? (dev ? "draft" : "published")
 * ```
 */
export function editor_version(event: { locals: object; url: URL }): Version | null {
	if (event.url.searchParams.has(LIVE)) return "published"
	const { editor, guest } = event.locals as { editor?: unknown; guest?: unknown }
	return editor || guest ? "draft" : null
}

/**
 * Put the Storyblok content version on `event.locals.version`: draft while developing, inside
 * the visual editor (`?_storyblok`) and whenever `editor_version` says so; published everywhere else.
 * Goes after `editor` in `sequence`.
 *
 * Declare it on `App.Locals` as `version: import("storyloco").Version`.
 */
export const version: Handle = async ({ event, resolve }) => {
	event.locals.version =
		editor_version(event) ??
		(dev || event.url.searchParams.has("_storyblok") ? "draft" : "published")

	return await resolve(event)
}
