import type { RequestEvent } from "@sveltejs/kit"
import type { Handle } from "./kit.js"
import { editor_version } from "./editor/version.js"
import { UNCACHED, type Choice } from "./middleware.js"
import { setting } from "./settings.js"
import { RECHECK } from "./storyblok.svelte.js"

/**
 * What the `cache` hook sends by default: a CDN keeps the response for an hour, then goes on
 * serving it for up to a day while a fresh one renders behind the request; a browser checks back
 * every time. A publish purges it sooner, where there's a webhook or the publish is storyloco's.
 */
export const SHARED = "max-age=0, s-maxage=3600, stale-while-revalidate=86400"

/**
 * What a page that isn't there is sent with: long enough to take a crawler's run at it, short
 * enough that a 404 a site raised by mistake is gone in a minute
 */
export const MISSING = "max-age=0, s-maxage=60"

/** The cache tag every response the `cache` hook shares carries, which a purge invalidates */
export const TAG = "storyloco"

/** Where a Storyblok webhook posts to purge the cache, answered by the `editor` and `cache` hooks */
export const PURGE_PATH = "/__storyloco/purge"

/** Says what the `cache` hook decided and why, on every response it saw: `shared`, or `private; <why>` */
export const EXPLAIN = "x-storyloco-cache"

/** Vite's development flag, absent outside a Vite build, like under tests */
const dev = Boolean(import.meta.env?.DEV)

/** How the site purges, as its `cache` hook was set up; false when it said not to */
let site_purge: PurgeOptions | false = {}

/** What's known of a request, kept against its `locals`, the one object every hook and load shares */
type Seen = {
	/** Why the response is one visitor's, or an answer that shouldn't outlive the moment */
	personal?: string
	/** Content was read through `storyloco/server`, in the request's own version */
	content?: boolean
}

const seen = new WeakMap<object, Seen>()
const of = (event: Pick<RequestEvent, "locals">) => {
	let state = seen.get(event.locals)
	if (!state) seen.set(event.locals, (state = {}))
	return state
}

/**
 * Keep this request's response out of shared caches. The `cache` hook sees most reasons for
 * itself; this is for one it can't: a load or remote function that hid a failure (a form left
 * out because its provider was down), which would otherwise be served to everyone long after
 * it's over. `storyloco/server` has one that finds the request itself.
 */
export function uncached(event: Pick<RequestEvent, "locals">, why = "marked uncached") {
	of(event).personal ??= why
}

/** Notes that the request read content, which is what makes a remote function shareable unasked */
export function content_read(event: Pick<RequestEvent, "locals">) {
	of(event).content = true
}

/** Request headers that say who's asking or where from: reading one makes the response theirs */
const PERSONAL =
	/^(cookie|authorization|user-agent|accept-language|x-forwarded-for|x-real-ip|x-vercel-ip-|cf-|sec-ch-)/i

/** Cookies as they were before `watch`, for `choice`, whose reads are accounted for */
const unwatched = new WeakMap<object, RequestEvent["cookies"]["get"]>()

/**
 * Has the request note anything read from it that only this visitor sent: a cookie, their
 * address, a header like their country. A CDN keys a response by its address alone, so a page
 * that looked at any of them is theirs, whatever it found. Hooks that run before `cache`
 * (`editor`, `version`) have read theirs already and aren't counted.
 */
function watch(event: RequestEvent) {
	const state = of(event)
	const note = (what: string) => void (state.personal ??= `read ${what}`)
	try {
		const { cookies, request } = event
		if (!unwatched.has(cookies)) {
			const get = cookies.get.bind(cookies)
			const all = cookies.getAll.bind(cookies)
			unwatched.set(cookies, get)
			cookies.get = (name, ...rest) => (note(`cookie ${name}`), get(name, ...rest))
			cookies.getAll = (...rest) => (note("cookies"), all(...rest))

			const { headers } = request
			const header = headers.get.bind(headers)
			headers.get = (name) => {
				if (PERSONAL.test(name)) note(`header ${name.toLowerCase()}`)
				return header(name)
			}
			const address = event.getClientAddress.bind(event)
			;(event as { getClientAddress: () => string }).getClientAddress = () => (
				note("the visitor's address"),
				address()
			)
		}
	} catch {
		// a runtime whose request can't be wrapped: nothing is noted, and nothing breaks
	}
	return state
}

