import { describe, expect, test } from "bun:test"
import { strip_schema } from "./strip.js"

const component = (module: string, instance = "let { blok } = $props()") =>
	`<script module lang="ts">\n${module}\n</script>\n\n<script lang="ts">\n${instance}\n</script>\n\n<h1>{blok.title}</h1>\n`

describe("strip_schema", () => {
	test("takes out the schema and the imports only it used, positions kept", async () => {
		const source = component(
			`\timport { block, text, type Props } from "storyloco/schema"\n\timport { audience } from "./shared.ts"\n\n\texport const schema = block("hero", {\n\t\ttitle: text(),\n\t\t...audience\n\t})`,
			`\tlet { blok }: Props<"hero"> = $props()`
		)
		const stripped = (await strip_schema(source))!
		expect(stripped).not.toContain("block(")
		expect(stripped).not.toContain("./shared.ts")
		expect(stripped).not.toMatch(/\btext\b/)
		// a type the component still uses stays, for Svelte to strip as types
		expect(stripped).toContain("type Props")
		expect(stripped.length).toBe(source.length)
		expect(stripped.split("\n").length).toBe(source.split("\n").length)
	})

	test("keeps what the component uses besides the schema", async () => {
		const source = component(
			`\timport { block, options } from "storyloco/schema"\n\timport bee from "./bee.avif"\n\tconst ILLUSTRATIONS = { bee }\n\texport const schema = block("intro", { illustration: options({ options: Object.keys(ILLUSTRATIONS) }) })`,
			`\tlet { blok } = $props()\n\tconst src = ILLUSTRATIONS.bee`
		)
		const stripped = (await strip_schema(source))!
		expect(stripped).toContain(`import bee from "./bee.avif"`)
		expect(stripped).toContain("const ILLUSTRATIONS")
		expect(stripped).not.toContain("storyloco/schema")
	})

	test("drops just the unused names from an import", async () => {
		const source = component(
			`\timport { block, tone } from "./helpers.ts"\n\texport const schema = block("quote", {})\n\texport const shade = tone("rose")`
		)
		const stripped = (await strip_schema(source))!
		expect(stripped).toMatch(/import \{\s+tone \} from "\.\/helpers\.ts"/)
	})

	test("leaves a component that uses its schema, or has none", async () => {
		const uses = component(
			`\timport { block } from "x"\n\texport const schema = block("a", {})`,
			`\tconsole.log(schema)`
		)
		expect(await strip_schema(uses)).toBeNull()
		expect(await strip_schema(component(`\texport const other = 1`))).toBeNull()
		expect(await strip_schema(`<script>let a = 1</script>`)).toBeNull()
	})

	// an apostrophe in the markup mustn't pair with another and hide a use between them
	test("markup prose doesn't hide an import the markup uses", async () => {
		const source = `<script module lang="ts">\n\timport { block } from "x"\n\timport { image } from "./image.ts"\n\texport const schema = block("a", {})\n</script>\n\n<p>The children's {image(1)} parents'</p>\n`
		expect(await strip_schema(source)).toContain(`import { image } from "./image.ts"`)
	})

	test("a parameter or local of the same name doesn't keep an import", async () => {
		const source = component(
			`\timport { block, text } from "storyloco/schema"\n\texport const schema = block("a", { text: text() })`,
			`\tconst lines = (text?: string) => (text ?? "").split("\\n")\n\tfunction count() { const text = "x"; return text.length }`
		)
		expect(await strip_schema(source)).not.toContain("storyloco/schema")
	})

	test("an each block's item doesn't keep an import, though its list does", async () => {
		const each = (list: string) =>
			`<script module lang="ts">\n\timport { block, text } from "storyloco/schema"\n\texport const schema = block("a", {})\n</script>\n\n{#each ${list} as text (text)}<p>{text}</p>{/each}\n`
		expect(await strip_schema(each("items"))).not.toContain("storyloco/schema")
		expect(await strip_schema(each("text()"))).toContain("storyloco/schema")
	})

	test("an import used beside a shadowing parameter stays", async () => {
		const source = component(
			`\timport { block, text } from "storyloco/schema"\n\texport const schema = block("a", {})`,
			`\tconst lines = (text?: string) => text\n\tconst field = text()`
		)
		expect(await strip_schema(source)).toMatch(/import \{\s+text \} from "storyloco\/schema"/)
	})

	test("an import used inside `as`, `!` or `satisfies` stays", async () => {
		for (const use of ["text() as Field", "text()!", "text() satisfies Field"]) {
			const source = component(
				`\timport { block, text } from "storyloco/schema"\n\texport const schema = block("a", {})`,
				`\tconst field = ${use}`
			)
			expect(await strip_schema(source)).toContain("text")
		}
	})

	test("a type of the schema doesn't count as using it", async () => {
		const source = component(
			`\timport { block, type Props } from "storyloco/schema"\n\texport const schema = block("a", {})`,
			`\tlet { blok }: Props<typeof schema> = $props()`
		)
		expect(await strip_schema(source)).not.toBeNull()
	})
})
