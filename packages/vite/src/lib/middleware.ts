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
 * export const config = { matcher: "/((?!_app/(?!remote/)|.*\\.(?!json$)\\w+$).*)", runtime: "nodejs" }
 * ```
 *
 * Vercel reads `config` from the file itself, so that stays the site's own. Middleware is a
 * function call of its own on every request it matches, cached answer or not, so the matcher
 * above keeps to what a cache key matters for: pages, their `__data.json` and remote functions,
 * not built assets or anything else that ends in a file extension.
 */

/** The editor's cookies: `sl_editor`, or `sl_editor_<space>`, and a guest's `sl_guest_<space>` */
export const EDITOR_COOKIE = /^sl_(editor|guest)(_\w+)?$/

/** The parameter an editor's request moves onto; a response for it must never be cached */
export const UNCACHED = "_storyloco"

const pairs = (request: Request) =>
	(request.headers.get("cookie") ?? "").split(";").map((cookie) => {
		const [name, ...value] = cookie.trim().split("=")
		return [name, value.join("=")] as const
	})

const names = (request: Request) => pairs(request).map(([name]) => name)

/** Whether the request is from someone signed in to edit, or a guest of a shared draft */
export const editing = (request: Request) => names(request).some((name) => EDITOR_COOKIE.test(name))

/**
 * Cookies, and the parameter a request carrying any of them moves onto: `?<param>=1`, or with
 * `value`, `?<param>=<what it returns for the cookie's value>`, so each value has a cached copy
 * of its own. A value it returns nothing for stays on the copy every visitor shares.
 */
export type Key = {
	cookies: Array<RegExp>
	param: string
	value?: (value: string) => string | null | undefined | false
}

/** What a request's cookies put on `key`: "1", a `value` key's value, or nothing when it has none of them */
function carried(request: Request, { cookies, value }: Pick<Key, "cookies" | "value">) {
	for (const [name, held] of pairs(request)) {
		if (!cookies.some((cookie) => cookie.test(name))) continue
		if (!value) return "1"
		const kept = value(held)
		if (kept) return kept
	}
	return null
}

/**
 * The URL to serve the request from instead, or null to serve it as it is. A read with any of
 * `cookies`, the editor's by default, moves onto `?<param>=1`; one already there passes straight
 * through, as does every other. A `value` key always carries the cookie's own value, whatever
 * the address said: which copy a visitor gets isn't theirs to type.
 *
 * Only reads: nothing else is cached, and a SvelteKit form post moved onto its own key loses its
 * action (`?/name`) on the way, so it finds none. The `version` hook reads the cookie on a post
 * itself.
 */
export function own_key(
	request: Request,
	{ cookies = [EDITOR_COOKIE], param = UNCACHED, value }: Partial<Key> = {}
): URL | null {
	if (request.method !== "GET" && request.method !== "HEAD") return null
	const on = carried(request, { cookies, value })
	if (!on) return null
	const url = new URL(request.url)
	if (value ? url.searchParams.get(param) === on : url.searchParams.has(param)) return null
	url.searchParams.set(param, on)
	return url
}

/** Someone signed in to edit, or a guest of a shared draft */
export const EDITORS: Key = { cookies: [EDITOR_COOKIE], param: UNCACHED }

/**
 * A Storyblok preview, onto `?_storyblok`, which the `version` hook reads as it does inside the
 * visual editor; kept in step with its `PREVIEW_COOKIE`. One already there passes through, which
 * is what lets `?_storyblok=off` reach the hook and end it.
 */
export const PREVIEW: Key = { cookies: [/^storyblok_preview$/], param: "_storyblok" }

/** A visitor's choice kept in a cookie, as `chosen` here and `choice` in `storyloco/hooks` both take it */
export type Choice = {
	/** The cookie the choice is kept in */
	cookie: string
	/** The parameter each value is moved onto; `_<cookie>` unless said */
	param?: string
	/** What a visitor who hasn't chosen gets, which stays on the copy everyone shares */
	shared?: string
}

/**
 * A visitor's choice kept in a cookie, a location or a currency say, that pages are rendered
 * for: each value onto a cached copy of its own, `?_<cookie>=<value>`. The `choice` helper
 * (`storyloco/hooks`) reads it on the other side, from the same object.
 *
 * @example
 * ```ts
 * export default middleware([PREVIEW, EDITORS, chosen({ cookie: "location", shared: "all" })])
 * ```
 */
export function chosen({ cookie, param = `_${cookie}`, shared }: Choice): Key {
	return {
		cookies: [new RegExp(`^${cookie.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)],
		param,
		// short and plain, so a cookie can't be used to fill the cache with copies
		value: (value) => /^[\w-]{1,64}$/.test(value) && value !== shared && value,
	}
}

/**
 * Whether a remote function is being asked from a preview's page. Its own address doesn't carry
 * the page's `?_storyblok…`, which is how the visual editor asks for drafts. SvelteKit 2 sends
 * the page's in a header; 3 sends nothing for a query, so the browser's `referer` is read, which
 * names the page in full for a request to its own site. A browser that blocks third-party
 * cookies keeps no preview cookie inside the editor's frame, so nothing else tells such a
 * request from a visitor's.
 */
const from_preview = (request: Request) => {
	const asked = (search?: string | null) => !!search && /[?&]_storyblok(?!=off(&|$))/.test(search)
	if (asked(request.headers.get("x-sveltekit-search"))) return true
	if (!/\/remote\//.test(new URL(request.url).pathname)) return false
	try {
		const from = new URL(request.headers.get("referer") ?? "")
		return from.origin === new URL(request.url).origin && asked(from.search)
	} catch {
		return false
	}
}

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
		const key = keys.find((key) => carried(request, key))
		let url = key && own_key(request, key)
		if (!key && from_preview(request) && (request.method === "GET" || request.method === "HEAD")) {
			url = new URL(request.url)
			url.searchParams.set(UNCACHED, "1")
		}
		return new Response(null, {
			headers: url ? { "x-middleware-rewrite": String(url) } : { "x-middleware-next": "1" },
		})
	}
}

export default middleware()
