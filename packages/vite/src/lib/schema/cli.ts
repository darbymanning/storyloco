import { readFile } from "node:fs/promises"
import path from "node:path"
import { parseArgs, parseEnv } from "node:util"
import { migrate } from "./migrate.js"
import { check_schema } from "./check.js"

const help = `Usage: storyloco schema <migrate|check> [options]

check validates the local schema offline; check --remote also fails on space drift.

Export a Storyblok space's GUI models into schema files. Does not change the space.

  --space <id>       Defaults to STORYBLOK_SPACE_ID
  --entry <file>     Defaults to src/schema.ts (auto-detected by schema())
  --out-dir <dir>    Defaults to the entry path without .ts
  --region <region> Storyblok region (defaults to eu when using an environment token)
  --help            Show this help

Reads .env, .env.local, then the shell environment. Use STORYBLOK_PERSONAL_ACCESS_TOKEN
or an existing Storyblok CLI login. Existing schema files are never overwritten.
The first run downloads the pinned Storyblok CLI through npx.`

export async function main(args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			remote: { type: "boolean" },
			space: { type: "string" },
			entry: { type: "string" },
			"out-dir": { type: "string" },
			region: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	})
	if (values.help || args.length === 0) {
		console.log(help)
		return
	}
	if (!["schema migrate", "schema check"].includes(positionals.join(" "))) throw new Error(help)
	const env: NodeJS.ProcessEnv = {}
	for (const file of [".env", ".env.local"]) {
		try {
			Object.assign(env, parseEnv(await readFile(path.resolve(file), "utf8")))
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
		}
	}
	Object.assign(env, process.env)
	if (positionals[1] === "check") {
		const count = await check_schema({
			entry: values.entry,
			remote: values.remote,
			space: values.space,
			region: values.region,
			env,
		})
		console.log(`Schema valid: ${count} blocks${values.remote ? "; space matches" : ""}.`)
		return
	}
	const space = values.space ?? env.STORYBLOK_SPACE_ID
	if (!space) throw new Error("Set STORYBLOK_SPACE_ID or pass --space <id>.")
	const result = await migrate({
		space,
		entry: values.entry,
		out_dir: values["out-dir"],
		region: values.region,
		env,
	})
	console.log(`Schema exported to ${result.entry} with supporting files in ${result.out_dir}.`)
	console.log(
		"Review the generated files, including any custom field placeholders, then restart Vite to generate types."
	)
}
