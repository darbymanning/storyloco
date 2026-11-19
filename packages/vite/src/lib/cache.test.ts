import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import {
	SHARED,
	TAG,
	cache,
	choice,
	purge,
	remote_name,
	shareable,
	signed_by_storyblok,
	take,
	uncached,
} from "./cache.js"

const SITE = "https://example.com"

type Extra = {
	locals?: Record<string, unknown>
	init?: RequestInit
	isDataRequest?: boolean
	isRemoteRequest?: boolean
	/** The page a remote function was asked from, which SvelteKit makes `event.url` */
	page?: string
}

const shown = (path = "/about", { locals = {}, init, page, ...rest }: Extra = {}) =>
	({
		request: new Request(SITE + path, init),
		url: new URL(SITE + (page ?? path)),
		locals,
		isDataRequest: false,
		isRemoteRequest: false,
		...rest,
	}) as unknown as Parameters<typeof shareable>[0]

const html = (init: ResponseInit = {}) =>
	new Response("<html></html>", {
		...init,
		headers: { "content-type": "text/html", ...init.headers },
	})

describe("shareable: a page", () => {
	test("a published page is", async () => {
		expect(await shareable(shown(), html())).toBe(true)
		expect(await shareable(shown("/about", { init: { method: "HEAD" } }), html())).toBe(true)
	})

	test("an editor's, a guest's or a draft isn't", async () => {
		expect(await shareable(shown("/about", { locals: { editor: {} } }), html())).toBe(false)
		expect(await shareable(shown("/about", { locals: { guest: {} } }), html())).toBe(false)
		expect(await shareable(shown("/about", { locals: { version: "draft" } }), html())).toBe(false)
		// a site that picks its own version, as the hook would
		expect(await shareable(shown("/about?_storyblok=1"), html())).toBe(false)
		// the `version` hook's word wins over the address
		expect(
			await shareable(shown("/about?_storyblok=off", { locals: { version: "published" } }), html())
		).toBe(true)
		expect(await shareable(shown("/about?_storyloco=1"), html())).toBe(false)
	})

	test("one visitor's isn't: a cookie set, a password given, or marked", async () => {
		expect(await shareable(shown(), html({ headers: { "set-cookie": "a=b" } }))).toBe(false)
		expect(
			await shareable(shown("/about", { init: { headers: { authorization: "Basic x" } } }), html())
		).toBe(false)
		const event = shown()
		uncached(event)
		expect(await shareable(event, html())).toBe(false)
		expect(await shareable(shown(), html())).toBe(true)
	})

	test("nor is a post, a failure, or an endpoint", async () => {
		expect(await shareable(shown("/about", { init: { method: "POST" } }), html())).toBe(false)
		expect(await shareable(shown(), html({ status: 500 }))).toBe(false)
		expect(await shareable(shown(), html({ status: 404 }))).toBe(false)
		expect(await shareable(shown("/robots.txt"), new Response("User-agent: *"))).toBe(false)
	})

	test("a 404 is, for a site that says its 404s are only ever that", async () => {
		expect(await shareable(shown(), html({ status: 404 }), { not_found: true })).toBe(true)
		expect(await shareable(shown(), html({ status: 500 }), { not_found: true })).toBe(false)
	})
})

describe("shareable: navigation data", () => {
	const data = (body: unknown, options = {}, init?: ResponseInit) =>
		shareable(
			shown("/about/__data.json", { isDataRequest: true }),
			Response.json(body, init),
			options
		)

	test("is, with every load answered or skipped", async () => {
		expect(
			await data({ type: "data", nodes: [{ type: "skip" }, { type: "data", data: [] }] })
		).toBe(true)
		expect(await data({ type: "data", nodes: [null, { type: "data", data: [] }] })).toBe(true)
	})

	test("isn't with a load that failed inside its 200, or a redirect", async () => {
		expect(
			await data({ type: "data", nodes: [{ type: "skip" }, { type: "error", error: {} }] })
		).toBe(false)
		expect(await data({ type: "data", nodes: [{ type: "error", error: {}, status: 500 }] })).toBe(
			false
		)
		expect(await data({ type: "redirect", location: "/" })).toBe(false)
		expect(await data({ type: "data" })).toBe(false)
		expect(await data({ type: "data", nodes: [] }, {}, { status: 500 })).toBe(false)
	})

	test("a 404 inside it is only with `not_found`, and only when it says it's a 404", async () => {
		const missing = {
			type: "data",
			nodes: [{ type: "skip" }, { type: "error", error: {}, status: 404 }],
		}
		expect(await data(missing)).toBe(false)
		expect(await data(missing, { not_found: true })).toBe(true)
		const unsaid = { type: "data", nodes: [{ type: "error", error: { message: "Not found" } }] }
		expect(await data(unsaid, { not_found: true })).toBe(false)
	})

	test("streamed data isn't read, so isn't shared", async () => {
		const streamed = new Response('{"type":"data","nodes":[]}', {
			headers: { "content-type": "text/sveltekit-data" },
		})
		expect(await shareable(shown("/about/__data.json", { isDataRequest: true }), streamed)).toBe(
			false
		)
	})
})

