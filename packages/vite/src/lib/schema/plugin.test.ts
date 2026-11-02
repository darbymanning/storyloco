import { expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ResolvedConfig } from "vite"
import schema from "./plugin.js"

type Hooks = {
	configResolved(config: Partial<ResolvedConfig>): Promise<void>
	buildStart(): Promise<void>
}

/** A build of a project at `root`, against a space whose components can't be read */
async function build(root: string) {
	const plugin = schema({
		storyblok_personal_access_token: "token",
		storyblok_space_id: "1",
	}) as unknown as Hooks
	await plugin.configResolved({
		mode: "production",
		root,
		command: "build",
		resolve: { alias: {} } as ResolvedConfig["resolve"],
	})
	return plugin.buildStart()
}

test("a build keeps the types it has when the space's components can't be read", async () => {
	const root = await mkdtemp(path.join(tmpdir(), "storyloco-types-"))
	const types = path.join(root, "src/lib/components.schema.ts")
	const real = globalThis.fetch
	globalThis.fetch = (async () => new Response("", { status: 403 })) as unknown as typeof fetch
	try {
		await mkdir(path.dirname(types), { recursive: true })
		await writeFile(types, "export type Kept = true\n")
		await build(root)
		expect(await readFile(types, "utf8")).toBe("export type Kept = true\n")
		// with none to keep, it still fails, as it can't be built without them
		await rm(types)
		await expect(build(root)).rejects.toThrow(/403/)
	} finally {
		globalThis.fetch = real
		await rm(root, { recursive: true, force: true })
	}
})
