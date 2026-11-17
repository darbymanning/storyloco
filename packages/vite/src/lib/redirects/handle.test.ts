import { afterAll, expect, mock, setSystemTime, test } from "bun:test"

mock.module("virtual:storyblok-redirects", () => ({
	redirects: [["/old", "/baked"]],
	datasource: "redirects",
	token: "public-token",
}))

let live: Array<{ name: string; value: string }> | "down" = [
	{ name: "/old", value: "/live" },
	{ name: "/contact-us/", value: "/contact" },
	{ name: "/same/", value: "/same" },
	{ name: "https://old.example/", value: "/old-home" },
	{ name: "//www.old.example/contact-us/", value: "/old-contact" },
	{ name: "https://old.example/blog/*", value: "/news/*" },
	{ name: "/blog/*", value: "/articles/*" },
]
const fetches = mock(async () =>
	live === "down"
		? new Response("", { status: 500 })
		: Response.json({ datasource_entries: live }, { headers: { total: String(live.length) } })
)
const real_fetch = globalThis.fetch
globalThis.fetch = fetches as unknown as typeof fetch
afterAll(() => {
	globalThis.fetch = real_fetch
	setSystemTime()
})

const { handle_redirects } = await import("./handle.js")

const visit = async (path: string, origin = "https://example.com") => {
	const response = await handle_redirects({
		event: { url: new URL(path, origin) },
		resolve: async () => new Response("page"),
	} as never)
	return response.headers.get("location") ?? (await response.text())
}
const settle = () => new Promise((r) => setTimeout(r, 0))

test("the first request uses the live datasource over the baked list", async () => {
	setSystemTime(new Date("2026-10-07T12:00:00Z"))
	expect(await visit("/old")).toBe("/live")
	expect(await visit("/elsewhere")).toBe("page")
	expect(fetches).toHaveBeenCalledTimes(1)
})

test("a trailing slash on either side doesn't stop a match, and never redirects a page to itself", async () => {
	expect(await visit("/contact-us")).toBe("/contact")
	expect(await visit("/contact-us/")).toBe("/contact")
	expect(await visit("/old/")).toBe("/live")
	expect(await visit("/same")).toBe("page")
	expect(await visit("/same/")).toBe("page")
})

test("a key written as a full URL only matches its own host, and wins there over a plain path", async () => {
	expect(await visit("/", "https://old.example")).toBe("/old-home")
	expect(await visit("/", "https://www.old.example")).toBe("/old-home")
	expect(await visit("/")).toBe("page")
	expect(await visit("/contact-us", "https://old.example")).toBe("/old-contact")
	expect(await visit("/contact-us")).toBe("/contact")
	expect(await visit("/old", "https://old.example")).toBe("/live")
	expect(await visit("/blog/a", "https://old.example")).toBe("/news/a")
	expect(await visit("/blog/a")).toBe("/articles/a")
	expect(await visit("https://example.com//old.example/")).toBe("page")
})

test("the list is refreshed every minute, keeping the last good one", async () => {
	live = [{ name: "/old", value: "/newer" }]
	setSystemTime(new Date("2026-10-07T12:00:30Z"))
	expect(await visit("/old")).toBe("/live")
	expect(fetches).toHaveBeenCalledTimes(1)

	setSystemTime(new Date("2026-10-07T12:01:01Z"))
	expect(await visit("/old")).toBe("/live")
	await settle()
	expect(await visit("/old")).toBe("/newer")
	expect(fetches).toHaveBeenCalledTimes(2)

	live = "down"
	setSystemTime(new Date("2026-10-07T12:02:02Z"))
	await visit("/old")
	await settle()
	expect(await visit("/old")).toBe("/newer")
	expect(fetches).toHaveBeenCalledTimes(3)
})
