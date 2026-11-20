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

test("a plugin field always has an options array, which the field plugin needs to load", async () => {
	const { heading, link } = await import("./index.js")
	expect(heading().options).toEqual([])
	const options = [{ name: "a", value: "b" }]
	expect(link({ options }).options).toEqual(options)
})

test("seo() is the plain field, and include names its extra sections in an option the plugin reads", async () => {
	const { seo } = await import("./index.js")
	expect(seo()).toEqual({ options: [], type: "custom", field_type: "uiloco-seo" })
	expect(seo({ include: [] })).toEqual(seo())

	expect<object>(seo({ include: ["organization"] })).toEqual({
		options: [{ name: "include", value: "organization" }],
		type: "custom",
		field_type: "uiloco-seo",
	})

	const r2 = [{ name: "R2_BUCKET", value: "assets" }]
	expect<object>(seo({ options: r2, required: true, include: ["organization"] })).toEqual({
		options: [...r2, { name: "include", value: "organization" }],
		required: true,
		type: "custom",
		field_type: "uiloco-seo",
	})
	expect(seo({ options: r2 }).options).toEqual(r2)

	// @ts-expect-error only known groups
	seo({ include: ["faq"] })
})
