import { expect, test } from "bun:test"
import { defineField, defineSchema } from "@storyblok/schema"
import {
	block,
	field,
	folder,
	datasource,
	schema,
	define_schema,
	tab,
	text,
	type Schema,
} from "./index.js"
import { to_components } from "./local.js"

test("short helpers preserve the upstream functions and schema inference", () => {
	expect(field).toBe(defineField)
	expect(schema).toBe(defineSchema)
	expect(define_schema).toBe(schema)
	const layout = folder({ name: "Layout" })
	const hero = block({ name: "hero", folder: layout, fields: [field("title", { type: "text" })] })
	const page = block({
		name: "page",
		is_root: true,
		fields: [field("body", { type: "bloks", allow: hero })],
	})
	const model = schema({ blocks: { hero, page } })
	const name: Schema<typeof model>["blocks"]["name"] = "hero"
	expect(name).toBe("hero")
	// @ts-expect-error Exact block names survive the re-export.
	const invalid: Schema<typeof model>["blocks"]["name"] = "not_a_block"
	void invalid
	expect(to_components(model)[1].schema.body.component_whitelist).toEqual(["hero"])
	expect(datasource({ name: "Colours", slug: "colours" }).slug).toBe("colours")
})

test("tab(name, fields) is the tab and its fields, in the order it lists them", () => {
	const hero = block("hero", {
		title: text(),
		...tab("Page SEO", { description: text(), canonical: text() }),
		"tab-1": tab({ display_name: "Old", keys: ["title"] }),
	})

	expect(hero.fields.map((f) => f.name)).toEqual([
		"title",
		"description",
		"canonical",
		"tab_page_seo",
		"tab-1",
	])
	expect(hero.fields[3]).toMatchObject({
		type: "tab",
		display_name: "Page SEO",
		keys: ["description", "canonical"],
	})
	expect(hero.fields[4]).toMatchObject({ type: "tab", display_name: "Old", keys: ["title"] })
})
