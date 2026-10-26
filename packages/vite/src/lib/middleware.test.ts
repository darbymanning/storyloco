import { describe, expect, test } from "bun:test"
import { editing, own_key } from "./middleware.js"

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
