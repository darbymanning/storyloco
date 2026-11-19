import { describe, expect, test } from "bun:test"
import handle, { EDITORS, PREVIEW, chosen, editing, middleware, own_key } from "./middleware.js"

const request = (cookie?: string, url = "https://example.com/about") =>
	new Request(url, { headers: cookie ? { cookie } : {} })

describe("own_key", () => {
	test("an editor's or guest's request moves onto its own key; a visitor's doesn't", () => {
		expect(own_key(request("sl_editor=x"))?.search).toBe("?_storyloco=1")
		expect(own_key(request("a=1; sl_editor_123=x"))?.search).toBe("?_storyloco=1")
		expect(own_key(request("sl_guest_123=x"))?.search).toBe("?_storyloco=1")
		expect(own_key(request("theme=dark"))).toBeNull()
		expect(own_key(request())).toBeNull()
	})

	test("one already on its key passes through", () => {
		expect(own_key(request("sl_editor=x", "https://example.com/about?_storyloco=1"))).toBeNull()
	})

	test("only reads move: a form post keeps its action", () => {
		const post = (cookie: string) =>
			new Request("https://example.com/?/prospectus", { method: "POST", headers: { cookie } })
		expect(own_key(post("sl_editor=x"))).toBeNull()
		expect(own_key(post("storyblok_preview=1"), PREVIEW)).toBeNull()
		expect(handle(post("storyblok_preview=1")).headers.get("x-middleware-next")).toBe("1")
		const head = new Request("https://example.com/about", {
			method: "HEAD",
			headers: { cookie: "sl_editor=x" },
		})
		expect(own_key(head)?.search).toBe("?_storyloco=1")
	})

	test("a site's own cookies and parameter", () => {
		const options = { cookies: [/^session$/], param: "_signed_in" }
		expect(own_key(request("session=x"), options)?.search).toBe("?_signed_in=1")
		expect(own_key(request("sl_editor=x"), options)).toBeNull()
	})

	test("editing", () => {
		expect(editing(request("sl_editor_1=x"))).toBe(true)
		expect(editing(request("sl_editorial=x"))).toBe(false)
	})
})

describe("middleware", () => {
	const run = (handler: (r: Request) => Response, cookie?: string, url?: string) => {
		const response = handler(request(cookie, url))
		return response.headers.get("x-middleware-rewrite") ?? response.headers.get("x-middleware-next")
	}

	test("a Storyblok preview onto its own key before an editor's, and ?_storyblok=off through", () => {
		expect(run(handle, "storyblok_preview=1; sl_editor=x")).toBe(
			"https://example.com/about?_storyblok=1"
		)
		expect(run(handle, "storyblok_preview=1", "https://example.com/about?_storyblok=off")).toBe("1")
	})

	test("editors onto their own key, everyone else through", () => {
		expect(run(handle, "sl_editor_1=x")).toBe("https://example.com/about?_storyloco=1")
		expect(run(handle)).toBe("1")
		expect(run(handle, "sl_editor_1=x", "https://example.com/about?_storyloco=1")).toBe("1")
	})

	test("the first key a request has a cookie for wins, even when it's on that key already", () => {
		const preview = { cookies: [/^storyblok_preview$/], param: "_storyblok" }
		const both = middleware([preview, EDITORS])
		expect(run(both, "storyblok_preview=1; sl_editor=x")).toBe(
			"https://example.com/about?_storyblok=1"
		)
		expect(
			run(both, "storyblok_preview=1; sl_editor=x", "https://example.com/about?_storyblok=off")
		).toBe("1")
		expect(run(both, "sl_editor=x")).toBe("https://example.com/about?_storyloco=1")
	})
})

