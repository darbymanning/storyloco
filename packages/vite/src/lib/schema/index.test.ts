import { expect, test } from "bun:test"
import { defineField, defineSchema } from "@storyblok/schema"
import { block, field, folder, datasource, schema, define_schema, type Schema } from "./index.js"
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
