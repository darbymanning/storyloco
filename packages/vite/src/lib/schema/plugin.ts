import { type AliasOptions, type Plugin, type FSWatcher, type ViteDevServer, loadEnv } from "vite"
import { writeFile, readFile, mkdir, chmod, rename } from "node:fs/promises"
import path from "node:path"
import { Logger } from "../shared/logger.js"
import { load_local } from "./local.js"
import { resolve_entry } from "./entry.js"
import { generate_types } from "./generate.js"
import { strip_schema } from "./strip.js"

const name = "vite-storyblok-schema"
const logger = new Logger(name)

/**
 * Formats generated code as a nicety, not a necessity. Prefers oxfmt if it's
 * installed, falls back to prettier if that happens to be around, and otherwise
 * leaves the code untouched. Never throws — formatting is entirely optional and
 * these tools are intentionally not hard dependencies.
 */
async function format_code(filename: string, content: string): Promise<string> {
	try {
		const oxfmt = await import("oxfmt")
		const { code } = await oxfmt.format(filename, content)
		return code
	} catch {
		/* oxfmt not available — try the next option */
	}

	try {
		const specifier = "prettier"
		const prettier = await import(specifier)
		return await prettier.format(content, { filepath: filename })
	} catch {
		/* prettier not available either — leave the code as-is */
	}

	return content
}

interface Options {
	storyblok_personal_access_token?: string
	storyblok_space_id?: string
	output_path?: string
	interval_ms?: number
	filename?: string
	/**
	 * A schema defined in code with `@storyblok/schema`: the file exporting the `defineSchema`
	 * result, as `schema` or as its default. The types then come from it rather than the space,
	 * so no token is needed and a dev server regenerates them as it changes rather than polling.
	 * Defaults to `src/schema.ts` when present. Set `false` to always read the space.
	 * Pushing it to the space stays `storyblok schema push`'s job.
	 */
	entry?: string | false
}

/**
 * @remarks
 * Vite plugin that automatically regenerates Storyblok component types at regular intervals
 *
 * @param [options] - The options for the plugin.
 * @param [options.storyblok_personal_access_token] - The personal access token for the Storyblok API. Defaults to the `STORYBLOK_PERSONAL_ACCESS_TOKEN` environment variable.
 * @param [options.storyblok_space_id] - The space ID for the Storyblok space. Defaults to the `STORYBLOK_SPACE_ID` environment variable.
 * @param [options.output_path] - The path to output the generated files to. Defaults to 'src/lib'.
 * @param [options.interval_ms] - The interval in milliseconds to regenerate the component types. Defaults to 60000 (1 minute).
 * @param [options.entry] - Schema entry relative to the Vite root. Detects 'src/schema.ts'; false always reads the space.
 * @param [options.filename] - The filename for the TypeScript definitions file. Defaults to 'components.schema.ts'.
 *
 *
 * @example Default configuration
 * ```ts title=vite.config.ts
 * import { schema } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [schema()]
 * })
 * ```
 *
 * @example Custom output path
 * ```ts title=vite.config.ts
 * import { schema } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [schema({
 *     output_path: 'src/lib/storyblok'
 *   })]
 * })
 * ```
 *
 * @example Custom filename
 * ```ts title=vite.config.ts
 * import { schema } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [schema({
 *     filename: 'storyblok-types.ts'
 *   })]
 * })
 *
 * @example Custom interval
 * ```ts title=vite.config.ts
 * import { schema } from 'storyloco/vite'
 *
 * export default defineConfig({
 *   plugins: [schema({
 *     interval_ms: 10000 // 10 seconds
 *   })]
 * })
 * ```
 *
 * @example Field plugin type definitions
 * ```ts title=vite.config.ts
 * import { schema } from 'storyloco/vite'
 *
 * export interface StoryblokCustomPlugins {
 *   "mux-video": { foo: "bar" }
 *   "heading-field": { foo: "bar" }
 * }
 *
 * export default defineConfig({
 *   plugins: [schema()]
 * })
 * ```
 *
 * @example A schema defined in code
 * ```ts title=vite.config.ts
 * export default defineConfig({
 *   plugins: [schema({ entry: 'src/schema.ts' })]
 * })
 * ```
 */
