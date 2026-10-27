import { expect, test } from "bun:test"
import { unless_editing } from "./client.js"

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
