import { useStoryblokApi } from "@storyblok/svelte"
import type { Handle } from "./kit.js"
import { StoryblokClient, type Version } from "./storyblok.svelte.js"

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

/** Keeps a Storyblok preview going past its first page; kept in step with `middleware.ts` */
export const PREVIEW_COOKIE = "storyblok_preview"

/**
 * Put the Storyblok content version on `event.locals.version`: draft while developing, in a
 * Storyblok preview and whenever `editor_version` says so; published everywhere else. Goes after
 * `editor` in `sequence`.
 *
 * `?_storyblok` only reaches the document request: client-side navigations fetch
 * `__data.json`, and remote functions POST to `/_app/remote/…`, without it. So a preview is kept
 * on a cookie for the session, which is also what makes `?_storyblok` work outside the visual
 * editor's frame; `?_storyblok=off` ends it.
 *
 * Declare it on `App.Locals` as `version: import("storyloco").Version`.
 */
export const version: Handle = async ({ event, resolve }) => {
	const param = event.url.searchParams.get("_storyblok")
	const previewing = param === null ? !!event.cookies.get(PREVIEW_COOKIE) : param !== "off"
	if (param === "off") event.cookies.delete(PREVIEW_COOKIE, { path: "/" })
	// SameSite=None, so it lasts inside the visual editor's cross-site frame
	else if (param !== null)
		event.cookies.set(PREVIEW_COOKIE, "1", {
			path: "/",
			sameSite: "none",
			secure: true,
			httpOnly: true,
		})

	event.locals.version =
		editor_version(event) ?? (import.meta.env.DEV || previewing ? "draft" : "published")

	// the SDK pins every read to the first cache version it saw, so a warm server never saw a publish
	if (event.locals.version === "published" && StoryblokClient.current) {
		await StoryblokClient.current.init()
		useStoryblokApi()?.clearCacheVersion()
	}

	return await resolve(event)
}
