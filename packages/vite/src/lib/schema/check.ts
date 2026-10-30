import path from "node:path"
import { load_local } from "./local.js"
import { resolve_entry } from "./entry.js"
import { cli_version } from "./migrate.js"
import { run_cli } from "./run.js"

export async function check_schema(
	options: {
		entry?: string
		root?: string
		remote?: boolean
		space?: string
		region?: string
		env?: NodeJS.ProcessEnv
	} = {},
	run = run_diff
) {
	const root = path.resolve(options.root ?? process.cwd())
	const entry = await resolve_entry(root, options.entry)
	if (!entry) throw new Error("No schema found at src/schema.ts. Pass --entry <file>.")

	const local = await load_local(entry)

	if (options.remote) {
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

		const args = [
			`storyblok@${cli_version}`,
			"schema",
			"diff",
			"--from",
			space,
			"--to",
			entry,
			"--exit-code",
		]
		if (options.region) args.push("--region", options.region)
		await run(args, { cwd: root, env })
	}

	return local.components.length
}

function run_diff(args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
	return run_cli(args, options, (code, signal) =>
		code === 1
			? "Schema differs from the space. Review the diff above."
			: `Schema comparison failed (${signal ?? code}).`
	)
}
