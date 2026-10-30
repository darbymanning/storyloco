import { afterEach, describe, expect, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import path from "node:path"
import { migrate, storyloco_imports, cli_version } from "./migrate.js"
import { load_local } from "./local.js"

const roots: string[] = []
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function project() {
	const root = await mkdtemp(path.join(tmpdir(), "storyloco-migrate-"))
	roots.push(root)
	return root
}
async function export_schema(args: string[]) {
	const out = args[args.indexOf("--out-dir") + 1]
	await mkdir(path.join(out, "blocks"))
	await writeFile(
		path.join(out, "blocks/hero.ts"),
		'export const hero = { name: "hero", fields: [{ name: "title", type: "text", description: "Keep defineField and @storyblok/schema in prose" }] }'
	)
	await writeFile(
		path.join(out, "schema.ts"),
		'import { hero } from "./blocks/hero"; export const schema = { blocks: { hero } }'
	)
}

describe("schema migration", () => {
	test("stages a pinned read-only export and creates a loadable default entry", async () => {
		const root = await project()
		const result = await migrate(
			{ root, space: "123", env: { STORYBLOK_PERSONAL_ACCESS_TOKEN: "test-token" }, region: "us" },
			async (args, options) => {
				expect(args.slice(0, 6)).toEqual([
					"--yes",
					`storyblok@${cli_version}`,
					"schema",
					"init",
					"--space",
					"123",
				])
				expect(args).not.toContain("test-token")
				expect(options.env.STORYBLOK_TOKEN).toBe("test-token")
				expect(options.env.STORYBLOK_REGION).toBe("us")
				await expect(access(path.join(root, "src/schema.ts"))).rejects.toThrow()
				await export_schema(args)
			}
		)
		expect(result.entry).toBe(path.join(root, "src/schema.ts"))
		const loaded = await load_local(result.entry)
		expect(loaded.components[0].name).toBe("hero")
		expect(loaded.components[0].schema.title.description).toBe(
			"Keep defineField and @storyblok/schema in prose"
		)
		expect((await readdir(path.join(root, "src"))).sort()).toEqual(["schema", "schema.ts"])
	})

	test("custom entry and output paths resolve from the project root", async () => {
		const root = await project()
		const result = await migrate(
			{ root, space: "123", entry: "cms.ts", out_dir: "models/content" },
			export_schema
		)
		expect((await load_local(result.entry)).components[0].name).toBe("hero")
	})

	test("never replaces an existing entry or directory, even an empty one", async () => {
		for (const existing of ["entry", "directory", "symlink"]) {
			const root = await project()
			await mkdir(path.join(root, "src"))
			if (existing === "entry") await writeFile(path.join(root, "src/schema.ts"), "keep me")
			else if (existing === "directory") await mkdir(path.join(root, "src/schema"))
			else await symlink(path.join(root, "missing"), path.join(root, "src/schema.ts"))
			let called = false
			await expect(
				migrate({ root, space: "123" }, async () => {
					called = true
				})
			).rejects.toThrow("Refusing to overwrite")
			expect(called).toBe(false)
			if (existing === "entry")
				expect(await readFile(path.join(root, "src/schema.ts"), "utf8")).toBe("keep me")
		}
	})

	test("failed or incomplete exports leave no entry, output directory, or staging files", async () => {
		for (const fails of [true, false]) {
			const root = await project()
			await expect(
				migrate({ root, space: "123" }, async (args) => {
					await writeFile(
						path.join(args[args.indexOf("--out-dir") + 1], "partial.ts"),
						"incomplete"
					)
					if (fails) throw new Error("network failure")
				})
			).rejects.toThrow()
			expect(await readdir(path.join(root, "src"))).toEqual([])
		}
	})

	test("a file created during export is preserved", async () => {
		const root = await project()
		await expect(
			migrate({ root, space: "123" }, async (args) => {
				await export_schema(args)
				await writeFile(path.join(root, "src/schema.ts"), "another editor")
			})
		).rejects.toThrow("Refusing to overwrite")
		expect(await readFile(path.join(root, "src/schema.ts"), "utf8")).toBe("another editor")
		expect(await readdir(path.join(root, "src"))).toEqual(["schema.ts"])
	})

	test("rejects output containing the entry and invalid space IDs before exporting", async () => {
		const root = await project()
		await expect(migrate({ root, space: "123", out_dir: "src" }, export_schema)).rejects.toThrow(
			"outside"
		)
		await expect(migrate({ root, space: "bad" }, export_schema)).rejects.toThrow("numeric")
	})
})

test("rewrites only generated imports, including multiline and official field plugins", () => {
	const source = `import { defineSchema } from '@storyblok/schema';
import type { Schema } from '@storyblok/schema';
import {
  defineBlock,
  defineField,
} from '@storyblok/schema';
import { color } from '@storyblok/schema/field-plugins';
const description = "from '@storyblok/schema' and defineField()";
`
	const result = storyloco_imports(source)
	expect(result).toContain("} from 'storyloco/schema';")
	expect(result).toContain("import type { Schema } from 'storyloco/schema';")
	expect(result).toContain("from 'storyloco/schema/field-plugins';")
	expect(result).toContain("const description = \"from '@storyblok/schema' and defineField()\";")
})

// The published CLI runs in Node, whose fs.cp errorOnExist behavior differs from Bun.
test("migration also installs successfully under the CLI's Node runtime", async () => {
	const root = await project()
	const bundled = await Bun.build({
		entrypoints: [fileURLToPath(new URL("./migrate.ts", import.meta.url))],
		outdir: path.join(root, "cli"),
		naming: "[name].mjs",
		target: "node",
	})
	expect(bundled.success).toBe(true)
	const script = `
		import { migrate } from ${JSON.stringify(path.join(root, "cli/migrate.mjs"))};
		import { mkdir, writeFile } from 'node:fs/promises';
		import path from 'node:path';
		await migrate({ root: ${JSON.stringify(root)}, space: '123' }, async args => {
			const out = args[args.indexOf('--out-dir') + 1];
			await mkdir(path.join(out, 'blocks'));
			await writeFile(path.join(out, 'blocks/hero.ts'), 'export const hero = {}');
			await writeFile(path.join(out, 'schema.ts'), 'export const schema = { blocks: {} }');
		});
	`
	const result = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" })
	if (result.error) throw result.error
	if (result.status !== 0) throw new Error(result.stderr)
	expect(await readFile(path.join(root, "src/schema.ts"), "utf8")).toContain("./schema/schema.js")
})
