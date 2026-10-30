import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import ts from "typescript"
import { generate_types } from "./generate.js"
import { load_local } from "./local.js"
import { push_schema } from "./check.js"

test("blocks colocated in .svelte module scripts load, generate, and type their props", async () => {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "storyloco-colocated-")))
	try {
		const pkg = path.join(root, "node_modules/storyloco")
		await mkdir(pkg, { recursive: true })
		await writeFile(
			path.join(pkg, "package.json"),
			JSON.stringify({
				name: "storyloco",
				type: "module",
				exports: { ".": "./root.d.ts", "./schema": "./schema.ts", "./mux": "./mux.ts" },
			})
		)
		await writeFile(path.join(pkg, "root.d.ts"), "export interface Registry {}")
		await writeFile(
			path.join(pkg, "schema.ts"),
			`export * from ${JSON.stringify(path.join(import.meta.dir, "index.ts"))}`
		)
		await writeFile(
			path.join(pkg, "mux.ts"),
			`export * from ${JSON.stringify(path.join(import.meta.dir, "../../../../mux/types.ts"))}`
		)
		const bloks_dir = path.join(root, "src/lib/bloks")
		await mkdir(bloks_dir, { recursive: true })
		await writeFile(path.join(root, "src/lib/shared.ts"), 'export const cta = "cta" as const')
		// The instance script imports what only the app resolves; only the module script is loaded.
		await writeFile(
			path.join(bloks_dir, "hero.svelte"),
			`<script module lang="ts">
	import { block, text, asset, bloks, mux, theme, type Props } from "storyloco/schema"
	import { cta } from "$lib/shared"

	export const schema = block("hero", {
		title: text({ required: true }),
		image: asset({ filetypes: ["images"] }),
		items: bloks(["teaser", cta], { minimum: 1 }),
		anything: bloks({ maximum: 2 }),
		video: mux({ required: true }),
		mode: theme(),
	})
</script>

<script lang="ts">
	import { page } from "$app/state"
	let { blok }: Props<"hero"> = $props()
</script>

<h1>{blok.title}{page.url}</h1>`
		)
		await writeFile(
			path.join(bloks_dir, "teaser.svelte"),
			`<script module lang="ts">
	import { block, text } from "storyloco/schema"
	export const schema = block("teaser", { label: text() })
</script>`
		)
		await writeFile(
			path.join(bloks_dir, "cta.svelte"),
			`<script module>
	import { block, multilink } from "storyloco/schema"
	export const schema = block("cta", { link: multilink() })
</script>`
		)
		const entry = path.join(root, "src/schema.ts")
		await writeFile(
			entry,
			`import { schema, block, bloks, type Block } from "storyloco/schema"
const page = block("page", { body: bloks("hero") }, { is_root: true })
export default schema({ blocks: { page, ...import.meta.glob<Block>("./lib/bloks/*.svelte", { eager: true, import: "schema" }) } })`
		)

		const files: string[] = []
		const local = await load_local(entry, (file) => files.push(file))
		expect(files).toContain(path.join(bloks_dir, "hero.svelte"))
		expect(Object.keys(local.schema.fieldPlugins ?? {})).toEqual([
			"storyloco:uiloco-mux",
			"storyloco:uiloco-theme",
		])
		const hero = local.components.find((c) => c.name === "hero")!
		expect(Object.keys(hero.schema)).toEqual([
			"title",
			"image",
			"items",
			"anything",
			"video",
			"mode",
		])
		expect(hero.schema.video).toMatchObject({
			type: "custom",
			field_type: "uiloco-mux",
			required: true,
		})
		expect(hero.schema.title).toMatchObject({ type: "text", required: true, pos: 0 })
		expect(hero.schema.items).toMatchObject({
			type: "bloks",
			minimum: 1,
			component_whitelist: ["teaser", "cta"],
			restrict_components: true,
		})
		expect(hero.schema.anything).toEqual({ pos: 3, type: "bloks", maximum: 2 })
		expect(local.components.find((c) => c.name === "page")?.is_root).toBe(true)

		// Push hands the Storyblok CLI a plain-data entry it can load without Svelte or Vite.
		let pushed: string[] = []
		await push_schema(
			{ root, entry: "src/schema.ts", space: "123", dry_run: true },
			async (args) => {
				pushed = args
			}
		)
		expect(pushed.slice(1, 3)).toEqual(["schema", "push"])
		expect(pushed).toContain("--dry-run")
		const flat = await import(pushed[3])
		expect(Object.keys(flat.default.blocks)).toHaveLength(4)
		expect(await readFile(pushed[3], "utf8")).not.toContain(".svelte")

		// Pull mode types plugins from the app's interface, which beats the built-in fallback
		await writeFile(
			path.join(root, "vite.config.ts"),
			'export interface StoryblokCustomPlugins { "uiloco-theme": "dark" | "light" }'
		)
		const output = path.join(root, "src/lib/components.schema.ts")
		await writeFile(output, generate_types(local.components, output, root))
		const consumer = path.join(root, "consumer.ts")
		await writeFile(
			consumer,
			`import "./src/lib/components.schema.js"
import { block, bloks, text, type Props } from "storyloco/schema"
import type { Video } from "storyloco/mux"
declare const video: Video
const props: Props<"hero", { class?: string }> = { blok: { title: "Hi", items: [{ component: "teaser" }], video }, class: "x" }
const typed: Video = props.blok.video
const mode: "dark" | "light" | undefined = props.blok.mode
// @ts-expect-error A registered plugin type wins over the built-in one
const badMode: Props<"hero"> = { blok: { title: "Hi", items: [], video, mode: "sepia" } }
// @ts-expect-error A plugin field takes its plugin's value type
const notVideo: Props<"hero"> = { blok: { title: "Hi", items: [], video: "nope" } }
// @ts-expect-error Required fields stay required
const missing: Props<"hero"> = { blok: { video } }
// @ts-expect-error Nested blocks keep the field's whitelist
const wrong: Props<"hero"> = { blok: { title: "Hi", items: [{ component: "page" }], video } }
// @ts-expect-error Only generated block names are props
type Unknown = Props<"nope">
// @ts-expect-error Allowed blocks are generated names
bloks("nope")
// @ts-expect-error An empty allow list would allow nothing
bloks([])
const local = block("local", { label: text({ required: true }) })
const own: Props<typeof local> = { blok: { _uid: "1", component: "local", label: "x" } }
void props; void typed; void mode; void badMode; void notVideo; void missing; void wrong; void own`
		)
		const program = ts.createProgram([consumer], {
			noEmit: true,
			strict: true,
			skipLibCheck: true,
			target: ts.ScriptTarget.ESNext,
			module: ts.ModuleKind.NodeNext,
			moduleResolution: ts.ModuleResolutionKind.NodeNext,
			allowImportingTsExtensions: true,
			types: [],
		})
		expect(
			ts
				.getPreEmitDiagnostics(program)
				.map(
					(e) =>
						`${e.file?.fileName}:${e.file && e.start !== undefined ? e.file.getLineAndCharacterOfPosition(e.start).line + 1 : ""} ${ts.flattenDiagnosticMessageText(e.messageText, "\n")}`
				)
		).toEqual([])
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("bloks takes a lone reference as allow, and module-script errors keep the file's lines", async () => {
	const { bloks, block, folder } = await import("./index.js")
	const hero = block("hero", {})
	expect(bloks(hero)).toEqual({ type: "bloks", allow: hero })
	expect(bloks(folder({ name: "Cards" })).allow).toMatchObject({ path: "Cards" })
	expect(bloks({ tag: "x" })).toEqual({ type: "bloks", allow: { tag: "x" } })
	expect(bloks({ maximum: 1 })).toEqual({ type: "bloks", maximum: 1 })

	const root = await realpath(await mkdtemp(path.join(tmpdir(), "storyloco-lines-")))
	try {
		// Valid for Svelte's parser, so the error comes from evaluating the served script
		await writeFile(
			path.join(root, "bad.svelte"),
			"<h1>hi</h1>\n\n<script module>\n\tnull.boom\n</script>"
		)
		await writeFile(path.join(root, "schema.ts"), 'export * from "./bad.svelte"')
		const error: Error = await load_local(path.join(root, "schema.ts")).catch((e) => e)
		expect(error.stack).toMatch(/bad\.svelte\?schema&lang\.ts:4:/)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test("a globbed file without a block schema is named in the error", async () => {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "storyloco-missing-")))
	try {
		await writeFile(path.join(root, "button.svelte"), "<script module>export const x = 1</script>")
		await writeFile(
			path.join(root, "schema.ts"),
			'export default { blocks: import.meta.glob("./*.svelte", { eager: true, import: "schema" }) }'
		)
		await expect(load_local(path.join(root, "schema.ts"))).rejects.toThrow("./button.svelte")
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})