describe("shareable: a remote function", () => {
	const QUERY = "/_app/remote/1x2y3z/get_products?payload=abc"
	const asked = (extra: Extra = {}) =>
		shown(QUERY, { isRemoteRequest: true, page: "/shop", ...extra })
	const result = () => Response.json({ type: "result", data: "[]" })
	const queries = ["get_products"]

	test("its name", () => {
		expect(remote_name(new Request(SITE + QUERY))).toBe("get_products")
		expect(remote_name(new Request(`${SITE}/base/_app/remote/1x2y3z/get_products`))).toBe(
			"get_products"
		)
		expect(remote_name(new Request(`${SITE}/about`))).toBeUndefined()
	})

	test("is when it's named and it answered", async () => {
		expect(await shareable(asked(), result(), { queries })).toBe(true)
		expect(await shareable(asked(), result(), { queries: new Set(queries) })).toBe(true)
	})

	test("isn't unless it's named: a new query is private until someone says otherwise", async () => {
		expect(await shareable(asked(), result())).toBe(false)
		expect(await shareable(asked(), result(), { queries: ["get_country"] })).toBe(false)
	})

	test("isn't when it threw, which is still a 200", async () => {
		const threw = Response.json({ type: "error", error: { message: "Internal server error" } })
		expect(await shareable(asked(), threw, { queries })).toBe(false)
		expect(await shareable(asked(), new Response("<html>"), { queries })).toBe(false)
	})

	test("isn't a draft's, asked from a preview's page or moved off the cache", async () => {
		expect(await shareable(asked({ page: "/shop?_storyblok=1" }), result(), { queries })).toBe(
			false
		)
		expect(await shareable(asked({ locals: { version: "draft" } }), result(), { queries })).toBe(
			false
		)
		expect(
			await shareable(
				shown(`${QUERY}&_storyloco=1`, { isRemoteRequest: true, page: "/shop" }),
				result(),
				{
					queries,
				}
			)
		).toBe(false)
	})

	test("isn't once the query has said its answer hid a failure", async () => {
		const event = asked()
		uncached(event)
		expect(await shareable(event, result(), { queries })).toBe(false)
	})
})

