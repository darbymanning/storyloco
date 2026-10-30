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
		await writeFile(path.join(pkg, "root.d.ts"), "export interface Registry {}")
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
const rich: NonNullable<Page["copy"]> = {type: "doc", content: [{type: "blok", attrs: {id: null, body: [hero]}}]};
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
