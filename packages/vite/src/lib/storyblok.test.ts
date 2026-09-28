import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { isHttpError } from "@sveltejs/kit"
import { handle_error, StoryblokClient } from "./storyblok.svelte.js"

/** The HttpError `handle_error` throws, so its status and body can be checked */
function thrown(fn: () => void) {
	try {
		fn()
	} catch (err) {
		if (isHttpError(err)) return { status: err.status, body: err.body }
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
		expect(client.error(404)).toEqual({ message: "Gone", code: 404 })
	})
})
