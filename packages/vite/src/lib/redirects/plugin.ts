import { type Plugin, loadEnv } from "vite"
import { writeFile, readFile, access, constants } from "node:fs/promises"
import path from "node:path"
import { Logger } from "../shared/logger.js"
import * as prettier from "prettier"

const name = "vite-storyblok-redirects"
const logger = new Logger(name)

interface RedirectEntry {
	id: number
	name: string
	value: string
	dimension_value: string | null
}

interface Options {
	datasource?: string
	public_storyblok_access_token?: string
}

async function get_redirects(
	datasource: string = "redirects",
	public_storyblok_access_token?: string
) {
	const env_token = loadEnv("", "", "").PUBLIC_STORYBLOK_ACCESS_TOKEN
	const token = public_storyblok_access_token ?? env_token

	const per_page = 100
	let page = 1
	const all_entries: Array<RedirectEntry> = []
	const cache_version = Date.now().toString()
	let total: number | null = null

	while (true) {
		const url = new URL("https://api.storyblok.com/v2/cdn/datasource_entries")
		url.searchParams.set("datasource", datasource)
		url.searchParams.set("token", token)
		url.searchParams.set("cv", cache_version)
		url.searchParams.set("per_page", String(per_page))
		url.searchParams.set("page", String(page))

		const request = await fetch(url)

		if (request.status === 404) {
			return { datasource_entries: [] as Array<RedirectEntry> }
		}

		// capture total from headers once
		if (total === null) {
			const total_header = request.headers.get("total")
			total = total_header ? Number(total_header) : null
		}

		const { datasource_entries } = (await request.json()) as {
			datasource_entries: Array<RedirectEntry>
		}

		all_entries.push(...(datasource_entries ?? []))

		// stop conditions:
		// - if we know total, stop when we've collected that many
		// - otherwise, stop when a page returns fewer than per_page
		if (
			(total !== null && all_entries.length >= total) ||
			!datasource_entries ||
			datasource_entries.length < per_page
		) {
			break
		}

		page += 1
	}

	return { datasource_entries: all_entries }
}

/**
 * @remarks
 * Vite plugin that automatically generates TypeScript redirects from Storyblok datasource entries
 *
 * @param [options] - The options for the plugin.
 * @param [options.datasource] - The Storyblok datasource name to fetch redirects from. Defaults to 'redirects'.
 * @param [options.public_storyblok_access_token] - The public access token for the Storyblok API. Defaults to the `PUBLIC_STORYBLOK_ACCESS_TOKEN` environment variable.
 *
 * @example Default configuration
 * ```ts title=vite.config.ts
 * import { redirects } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [redirects()]
 * })
 * ```
 *
 * @example Custom datasource
 * ```ts title=vite.config.ts
 * import { redirects } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [redirects({
 *     datasource: 'my-redirects'
 *   })]
 * })
 * ```
 *
 * @example Custom token
 * ```ts title=vite.config.ts
 * import { redirects } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [redirects({
 *     public_storyblok_access_token: 'your-token-here'
 *   })]
 * })
 * ```
 *
 * @example Complete configuration
 * ```ts title=vite.config.ts
 * import { redirects } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [redirects({
 *     datasource: 'custom-redirects',
 *     public_storyblok_access_token: 'your-token-here'
 *   })]
 * })
 * ```
 */
export default function redirects({
	datasource = "redirects",
	public_storyblok_access_token,
}: Options = {}): Plugin {
	return {
		name,
		async configureServer() {
			let last_written = ""

			function normalize_content(content: string): string {
				const without_header = content.replace(/^\/\*\*[\s\S]*?\*\/\n+/, "")
				return without_header.replace(/\r\n/g, "\n").trim()
			}

			const run = async () => {
				try {
					const { datasource_entries } = await get_redirects(
						datasource,
						public_storyblok_access_token
					)
					const ts_content = generate_ts_file(datasource_entries)
					const output = path.resolve(".svelte-kit", "storyblok", "redirects.build.ts")
					const prettier_config = await prettier.resolveConfig(output)
					const formatted = await prettier.format(ts_content, {
						...(prettier_config ?? {}),
						filepath: output,
					})

					const current_norm = normalize_content(formatted)
					if (current_norm !== last_written) {
						logger.start("Generating redirects")
						await writeFile(output, formatted)
						last_written = current_norm
						logger.succeed("Redirects TS generated")
					}
				} catch (err) {
					const message =
						err instanceof Error && typeof err.message === "string" ? err.message : "Unknown error"
					logger.fail(`Error generating redirects: ${message}`)
				}
			}

			await run()
		},
		async buildStart() {
			function normalize_content(content: string): string {
				const without_header = content.replace(/^\/\*\*[\s\S]*?\*\/\n+/, "")
				return without_header.replace(/\r\n/g, "\n").trim()
			}

			try {
				const { datasource_entries } = await get_redirects(
					datasource,
					public_storyblok_access_token
				)
				const ts_content = generate_ts_file(datasource_entries)
				const output = path.resolve(".svelte-kit", "storyblok", "redirects.build.ts")
				const prettier_config = await prettier.resolveConfig(output)
				const formatted = await prettier.format(ts_content, {
					...(prettier_config ?? {}),
					filepath: output,
				})

				let previous = ""
				try {
					await access(output, constants.F_OK)
					previous = await readFile(output, "utf8")
				} catch {
					// file doesn't exist, that's fine
				}

				const previous_norm = normalize_content(previous)
				const current_norm = normalize_content(formatted)
				if (previous_norm !== current_norm) {
					logger.start("Generating redirects")
					await writeFile(output, formatted)
					logger.succeed("Redirects TS generated")
				}
			} catch (err) {
				const message =
					err instanceof Error && typeof err.message === "string" ? err.message : "Unknown error"
				logger.fail(`Error generating redirects: ${message}`)
			}
		},
		closeBundle() {},
	}
}

function generate_ts_file(entries: Array<RedirectEntry>): string {
	const map_entries = entries
		.filter((e) => Boolean(e?.name) && Boolean(e?.value))
		.map((e) => `\t[${JSON.stringify(e.name)}, ${JSON.stringify(e.value)}]`)
		.join(",\n")

	return `/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 * Generated by ${name} plugin on ${new Date().toISOString()}.
 * Any changes will be overwritten.
 */

/**
 * Redirects map
 *
 * Maps a source pathname pattern to a target pathname template.
 *
 * - key: source pattern (supports '*' as a single-segment wildcard)
 * - value: target template (each '*' is replaced by the corresponding capture)
 *
 * Notes:
 * - Keys may be provided without a leading slash (e.g. foo == /foo).
 * - Self-redirects (target resolves to the same pathname) are ignored.
 */
export const redirects_map: Map<string, string> = new Map([
${map_entries}
])
`
}
