import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { default_entry } from "./entry.js"
import { run_cli } from "./run.js"

export const cli_version = "4.25.0"

interface Options {
	root?: string
	entry?: string
	out_dir?: string
	space: string
	region?: string
	env?: NodeJS.ProcessEnv
}

type Runner = (args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<void>

const run: Runner = (args, options) =>
	run_cli(
		args,
		options,
		(code, signal) =>
			`Storyblok schema export failed (${signal ?? code}). No schema files were installed.`
	)

async function require_absent(file: string) {
	try {
		await lstat(file)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return
		throw error
	}
	throw new Error(`Refusing to overwrite ${file}. Choose a different --entry or --out-dir.`)
}

/** Only module specifiers change; upstream helper names and user-authored values stay intact. */
export function storyloco_imports(source: string) {
	return source.replace(
		/^(import[^\n]*|} )([^\n]*?from\s+)(["'])@storyblok\/schema(\/field-plugins)?\3/gm,
		(_match, start, from, quote, plugins) =>
			`${start}${from}${quote}storyloco/schema${plugins ?? ""}${quote}`
	)
}

const known_plugins: Record<string, string> = {
	"loco-link-field": 'import("storyloco/link").Link',
	"mux-video": 'import("storyloco/mux").Video',
	"video-mux": 'import("storyloco/mux").Video',
	"uiloco-currency": 'import("storyloco/currency").Currency',
	"uiloco-input": 'import("storyloco/input").Input',
	"heading-field": 'import("storyloco/heading").Heading',
	"uiloco-heading": 'import("storyloco/heading").Heading',
	"mux-field": 'import("storyloco/mux").Video',
	"loco-mux": 'import("storyloco/mux").Video',
	"uiloco-mux": 'import("storyloco/mux").Video',
	"loco-link": 'import("storyloco/link").Link',
	"link-field": 'import("storyloco/link").Link',
	"uiloco-link": 'import("storyloco/link").Link',
	"loco-input": 'import("storyloco/input").Input',
	"loco-time": "string",
	"loco-currency": 'import("storyloco/currency").Currency',
	"loco-asset": 'import("storyloco/asset").Asset',
	"loco-dates": 'import("storyloco/dates").Dates',
}

export function infer_known_plugin(source: string) {
	const field_type = source.match(/fieldType: ['"]([^'"]+)['"]/)?.[1]
	const type = field_type && known_plugins[field_type]
	return type
		? source
				.replace("({ value })", `({ value: value as ${type} })`)
				.replace(
					"version: 1,",
					`version: 1,\n      types: undefined as unknown as { input: unknown; output: ${type} },`
				)
		: source
}

async function update_imports(directory: string): Promise<void> {
	for (const item of await readdir(directory, { withFileTypes: true })) {
		const file = path.join(directory, item.name)
		if (item.isDirectory()) await update_imports(file)
		else if (item.isFile() && item.name.endsWith(".ts")) {
			await writeFile(file, infer_known_plugin(storyloco_imports(await readFile(file, "utf8"))))
		}
	}
}

/** Export into staging first, so failed exports never become the default schema. */
export async function migrate(options: Options, runner: Runner = run) {
	const root = path.resolve(options.root ?? process.cwd())
	const entry = path.resolve(root, options.entry ?? default_entry)
	if (!entry.endsWith(".ts")) throw new Error("--entry must be a TypeScript (.ts) file")
	if (!/^\d+$/.test(options.space)) throw new Error("--space must be a numeric Storyblok space ID")

	const out_dir = path.resolve(root, options.out_dir ?? entry.slice(0, -3))

	const relative_entry = path.relative(out_dir, entry)
	if (
		!relative_entry.startsWith(`..${path.sep}`) &&
		relative_entry !== ".." &&
		!path.isAbsolute(relative_entry)
	) {
		throw new Error("--entry must be outside --out-dir")
	}

	await require_absent(entry)
	await require_absent(out_dir)
	await mkdir(path.dirname(out_dir), { recursive: true })
	const staging = await mkdtemp(path.join(path.dirname(out_dir), ".storyloco-schema-"))

	let installed = false

	try {
		const env = { ...process.env, ...options.env }
		const token = env.STORYBLOK_PERSONAL_ACCESS_TOKEN || env.STORYBLOK_TOKEN
		if (token) {
			env.STORYBLOK_TOKEN = token
			env.STORYBLOK_LOGIN ||= "storyloco"
			env.STORYBLOK_REGION = options.region ?? env.STORYBLOK_REGION ?? "eu"
		}

		const args = [
			`storyblok@${cli_version}`,
			"schema",
			"init",
			"--space",
			options.space,
			"--out-dir",
			staging,
		]
		if (options.region) args.push("--region", options.region)

		await runner(args, { cwd: root, env })

		// Some CLI failures return successfully but don't produce an entry.
		await readFile(path.join(staging, "schema.ts"), "utf8")
		await update_imports(staging)
		await mkdir(path.dirname(entry), { recursive: true })
		await require_absent(entry)
		await mkdir(out_dir) // Exclusive: another migration cannot replace this directory.
		installed = true
		// Copy children into the directory we reserved. Node rejects copying the staging
		// directory itself with errorOnExist, even when the destination is empty.
		for (const name of await readdir(staging)) {
			await cp(path.join(staging, name), path.join(out_dir, name), {
				recursive: true,
				force: false,
				errorOnExist: true,
			})
		}

		const specifier =
			"./" +
			path.relative(path.dirname(entry), path.join(out_dir, "schema.js")).split(path.sep).join("/")
		await writeFile(
			entry,
			`// Exported from Storyblok. Review the schema before pushing changes.\nexport * from ${JSON.stringify(specifier)}\n`,
			{ flag: "wx" }
		)

		return { entry, out_dir }
	} catch (error) {
		if (installed) await rm(out_dir, { recursive: true, force: true })
		throw error
	} finally {
		await rm(staging, { recursive: true, force: true })
	}
}