export default function schema({
	output_path,
	interval_ms,
	storyblok_personal_access_token,
	storyblok_space_id,
	filename,
	entry,
}: Options = {}): Plugin {
	let interval: ReturnType<typeof setInterval> | null = null
	let mode = "development"
	let root = process.cwd()
	let server: ViteDevServer | undefined
	let building = false
	let named = true
	let had_error = false
	let local_entry: string | undefined
	let alias: AliasOptions | undefined
	let build_run: Promise<void> | null = null
	/** What the local schema was read from, so a dev server knows what to watch: the entry until it first loads. */
	let local_files = new Set<string>()
	let watcher: FSWatcher | undefined
	let stop_watching: (() => void) | undefined

	function watch_file(file: string, watch = true) {
		const absolute = path.resolve(file)
		local_files.add(absolute)
		if (watch) watcher?.add(absolute)
	}

	/** The run under way, and whether another was asked for while it ran. */
	let running: Promise<void> | null = null
	let again = false

	// ensure output_path does not end with a slash

	const out_dir = output_path?.replace(/\/?$/, "") ?? "src/lib"
	const schema_ts_file = () => path.resolve(root, out_dir, filename ?? "components.schema.ts")

	/** The space's components: from the schema in code where there is one, from the API otherwise. */
	async function components(token: string, space_id: string) {
		if (local_entry) {
			const local = await load_local(local_entry, watch_file, alias)
			local_files = new Set([local_entry, ...local.dependencies.map((file) => path.resolve(file))])
			watcher?.add([...local_files])
			named = local.named
			return local.components
		}
		const url = `https://mapi.storyblok.com/v1/spaces/${space_id}/components`
		const response = await fetch(url, { headers: new Headers({ Authorization: token }) })
		if (!response.ok) throw new Error(`Storyblok components request failed: ${response.status}`)
		return (await response.json()).components
	}

	async function generate(): Promise<void> {
		const env = loadEnv(mode, root, "")
		const token = storyblok_personal_access_token ?? env.STORYBLOK_PERSONAL_ACCESS_TOKEN
		const space_id = storyblok_space_id ?? env.STORYBLOK_SPACE_ID
		if (!local_entry && (!token || !space_id)) {
			logger.warn(
				"STORYBLOK_PERSONAL_ACCESS_TOKEN and STORYBLOK_SPACE_ID are required to generate remote component types"
			)
			return
		}

		try {
			const models = await components(token, space_id)
			const output = schema_ts_file()
			const content = await format_code(
				path.basename(output),
				generate_types(models, output, root, local_entry, named)
			)

			const previous = await readFile(output, "utf8").catch(() => "")
			if (content !== previous) {
				await mkdir(path.dirname(output), { recursive: true })
				await chmod(output, 0o644).catch(() => {})
				await writeFile(`${output}.tmp`, content)
				await rename(`${output}.tmp`, output)
				await chmod(output, 0o444)
				logger.succeed(`Storyblok component types generated to ${output}`)
			}

			if (had_error) server?.ws.send({ type: "full-reload" })
			had_error = false
		} catch (error) {
			had_error = true
			if (building) throw error
			const err = error instanceof Error ? error : new Error(String(error))
			logger.fail(err.message)
			const detail = err as Error & {
				id?: string
				loc?: { file?: string; line: number; column: number }
				frame?: string
			}

			server?.ws.send({
				type: "error",
				err: {
					message: err.message,
					stack: err.stack ?? "",
					plugin: name,
					id: detail.id ?? local_entry,
					loc: detail.loc,
					frame: detail.frame,
				},
			})
		}
	}

	/**
	 * `generate`, one run at a time: a run writes and locks the same files, and takes seconds,
	 * so asking while one is under way queues a single run after it rather than racing it.
	 */
	function regenerate(): Promise<void> {
		if (running) {
			again = true
			return running
		}
		running = generate().finally(() => {
			running = null
			if (again) {
				again = false
				void regenerate()
			}
		})
		return running
	}

	return {
		name,
		async configResolved(config) {
			mode = config.mode
			root = config.root
			alias = config.resolve.alias
			building = config.command === "build"
			local_entry = await resolve_entry(config.root, entry)
			local_files = new Set(local_entry ? [local_entry] : [])
		},
		/**
		 * Types are needed by anything that type-checks a build — CI especially, where
		 * the generated file is gitignored and no dev server ever runs. Vite builds each
		 * environment separately, so this hook fires more than once; generate once and
		 * let the later calls await the same run.
		 */
		async buildStart() {
			build_run ??= regenerate()
			await build_run
		},
		async configureServer(dev_server) {
			server = dev_server
			mode = server.config.mode

			// A schema in code changes when its files do, so it's watched rather than polled
			if (local_entry) {
				watcher = server.watcher
				watcher.add([...local_files])
				let pending: ReturnType<typeof setTimeout> | undefined
				// `add` too: an editor that saves by renaming a new file over the old one reports that
				const on_change = (event: string, file: string) => {
					if (event !== "change" && event !== "add" && event !== "unlink") return
					// A block file added or removed may be one the entry globs, which no import names yet
					const block_file = event !== "change" && file.endsWith(".svelte")
					if (!block_file && !local_files.has(path.resolve(file))) return
					clearTimeout(pending)
					pending = setTimeout(regenerate, 100)
				}
				watcher.on("all", on_change)
				stop_watching = () => {
					clearTimeout(pending)
					dev_server.watcher.off("all", on_change)
					watcher = undefined
				}
				await regenerate()
				logger.info(`Regenerating Storyblok component types as ${local_entry} changes`)
				return
			}

			interval_ms = interval_ms ?? 60000 // 1 minute

			const seconds = interval_ms / 1000
			logger.info(
				`Regenerating Storyblok component types every ${seconds} ${seconds === 1 ? "second" : "seconds"}`
			)

			await regenerate()

			interval = setInterval(regenerate, interval_ms)
		},
		/**
		 * A block component's schema is for the schema entry alone, which reads module scripts
		 * through its own loader (as `?schema&lang.ts`). In the app it's taken out before Svelte
		 * compiles the component, so `@storyblok/schema` never reaches the bundle.
		 */
		transform: {
			order: "pre",
			async handler(code, id) {
				if (!id.endsWith(".svelte") || id.includes("/node_modules/")) return null
				const stripped = await strip_schema(code)
				// positions are unchanged, so the map is the identity
				return stripped === null ? null : { code: stripped, map: null }
			},
		},
		closeBundle() {
			stop_watching?.()
			if (interval) clearInterval(interval)
		},
	}
}
