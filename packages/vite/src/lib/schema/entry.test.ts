import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { resolve_entry } from "./entry.js"
import { load_local } from "./local.js"

const roots: string[] = []
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function project() {
	const root = await mkdtemp(path.join(tmpdir(), "storyloco-entry-"))
	roots.push(root)
	await mkdir(path.join(root, "src"))
	return root
}

test("an absent default keeps the GUI workflow; an explicit path never silently falls back", async () => {
	const root = await project()
	expect(await resolve_entry(root)).toBeUndefined()
	expect(await resolve_entry(root, "missing.ts")).toBe(path.join(root, "missing.ts"))
	await expect(load_local(path.join(root, "missing.ts"))).rejects.toThrow()
})

test("discovers src/schema.ts relative to Vite's root, with an explicit GUI opt-out", async () => {
	const root = await project()
	await writeFile(path.join(root, "src/schema.ts"), "export default { blocks: {} }")
	expect(await resolve_entry(root)).toBe(path.join(root, "src/schema.ts"))
	expect(await resolve_entry(root, false)).toBeUndefined()
	expect(await resolve_entry(root, "custom/schema.ts")).toBe(path.join(root, "custom/schema.ts"))
})

test("an invalid conventional entry is reported rather than using the remote space", async () => {
	const root = await project()
	await mkdir(path.join(root, "src/schema.ts"))
	await expect(resolve_entry(root)).rejects.toThrow("must be a schema file")
})

test("loads default and named exports and tracks edits to imported blocks", async () => {
	const root = await project()
	const entry = path.join(root, "src/schema.ts")
	const block = path.join(root, "src/hero.ts")
	await writeFile(
		block,
		'export const hero = { name: "hero", fields: [{ name: "title", type: "text" }] }'
	)
	await writeFile(entry, 'import { hero } from "./hero.ts"; export default { blocks: { hero } }')
	const first = await load_local(entry)
	expect(first.components[0].schema.title.type).toBe("text")
	expect(first.dependencies).toContain(await realpath(block))
	await writeFile(
		block,
		'export const hero = { name: "hero", fields: [{ name: "title", type: "textarea" }] }'
	)
	await writeFile(
		entry,
		'import { hero } from "./hero.ts"; export const schema = { blocks: { hero } }'
	)
	expect((await load_local(entry)).components[0].schema.title.type).toBe("textarea")
})
