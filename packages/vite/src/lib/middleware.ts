/**
 * For a site's Routing Middleware (Vercel's, or any that sees the request ahead of the CDN):
 * requests from someone signed in to edit, or a guest a draft is shared with, onto a cache key
 * of their own.
 *
 * A CDN answers a cached page before any of the site's own code runs, and doesn't vary it on
 * cookies, so an editor would be handed the page visitors see. Middleware runs first, and moving
 * the request onto `?_storyloco=1` puts it on a key nothing is ever cached under, and a Storyblok
 * preview onto `?_storyblok=1`. Nothing here imports anything, so it bundles into middleware as
 * it is.
 *
 * @example
 * ```ts
 * // middleware.ts
 * export { default } from "storyloco/middleware"
 * export const config = { matcher: "/((?!_app/|api/).*)", runtime: "nodejs" }
 * ```
 *
 * Vercel reads `config` from the file itself, so that stays the site's own.
 */

/** The editor's cookies: `sl_editor`, or `sl_editor_<space>`, and a guest's `sl_guest_<space>` */
export const EDITOR_COOKIE = /^sl_(editor|guest)(_\w+)?$/

/** The parameter an editor's request moves onto; a response for it must never be cached */
export const UNCACHED = "_storyloco"

const names = (request: Request) =>
	(request.headers.get("cookie") ?? "").split(";").map((cookie) => cookie.trim().split("=")[0])

/** Whether the request is from someone signed in to edit, or a guest of a shared draft */
export const editing = (request: Request) => names(request).some((name) => EDITOR_COOKIE.test(name))

/**
 * The URL to serve the request from instead, or null to serve it as it is. One with any of
 * `cookies`, the editor's by default, moves onto `?<param>=1`; one already there passes straight
 * through, as does every other.
 */
export function own_key(
	request: Request,
	{ cookies = [EDITOR_COOKIE], param = UNCACHED }: { cookies?: Array<RegExp>; param?: string } = {}
): URL | null {
	if (!names(request).some((name) => cookies.some((cookie) => cookie.test(name)))) return null
	const url = new URL(request.url)
	if (url.searchParams.has(param)) return null
	url.searchParams.set(param, "1")
	return url
}

/** Cookies, and the parameter a request carrying any of them moves onto */
export type Key = { cookies: Array<RegExp>; param: string }

/** Someone signed in to edit, or a guest of a shared draft */
export const EDITORS: Key = { cookies: [EDITOR_COOKIE], param: UNCACHED }

/**
 * A Storyblok preview, onto `?_storyblok`, which the `version` hook reads as it does inside the
 * visual editor; kept in step with its `PREVIEW_COOKIE`. One already there passes through, which
 * is what lets `?_storyblok=off` reach the hook and end it.
 */
export const PREVIEW: Key = { cookies: [/^storyblok_preview$/], param: "_storyblok" }

/**
 * A whole middleware: the first of `keys` whose cookie a request carries moves it onto its
 * parameter, and every other request passes through. It answers the way Vercel's `rewrite` and
 * `next` do, without needing them.
 *
 * @example
 * ```ts
 * // a shop's signed-in customers too, on one key with the editors
 * export default middleware([
 * 	{ cookies: [/^session$/, EDITOR_COOKIE], param: "_signed_in" },
 * ])
 * ```
 */
export function middleware(keys: Array<Key> = [PREVIEW, EDITORS]) {
	return (request: Request) => {
		const have = names(request)
		const key = keys.find(({ cookies }) => have.some((name) => cookies.some((c) => c.test(name))))
		const url = key && own_key(request, key)
		return new Response(null, {
			headers: url ? { "x-middleware-rewrite": String(url) } : { "x-middleware-next": "1" },
		})
	}
}

export default middleware()
