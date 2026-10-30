import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { in_scope, scoped, type Space } from "./scope.js"
import { check_schema, push_schema } from "./check.js"

const own = { name: "storyloco:Brochure" }

// Another schema's components share the space: `hero` and `card`, in Components
const space: Space = {
	component_groups: [
		{ uuid: "b", name: "Brochure" },
		{ uuid: "c", name: "Components" },
	],
	components: [
		{ id: 1, name: "brochure_card", component_group_uuid: "b", internal_tags_list: [own] },
		{ id: 2, name: "brochure_old", component_group_uuid: "b", internal_tags_list: [own] },
		{ id: 3, name: "hero", component_group_uuid: "c" },
		{ id: 4, name: "card", component_group_uuid: "c" },
		// made by hand in the folder, and moved into it from another schema's
		{ id: 5, name: "brochure_draft", component_group_uuid: "b" },
		{
			id: 6,
			name: "banner",
			component_group_uuid: "b",
			internal_tags_list: [{ name: "storyloco:Components" }],
		},
	],
}

// As the pinned Storyblok CLI prints a diff
const diff = ` Schema  Diffing schema...
from 1 → to schema.mjs
Folders
  = brochure (unchanged)
  - components (removed)
Components
  ~ brochure_card (changed)
  - brochure_old (removed)
  - card (removed)
  - hero (removed)
Datasources
  - colours (removed)
Summary: 1 changed, 4 stale
⚠️  4 stale entity(s) exist remotely but not in schema. Use --delete to remove.`

describe("scoped output", () => {
	test("reads the CLI's output plain when it's coloured", () => {
		const coloured = diff.replace(
			"~ brochure_card (changed)",
			"\x1b[33m~ brochure_card (changed)\x1b[39m"
		)
		const { changed } = scoped(
			coloured,
			["Brochure"],
			{ components: ["brochure_card"], datasources: [] },
			space
		)
		expect(changed).toContain("brochure_card (changed)")
	})

	test("knows its own datasources by the name the CLI prints", () => {
		const output = "Datasources\n  ~ Colours (changed)\n  - Asset+ (removed)"
		const { changed, hidden } = scoped(
			output,
			["Brochure"],
			{ components: [], datasources: ["colours", "Colours"] },
			space
		)
		expect(changed).toEqual(["Colours (changed)"])
		expect(hidden).toBe(1)
	})
})

describe("hidden entities", () => {
	test("take their detail lines with them", () => {
		const output =
			"Components\n  ~ hero (update)\n    ~ tags\n      - []\n  ~ brochure_card (update)\n    ~ tags"
		const { text } = scoped(
			output,
			["Brochure"],
			{ components: ["brochure_card"], datasources: [] },
			space
		)
		expect(text).toBe("Components\n  ~ brochure_card (update)\n    ~ tags")
	})
})

describe("in_scope", () => {
	test("a folder, or one inside it, compared as the CLI prints them", () => {
		expect(in_scope("Brochure", ["Brochure"])).toBe(true)
		expect(in_scope("Brochure/Parts", ["brochure"])).toBe(true)
		expect(in_scope("My Layout", ["my-layout"])).toBe(true)
		expect(in_scope("Brochures", ["Brochure"])).toBe(false)
		expect(in_scope(undefined, ["Brochure"])).toBe(false)
	})
})

describe("scoped", () => {
	test("shows the scope's own entities, counts the rest, and finds what differs", () => {
		const { text, changed, hidden } = scoped(
			diff,
			["Brochure"],
			{ components: ["brochure_card"], datasources: [] },
			space
		)
		expect(text).toContain("brochure_card (changed)")
		expect(text).toContain("brochure_old (removed)")
		expect(text).not.toContain("hero")
		expect(text).not.toContain("components (removed)")
		expect(text).not.toContain("Summary")
		expect(changed).toEqual(["brochure_card (changed)", "brochure_old (removed)"])
		expect(hidden).toBe(4)
	})
})

/** A project whose schema entry is `entry`, run with `body` */
async function project(entry: string, body: (root: string) => Promise<void>) {
	const root = await realpath(await mkdtemp(path.join(tmpdir(), "storyloco-scope-")))
	try {
		await mkdir(path.join(root, "src"))
		const helpers = JSON.stringify(path.join(import.meta.dir, "index.ts"))
		await writeFile(
			path.join(root, "src/schema.ts"),
			`import { block, folder, schema, text } from ${helpers}\n${entry}`
		)
		await body(root)
	} finally {
		await rm(root, { recursive: true, force: true })
	}
}

const brochure = `const brochure = folder({ name: "Brochure" })
export const scope = brochure
export default schema({
	blocks: { card: block("brochure_card", { title: text() }, { folder: brochure }) },
	folders: { brochure },
})`

/** A Management API that answers from `space` and records what it's asked to delete */
function api(deleted: Array<string>) {
	return (async (url: string, init?: RequestInit) => {
		if (init?.method === "DELETE") {
			deleted.push(url.split("/").pop()!)
			return new Response(null, { status: 204 })
		}
		const key = url.endsWith("component_groups") ? "component_groups" : "components"
		return Response.json({ [key]: space[key] })
	}) as unknown as typeof fetch
}

const env = { STORYBLOK_PERSONAL_ACCESS_TOKEN: "token" }

describe("a scoped schema", () => {
	test("refuses a block outside its scope", async () => {
		await project(
			`const brochure = folder({ name: "Brochure" })
export const scope = brochure
export default schema({ blocks: { hero: block("hero", {}) } })`,
			async (root) => {
				await expect(check_schema({ root, env })).rejects.toThrow(/hero isn't in/)
			}
		)
	})

	test("checks against its own folders alone", async () => {
		await project(brochure, async (root) => {
			const run = async () => diff
			await expect(
				check_schema({ root, env, space: "1", remote: true }, run, api([]))
			).rejects.toThrow(
				"Schema differs from the space in Brochure: brochure_card (changed), brochure_old (removed)."
			)
			const same = async () => "Components\n  = brochure_card (unchanged)\n  - hero (removed)"
			expect(await check_schema({ root, env, space: "1", remote: true }, same, api([]))).toBe(1)
		})
	})

	test("its owner tag goes on every block it pushes, beside their own", async () => {
		await project(brochure, async (root) => {
			let pushed = ""
			await push_schema(
				{ root, env, space: "1" },
				async (args) => {
					pushed = await Bun.file(args[3]).text()
				},
				api([])
			)
			expect(pushed).toContain(`"tags":["storyloco:Brochure"]`)
		})
	})

	test("push --delete removes its own stale components, never another schema's", async () => {
		await project(brochure, async (root) => {
			const deleted: Array<string> = []
			await push_schema(
				{ root, env, space: "1", delete: true, dry_run: true },
				async () => diff,
				api(deleted)
			)
			expect(deleted).toEqual([])
			await push_schema({ root, env, space: "1", delete: true }, async () => diff, api(deleted))
			// not brochure_draft or banner, in the folder but not pushed by this schema
			expect(deleted).toEqual(["2"])
		})
	})

	test("push --delete needs a scope", async () => {
		await project(
			`export default schema({ blocks: { hero: block("hero", { title: text() }) } })`,
			async (root) => {
				await expect(
					push_schema({ root, env, space: "1", delete: true }, async () => "", api([]))
				).rejects.toThrow(/needs the schema's scope/)
			}
		)
	})
})
