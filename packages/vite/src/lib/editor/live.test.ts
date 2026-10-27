import { describe, expect, test } from "bun:test"
import * as Y from "yjs"
import {
	anchor,
	apply_edit,
	enter,
	leader_of,
	leave,
	quietly,
	rebase,
	type_into,
	type Person,
} from "./live.js"

/** Two people's copies of one field, each passing its changes to the other */
function pair(start: string) {
	const a = new Y.Doc()
	const b = new Y.Doc()
	a.getText("text").insert(0, start)
	Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
	const sync = () => {
		Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
		Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
	}
	return { a: a.getText("text"), b: b.getText("text"), sync }
}

describe("typing together", () => {
	test("each person's typing is kept when both type at once", () => {
		const { a, b, sync } = pair("Hello world")
		type_into(a, "Oh, Hello world")
		type_into(b, "Hello world!")
		sync()
		expect(a.toString()).toBe("Oh, Hello world!")
		expect(b.toString()).toBe(a.toString())
	})

	test("an edit goes in as the smallest change, so typing beside it survives", () => {
		const { a, b, sync } = pair("one two three")
		type_into(a, "one 2 three")
		type_into(b, "one two three four")
		sync()
		expect(a.toString()).toBe("one 2 three four")
	})

	test("the same text again changes nothing", () => {
		const { a } = pair("same")
		let updates = 0
		a.doc!.on("update", () => updates++)
		type_into(a, "same")
		expect(updates).toBe(0)
	})

	test("typing before the text arrived lands as an edit to it", () => {
		const { a, b, sync } = pair("Hello world")
		type_into(a, "Hello there, world")
		sync()
		// b's person typed "!" at the end of what they saw, before a's change reached them
		apply_edit(b, rebase("Hello world", "Hello world!", b.toString()))
		sync()
		expect(a.toString()).toBe("Hello there, world!")
		// and typed near the start while someone added to the end
		const two = pair("one two")
		type_into(two.a, "one two three")
		two.sync()
		apply_edit(two.b, rebase("one two", "zero one two", two.b.toString()))
		two.sync()
		expect(two.a.toString()).toBe("zero one two three")
	})

	test("a caret stays by its text while someone types before it", () => {
		const { a, b, sync } = pair("Hello world")
		const caret = anchor(b, 6)
		type_into(a, "Oh, Hello world")
		sync()
		expect(caret()).toBe(10)
		expect(b.toString().slice(caret())).toBe("world")
	})
})

describe("who saves a field", () => {
	const person = (id: string, joined: number, rooms: Array<string>) =>
		({
			id,
			joined,
			rooms,
			user: { id: 1, name: null, email: null },
			color: "",
			page: "/",
			story: 1,
			select: null,
		}) as Person

	test("the first of those in the field to arrive, whoever else is about", () => {
		const everyone = [
			person("late", 3, ["1:a:title"]),
			person("early", 1, ["1:a:body"]),
			person("first", 2, ["1:a:title"]),
		]
		expect(leader_of(everyone, "1:a:title")).toBe("first")
		expect(leader_of(everyone, "1:a:body")).toBe("early")
		expect(leader_of(everyone, "1:b:title")).toBeNull()
	})
})

describe("saving a field", () => {
	const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

	test("not while its document is empty and nobody here typed, as before the saved text is in", async () => {
		const room = enter("1:a:title")
		const saves: Array<unknown> = []
		const text = room.doc.getText("text")
		room.saved = "Industry 01"
		room.value = () => text.toString()
		room.save = async (value) => (saves.push(value), true)
		// a change to the room that isn't typing, like someone else joining, has it look to save
		quietly(room, () => room.doc.getMap("other").set("x", 1))
		await wait(900)
		expect(saves).toEqual([])
		await leave(room)
		expect(saves).toEqual([])
	})

	test("nor a rich text one, with nothing but an empty paragraph in it", async () => {
		const room = enter("1:a:body")
		const saves: Array<unknown> = []
		room.saved = {
			type: "doc",
			content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
		}
		room.value = () => ({ type: "doc", content: [{ type: "paragraph" }] })
		room.save = async (value) => (saves.push(value), true)
		quietly(room, () => room.doc.getMap("other").set("x", 1))
		await wait(900)
		expect(saves).toEqual([])
		await leave(room)
		expect(saves).toEqual([])
	})

	test("but when someone here cleared it", async () => {
		const room = enter("1:a:subtitle")
		const saves: Array<unknown> = []
		const text = room.doc.getText("text")
		quietly(room, () => text.insert(0, "Industry 01"))
		room.saved = "Industry 01"
		room.value = () => text.toString()
		room.save = async (value) => (saves.push(value), true)
		text.delete(0, text.length)
		await wait(900)
		expect(saves).toEqual([""])
		await leave(room)
	})
})
