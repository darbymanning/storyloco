import type { RequestEvent } from "@sveltejs/kit"
import type { Handle } from "./kit.js"
import { editor_version } from "./editor/version.js"
import { UNCACHED } from "./middleware.js"
import { RECHECK } from "./storyblok.svelte.js"

/**
 * What the `cache` hook sends by default: a CDN keeps the response for an hour, then goes on
 * serving it for up to a day while a fresh one renders behind the request; a browser checks back
 * every time. With `purge` wired to a publish webhook, the hour can be far longer.
 */
export const SHARED = "max-age=0, s-maxage=3600, stale-while-revalidate=86400"

/** The cache tag every response the `cache` hook shares carries, which `purge` invalidates */
export const TAG = "storyloco"

/** Vite's development flag, absent outside a Vite build, like under tests */
const dev = Boolean(import.meta.env?.DEV)

/** Requests whose response is one visitor's, or an answer that shouldn't outlive the moment */
const unshared = new WeakSet<object>()

/**
 * Keep this request's response out of shared caches. For anything the `cache` hook can't see for
 * itself: a page that read the visitor's cookie, or a load or remote function that hid a failure
 * (a form left out because its provider was down), which would otherwise be served to everyone
 * long after it's over. `storyloco/server` has one that finds the request itself.
 */
export function uncached(event: Pick<RequestEvent, "locals">) {
	unshared.add(event.locals)
}

export type CacheOptions = {
	/** The `Cache-Control` a shared response gets; `SHARED` by default */
	policy?: string
	/**
	 * The site's own say, asked for every response that could be shared: false keeps it out.
	 * For a deployment behind a password, or one that should only cache in production
	 */
	when?: (event: RequestEvent) => boolean | Promise<boolean>
	/**
	 * Remote functions, by name, whose answer is the same for every visitor: queries of published
	 * content, not ones that read the request (a country, a session). None by default; a query
	 * not named is never cached, so a new one is private until someone decides otherwise
	 */
	queries?: Iterable<string>
	/**
	 * Share a 404 too, the answer crawlers ask for most. Only for a site whose loads raise a 404
	 * when a page isn't there and nothing else: one that also turns a failed read into a 404
	 * would have the failure cached
	 */
	not_found?: boolean
	/** The cache tag shared responses carry (`Vercel-Cache-Tag`), for `purge`; false for none */
	tag?: string | false
}

type Shown = Pick<RequestEvent, "request" | "url" | "locals" | "isDataRequest"> & {
	isRemoteRequest?: boolean
}

const json = (response: Response) =>
	(response.headers.get("content-type") ?? "").startsWith("application/json")
		? (response
				.clone()
				.json()
				.catch(() => null) as Promise<Record<string, unknown> | null>)
		: null

/** The remote function a request is for: the `<name>` of `…/remote/<hash>/<name>` */
export function remote_name(request: Request) {
	return new URL(request.url).pathname.match(/\/remote\/[^/]+\/([^/]+)$/)?.[1]
}

/**
 * Whether a response is the same for everyone who asks for its address, and an answer worth
 * keeping: a published page, the data a navigation to one asks for, or a remote function named
 * in `queries`, that didn't fail. What the `cache` hook decides by; exported for a site that
 * sets its own headers.
 *
 * A failure hides in two places a status doesn't show: a load that threw answers a data request
 * with a 200, the error inside it, and so does a remote function. Both are read here.
 */
export async function shareable(
	event: Shown,
	response: Response,
	{ queries, not_found = false }: Pick<CacheOptions, "queries" | "not_found"> = {}
) {
	const { request, url, locals } = event
	if (request.method !== "GET" && request.method !== "HEAD") return false
	// a CDN won't keep these either; said here so a site's own headers agree with it
	if (request.headers.has("authorization") || response.headers.has("set-cookie")) return false
	if (unshared.has(locals)) return false

	// drafts, and whoever sees them: `version` for a site with the `version` hook, and what that
	// hook goes by for one that picks its own
	const { editor, guest, version } = locals as {
		editor?: unknown
		guest?: unknown
		version?: string
	}
	if (editor || guest) return false
	const shown =
		version ?? editor_version(event) ?? (url.searchParams.has("_storyblok") ? "draft" : "published")
	if (shown !== "published") return false
	// moved off the cache by the middleware, for a reason this hook needn't know
	if (new URL(request.url).searchParams.has(UNCACHED)) return false

	const found = response.status === 200 || (not_found && response.status === 404)

	if (event.isRemoteRequest) {
		const name = remote_name(request)
		if (!name || response.status !== 200 || !new Set(queries).has(name)) return false
		return (await json(response))?.type === "result"
	}

	if (event.isDataRequest) {
		if (response.status !== 200) return false
		const body = await json(response)
		if (body?.type !== "data" || !Array.isArray(body.nodes)) return false
		return body.nodes.every((node: { type?: string; status?: number } | null) => {
			if (node?.type !== "error") return true
			return not_found && node.status === 404
		})
	}

	return found && (response.headers.get("content-type") ?? "").startsWith("text/html")
}

