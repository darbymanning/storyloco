import { expect, test } from "bun:test"
import { editor } from "./server.js"

const handle = editor({ moxy: "https://moxy.test", space: "1" })

/** A visitor's GET, which the site answers with `status` */
async function visit(path: string, status: number, through = handle) {
	const jar = new Map<string, string>()
	const event = {
		url: new URL(`https://site.test${path}`),
		request: new Request(`https://site.test${path}`, { headers: { accept: "text/html" } }),
		locals: {},
		cookies: {
			get: (name: string) => jar.get(name),
			getAll: () => [...jar].map(([name, value]) => ({ name, value })),
			set: (name: string, value: string) => void jar.set(name, value),
			delete: (name: string) => void jar.delete(name),
			serialize: (name: string, value: string) => `${name}=${value}; Path=/`,
		},
		setHeaders: () => {},
	}
	const resolve = async () => new Response("page", { status })
	try {
		return (await through({ event, resolve } as never)) as Response
	} catch (e) {
		// SvelteKit's redirect(); anything else is a failure
		if (!(e instanceof Object && "location" in e)) throw e
		const { status, location } = e as { status: number; location: string }
		return new Response(null, { status, headers: { location } })
	}
}

test("/admin, where the site has no page, signs in to the home page in edit mode", async () => {
	const response = await visit("/admin", 404)
	expect(response.status).toBe(303)
	expect(response.headers.get("location")).toBe("/__storyloco/signin?return=%2F")
	expect(response.headers.get("set-cookie")).toStartWith("sl_edit_on=1")
})

test("/a, as short, does the same", async () => {
	const response = await visit("/a", 404)
	expect(response.status).toBe(303)
	expect(response.headers.get("location")).toBe("/__storyloco/signin?return=%2F")
})

test("a site's own /admin is left alone", async () => {
	const response = await visit("/admin", 200)
	expect(response.status).toBe(200)
	expect(await response.text()).toBe("page")
})

test("?edit is the site's own, unless it's asked for", async () => {
	expect((await visit("/about?edit", 200)).status).toBe(200)
	const both = editor({ moxy: "https://moxy.test", space: "1", entry: ["/admin", "?edit"] })
	const response = await visit("/about?edit&x=1", 200, both)
	expect(response.status).toBe(303)
	expect(response.headers.get("location")).toBe("/__storyloco/signin?return=%2Fabout%3Fx%3D1")
	expect((await visit("/admin/", 404, both)).status).toBe(303)
})

test("another path in, and /admin left to the site", async () => {
	const own = editor({ moxy: "https://moxy.test", space: "1", entry: ["cms/", "?go=1"] })
	expect((await visit("/cms", 404, own)).headers.get("location")).toBe(
		"/__storyloco/signin?return=%2F"
	)
	expect((await visit("/admin", 404, own)).status).toBe(404)
	expect((await visit("/about?go", 200, own)).status).toBe(303)
})

test("a shared link's token stays on its page, so the address copied from there lets the next person in", async () => {
	const token = "t".repeat(24)
	const asked: Array<string> = []
	const real = globalThis.fetch
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? "{}")) as { op: string; token?: string }
		asked.push(body.op)
		if (body.op === "open")
			return body.token === token
				? Response.json({ handle: `h${asked.length}` })
				: new Response(null, { status: 404 })
		if (body.op === "who")
			return Response.json({
				user: { id: "g", name: null, email: null },
				guest: { role: "view", named: false, by: null },
			})
		return real(input, init)
	}) as typeof fetch
	try {
		// the link itself lands on its page with the token kept
		const opened = await visit(`/__storyloco/share/${token}?to=%2Fform%3Fa%3D1`, 200)
		expect(opened.headers.get("location")).toBe(`/form?a=1&sl_share=${token}`)

		// someone else, given that address, is let in on the same request, with a cookie for the next
		const jar = new Map<string, string>()
		const locals: { guest?: unknown } = {}
		const path = `/form?sl_share=${token}`
		const event = {
			url: new URL(`https://site.test${path}`),
			request: new Request(`https://site.test${path}`, { headers: { accept: "text/html" } }),
			locals,
			cookies: {
				get: (name: string) => jar.get(name),
				set: (name: string, value: string) => void jar.set(name, value),
				delete: (name: string) => void jar.delete(name),
			},
		}
		await handle({ event, resolve: async () => new Response("page") } as never)
		expect(jar.get("sl_guest_1")).toBeString()
		expect(locals.guest).toMatchObject({ role: "view" })

		// a token that isn't a shared link's lets nobody in
		const before = asked.length
		const other = {
			...event,
			url: new URL("https://site.test/form?sl_share=nope-not-a-token-at-all"),
			locals: {},
		}
		jar.clear()
		await handle({ event: other, resolve: async () => new Response("page") } as never)
		expect(jar.size).toBe(0)
		expect(asked.length).toBe(before + 1)
	} finally {
		globalThis.fetch = real
	}
})