describe("cache", () => {
	type Input = Parameters<ReturnType<typeof cache>>[0]
	const run = async (handle: ReturnType<typeof cache>, event = shown(), response = html()) =>
		(await handle({ event, resolve: () => response } as unknown as Input)).headers

	test("shares a published page, tagged for a purge", async () => {
		const headers = await run(cache())
		expect(headers.get("cache-control")).toBe(SHARED)
		expect(headers.get("vercel-cache-tag")).toBe(TAG)
	})

	test("as a hook itself, without being set up", async () => {
		const event = shown()
		const response = await cache({ event, resolve: () => html() } as unknown as Input)
		expect(response.headers.get("cache-control")).toBe(SHARED)
	})

	test("leaves anything else as it came", async () => {
		const headers = await run(cache(), shown("/about", { locals: { editor: {} } }))
		expect(headers.get("cache-control")).toBeNull()
		expect(headers.get("vercel-cache-tag")).toBeNull()
		const data = await run(
			cache(),
			shown("/about/__data.json", { isDataRequest: true }),
			Response.json(
				{ type: "data", nodes: [{ type: "error", error: {} }] },
				{ headers: { "cache-control": "private, no-store" } }
			)
		)
		expect(data.get("cache-control")).toBe("private, no-store")
	})

	test("replaces SvelteKit's no-store on data and remote functions, but not a page's own policy", async () => {
		const data = await run(
			cache(),
			shown("/about/__data.json", { isDataRequest: true }),
			Response.json(
				{ type: "data", nodes: [] },
				{ headers: { "cache-control": "private, no-store" } }
			)
		)
		expect(data.get("cache-control")).toBe(SHARED)

		const own = await run(cache(), shown(), html({ headers: { "cache-control": "max-age=60" } }))
		expect(own.get("cache-control")).toBe("max-age=60")
		expect(own.get("vercel-cache-tag")).toBeNull()
	})

	test("the site's own policy, tag, and say", async () => {
		const headers = await run(cache({ policy: "s-maxage=60", tag: "site" }))
		expect(headers.get("cache-control")).toBe("s-maxage=60")
		expect(headers.get("vercel-cache-tag")).toBe("site")
		expect((await run(cache({ tag: false }))).get("vercel-cache-tag")).toBeNull()
		expect((await run(cache({ when: () => false }))).get("cache-control")).toBeNull()
		expect((await run(cache({ when: async () => true }))).get("cache-control")).toBe(SHARED)
	})

	test("a response whose headers can't be changed passes through", async () => {
		const fixed = Response.redirect(`${SITE}/x`, 302)
		const event = shown()
		const response = await cache()({ event, resolve: () => fixed } as unknown as Input)
		expect(response).toBe(fixed)
	})
})

function jar(initial: Record<string, string> = {}) {
	const store = { ...initial }
	const set: Array<[string, string, Record<string, unknown>]> = []
	return {
		store,
		set_calls: set,
		get: (name: string) => store[name],
		set: (name: string, value: string, options: Record<string, unknown>) => {
			store[name] = value
			set.push([name, value, options])
		},
	}
}

describe("choice", () => {
	const LOCATIONS = ["all", "woking", "guildford"] as const
	const at = (path: string, cookies: Record<string, string> = {}, asked?: string | null) => {
		const event = { url: new URL(SITE + path), cookies: jar(cookies), locals: {} }
		const value = choice(event as never, {
			cookie: "location",
			param: "_location",
			values: LOCATIONS,
			shared: "all",
			asked,
		})
		const page = shown("/about", { locals: event.locals })
		return { value, set: event.cookies.set_calls, url: event.url.search, page }
	}
	const shared = async ({ page }: ReturnType<typeof at>) => shareable(page, html())

	test("a visitor who hasn't chosen shares the default, and is given no cookie", async () => {
		const got = at("/about")
		expect(got).toMatchObject({ value: "all", set: [] })
		expect(await shared(got)).toBe(true)
		expect(at("/about", { location: "all" }, "all").set).toEqual([])
	})

	test("choosing sets the cookie, once", () => {
		expect(at("/about", {}, "woking")).toMatchObject({
			value: "woking",
			set: [["location", "woking", { path: "/" }]],
		})
		expect(at("/about?_location=woking", { location: "woking" }, "woking").set).toEqual([])
		expect(at("/about?_location=woking", { location: "woking" }, "all")).toMatchObject({
			value: "all",
			set: [["location", "all", { path: "/" }]],
		})
	})

	test("a chosen value is shared on the copy the middleware moved it onto, the key taken off", async () => {
		const got = at("/about?a=1&_location=woking", { location: "woking" })
		expect(got).toMatchObject({ value: "woking", set: [], url: "?a=1" })
		expect(await shared(got)).toBe(true)
	})

	test("one that came round the middleware still gets its choice, on a response of its own", async () => {
		const got = at("/about", { location: "woking" })
		expect(got.value).toBe("woking")
		expect(await shared(got)).toBe(false)
	})

	test("a key with no cookie behind it shows that copy, which is all it could be", async () => {
		const got = at("/about?_location=woking")
		expect(got.value).toBe("woking")
		expect(await shared(got)).toBe(false)
	})

	test("values it doesn't know are ignored", () => {
		expect(at("/about?_location=mars", { location: "venus" }, "pluto")).toMatchObject({
			value: "all",
			set: [],
		})
	})

	test("take reads a parameter and removes it", () => {
		const url = new URL(`${SITE}/about?a=1&_k=x`)
		expect(take(url, "_k")).toBe("x")
		expect(url.search).toBe("?a=1")
		expect(take(url, "_k")).toBeNull()
	})
})

