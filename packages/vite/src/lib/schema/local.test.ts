import { describe, expect, test } from "bun:test"
import { to_components } from "./local.js"

const layout = { name: "Layout" }
const sections = { name: "Sections", parent: layout }

describe("to_components", () => {
	test("fields become a schema keyed by name, in order", () => {
		const [hero] = to_components({
			blocks: {
				hero: {
					name: "hero",
					display_name: "Hero",
					is_root: false,
					fields: [
						{ name: "headline", type: "text", required: true },
						{ name: "image", type: "asset", filetypes: ["images"] },
					],
				},
			},
		})
		expect(hero).toEqual({
			name: "hero",
			display_name: "Hero",
			is_root: false,
			schema: {
				headline: { pos: 0, type: "text", required: true },
				image: { pos: 1, type: "asset", filetypes: ["images"] },
			},
		})
	})

	test("allow names the blocks a bloks field takes, and restricts it", () => {
		const [page] = to_components({
			blocks: {
				page: { name: "page", fields: [{ name: "body", type: "bloks", allow: ["hero", "quote"] }] },
			},
		})
		expect(page.schema.body).toMatchObject({
			component_whitelist: ["hero", "quote"],
			restrict_components: true,
		})
		expect(page.schema.body).not.toHaveProperty("allow")
	})

	test("a folder in allow is the blocks in it, nested folders included", () => {
		const components = to_components({
			blocks: {
				page: {
					name: "page",
					fields: [{ name: "body", type: "bloks", allow: [{ folder: "Layout" }] }],
				},
				hero: { name: "hero", folder: layout, fields: [] },
				band: { name: "band", folder: sections, fields: [] },
				quote: { name: "quote", folder: "Elsewhere", fields: [] },
			},
		})
		expect(components[0].schema.body.component_whitelist).toEqual(["hero", "band"])
		// The folder itself is the space's to make on a push; it isn't a component key
		expect(components[1]).not.toHaveProperty("folder")
	})

	test("allow on a multilink keeps its list without restricting bloks", () => {
		const [card] = to_components({
			blocks: {
				card: { name: "card", fields: [{ name: "link", type: "multilink", allow: ["page"] }] },
			},
		})
		expect(card.schema.link).toEqual({ pos: 0, type: "multilink", component_whitelist: ["page"] })
	})

	test("a folder matches whatever its case", () => {
		const [page] = to_components({
			blocks: {
				page: {
					name: "page",
					fields: [{ name: "body", type: "bloks", allow: [{ folder: "layout" }] }],
				},
				hero: { name: "hero", folder: layout, fields: [] },
			},
		})
		expect(page.schema.body.component_whitelist).toEqual(["hero"])
	})

	test("a tag is the blocks that declare it", () => {
		const [page] = to_components({
			blocks: {
				page: { name: "page", fields: [{ name: "body", type: "bloks", allow: [{ tag: "card" }] }] },
				hero: { name: "hero", tags: ["card"], fields: [] },
				quote: { name: "quote", fields: [] },
			},
		})
		expect(page.schema.body.component_whitelist).toEqual(["hero"])
		expect(page).not.toHaveProperty("tags")
	})

	test("deny is every nestable block it doesn't name, on fields that pick blocks", () => {
		const [page] = to_components({
			blocks: {
				page: {
					name: "page",
					is_nestable: false,
					fields: [
						{ name: "body", type: "bloks", deny: ["quote", { folder: "Layout" }] },
						{ name: "link", type: "multilink", deny: ["quote"] },
					],
				},
				hero: { name: "hero", folder: layout, fields: [] },
				quote: { name: "quote", fields: [] },
				card: { name: "card", fields: [] },
			},
		})
		expect(page.schema.body).toMatchObject({
			component_whitelist: ["card"],
			restrict_components: true,
		})
		expect(page.schema.link).toEqual({ pos: 1, type: "multilink" })
	})

	test("a datasource is its slug", () => {
		const [block] = to_components({
			blocks: {
				block: {
					name: "block",
					fields: [{ name: "colour", type: "option", source: "internal", datasource: "colours" }],
				},
			},
		})
		expect(block.schema.colour).toMatchObject({ source: "internal", datasource_slug: "colours" })
	})
})
