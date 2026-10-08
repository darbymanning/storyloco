import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { isHttpError } from "@sveltejs/kit"
import { handle_error, href, StoryblokClient } from "./storyblok.svelte.js"

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
		expect(thrown(() => handle_error({ status: 404 }))).toEqual({
			status: 404,
			body: { message: "Story not found" },
		})
		expect(thrown(() => handle_error(new Error("socket hang up")))).toEqual({
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
			}) as App.Error

		expect(thrown(() => handle_error(cause, body))).toEqual({
			status: 500,
			body: { message: "Nope", code: "STORYBLOK", cause },
		})
	})

	test("the client passes its own shape, detached as a `.catch` callback", () => {
		const client = new StoryblokClient({
			token: "",
			error: (status) => ({ message: "Gone", code: status }) as App.Error,
		})
		const { handle_error } = client

		expect(thrown(() => handle_error({ status: 404 }))).toEqual({
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
		expect(href({ linktype: "story", cached_url: "old", story: { url: "new/" } })).toBe("/new/")
	})

	test("a field that links nowhere has no href", () => {
		expect(href(undefined)).toBeUndefined()
		expect(href({ linktype: "story", cached_url: "" })).toBeUndefined()
		expect(href({ linktype: "url", url: "" })).toBeUndefined()
		expect(href({ linktype: "email", email: "" })).toBeUndefined()
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
