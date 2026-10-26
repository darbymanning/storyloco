import { beforeEach, expect, test } from "bun:test"
import { send, undo } from "./client.js"

/** The blok's fields on the "server", and every change sent, as the editor hook would see them */
let blok: Record<string, string> = {}
let sent: Array<{ values: Record<string, string> }> = []

beforeEach(() => {
	blok = { title: "Hello", subtitle: "Hi" }
	sent = []
	globalThis.fetch = (async (_: unknown, init?: RequestInit) => {
		const change = JSON.parse(String(init?.body))
		sent.push(change)
		// what each field held before, as the hook's reply carries it to undo
		const before = Object.fromEntries(Object.keys(change.values).map((key) => [key, blok[key]]))
		Object.assign(blok, change.values)
		const undo = { op: "fields", story: 1, uid: "a", values: before }
		return new Response(JSON.stringify({ undo }))
	}) as typeof fetch
})

const typed = (title: string) =>
	send({ op: "fields", story: 1, uid: "a", values: { title } }, "change", { again: false })

test("one edit typed in pauses undoes in one go, to how it was before it", async () => {
	await typed("Hello w")
	await typed("Hello wor")
	await typed("Hello world")
	await undo().catch(() => {})
	expect(sent.at(-1)?.values).toEqual({ title: "Hello" })
})

test("another field is an edit of its own", async () => {
	await typed("Hello w")
	await send({ op: "fields", story: 1, uid: "a", values: { subtitle: "x" } }, "change", {
		again: false,
	})
	await undo().catch(() => {})
	expect(sent.at(-1)?.values).toEqual({ subtitle: "Hi" })
	await undo().catch(() => {})
	expect(sent.at(-1)?.values).toEqual({ title: "Hello" })
})