function create({
	policy = SHARED,
	when,
	queries,
	not_found,
	tag = TAG,
}: CacheOptions = {}): Handle {
	const named = new Set(queries)

	return async ({ event, resolve }) => {
		const response = await resolve(event)
		if (dev) return response

		const shown = event as Shown
		// a page that set a policy of its own keeps it; data and remote functions only ever carry
		// SvelteKit's `private, no-store`
		const own =
			!shown.isDataRequest && !shown.isRemoteRequest && response.headers.has("cache-control")
		if (own) return response

		if (!(await shareable(shown, response, { queries: named, not_found }))) return response
		if (when && !(await when(event))) return response

		try {
			response.headers.set("cache-control", policy)
			if (tag) response.headers.set("vercel-cache-tag", tag)
		} catch {
			// a response passed through from elsewhere has headers of its own
		}
		return response
	}
}

const plain = create()

/**
 * Lets a CDN keep what's the same for every visitor, so the site's function runs when content
 * changes rather than on every request: published pages, the `__data.json` a client-side
 * navigation or a hovered link asks for, and the remote functions named in `queries`.
 *
 * Never an editor's or a guest's response, a draft, one that sets a cookie, one marked
 * `uncached`, or one a load or query failed inside; and nothing in development. After `editor`
 * and `version` in the sequence, so it knows who's asking, and around the hooks that decide
 * anything per visitor. It needs `storyloco/middleware` in front of the CDN, which answers
 * before any hook runs: that's what keeps editors and previews off the copies this shares.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * export const handle = sequence(editor, version, cache, …)
 *
 * // or set up
 * cache({ queries: ["get_products"], not_found: true, when: () => !env.BASIC_AUTH_PASS })
 * ```
 */
export function cache(input: Parameters<Handle>[0]): ReturnType<Handle>
export function cache(options?: CacheOptions): Handle
export function cache(input?: Parameters<Handle>[0] | CacheOptions) {
	return input && "event" in input ? plain(input) : create(input)
}

/**
 * Read a parameter the middleware put on the address, and take it off again: it's there for the
 * CDN's key, so no page, redirect or link built from `event.url` should see it.
 */
export function take(url: URL, param: string) {
	const value = url.searchParams.get(param)
	url.searchParams.delete(param)
	return value
}

export type ChoiceOptions<V extends string> = {
	/** The cookie the choice is kept in */
	cookie: string
	/** The parameter `chosen(cookie, param, shared)` in the middleware moves each value onto */
	param: string
	/** Every value there is; anything else is ignored */
	values: ReadonlyArray<V>
	/** What a visitor who hasn't chosen gets: the copy everyone shares, with no cookie needed */
	shared: V
	/** What this request asks to change to, from `?location=` say; sets the cookie when it's news */
	asked?: string | null
	/** The cookie's lifetime in seconds; the browser session without */
	max_age?: number
}

/**
 * A visitor's choice that pages are rendered for, a location or a currency say, kept in a cookie
 * without costing the cache: the value for this request, from what it asks for, else the copy
 * the middleware moved it onto, else the cookie.
 *
 * The CDN keys a page by its address and ignores cookies. So the cookie is only ever set when a
 * visitor chooses, never to give a new one the default, since a response that sets a cookie
 * isn't cached; and a request whose cookie says something its address doesn't, one that came
 * round the middleware, is kept out of the cache with `uncached`.
 *
 * @example
 * ```ts
 * // a hook, before `resolve`
 * event.locals.location = choice(event, {
 * 	cookie: "location",
 * 	param: "_location",
 * 	values: LOCATIONS,
 * 	shared: "all",
 * 	asked: event.url.searchParams.get("location"),
 * })
 * ```
 */
export function choice<const V extends string>(
	event: Pick<RequestEvent, "url" | "cookies" | "locals">,
	{ cookie, param, values, shared, asked, max_age }: ChoiceOptions<V>
): V {
	const known = (value?: string | null) => values.find((known) => known === value)

	const wanted = known(asked)
	const keyed = known(take(event.url, param)) ?? shared
	const kept = known(event.cookies.get(cookie)) ?? shared

	if (wanted && wanted !== kept)
		event.cookies.set(cookie, wanted, { path: "/", ...(max_age && { maxAge: max_age }) })
	else if (kept !== keyed) uncached(event)

	return wanted ?? (keyed !== shared ? keyed : kept)
}

