import { expect, test } from "bun:test"
import { persona } from "./guests.js"

test("a guest's made-up name and face are the same each time, and differ between guests", () => {
	expect(persona("g_abc")).toEqual(persona("g_abc"))
	expect(persona("g_abc").name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
	expect(persona("g_abc").art).toContain("<pattern")
	const names = new Set(Array.from({ length: 40 }, (_, i) => persona(`g_${i * 7919}`).name))
	expect(names.size).toBeGreaterThan(25)
})
