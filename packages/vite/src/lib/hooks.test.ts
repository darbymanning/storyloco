import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { version } from "./hooks.js"

const TOKEN = "preview-token"
process.env.PUBLIC_STORYBLOK_ACCESS_TOKEN = TOKEN

const now = () => Math.floor(Date.now() / 1000)

/** A preview URL's query as the visual editor signs it */
function from_editor(timestamp = now(), token = TOKEN, space = "123") {
	const signature = createHash("sha1").update(`${space}:${token}:${timestamp}`).digest("hex")
	return new URLSearchParams({
		_storyblok: "456",
		"_storyblok_tk[space_id]": space,
		"_storyblok_tk[timestamp]": String(timestamp),
		"_storyblok_tk[token]": signature,
	})
}

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

	test("a preview the editor signed, kept on a cookie", async () => {
		const { version, cookies } = await run(`${SITE}/about?${from_editor()}`)
		expect(version).toBe("draft")
		expect(cookies.storyblok_preview).toMatch(/^123:\d+:[0-9a-f]{40}$/)
	})

	test("a bare ?_storyblok is no preview", async () => {
		expect(await run(`${SITE}/about?_storyblok=1234`)).toEqual({
			version: "published",
			cookies: {},
		})
	})

	test("nor one signed with another token, or over an hour ago", async () => {
		expect((await run(`${SITE}/?${from_editor(now(), "guessed")}`)).version).toBe("published")
		expect((await run(`${SITE}/?${from_editor(now() - 3601)}`)).version).toBe("published")
	})

	// client-side navigation and remote functions never carry the query, so it's the cookie that lasts
	test("still a preview on the cookie alone, which is renewed", async () => {
		const signed = from_editor(now() - 3000)
		const kept = ["space_id", "timestamp", "token"].map((key) =>
			signed.get(`_storyblok_tk[${key}]`)
		)
		const { version, cookies } = await run(`${SITE}/about`, { storyblok_preview: kept.join(":") })
		expect(version).toBe("draft")
		expect(cookies.storyblok_preview).toStartWith(`123:${now()}:`)
	})

	test("a link a few seconds ahead of the server's clock", async () => {
		expect((await run(`${SITE}/?${from_editor(now() + 5)}`)).version).toBe("draft")
	})

	// the editor's frame keeps the URL it loaded, so its signature ages out while the session doesn't
	test("a stale link falls back on the session it started", async () => {
		const { cookies } = await run(`${SITE}/?${from_editor()}`)
		expect((await run(`${SITE}/?${from_editor(now() - 7200)}`, cookies)).version).toBe("draft")
	})

	test("the session outlasts the link's hour, but not a day", async () => {
		const cookie = (age: number) => {
			const signed = from_editor(now() - age)
			return ["space_id", "timestamp", "token"]
				.map((key) => signed.get(`_storyblok_tk[${key}]`))
				.join(":")
		}
		expect((await run(`${SITE}/`, { storyblok_preview: cookie(2 * 3600) })).version).toBe("draft")
		expect((await run(`${SITE}/`, { storyblok_preview: cookie(24 * 3600) })).version).toBe(
			"published"
		)
	})

	// the middleware moves a preview onto ?_storyblok=1, which mustn't spoil the cookie
	test("the cookie carries a request the middleware moved", async () => {
		const { cookies } = await run(`${SITE}/?${from_editor()}`)
		expect((await run(`${SITE}/about?_storyblok=1`, cookies)).version).toBe("draft")
	})

	test("a cookie that isn't signed is no preview, and is dropped", async () => {
		expect(await run(`${SITE}/about`, { storyblok_preview: "1" })).toEqual({
			version: "published",
			cookies: {},
		})
	})

	test("?_storyblok=off ends it", async () => {
		const { cookies } = await run(`${SITE}/?${from_editor()}`)
		expect(await run(`${SITE}/about?_storyblok=off`, cookies)).toEqual({
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
