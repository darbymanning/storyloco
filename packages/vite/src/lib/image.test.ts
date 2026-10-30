import { describe, expect, test } from "bun:test"
import { image } from "./image.js"

const photo = "https://a.storyblok.com/f/1/2400x1600/abc/photo.jpg"

describe("image", () => {
	test("nothing for an empty asset, so it spreads safely", () => {
		expect(image(undefined)).toBeUndefined()
		expect(image({ filename: null })).toBeUndefined()
		expect(image.exists({ filename: "" })).toBe(false)
	})

	test("a srcset up to the asset's own width, its proportions kept", () => {
		const attrs = image({ filename: photo, alt: "A field" })!
		expect(attrs).toMatchObject({ width: 2400, height: 1600, alt: "A field", loading: "lazy" })
		const widths = attrs
			.srcset!.split(", ")
			.map((entry) => Number(entry.split(" ")[1].slice(0, -1)))
		expect(Math.max(...widths)).toBeLessThanOrEqual(2400)
		expect(attrs.srcset).toContain(`${photo}/m/100x66/smart/filters:quality(85) 100w`)
		expect(attrs.style).toBe("--aspect: 2400/1600;")
	})

	test("a size given crops to it", () => {
		const attrs = image({ filename: photo }, { width: 272, height: 152 })!
		expect(attrs.src).toBe(`${photo}/m/272x152/smart/filters:quality(85)`)
	})

	test("the focal point centres the crop and positions it", () => {
		const attrs = image({ filename: photo, focus: "1200x400:1300x500" })!
		expect(attrs.src).toContain("filters:quality(85):focal(1200x400:1300x500)")
		expect(attrs.src).not.toContain("/smart")
		expect(attrs.style).toContain("object-position: 52.08% 28.13%;")
	})

	test("an asset without dimensions is served as it is, filters only", () => {
		const attrs = image({ filename: "https://a.storyblok.com/f/1/abc/photo.jpg" })!
		expect(attrs.src).toBe("https://a.storyblok.com/f/1/abc/photo.jpg/m/filters:quality(85)")
		expect(attrs.srcset).toBeUndefined()
	})

	test("an svg passes through", () => {
		expect(image({ filename: "https://a.storyblok.com/f/1/logo.svg" })!.src).toBe(
			"https://a.storyblok.com/f/1/logo.svg"
		)
	})
})
