import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { isHttpError } from "@sveltejs/kit"
import { handle_error, href, link_attrs, richtext, StoryblokClient } from "./storyblok.svelte.js"

/** The HttpError `handle_error` throws, so its status and body can be checked */
function thrown(fn: () => void) {
	try {
		fn()
	} catch (err) {
		// Widened: the tests check bodies richer than storyloco's own `App.Error`
		if (isHttpError(err)) return { status: err.status, body: err.body as unknown }
		throw err
	}
	throw new Error("did not throw")
}

describe("handle_error", () => {
	const log = console.error
	beforeAll(() => (console.error = () => {}))
	afterAll(() => (console.error = log))

	test("a missing story is a 404, anything else a 500", () => {
		expect(thrown(() => handle_error({ status: 404 }))).toMatchObject({
			status: 404,
			body: { message: "Story not found" },
		})
		expect(thrown(() => handle_error(new Error("socket hang up")))).toMatchObject({
			status: 500,
			body: { message: "Internal server error" },
		})
	})

	test("the body comes from the project's shape, with the Storyblok error as cause", () => {
		const cause = { status: 429 }
		const body = (status: 404 | 500, err?: unknown) =>
			({
				message: "Nope",
				code: status === 404 ? "NOT_FOUND" : "STORYBLOK",
				cause: err,
			}) as unknown as App.Error

		expect(thrown(() => handle_error(cause, body))).toMatchObject({
			status: 500,
			body: { message: "Nope", code: "STORYBLOK", cause },
		})
	})

	test("the client passes its own shape, detached as a `.catch` callback", () => {
		const client = new StoryblokClient({
			token: "",
			error: (status) => ({ message: "Gone", code: status }) as unknown as App.Error,
		})
		const { handle_error } = client

		expect(thrown(() => handle_error({ status: 404 }))).toMatchObject({
			status: 404,
			body: { message: "Gone", code: 404 },
		})
		expect(client.error(404) as unknown).toEqual({ message: "Gone", code: 404 })
	})
})

describe("href", () => {
	test("a story link is root-relative, with its anchor", () => {
		expect(href({ linktype: "story", cached_url: "privacy-policy" })).toBe("/privacy-policy")
		expect(
			href({ linktype: "story", cached_url: "privacy-policy", anchor: "7-about-cookies" })
		).toBe("/privacy-policy#7-about-cookies")
		expect(href({ linktype: "story", cached_url: "a", anchor: "#b" })).toBe("/a#b")
	})

	test("a resolved story's url wins over a stale cached_url", () => {
		expect(href({ linktype: "story", cached_url: "old", story: { url: "new" } })).toBe("/new")
	})

	test("a folder's start page links without the slash its slug ends in", () => {
		expect(href({ linktype: "story", cached_url: "about/" })).toBe("/about")
		expect(href({ linktype: "story", cached_url: "old", story: { url: "about/" } })).toBe("/about")
		expect(href({ linktype: "story", cached_url: "about/", anchor: "team" })).toBe("/about#team")
		expect(href({ linktype: "story", cached_url: "about/", suffix: "?tab=team" })).toBe(
			"/about?tab=team"
		)
		expect(link_attrs({ linktype: "story", cached_url: "about/" })).toEqual({ href: "/about" })
	})

	test("only a story's path is touched", () => {
		expect(href({ linktype: "url", url: "https://example.com/docs/" })).toBe(
			"https://example.com/docs/"
		)
		expect(href({ linktype: "url", url: "/about/" })).toBe("/about/")
	})

	test("a link plugin's story link keeps its suffix", () => {
		expect(
			href({ linktype: "story", cached_url: "old", story: { url: "new" }, suffix: "?tab=specs" })
		).toBe("/new?tab=specs")
		expect(href({ linktype: "story", suffix: "?tab=specs" })).toBeUndefined()
	})

	test("a story resolved to the root links to it", () => {
		expect(href({ linktype: "story", cached_url: "home", story: { url: "/" } })).toBe("/")
		expect(href({ linktype: "story", cached_url: "home", story: { url: "/" }, anchor: "a" })).toBe(
			"/#a"
		)
	})

	test("a field that links nowhere has no href", () => {
		expect(href(undefined)).toBeUndefined()
		expect(href({ linktype: "story", cached_url: "" })).toBeUndefined()
		expect(href({ linktype: "url", url: "" })).toBeUndefined()
		expect(href({ linktype: "email", email: "" })).toBeUndefined()
	})

	// the native generator types a multilink's unset parts as null
	test("null parts count as unset", () => {
		expect(href({ linktype: "story", cached_url: "a", anchor: null })).toBe("/a")
		expect(href({ linktype: "url", url: null, cached_url: null })).toBeUndefined()
		expect(href({ linktype: "email", email: null, url: null })).toBeUndefined()
	})

	test("an anchor alone stays on the page", () => {
		expect(href({ linktype: "story", cached_url: "", anchor: "top" })).toBe("#top")
	})

	test("an email link is a mailto", () => {
		expect(href({ linktype: "email", email: "hi@example.com" })).toBe("mailto:hi@example.com")
		expect(href({ linktype: "email", url: "mailto:hi@example.com" })).toBe("mailto:hi@example.com")
	})

	test("URL and asset links pass through", () => {
		expect(href({ linktype: "url", url: "https://example.com" })).toBe("https://example.com")
		expect(href({ linktype: "asset", url: "https://a.storyblok.com/f/1/doc.pdf" })).toBe(
			"https://a.storyblok.com/f/1/doc.pdf"
		)
	})
})