/** What Storyblok says happened, in a webhook's `action`, that changes what visitors see */
export const CHANGES = [
	// stories
	"published",
	"unpublished",
	"deleted",
	"moved",
	// datasources, where redirects and options live
	"entries_updated",
	"entries_deleted",
	// an asset swapped under the same address
	"replaced",
	// releases and pipelines, which publish many stories at once
	"merged",
	"deployed",
] as const

export type PurgeOptions = {
	/**
	 * Marks everything carrying these tags stale at the CDN. On Vercel, `invalidateByTag` from
	 * `@vercel/functions`: storyloco doesn't import it, so the site's bundle does and any other
	 * CDN can stand in
	 */
	invalidate: (tags: Array<string>) => unknown
	/**
	 * The webhook's secret, as set in Storyblok, which signs each request. Without one anyone
	 * who finds the address can purge the cache, so give it one or keep the address unguessable
	 */
	secret?: string
	/** The tags to invalidate; the one the `cache` hook sets by default */
	tags?: Array<string>
	/** The webhook actions that purge; `CHANGES` by default */
	actions?: ReadonlyArray<string>
	/**
	 * How long to wait first, in milliseconds. A warm server reads at the cache version it last
	 * saw for up to `RECHECK`, so a page rendered the instant a publish lands could be the old
	 * one, cached anew. A second past that by default
	 */
	settle?: number
	/**
	 * Runs the wait and the purge after the response, `waitUntil` from `@vercel/functions` say,
	 * so Storyblok is answered at once. Without it the request is held until the purge is done
	 */
	defer?: (work: Promise<unknown>) => void
}

const hex = (bytes: ArrayBuffer) =>
	Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")

/** Whether `signature` is Storyblok's for `body`: the hex HMAC-SHA1 of the raw body under the secret */
export async function signed_by_storyblok(body: string, signature: string | null, secret: string) {
	if (!signature) return false
	const encode = new TextEncoder()
	const key = await crypto.subtle.importKey(
		"raw",
		encode.encode(secret),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"]
	)
	const expected = hex(await crypto.subtle.sign("HMAC", key, encode.encode(body)))
	const given = signature.trim().toLowerCase()
	if (given.length !== expected.length) return false
	// every character compared, so the time taken says nothing about where they differ
	let differs = 0
	for (let i = 0; i < expected.length; i++) differs |= expected.charCodeAt(i) ^ given.charCodeAt(i)
	return differs === 0
}

/**
 * An endpoint for a Storyblok webhook that purges what the `cache` hook shared, so a publish
 * shows in seconds however long the CDN is told to keep pages. Point a webhook at it for story,
 * datasource, asset, release and pipeline events.
 *
 * Storyblok doesn't retry a webhook, so a purge that fails answers 500 for its log to show.
 *
 * @example
 * ```ts
 * // src/routes/webhooks/purge/+server.ts
 * import { invalidateByTag, waitUntil } from "@vercel/functions"
 * import { purge } from "storyloco/hooks"
 * import { env } from "$env/dynamic/private"
 *
 * export const POST = purge({
 * 	invalidate: invalidateByTag,
 * 	defer: waitUntil,
 * 	secret: env.STORYBLOK_WEBHOOK_SECRET,
 * })
 * ```
 */
export function purge({
	invalidate,
	secret,
	tags = [TAG],
	actions = CHANGES,
	settle = RECHECK + 1000,
	defer,
}: PurgeOptions) {
	const reply = (body: Record<string, unknown>, status = 200) =>
		// Storyblok asks for JSON back
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json", "cache-control": "no-store" },
		})

	return async ({ request }: Pick<RequestEvent, "request">) => {
		const body = await request.text()
		if (
			secret &&
			!(await signed_by_storyblok(body, request.headers.get("webhook-signature"), secret))
		)
			return reply({ message: "Signature doesn’t match" }, 401)

		let action: unknown
		try {
			action = (JSON.parse(body) as { action?: unknown }).action
		} catch {
			return reply({ message: "Not a Storyblok webhook" }, 400)
		}
		if (typeof action !== "string" || !actions.includes(action))
			return reply({ purged: false, action: action ?? null })

		const work = (async () => {
			if (settle > 0) await new Promise((done) => setTimeout(done, settle))
			await invalidate(tags)
		})()

		if (defer) {
			defer(work.catch((e) => console.error("storyloco: purge failed", e)))
			return reply({ purged: "soon", action, tags }, 202)
		}
		try {
			await work
		} catch (e) {
			console.error("storyloco: purge failed", e)
			return reply({ purged: false, action, message: "The purge failed" }, 500)
		}
		return reply({ purged: true, action, tags })
	}
}
