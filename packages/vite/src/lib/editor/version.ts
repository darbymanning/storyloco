import type { Version } from "../storyblok.svelte.js"

/** The query that has the editor show the live page beside the draft */
export const LIVE = "_storyloco_live"

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
