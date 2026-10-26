import { describe, expect, test } from "bun:test"
import { version } from "./hooks.js"

type Input = Parameters<typeof version>[0]

/** Stand-in for `event.cookies`, whose `get` sees a pending `set` or `delete` as SvelteKit's does */
function jar(initial: Record<string, string> = {}) {
	const store = { ...initial }
	return {
		store,
		get: (name: string) => store[name],
		set: (name: string, value: string) => void (store[name] = value),
		delete: (name: string) => void delete store[name],
	}
}

async function run(url: string, cookies: Record<string, string> = {}) {
	const jarred = jar(cookies)
	const event = { url: new URL(url), cookies: jarred, locals: {} as { version?: string } }
	await version({ event, resolve: () => new Response("ok") } as unknown as Input)
	return { version: event.locals.version, cookies: jarred.store }
}

const SITE = "https://example.com"

describe("version", () => {
	test("published by default", async () => {
		expect(await run(`${SITE}/about`)).toEqual({ version: "published", cookies: {} })
	})

	test("a preview on ?_storyblok, kept on a cookie", async () => {
		expect(await run(`${SITE}/about?_storyblok=1234`)).toEqual({
			version: "draft",
			cookies: { storyblok_preview: "1" },
		})
	})

	// client-side navigation and remote functions never carry the query, so it's the cookie that lasts
	test("still a preview on the cookie alone", async () => {
		expect((await run(`${SITE}/about`, { storyblok_preview: "1" })).version).toBe("draft")
	})

	test("?_storyblok=off ends it", async () => {
		expect(await run(`${SITE}/about?_storyblok=off`, { storyblok_preview: "1" })).toEqual({
			version: "published",
			cookies: {},
		})
	})

	test("an editor sees drafts, and the editor's view of the live page doesn't", async () => {
		const as_editor = async (url: string) => {
			const event = {
				url: new URL(url),
				cookies: jar(),
				locals: { editor: {} } as { version?: string },
			}
			await version({ event, resolve: () => new Response("ok") } as unknown as Input)
			return event.locals.version
		}
		expect(await as_editor(`${SITE}/about`)).toBe("draft")
		expect(await as_editor(`${SITE}/about?_storyloco_live=1`)).toBe("published")
	})
})
