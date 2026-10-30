import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { load_local } from "./local.js"
import { resolve_entry } from "./entry.js"
import { cli_version } from "./migrate.js"
import { run_cli } from "./run.js"
import { createInterface } from "node:readline/promises"
import { folders, in_scope, management, owner_tag, scoped, type Space } from "./scope.js"

interface Options {
	entry?: string
	root?: string
	space?: string
	region?: string
	env?: NodeJS.ProcessEnv
}

type Runner = (
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; capture?: boolean }
) => Promise<string | void>

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
async function write_flat(root: string, local: Awaited<ReturnType<typeof load_local>>) {
	const { schema, scope } = local
	const flat = path.join(root, "node_modules/.cache/storyloco/schema.mjs")
	await mkdir(path.dirname(flat), { recursive: true })
	// Keyed by name: a globbed entry keys its blocks by file path. A scoped schema's blocks carry
	// its owner tag, beside any tags of their own, so `push --delete` knows what it pushed.
	const tag = scope && owner_tag(scope)
	const blocks = Object.fromEntries(
		Object.values(schema.blocks).map((b) => [
			b.name,
			tag ? { ...b, tags: [...new Set([...(b.tags ?? []), tag])] } : b,
		])
	)
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

/** The names a scoped run compares the space's output with */
function own(local: Awaited<ReturnType<typeof load_local>>) {
	const datasources = (
		local.schema as { datasources?: Record<string, { name?: string; slug?: string }> }
	).datasources
	return {
		components: local.components.map((component) => component.name),
		// the CLI prints a datasource by its name
		datasources: Object.entries(datasources ?? {}).flatMap(([key, d]) =>
			[key, d?.name, d?.slug].filter((name): name is string => !!name)
		),
	}
}

/** The CLI's output for the scope alone, and a count of what it left out */
function report(output: string | void, local: Awaited<ReturnType<typeof load_local>>, held: Space) {
	const result = scoped(output ?? "", local.scope!, own(local), held)
	console.log(result.text)
	if (result.hidden) console.log(`${result.hidden} outside ${local.scope!.join(", ")} not shown.`)
	return result
}

/**
 * Validate the schema, and with `remote`, compare it with the space. A scoped schema is compared
 * with its own folders alone: another schema's components in the space don't make it differ.
 */
export async function check_schema(
	options: Options & { remote?: boolean } = {},
	run: Runner = run_diff,
	request = fetch
) {
	const { root, local } = await load(options)

	if (options.remote) {
		const { space, env } = remote(options)
		const flat = await write_flat(root, local)
		const args = [`storyblok@${cli_version}`, "schema", "diff", "--from", space, "--to", flat]
		if (options.region) args.push("--region", options.region)
		if (!local.scope) {
			await run([...args, "--exit-code"], { cwd: root, env })
			return local.components.length
		}

		const [output, held] = await Promise.all([
			run(args, { cwd: root, env, capture: true }),
			management(space, env, options.region, request).then((api) => api.read()),
		])
		const { changed } = report(output, local, held)
		if (changed.length)
			throw new Error(
				`Schema differs from the space in ${local.scope.join(", ")}: ${changed.join(", ")}.`
			)
	}

	return local.components.length
}

/**
 * Push the schema. A push only ever creates and updates what the schema defines. `delete` also
 * removes the space's components in the schema's scope that it no longer defines, so it needs a
 * scope: unscoped, every component another schema in the space defines would count as stale.
 */
export async function push_schema(
	options: Options & { dry_run?: boolean; delete?: boolean } = {},
	run: Runner = (args, opts) =>
		run_cli(args, opts, (code, signal) => `Schema push failed (${signal ?? code}).`),
	request = fetch
) {
	const { space, env } = remote(options)
	const { root, local } = await load(options)
	if (options.delete && !local.scope)
		throw new Error(
			"push --delete needs the schema's scope: export `scope`, the folders it owns, from the entry. Without one it would delete every component another schema in the space defines."
		)
	const flat = await write_flat(root, local)
	const args = [`storyblok@${cli_version}`, "schema", "push", flat, "--space", space]
	if (options.dry_run) args.push("--dry-run")
	if (options.region) args.push("--region", options.region)
	if (!local.scope) {
		await run(args, { cwd: root, env })
		return local.components.length
	}

	const api = await management(space, env, options.region, request)
	const output = await run(args, { cwd: root, env, capture: true })
	const held = await api.read()
	const names = own(local)
	report(output, local, held)

	if (options.delete) {
		const { components } = folders(held)
		const tag = owner_tag(local.scope)
		const leftover = held.components.filter(
			(c) => !names.components.includes(c.name) && in_scope(components.get(c.name), local.scope!)
		)
		// only what this schema pushed: a component moved into the folders by hand has no owner tag
		const pushed = (c: (typeof leftover)[number]) =>
			(c.internal_tags_list ?? []).some(({ name }) => name === tag)
		const stale = leftover.filter(pushed)
		for (const c of leftover.filter((c) => !pushed(c)))
			console.log(
				`Left ${c.name}: it's in ${local.scope.join(", ")}, but this schema didn't push it`
			)

		if (stale.length && !options.dry_run && !(await confirm(stale.map((c) => c.name))))
			return local.components.length
		for (const component of stale) {
			if (!options.dry_run) await api.delete(component.id)
			console.log(`${options.dry_run ? "Would delete" : "Deleted"} ${component.name}`)
		}
	}
	return local.components.length
}

/** Asks before deleting, at a terminal; a script that passed `--delete` has said so already */
async function confirm(names: Array<string>) {
	if (!process.stdin.isTTY) return true
	const prompt = createInterface({ input: process.stdin, output: process.stdout })
	const answer = await prompt.question(`Delete ${names.join(", ")}? (y/N) `)
	prompt.close()
	return /^y(es)?$/i.test(answer.trim())
}

function run_diff(
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; capture?: boolean }
): Promise<string> {
	return run_cli(args, options, (code, signal) =>
		code === 1
			? "Schema differs from the space. Review the diff above."
			: `Schema comparison failed (${signal ?? code}).`
	)
}
