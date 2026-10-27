import { expect, test } from "bun:test"
import { as_shown, holds, tools_of } from "./richtext.js"

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

test("text opens as the page shows it, without the spaces the page hides", () => {
	const p = (...content: Array<object>) => ({
		type: "doc",
		content: [{ type: "paragraph", content }],
	})
	const text = (text: string, marks?: Array<{ type: string }>) => ({
		type: "text",
		text,
		...(marks && { marks }),
	})
	const bold = [{ type: "bold" }]
	expect(as_shown(p(text(" The law  states "))).content).toEqual(p(text("The law states")).content)
	// across marks, a space after a space is gone, and an empty node with it
	expect(as_shown(p(text("A "), text(" b", bold), text(" "))).content).toEqual(
		p(text("A "), text("b", bold)).content
	)
	expect(as_shown(p(text("Line "), { type: "hard_break" }, text(" next"))).content).toEqual(
		p(text("Line"), { type: "hard_break" }, text("next")).content
	)
	// non-breaking spaces show, and code keeps its spacing
	expect(as_shown(p(text(" x"))).content).toEqual(p(text(" x")).content)
	const code = { type: "doc", content: [{ type: "code_block", content: [text("  a  b ")] }] }
	expect(as_shown(code)).toEqual(code)
})

test("the editor holds text as Storyblok keeps it, an image in a line, and says when it can't", () => {
	const image = { type: "image", attrs: { src: "https://a.storyblok.com/f/1/a.png" } }
	expect(holds({ type: "doc", content: [{ type: "paragraph", content: [image] }] })).toBe(true)
	// text loose in the document, outside any paragraph, it would drop
	expect(holds({ type: "doc", content: [{ type: "text", text: "loose" }] })).toBe(false)
})
