import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import {
	EXPLAIN,
	MISSING,
	PURGE_PATH,
	SHARED,
	TAG,
	cache,
	choice,
	content_read,
	purge,
	purged,
	remote_name,
	shareable,
	signed_by_storyblok,
	take,
	uncached,
	verdict,
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
		expect(await shareable(shown("/robots.txt"), new Response("User-agent: *"))).toBe(false)
	})

	test("a 404 is, briefly, unless the site can't tell one from a failure", async () => {
		expect(await verdict(shown(), html({ status: 404 }))).toEqual({ share: true, missing: true })
		expect(await shareable(shown(), html({ status: 404 }), { not_found: false })).toBe(false)
	})

	test("says why not", async () => {
		expect(await verdict(shown("/about", { locals: { editor: {} } }), html())).toEqual({
			share: false,
			why: "an editor's",
		})
		expect(await verdict(shown(), html({ status: 500 }))).toEqual({ share: false, why: "a 500" })
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

	test("a 404 inside it is, but only when it says it's a 404", async () => {
		const missing = {
			type: "data",
			nodes: [{ type: "skip" }, { type: "error", error: {}, status: 404 }],
		}
		expect(await data(missing)).toBe(true)
		expect(await data(missing, { not_found: false })).toBe(false)
		// as SvelteKit 3 says it
		const three = { type: "data", nodes: [null, { type: "error", error: { status: 404 } }] }
		expect(
			await verdict(shown("/x/__data.json", { isDataRequest: true }), Response.json(three))
		).toEqual({
			share: true,
			missing: true,
		})
		expect(await data({ type: "data", nodes: [{ type: "error", error: { status: 500 } }] })).toBe(
			false
		)
		const unsaid = { type: "data", nodes: [{ type: "error", error: { message: "Not found" } }] }
		expect(await data(unsaid)).toBe(false)
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

	test("is, unasked, when it read content through storyloco and nothing of the visitor's", async () => {
		const event = asked()
		content_read(event)
		expect(await shareable(event, result())).toBe(true)
		expect(await shareable(event, result(), { queries: false })).toBe(false)
	})

	test("isn't when it read no content and isn't named: a country, a session", async () => {
		expect(await verdict(asked(), result())).toEqual({
			share: false,
			why: "a remote function that read no content, and isn't named",
		})
		expect(await shareable(asked(), result(), { queries: ["get_country"] })).toBe(false)
		expect(await shareable(asked(), result(), { queries: false })).toBe(false)
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

/** An event real enough for the hook to watch: cookies, headers and an address to be read */
function visit(path = "/about", extra: Extra & { cookies?: Record<string, string> } = {}) {
	const { cookies = {}, ...rest } = extra
	const event = shown(path, rest) as unknown as Record<string, unknown>
	event.cookies = {
		get: (name: string) => cookies[name],
		getAll: () => Object.entries(cookies).map(([name, value]) => ({ name, value })),
		set: () => {},
	}
	event.getClientAddress = () => "203.0.113.1"
	return event as unknown as Parameters<ReturnType<typeof cache>>[0]["event"]
}

describe("cache", () => {
	type Input = Parameters<ReturnType<typeof cache>>[0]
	type Event = Input["event"]
	const run = async (
		handle: ReturnType<typeof cache>,
		event: Event = visit(),
		respond: (event: Event) => Response = () => html()
	) => (await handle({ event, resolve: () => respond(event) } as unknown as Input)).headers

	test("shares a published page, tagged for a purge, and says so", async () => {
		const headers = await run(cache())
		expect(headers.get("cache-control")).toBe(SHARED)
		expect(headers.get("vercel-cache-tag")).toBe(TAG)
		expect(headers.get(EXPLAIN)).toBe("shared")
	})

	test("as a hook itself, without being set up", async () => {
		const event = visit()
		const response = await cache({ event, resolve: () => html() } as unknown as Input)
		expect(response.headers.get("cache-control")).toBe(SHARED)
	})

	test("a page that isn't there is shared for a minute", async () => {
		const headers = await run(cache(), visit(), () => html({ status: 404 }))
		expect(headers.get("cache-control")).toBe(MISSING)
		expect(headers.get(EXPLAIN)).toBe("shared; not found")
		const off = await run(cache({ not_found: false }), visit(), () => html({ status: 404 }))
		expect(off.get("cache-control")).toBeNull()
	})

	test("leaves anything else as it came, and says why", async () => {
		const headers = await run(cache(), visit("/about", { locals: { editor: {} } }))
		expect(headers.get("cache-control")).toBeNull()
		expect(headers.get("vercel-cache-tag")).toBeNull()
		expect(headers.get(EXPLAIN)).toBe("private; an editor's")
		const data = await run(cache(), visit("/about/__data.json", { isDataRequest: true }), () =>
			Response.json(
				{ type: "data", nodes: [{ type: "error", error: {} }] },
				{ headers: { "cache-control": "private, no-store" } }
			)
		)
		expect(data.get("cache-control")).toBe("private, no-store")
		expect(data.get(EXPLAIN)).toBe("private; a load that failed")
	})

	test("a page that read a cookie, the visitor's country or their address is theirs", async () => {
		const read = async (look: (event: Event) => unknown, extra: Parameters<typeof visit>[1] = {}) =>
			(await run(cache(), visit("/about", extra), (event) => (look(event), html()))).get(EXPLAIN)

		expect(await read((event) => event.cookies.get("session"))).toBe("private; read cookie session")
		// found or not: the next visitor might have one
		expect(await read((event) => event.cookies.get("theme"), { cookies: { theme: "dark" } })).toBe(
			"private; read cookie theme"
		)
		expect(await read((event) => event.cookies.getAll())).toBe("private; read cookies")
		expect(await read((event) => event.request.headers.get("X-Vercel-IP-Country"))).toBe(
			"private; read header x-vercel-ip-country"
		)
		expect(await read((event) => event.request.headers.get("user-agent"))).toBe(
			"private; read header user-agent"
		)
		expect(await read((event) => event.getClientAddress())).toBe(
			"private; read the visitor's address"
		)
		// what SvelteKit reads for itself says nothing of the visitor
		expect(await read((event) => event.request.headers.get("accept"))).toBe("shared")
	})

	test("what hooks before it read isn't counted, and the reads still work", async () => {
		const event = visit("/about", { cookies: { sl_editor: "x", theme: "dark" } })
		expect(event.cookies.get("sl_editor")).toBe("x")
		let theme: string | undefined
		const headers = await run(cache({ when: () => true }), event, (event) => {
			theme = event.cookies.get("theme")
			return html()
		})
		expect(theme).toBe("dark")
		expect(headers.get(EXPLAIN)).toBe("private; read cookie theme")
		expect(
			(await run(cache(), visit("/about", { cookies: { sl_editor: "x" } }))).get(EXPLAIN)
		).toBe("shared")
	})

	test("a cookie read through `choice` stays shared on its own copy", async () => {
		const LOCATION = { cookie: "location", values: ["all", "woking"], shared: "all" } as const
		const page = (path: string, cookies: Record<string, string>) => {
			let location: string | undefined
			return run(cache(), visit(path, { cookies }), (event) => {
				location = choice(event, LOCATION)
				return html({ headers: { "x-location": location } })
			})
		}
		const keyed = await page("/about?_location=woking", { location: "woking" })
		expect(keyed.get("x-location")).toBe("woking")
		expect(keyed.get(EXPLAIN)).toBe("shared")
		expect((await page("/about", {})).get(EXPLAIN)).toBe("shared")
		const round = await page("/about", { location: "woking" })
		expect(round.get("x-location")).toBe("woking")
		expect(round.get(EXPLAIN)).toBe(
			"private; cookie location without its key: is the middleware running?"
		)
	})

	test("replaces SvelteKit's no-store on data and remote functions, but not a page's own policy", async () => {
		const data = await run(cache(), visit("/about/__data.json", { isDataRequest: true }), () =>
			Response.json(
				{ type: "data", nodes: [] },
				{ headers: { "cache-control": "private, no-store" } }
			)
		)
		expect(data.get("cache-control")).toBe(SHARED)

		const own = await run(cache(), visit(), () =>
			html({ headers: { "cache-control": "max-age=60" } })
		)
		expect(own.get("cache-control")).toBe("max-age=60")
		expect(own.get("vercel-cache-tag")).toBeNull()
		expect(own.get(EXPLAIN)).toBe("own policy")
	})

	test("a remote function that read content is shared; one that read the visitor isn't", async () => {
		const QUERY = "/_app/remote/1x2y3z/get_products?payload=abc"
		const result = () =>
			Response.json(
				{ type: "result", data: "[]" },
				{ headers: { "cache-control": "private, no-store" } }
			)
		const asked = () => visit(QUERY, { isRemoteRequest: true, page: "/shop" })

		const content = await run(cache(), asked(), (event) => (content_read(event), result()))
		expect(content.get("cache-control")).toBe(SHARED)

		const country = await run(cache(), asked(), (event) => {
			content_read(event)
			event.request.headers.get("x-vercel-ip-country")
			return result()
		})
		expect(country.get("cache-control")).toBe("private, no-store")

		expect((await run(cache(), asked(), result)).get("cache-control")).toBe("private, no-store")
		expect(
			(await run(cache({ queries: ["get_products"] }), asked(), result)).get("cache-control")
		).toBe(SHARED)
	})

	test("the site's own policy, tag, and say", async () => {
		const headers = await run(cache({ policy: "s-maxage=60", tag: "site" }))
		expect(headers.get("cache-control")).toBe("s-maxage=60")
		expect(headers.get("vercel-cache-tag")).toBe("site")
		expect((await run(cache({ tag: false }))).get("vercel-cache-tag")).toBeNull()
		const refused = await run(cache({ when: () => false }))
		expect(refused.get("cache-control")).toBeNull()
		expect(refused.get(EXPLAIN)).toBe("private; the site said no")
		expect((await run(cache({ when: async () => true }))).get("cache-control")).toBe(SHARED)
	})

	test("a response whose headers can't be changed passes through", async () => {
		const fixed = Response.redirect(`${SITE}/x`, 302)
		const event = visit()
		const response = await cache()({ event, resolve: () => fixed } as unknown as Input)
		expect(response).toBe(fixed)
	})

	test("answers Storyblok's webhook itself, with the site's way of purging", async () => {
		const calls: Array<Array<string>> = []
		const handle = cache({
			tag: "site",
			purge: { invalidate: (tags) => void calls.push(tags), settle: 0 },
		})
		const event = visit(PURGE_PATH, {
			init: { method: "POST", body: JSON.stringify({ action: "published" }) },
		})
		const response = await handle({ event, resolve: () => html() } as unknown as Input)
		expect(await response.json()).toEqual({ purged: true, action: "published" })
		expect(calls).toEqual([["site"]])
		// and what the editor does after a publish goes the same way
		expect(await purged()).toBe(true)
		expect(calls).toEqual([["site"], ["site"]])

		const off = cache({ purge: false })
		const refused = await off({
			event: visit(PURGE_PATH, { init: { method: "POST", body: "{}" } }),
			resolve: () => html({ status: 404 }),
		} as unknown as Input)
		expect(refused.status).toBe(404)
		expect(await purged({ invalidate: () => {}, settle: 0 })).toBe(false)
		// back to a site that hasn't said, for the tests below
		cache({})
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

	test("the secret comes from the environment when it isn't given", async () => {
		process.env.STORYBLOK_WEBHOOK_SECRET = SECRET
		try {
			const calls: Array<unknown> = []
			const handle = purge({ invalidate: (tags) => void calls.push(tags), settle: 0 })
			expect((await handle(post(published))).status).toBe(401)
			expect((await handle(post(published, sign(published)))).status).toBe(200)
			expect(calls.length).toBe(1)
		} finally {
			delete process.env.STORYBLOK_WEBHOOK_SECRET
		}
	})

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
		expect(await response.json()).toEqual({ purged: true, action: "published" })
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

	test("with no way to purge, says so", async () => {
		const response = await purge({ settle: 0 })(post(published))
		expect(response.status).toBe(501)
		expect(await purged()).toBe(false)
	})

	test("on Vercel it purges and defers by itself, with nothing installed", async () => {
		const context = Symbol.for("@vercel/request-context")
		const calls: Array<unknown> = []
		let work: Promise<unknown> | undefined
		const api = {
			purge: { invalidateByTag: async (tags: unknown) => void calls.push(tags) },
			waitUntil: (promise: Promise<unknown>) => void (work = promise),
		}
		const global = globalThis as unknown as Record<symbol, unknown>
		global[context] = { get: () => api }
		try {
			const response = await purge({ settle: 10 })(post(published))
			expect(response.status).toBe(202)
			expect(calls).toEqual([])
			await work
			expect(calls).toEqual([[TAG]])
		} finally {
			delete global[context]
		}
	})

	test("purges that land together wait as one, from the last of them", async () => {
		const calls: Array<Array<string>> = []
		const invalidate = (tags: Array<string>) => void calls.push(tags)
		const started = Date.now()
		const first = purged({ invalidate, settle: 30, tags: ["a"] })
		await new Promise((done) => setTimeout(done, 15))
		const second = purged({ invalidate, settle: 30, tags: ["b"] })
		await Promise.all([first, second])
		expect(calls).toEqual([["a", "b"]])
		expect(Date.now() - started).toBeGreaterThanOrEqual(40)
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
