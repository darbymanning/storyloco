import { expect, test } from "bun:test"
import { on_edited, set_editing, set_presence, unless_editing } from "./client.js"

test("an effect runs, and is undone by its cleanup, while nobody's editing the page", () => {
	const node = { textContent: "Creating homes" } as unknown as Element
	let undone = false
	const cleanup = unless_editing((el) => {
		el.textContent = "split"
		return () => (undone = true)
	})(node)
	expect(node.textContent).toBe("split")
	expect(typeof cleanup).toBe("function")
	;(cleanup as () => void)()
	expect(undone).toBe(true)
})

test("what rests while editing hears only edit mode turning on or off, not the rest of the editor", () => {
	const state = (globalThis as { __storyloco?: { injected: { user: unknown } } }).__storyloco!
	state.injected.user = { id: 1 }
	set_editing(false, false)
	let heard = 0
	const stop = on_edited(() => heard++)
	// presence and notifications arriving, as they do after each navigation
	set_presence({ me: null, people: [] })
	set_presence({ me: null, people: [] })
	set_editing(false, false)
	expect(heard).toBe(0)
	set_editing(true, false)
	set_editing(false, false)
	expect(heard).toBe(2)
	stop()
	state.injected.user = null
})
