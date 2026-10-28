import { expect, test } from "bun:test"
import { create_editor } from "./server.js"

const handle = create_editor({ moxy: "https://moxy.test", space: "1" })

/** A visitor's GET, which the site answers with `status` */
async function visit(path: string, status: number) {
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
	return (await handle({ event, resolve } as never)) as Response
}

test("/admin, where the site has no page, signs in to the home page in edit mode", async () => {
	const response = await visit("/admin", 404)
	expect(response.status).toBe(303)
	expect(response.headers.get("location")).toBe("/__storyloco/signin?return=%2F")
	expect(response.headers.get("set-cookie")).toStartWith("sl_edit_on=1")
})

test("a site's own /admin is left alone", async () => {
	const response = await visit("/admin", 200)
	expect(response.status).toBe(200)
	expect(await response.text()).toBe("page")
})