describe("a choice kept in a cookie", () => {
	const location = chosen({ cookie: "location", shared: "all" })
	const run = (cookie?: string, url?: string, keys = [PREVIEW, EDITORS, location]) => {
		const response = middleware(keys)(request(cookie, url))
		return response.headers.get("x-middleware-rewrite") ?? response.headers.get("x-middleware-next")
	}

	test("each value onto a copy of its own; the shared value and no cookie pass through", () => {
		expect(run("a=1; location=woking; b=2")).toBe("https://example.com/about?_location=woking")
		expect(run("location=all")).toBe("1")
		expect(run("relocation=woking")).toBe("1")
		expect(run()).toBe("1")
	})

	test("the cookie decides the copy, whatever the address says, and passes once it's there", () => {
		expect(run("location=woking", "https://example.com/about?_location=guildford")).toBe(
			"https://example.com/about?_location=woking"
		)
		expect(run("location=woking", "https://example.com/about?_location=woking")).toBe("1")
	})

	test("a value that isn't short and plain shares the visitor copy", () => {
		expect(run("location=a%20b")).toBe("1")
		expect(run(`location=${"x".repeat(65)}`)).toBe("1")
		expect(run("location=")).toBe("1")
	})

	test("an editor's key comes first, and one that shares falls through to a later key", () => {
		expect(run("location=woking; sl_editor=x")).toBe("https://example.com/about?_storyloco=1")
		const currency = chosen({ cookie: "currency" })
		expect(run("location=all; currency=eur", undefined, [location, currency])).toBe(
			"https://example.com/about?_currency=eur"
		)
	})

	test("a cookie name is matched as it's written", () => {
		expect(own_key(request("a.b=x"), chosen({ cookie: "a.b", param: "_k" }))?.search).toBe("?_k=x")
		expect(own_key(request("aXb=x"), chosen({ cookie: "a.b", param: "_k" }))).toBeNull()
	})
})

describe("a remote function asked from a preview's page", () => {
	const QUERY = "https://example.com/_app/remote/1x2y/get_shared?payload=abc"
	const run = (search?: string, cookie?: string, method = "GET") => {
		const headers: Record<string, string> = {}
		if (search !== undefined) headers["x-sveltekit-search"] = search
		if (cookie) headers.cookie = cookie
		const response = handle(new Request(QUERY, { method, headers }))
		return response.headers.get("x-middleware-rewrite") ?? response.headers.get("x-middleware-next")
	}

	test("moves off the cache with no cookie at all", () => {
		expect(run("?_storyblok=456&_storyblok_tk%5Bspace_id%5D=1")).toBe(`${QUERY}&_storyloco=1`)
		expect(run("?a=1&_storyblok")).toBe(`${QUERY}&_storyloco=1`)
	})

	test("a visitor's, a preview switched off, and a post pass through", () => {
		expect(run("?page=2")).toBe("1")
		expect(run("")).toBe("1")
		expect(run()).toBe("1")
		expect(run("?not_storyblok=1")).toBe("1")
		expect(run("?_storyblok=off")).toBe("1")
		expect(run("?_storyblok=456", undefined, "POST")).toBe("1")
	})

	test("SvelteKit 3 sends no header for a query, so the page it came from is read instead", () => {
		const from = (referer: string, url = QUERY) => {
			const response = handle(new Request(url, { headers: { referer } }))
			return (
				response.headers.get("x-middleware-rewrite") ?? response.headers.get("x-middleware-next")
			)
		}
		expect(from("https://example.com/about?_storyblok=456&_storyblok_tk%5Btoken%5D=abc")).toBe(
			`${QUERY}&_storyloco=1`
		)
		expect(from("https://example.com/about")).toBe("1")
		expect(from("https://example.com/about?_storyblok=off")).toBe("1")
		// another site's page says nothing about this one's previews
		expect(from("https://elsewhere.test/about?_storyblok=456")).toBe("1")
		// and a page isn't moved for where its visitor came from
		expect(from("https://example.com/a?_storyblok=456", "https://example.com/about")).toBe("1")
	})

	test("a cookie's key still comes first", () => {
		expect(run("?_storyblok=456", "storyblok_preview=1")).toBe(`${QUERY}&_storyblok=1`)
	})
})