export type CacheOptions = {
	/** The `Cache-Control` a shared response gets; `SHARED` by default */
	policy?: string
	/**
	 * The site's own say, asked for every response that could be shared: false keeps it out.
	 * Seldom needed: a deployment behind a password isn't cached as it is
	 */
	when?: (event: RequestEvent) => boolean | Promise<boolean>
	/**
	 * Which remote functions are shared. Left out, those that read content through
	 * `storyloco/server` and nothing of the visitor's. Names add ones that read something else
	 * that's the same for everyone (a form's definition); false shares none
	 */
	queries?: Iterable<string> | false
	/**
	 * Share a 404, the answer crawlers ask for most, for `MISSING`'s minute. On by default; off
	 * for a site that can't tell a page that isn't there from a read that failed
	 */
	not_found?: boolean
	/** The cache tag shared responses carry (`Vercel-Cache-Tag`), for a purge; false for none */
	tag?: string | false
	/** Purging, at `PURGE_PATH` and after a publish; false to leave the cache to expire */
	purge?: PurgeOptions | false
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

/** Shared, for a page that's there or (`missing`) one that isn't; or why not */
type Verdict = { share: true; missing: boolean } | { share: false; why: string }
const no = (why: string): Verdict => ({ share: false, why })

/**
 * Whether a response is the same for everyone who asks for its address, and an answer worth
 * keeping, and if not, why. What the `cache` hook decides by.
 *
 * A failure hides in two places a status doesn't show: a load that threw answers a data request
 * with a 200, the error inside it, and so does a remote function. Both are read here.
 */
export async function verdict(
	event: Shown,
	response: Response,
	{ queries, not_found = true }: Pick<CacheOptions, "queries" | "not_found"> = {}
): Promise<Verdict> {
	const { request, url, locals } = event
	if (request.method !== "GET" && request.method !== "HEAD") return no(`a ${request.method}`)
	// a CDN won't keep these either; said here so the headers agree with it
	if (request.headers.has("authorization")) return no("behind a password")
	if (response.headers.has("set-cookie")) return no("sets a cookie")
	const state = seen.get(locals)
	if (state?.personal) return no(state.personal)

	// drafts, and whoever sees them: `version` for a site with the `version` hook, and what that
	// hook goes by for one that picks its own
	const { editor, guest, version } = locals as {
		editor?: unknown
		guest?: unknown
		version?: string
	}
	if (editor) return no("an editor's")
	if (guest) return no("a guest's")
	const shown =
		version ?? editor_version(event) ?? (url.searchParams.has("_storyblok") ? "draft" : "published")
	if (shown !== "published") return no("a draft")
	// moved off the cache by the middleware, for a reason this hook needn't know
	if (new URL(request.url).searchParams.has(UNCACHED)) return no("moved off the cache")

	if (event.isRemoteRequest) {
		const name = remote_name(request)
		const named = queries !== false && !!name && new Set(queries).has(name)
		const content = queries !== false && !!state?.content
		if (!named && !content) return no("a remote function that read no content, and isn't named")
		if (response.status !== 200) return no(`a ${response.status}`)
		if ((await json(response))?.type !== "result") return no("a remote function that failed")
		return { share: true, missing: false }
	}

	if (event.isDataRequest) {
		if (response.status !== 200) return no(`a ${response.status}`)
		const body = await json(response)
		if (body?.type !== "data" || !Array.isArray(body.nodes)) return no("not page data")
		let missing = false
		type Node = { type?: string; status?: number; error?: { status?: number } } | null
		for (const node of body.nodes as Array<Node>) {
			if (node?.type !== "error") continue
			// SvelteKit 2 puts the status on the node, 3 on the error itself
			if (!not_found || (node.status ?? node.error?.status) !== 404) return no("a load that failed")
			missing = true
		}
		return { share: true, missing }
	}

	if (!(response.headers.get("content-type") ?? "").startsWith("text/html")) return no("not a page")
	if (response.status === 200) return { share: true, missing: false }
	if (response.status === 404 && not_found) return { share: true, missing: true }
	return no(`a ${response.status}`)
}

/** Whether a response may be shared: `verdict`, without the reason */
export async function shareable(...input: Parameters<typeof verdict>) {
	return (await verdict(...input)).share
}

function create({
	policy = SHARED,
	when,
	queries,
	not_found,
	tag = TAG,
	purge: purging,
}: CacheOptions = {}): Handle {
	const named = queries === false ? false : new Set(queries)
	// the site's way of purging, which a publish through the editor and the webhook both go by
	site_purge = purging === false ? false : { ...(tag && { tags: [tag] }), ...purging }
	const webhook = purging === false ? null : purge()

	return async ({ event, resolve }) => {
		// reached here on a site without the `editor` hook, which answers it otherwise
		if (webhook && event.url.pathname === PURGE_PATH && event.request.method === "POST")
			return webhook(event)

		if (!dev) watch(event)
		const response = await resolve(event)
		const shown = event as Shown
		const set = (name: string, value: string) => {
			try {
				response.headers.set(name, value)
			} catch {
				// a response passed through from elsewhere has headers of its own
			}
		}

		if (dev) return (set(EXPLAIN, "private; development"), response)
		// a page that set a policy of its own keeps it; data and remote functions only ever carry
		// SvelteKit's `private, no-store`
		if (!shown.isDataRequest && !shown.isRemoteRequest && response.headers.has("cache-control"))
			return (set(EXPLAIN, "own policy"), response)

		let decided = await verdict(shown, response, { queries: named, not_found })
		if (decided.share && when && !(await when(event))) decided = no("the site said no")
		if (!decided.share) return (set(EXPLAIN, `private; ${decided.why}`), response)

		set("cache-control", decided.missing ? MISSING : policy)
		if (tag) set("vercel-cache-tag", tag)
		set(EXPLAIN, decided.missing ? "shared; not found" : "shared")
		return response
	}
}

const plain = create()

/**
 * Lets a CDN keep what's the same for every visitor, so the site's function runs when content
 * changes rather than on every request: published pages, the `__data.json` a client-side
 * navigation or a hovered link asks for, and remote functions that read content.
 *
 * It works out what's safe by itself. Never an editor's or a guest's response, a draft, one
 * behind a password, one that sets a cookie, or one a load or query failed inside. Nor one whose
 * rendering read anything only this visitor sent, a cookie or their country say: the CDN can't
 * tell visitors apart, so a page that looked is theirs. `choice` is how to read a cookie and
 * stay cached. Every response says what was decided in an `x-storyloco-cache` header.
 *
 * After `editor` and `version` in the sequence, and around the site's own hooks. It needs
 * `storyloco/middleware` in front of the CDN, which answers before any hook runs: that's what
 * keeps editors and previews off the copies this shares. Publishing through storyloco purges
 * them; so does a Storyblok webhook pointed at `/__storyloco/purge`.
 *
 * @example
 * ```ts
 * // hooks.server.ts
 * export const handle = sequence(editor, version, cache, …)
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

export type ChoiceOptions<V extends string> = Choice & {
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
 * the middleware moved it onto, else the cookie. Give `chosen` in the middleware the same object.
 *
 * The CDN keys a page by its address and ignores cookies. So the cookie is only ever set when a
 * visitor chooses, never to give a new one the default, since a response that sets a cookie
 * isn't cached; and a request whose cookie says something its address doesn't, one that came
 * round the middleware, is kept out of the cache.
 *
 * @example
 * ```ts
 * // $lib/location.ts
 * export const LOCATION = { cookie: "location", values: ["all", "woking"], shared: "all" } as const
 *
 * // a hook, inside `cache`
 * event.locals.location = choice(event, { ...LOCATION, asked: event.url.searchParams.get("location") })
 * ```
 */
export function choice<const V extends string>(
	event: Pick<RequestEvent, "url" | "cookies" | "locals">,
	{ cookie, param = `_${cookie}`, values, shared, asked, max_age }: ChoiceOptions<V>
): V {
	const known = (value?: string | null) => values.find((known) => known === value)
	// its own reads don't make the page the visitor's: what the cookie says is settled below
	const read = unwatched.get(event.cookies) ?? event.cookies.get.bind(event.cookies)

	const wanted = known(asked)
	const keyed = known(take(event.url, param)) ?? shared
	const kept = known(read(cookie)) ?? shared

	if (wanted && wanted !== kept)
		event.cookies.set(cookie, wanted, { path: "/", ...(max_age && { maxAge: max_age }) })
	else if (kept !== keyed)
		uncached(event, `cookie ${cookie} without its key: is the middleware running?`)

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
	 * Marks everything carrying these tags stale at the CDN. Vercel's own by default, with
	 * nothing to install; for another CDN, a function that does the same
	 */
	invalidate?: (tags: Array<string>) => unknown
	/**
	 * The webhook's secret, as set in Storyblok, which signs each request.
	 * `STORYBLOK_WEBHOOK_SECRET` by default. Without one anyone can ask for a purge, which costs
	 * a re-render of each page, no more than asking for pages with made-up queries does
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
	 * Runs the wait and the purge after the response, so Storyblok is answered at once. Vercel's
	 * `waitUntil` by default; elsewhere the request is held until the purge is done
	 */
	defer?: (work: Promise<unknown>) => void
}

/** What Vercel gives a function for the request it's handling, which `@vercel/functions` wraps */
type Vercel = {
	purge?: { invalidateByTag: (tags: string | Array<string>) => Promise<unknown> }
	waitUntil?: (work: Promise<unknown>) => void
}
const vercel = () =>
	(globalThis as unknown as Record<symbol, { get?: () => Vercel | undefined } | undefined>)[
		Symbol.for("@vercel/request-context")
	]?.get?.()

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** The purge that's waiting, which a later one joins, pushing it back, rather than repeating */
let waiting: { due: number; tags: Set<string>; done: Promise<void> } | undefined

/**
 * Purge what the `cache` hook shared, once warm servers have had time to see the change. Called
 * for a publish made through storyloco, and by the webhook; a site calls it after changing
 * anything else visitors see. Resolves to whether there was a way to purge here.
 */
export function purged(
	how: Pick<PurgeOptions, "invalidate" | "tags" | "settle" | "defer"> = {}
): Promise<boolean> {
	if (site_purge === false) return Promise.resolve(false)
	const { invalidate, tags = [TAG], settle = RECHECK + 1000, defer } = { ...site_purge, ...how }
	// taken now: Vercel's are the current request's, gone once it's answered
	const context = vercel()
	const run = invalidate ?? context?.purge?.invalidateByTag.bind(context.purge)
	if (!run) return Promise.resolve(false)

	const due = Date.now() + settle
	let entry = waiting
	if (entry) {
		entry.due = Math.max(entry.due, due)
		for (const tag of tags) entry.tags.add(tag)
	} else {
		const mine = (entry = waiting = { due, tags: new Set(tags), done: Promise.resolve() })
		mine.done = (async () => {
			try {
				// at least a turn, so `mine` is in place before anything joins or follows it
				do await sleep(Math.max(0, mine.due - Date.now()))
				while (Date.now() < mine.due)
			} finally {
				// whatever comes next starts a wait of its own
				if (waiting === mine) waiting = undefined
			}
			await run([...mine.tags])
		})()
	}
	const work = entry.done.then(() => true)
	const later = defer ?? context?.waitUntil?.bind(context)
	later?.(work.catch((e) => console.error("storyloco: purge failed", e)))
	return work
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
 * The endpoint a Storyblok webhook posts to, purging what the `cache` hook shared, so a publish
 * shows in seconds however long the CDN is told to keep pages. The `editor` and `cache` hooks
 * answer it at `/__storyloco/purge` already; this is for a route of the site's own.
 *
 * Storyblok doesn't retry a webhook, so a purge that fails answers 500 for its log to show.
 *
 * @example
 * ```ts
 * // src/routes/webhooks/purge/+server.ts
 * export const POST = purge()
 * ```
 */
export function purge(given: PurgeOptions = {}) {
	const reply = (body: Record<string, unknown>, status = 200) =>
		// Storyblok asks for JSON back
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json", "cache-control": "no-store" },
		})

	return async ({ request }: Pick<RequestEvent, "request">) => {
		if (site_purge === false) return reply({ purged: false, message: "Purging is off" }, 404)
		const { secret, actions = CHANGES, ...how } = { ...site_purge, ...given }
		const body = await request.text()
		const key = secret ?? (await setting("STORYBLOK_WEBHOOK_SECRET").catch(() => undefined))
		if (key && !(await signed_by_storyblok(body, request.headers.get("webhook-signature"), key)))
			return reply({ message: "Signature doesn’t match" }, 401)

		let action: unknown
		try {
			action = (JSON.parse(body) as { action?: unknown }).action
		} catch {
			return reply({ message: "Not a Storyblok webhook" }, 400)
		}
		if (typeof action !== "string" || !actions.includes(action))
			return reply({ purged: false, action: action ?? null })

		const deferred = how.defer ?? vercel()?.waitUntil
		const work = purged(how)
		if (deferred) {
			// already handed to `defer`; a host with no way to purge is said so now
			const able = !!(how.invalidate ?? vercel()?.purge)
			return able
				? reply({ purged: "soon", action }, 202)
				: reply({ purged: false, action, message: "No way to purge here" }, 501)
		}
		try {
			if (!(await work))
				return reply({ purged: false, action, message: "No way to purge here" }, 501)
		} catch (e) {
			console.error("storyloco: purge failed", e)
			return reply({ purged: false, action, message: "The purge failed" }, 500)
		}
		return reply({ purged: true, action })
	}
}