describe("purge", () => {
	const SECRET = "shh"
	const sign = (body: string) => createHmac("sha1", SECRET).update(body).digest("hex")
	const post = (body: string, signature?: string) =>
		({
			request: new Request(`${SITE}/webhooks/purge`, {
				method: "POST",
				body,
				headers: signature ? { "webhook-signature": signature } : {},
			}),
		}) as never
	const published = JSON.stringify({ action: "published", story_id: 1, full_slug: "about" })

	test("a signature is Storyblok's or it isn't", async () => {
		expect(await signed_by_storyblok(published, sign(published), SECRET)).toBe(true)
		expect(await signed_by_storyblok(published, sign(published).toUpperCase(), SECRET)).toBe(true)
		expect(await signed_by_storyblok(`${published} `, sign(published), SECRET)).toBe(false)
		expect(await signed_by_storyblok(published, sign(published), "other")).toBe(false)
		expect(await signed_by_storyblok(published, null, SECRET)).toBe(false)
		expect(await signed_by_storyblok(published, "abc", SECRET)).toBe(false)
	})

	test("a publish invalidates the hook's tag, and says so in JSON", async () => {
		const calls: Array<Array<string>> = []
		const handle = purge({ invalidate: (tags) => void calls.push(tags), secret: SECRET, settle: 0 })
		const response = await handle(post(published, sign(published)))
		expect(response.status).toBe(200)
		expect(response.headers.get("content-type")).toBe("application/json")
		expect(await response.json()).toEqual({ purged: true, action: "published", tags: [TAG] })
		expect(calls).toEqual([[TAG]])
	})

	test("a wrong or missing signature purges nothing", async () => {
		const calls: Array<unknown> = []
		const handle = purge({ invalidate: (tags) => void calls.push(tags), secret: SECRET, settle: 0 })
		expect((await handle(post(published, "0".repeat(40)))).status).toBe(401)
		expect((await handle(post(published))).status).toBe(401)
		expect(calls).toEqual([])
	})

	test("what doesn't change the site doesn't purge, nor does anything that isn't a webhook", async () => {
		const calls: Array<unknown> = []
		const handle = purge({ invalidate: (tags) => void calls.push(tags), settle: 0 })
		const comment = JSON.stringify({ action: "comment_created" })
		expect(await (await handle(post(comment))).json()).toEqual({
			purged: false,
			action: "comment_created",
		})
		expect((await handle(post("not json"))).status).toBe(400)
		expect(await (await handle(post("{}"))).json()).toEqual({ purged: false, action: null })
		expect(calls).toEqual([])
		const redirects = JSON.stringify({ action: "entries_updated", datasource_slug: "redirects" })
		expect((await (await handle(post(redirects))).json()).purged).toBe(true)
	})

	test("waits for warm servers to see the publish before purging", async () => {
		let at = 0
		const started = Date.now()
		const handle = purge({ invalidate: () => void (at = Date.now() - started), settle: 40 })
		await handle(post(published))
		expect(at).toBeGreaterThanOrEqual(35)
	})

	test("deferred, it answers at once and purges after", async () => {
		const calls: Array<unknown> = []
		let work: Promise<unknown> | undefined
		const handle = purge({
			invalidate: (tags) => void calls.push(tags),
			settle: 20,
			defer: (promise) => void (work = promise),
			tags: ["a", "b"],
		})
		const response = await handle(post(published))
		expect(response.status).toBe(202)
		expect(calls).toEqual([])
		await work
		expect(calls).toEqual([["a", "b"]])
	})

	test("a purge that fails says so, since Storyblok won't try again", async () => {
		const error = console.error
		console.error = () => {}
		try {
			const handle = purge({
				invalidate: () => Promise.reject(new Error("429")),
				settle: 0,
			})
			const response = await handle(post(published))
			expect(response.status).toBe(500)
			expect((await response.json()).purged).toBe(false)
		} finally {
			console.error = error
		}
	})
})
