import { expect, test } from "bun:test"
import { tools_of } from "./richtext.js"

test("a field's toolbar: its own list, none when that's empty, else the default", () => {
	expect([...tools_of({ customize_toolbar: true, toolbar: ["bold", "list"] })]).toEqual([
		"bold",
		"list",
	])
	expect(tools_of({ customize_toolbar: true, toolbar: [] }).size).toBe(0)
	// customised with no list saved, as Storyblok has many: its full toolbar, not none
	expect(tools_of({ customize_toolbar: true }).has("list")).toBe(true)
	expect(tools_of(undefined).has("bold")).toBe(true)
})
