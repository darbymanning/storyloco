import { describe, expect, test } from "bun:test"
import {
	alt_problem,
	contrast,
	heading_problems,
	hex,
	link_problem,
	needed,
	over,
	parse_rgb,
	suggest,
	type Rgba,
} from "./a11y.js"

const black: Rgba = [0, 0, 0, 1]
const white: Rgba = [255, 255, 255, 1]

describe("contrast", () => {
	test("reads colours as browsers serialise them", () => {
		expect(parse_rgb("rgb(1, 2, 3)")).toEqual([1, 2, 3, 1])
		expect(parse_rgb("rgba(1, 2, 3, 0.5)")).toEqual([1, 2, 3, 0.5])
		expect(parse_rgb("rgb(1 2 3 / 50%)")).toEqual([1, 2, 3, 0.5])
		expect(parse_rgb("oklch(0.5 0.1 200)")).toBeNull()
	})

	test("matches WCAG's own figures", () => {
		expect(contrast(black, white)).toBeCloseTo(21, 5)
		expect(contrast(white, white)).toBe(1)
		// #767676 is the lightest grey that passes AA on white, #777777 the first that doesn't
		expect(contrast([118, 118, 118, 1], white)).toBeGreaterThan(4.5)
		expect(contrast([119, 119, 119, 1], white)).toBeLessThan(4.5)
	})

	test("see-through colours blend with what's under them", () => {
		expect(over([0, 0, 0, 0.5], white).map(Math.round)).toEqual([128, 128, 128, 1])
		expect(over([9, 9, 9, 1], white)).toEqual([9, 9, 9, 1])
		expect(over([0, 0, 0, 0], [0, 0, 0, 0])).toEqual([0, 0, 0, 0])
	})

	test("large text may be lower", () => {
		expect(needed(16, 400)).toBe(4.5)
		expect(needed(24, 400)).toBe(3)
		expect(needed(19, 700)).toBe(3)
		expect(needed(19, 400)).toBe(4.5)
	})

	test("a suggestion passes, in the direction that can", () => {
		const grey: Rgba = [170, 170, 170, 1]
		const on_white = suggest(grey, white, 4.5)
		expect(contrast(on_white, white)).toBeGreaterThanOrEqual(4.5)
		expect(on_white[0]).toBeLessThan(170)
		const on_black = suggest([90, 90, 90, 1], black, 4.5)
		expect(contrast(on_black, black)).toBeGreaterThanOrEqual(4.5)
		expect(on_black[0]).toBeGreaterThan(90)
		// it goes no further than it needs to: one step back wouldn't pass
		expect(contrast(on_white, white)).toBeLessThan(5)
		expect(hex([255, 0, 16, 1])).toBe("#ff0010")
	})
})

describe("headings", () => {
	const levels = (...list: Array<number | [number, string]>) =>
		heading_problems(
			list.map((item) =>
				Array.isArray(item) ? { level: item[0], text: item[1] } : { level: item, text: "A title" }
			)
		)

	test("a tidy outline has nothing to say", () => {
		expect(levels(1, 2, 3, 3, 2, 3)).toEqual({ problems: [], no_h1: false })
	})

	test("going back up any number of levels is fine; going down by more than one isn't", () => {
		expect(levels(1, 2, 3, 2).problems).toEqual([])
		expect(levels(1, 2, 4).problems).toEqual([{ index: 2, problem: "skipped" }])
	})

	test("says when the h1 is missing, doubled or a heading is empty", () => {
		expect(levels(2, 3).no_h1).toBe(true)
		expect(levels(1, 1).problems).toEqual([{ index: 1, problem: "another_h1" }])
		expect(levels(1, [2, "  "]).problems).toEqual([{ index: 1, problem: "empty" }])
	})
})

describe("words", () => {
	test("links that mean nothing on their own", () => {
		for (const text of ["Read more", "click here", "More…", " Learn more "])
			expect(link_problem(text)).toBe("vague")
		expect(link_problem("https://bedales.org.uk/admissions")).toBe("url")
		expect(link_problem("Read more about admissions")).toBeNull()
		expect(link_problem("Admissions")).toBeNull()
	})

	test("alt text that isn't doing its job", () => {
		for (const alt of ["IMG_8402.jpg", "img_8402resize.jpg", "DSC1234", "will-in-the-isc"])
			expect(alt_problem(alt)).toBe("filename")
		expect(alt_problem("Image of a school")).toBe("redundant")
		expect(alt_problem("A photo of pupils")).toBe("redundant")
		expect(alt_problem("x ".repeat(120))).toBe("long")
		expect(alt_problem("Will Goldsmith, Head of Bedales")).toBeNull()
		expect(alt_problem("Pupils in the Olivier Theatre")).toBeNull()
		expect(alt_problem("Well-being")).toBeNull()
		expect(alt_problem("")).toBeNull()
	})
})
