import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { load_local } from "./local.js"
import { resolve_entry } from "./entry.js"
import { cli_version } from "./migrate.js"
import { run_cli } from "./run.js"

interface Options {
	entry?: string
	root?: string
	space?: string
	region?: string
	env?: NodeJS.ProcessEnv
}

type Runner = (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<void>

async function load(options: Options) {
	const root = path.resolve(options.root ?? process.cwd())
	const entry = await resolve_entry(root, options.entry)
	if (!entry) throw new Error("No schema found at src/schema.ts. Pass --entry <file>.")
	return { root, local: await load_local(entry, undefined, { $lib: path.join(root, "src/lib") }) }
}

/**
 * The loaded schema written out as plain data for the Storyblok CLI, which loads an entry with
 * jiti: it can't read the `.svelte` files or `import.meta.glob` an entry may use. Block references
 * are names by now. Field plugins lose their validator functions, which only the CLI's story
 * validation runs, not a diff or push.
 */
async function write_flat(root: string, schema: Awaited<ReturnType<typeof load_local>>["schema"]) {
	const flat = path.join(root, "node_modules/.cache/storyloco/schema.mjs")
	await mkdir(path.dirname(flat), { recursive: true })
	// Keyed by name: a globbed entry keys its blocks by file path
	const blocks = Object.fromEntries(Object.values(schema.blocks).map((b) => [b.name, b]))
	await writeFile(flat, `export default ${JSON.stringify({ ...schema, blocks })}\n`)
	return flat
}

/** The space to compare with or push to, and the CLI's environment for it. */
function remote(options: Options) {
	const env = { ...process.env, ...options.env }
	const space = options.space ?? env.STORYBLOK_SPACE_ID
	if (!space || !/^\d+$/.test(space))
		throw new Error("Set STORYBLOK_SPACE_ID or pass --space <numeric id>.")
	const token = env.STORYBLOK_PERSONAL_ACCESS_TOKEN ?? env.STORYBLOK_TOKEN
	if (token)
		Object.assign(env, {
			STORYBLOK_TOKEN: token,
			STORYBLOK_LOGIN: env.STORYBLOK_LOGIN || "storyloco",
			STORYBLOK_REGION: options.region ?? env.STORYBLOK_REGION ?? "eu",
		})
	return { space, env }
}

export async function check_schema(options: Options & { remote?: boolean } = {}, run = run_diff) {
	const { root, local } = await load(options)

	if (options.remote) {
		const { space, env } = remote(options)
		const flat = await write_flat(root, local.schema)
		const args = [
			`storyblok@${cli_version}`,
			"schema",
			"diff",
			"--from",
			space,
			"--to",
			flat,
			"--exit-code",
		]
		if (options.region) args.push("--region", options.region)
		await run(args, { cwd: root, env })
	}

	return local.components.length
}

export async function push_schema(
	options: Options & { dry_run?: boolean } = {},
	run: Runner = (args, opts) =>
		run_cli(args, opts, (code, signal) => `Schema push failed (${signal ?? code}).`)
) {
	const { space, env } = remote(options)
	const { root, local } = await load(options)
	const flat = await write_flat(root, local.schema)
	const args = [`storyblok@${cli_version}`, "schema", "push", flat, "--space", space]
	if (options.dry_run) args.push("--dry-run")
	if (options.region) args.push("--region", options.region)
	await run(args, { cwd: root, env })
	return local.components.length
}

function run_diff(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
	return run_cli(args, options, (code, signal) =>
		code === 1
			? "Schema differs from the space. Review the diff above."
			: `Schema comparison failed (${signal ?? code}).`
	)
}