describe("link_attrs", () => {
	test("a link's href, with the editor's target and rel", () => {
		expect(
			link_attrs({
				linktype: "url",
				url: "https://example.com",
				target: "_blank",
				rel: "nofollow noopener",
			})
		).toEqual({ href: "https://example.com", target: "_blank", rel: "nofollow noopener" })
		expect(link_attrs({ linktype: "story", cached_url: "about" })).toEqual({ href: "/about" })
	})

	test("a link that opens a new window is noopener", () => {
		expect(link_attrs({ url: "https://example.com", target: "_new" }).rel).toBe("noopener")
		expect(link_attrs({ url: "https://example.com", target: "_blank", rel: "nofollow" }).rel).toBe(
			"noopener nofollow"
		)
		expect(
			link_attrs({ url: "https://example.com", target: "_blank", rel: "noreferrer" }).rel
		).toBe("noreferrer")
		expect(link_attrs({ url: "https://example.com", target: "_self" }).rel).toBeUndefined()
	})

	test("a field that links nowhere has no attributes", () => {
		expect(link_attrs(undefined)).toEqual({})
		expect(link_attrs({ linktype: "url", url: "", target: null, rel: null })).toEqual({})
	})
})

describe("cache version", () => {
	test("kept between reads, and asked for again once it's five seconds old", async () => {
		const asked: Array<string | null> = []
		const client = new StoryblokClient({
			token: "recheck",
			api: {
				fetch: (async (url: string) => {
					asked.push(new URL(url).searchParams.get("cv"))
					return Response.json({ story: {}, cv: 111 })
				}) as unknown as typeof fetch,
			},
		})
		const clock = Date.now
		try {
			await client.get("cdn/stories/a", { version: "published" })
			await client.get("cdn/stories/b", { version: "published" })
			const later = clock() + 6_000
			Date.now = () => later
			await client.get("cdn/stories/c", { version: "published" })
		} finally {
			Date.now = clock
		}
		expect(asked[1]).toBe("111")
		expect(asked[2]).not.toBe("111")
	})
})

describe("richtext", () => {
	const link = (attrs: object) =>
		richtext({
			type: "doc",
			content: [
				{
					type: "paragraph",
					content: [{ type: "text", text: "UK", marks: [{ type: "link", attrs }] }],
				},
			],
		} as never)

	test("a story link to a folder's start page loses its slash, and the resolved story", () => {
		expect(
			link({
				href: "/terms/uk/",
				linktype: "story",
				anchor: "fees",
				target: "_self",
				story: { url: "terms/uk/" },
			})
		).toBe('<p><a target="_self" href="/terms/uk#fees">UK</a></p>')
	})

	test("any other link is left as it was written", () => {
		expect(link({ href: "https://example.com/docs/", linktype: "url" })).toBe(
			'<p><a href="https://example.com/docs/">UK</a></p>'
		)
	})
})
