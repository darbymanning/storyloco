import type { Handle } from "@sveltejs/kit"
import { dev } from "$app/environment"

export { handle_redirects as redirects } from "./redirects/handle.js"

/**
 * Put the Storyblok content version on `event.locals.version` — draft while developing and
 * inside the visual editor (`?_storyblok`), published everywhere else.
 *
 * Declare it on `App.Locals` as `version: import("storyloco").Version`.
 */
export const version: Handle = async ({ event, resolve }) => {
	event.locals.version = dev || event.url.searchParams.has("_storyblok") ? "draft" : "published"

	return await resolve(event)
}
