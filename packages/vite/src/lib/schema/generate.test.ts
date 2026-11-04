import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import ts from "typescript"
import { generate_types } from "./generate.js"
import { load_local } from "./local.js"
import { check_schema } from "./check.js"
import { infer_known_plugin } from "./migrate.js"

test("generated interfaces compile with inferred plugins, recursive blocks, and strict field values", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "storyloco-types-"))
	try {
		await mkdir(path.join(root, "node_modules"))
		const pkg = path.join(root, "node_modules/storyloco")
		await mkdir(pkg)
		await writeFile(
			path.join(pkg, "package.json"),
			JSON.stringify({
				name: "storyloco",
				type: "module",
				exports: { ".": "./root.d.ts", "./schema": "./schema.ts" },
			})
		)
		await writeFile(
			path.join(pkg, "root.d.ts"),
			"export interface Registry {}\nexport type Story<T> = { uuid: string; content: T }\nexport type Content = Record<string, unknown>"
		)
		await writeFile(
			path.join(pkg, "schema.ts"),
			`export * from ${JSON.stringify(path.join(import.meta.dir, "index.ts"))}`
		)
		const entry = path.join(root, "schema.ts")
		await writeFile(
			entry,
			`import { schema, block, field, field_plugin } from "storyloco/schema";
const heading = field_plugin({ fieldType: "heading", value: { "~standard": { version: 1, vendor: "test", types: undefined as unknown as { input: unknown; output: { text: string } }, validate(value: unknown) { return { value: value as { text: string } } } } } });
const hero = block({ name: "hero", fields: [field("heading", { type: "custom", field_type: "heading", required: true }), field("tone", { type: "option", options: [{ name: "Red", value: "red" }] })] });
const page = block({ name: "page", is_root: true, fields: [field("body", { type: "bloks", allow: [hero], required: true }), field("image", { type: "asset" }), field("copy", { type: "richtext", allow: [hero] })] });
export default schema({ blocks: { page, hero }, fieldPlugins: { heading } });`
		)
		const local = await load_local(entry)
		const output = path.join(root, "types.ts")
		await writeFile(output, generate_types(local.components, output, root, entry, local.named))
		const consumer = path.join(root, "consumer.ts")
		await writeFile(
			consumer,
			`import type { Hero, Page, ContentTypes } from "./types.js";
const hero: Hero = { heading: {text: "hello"}, tone: "red" };
const page: Page = {body: [hero]};
const content: ContentTypes["page"] = page;
const rich: NonNullable<Page["copy"]> = {type: "doc", content: [{type: "blok", attrs: {id: null, body: [{ ...hero, component: "hero", heading: { plugin: "heading", text: "hello" } }]}}]};
// a blocks-limited richtext is still a richtext, wherever one goes
const plain: import("storyloco/schema").RichTextFieldValue = rich;
void plain;
// @ts-expect-error Rich-text block restrictions are preserved
const badRich: NonNullable<Page["copy"]> = {type: "doc", content: [{type: "blok", attrs: {id: null, body: [{component: "page"}]}}]};
void rich; void badRich;
// @ts-expect-error Plugin types are inferred without a Vite config interface
const bad: Hero = { heading: {text: 42} };
// @ts-expect-error Block whitelist is preserved
const badPage: Page = { body: [{ component: "page" }] };
void content; void bad; void badPage;`
		)
		const program = ts.createProgram([consumer], {
			noEmit: true,
			noUnusedLocals: true,
			allowImportingTsExtensions: true,
			strict: true,
			skipLibCheck: true,
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			types: [],
		})
		const errors = ts.getPreEmitDiagnostics(program)
		expect(
			errors.map(
				(e) =>
					(e.file && e.start !== undefined
						? e.file.fileName + ":" + (e.file.getLineAndCharacterOfPosition(e.start).line + 1) + " "
						: "") + ts.flattenDiagnosticMessageText(e.messageText, "\n")
			)
		).toEqual([])
		expect(await check_schema({ root, entry: "schema.ts" })).toBe(2)
		let compared = false
		await check_schema({ root, entry: "schema.ts", remote: true, space: "123" }, async (args) => {
			compared = true
			expect(args).toContain("--exit-code")
			expect(args).toContain("123")
		})
		expect(compared).toBe(true)
		await expect(
			check_schema({ root, entry: "schema.ts", remote: true, space: "123" }, async () => {
				throw new Error("drift")
			})
		).rejects.toThrow("drift")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("validation reports block/field paths and check fails for invalid schemas", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "storyloco-invalid-"))
	try {
		await writeFile(
			path.join(root, "schema.ts"),
			'export default {blocks: { hero: {name: "hero", fields: [{name: "title", type: "not-real"}]}}}'
		)
		await expect(check_schema({ root, entry: "schema.ts" })).rejects.toThrow("hero")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("migration annotates known plugins while keeping unknown placeholders", () => {
	const source = "fieldType: 'heading-field', validate: (value: unknown) => ({ value })"
	expect(infer_known_plugin(source)).toContain('value as import("storyloco/heading").Heading')
	expect(infer_known_plugin(source.replace("heading-field", "unknown"))).toBe(
		source.replace("heading-field", "unknown")
	)
})

test("generation rejects name collisions", () => {
	expect(() =>
		generate_types(
			[
				{ name: "foo-bar", schema: {} },
				{ name: "foo_bar", schema: {} },
			],
			"/types.ts",
			"/"
		)
	).toThrow("conflicting")
})

test("a blocks field takes its components by folder or tag, as well as by name", () => {
	const field = (restrict: Record<string, unknown>) => ({
		type: "bloks",
		restrict_components: true,
		component_whitelist: [],
		...restrict,
	})
	const types = generate_types(
		[
			{
				name: "page",
				is_nestable: false,
				schema: {
					by_folder: field({ restrict_type: "groups", component_group_whitelist: ["blocks"] }),
					by_tag: field({ restrict_type: "tags", component_tag_whitelist: [7] }),
					by_name: field({ restrict_type: "", component_whitelist: ["title"] }),
				},
			},
			{ name: "title", component_group_uuid: "blocks", schema: {} },
			{ name: "image", component_group_uuid: "blocks", internal_tag_ids: ["7"], schema: {} },
			{ name: "link", schema: {} },
		],
		"/types.ts",
		"/"
	).replace(/\s+/g, " ")
	expect(types).toContain('"by_folder"?: (Title | Image)[]')
	expect(types).toContain('"by_tag"?: (Image)[]')
	expect(types).toContain('"by_name"?: (Title)[]')
})

test("a field's type takes only what types its value, not settings the space spells its own way", () => {
	const types = generate_types(
		[
			{
				name: "filters",
				schema: {
					regions: {
						type: "options",
						pos: 2,
						id: "zDv7",
						source: "internal",
						datasource_slug: "regions",
						// a number from the Management API, where the schema types a string: `never` if kept
						max_options: 3,
					},
				},
			},
		],
		"/types.ts",
		"/"
	).replace(/\s+/g, " ")
	expect(types).toContain(
		'"regions"?: FieldValue<Extract<Field, { type: "options" }> & {"type":"options","source":"internal"}>'
	)
	expect(types).not.toContain("max_options")
})

test("stories a field picks are their uuids, or the stories once resolved; a link may carry its story", () => {
	const types = generate_types(
		[
			{
				name: "cases",
				schema: {
					items: {
						type: "options",
						source: "internal_stories",
						filter_content_type: ["case_study"],
					},
					lead: { type: "option", source: "internal_stories" },
					link: { type: "multilink" },
				},
			},
			{ name: "case_study", is_root: true, schema: {} },
		],
		"/types.ts",
		"/"
	).replace(/\s+/g, " ")
	expect(types).toContain('"items"?: (import("storyloco").Story<CaseStudy> | string)[]')
	expect(types).toContain(
		'"lead"?: import("storyloco").Story<import("storyloco").Content> | string'
	)
	expect(types).toContain('"link"?: StoryblokLink')
})
