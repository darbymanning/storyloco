import { type Plugin, loadEnv } from "vite"
import { writeFile, readFile, access, constants, mkdir } from "node:fs/promises"
import path from "node:path"
import { $ } from "../shared/shell.js"
import exec from "../shared/x.js"
import { Logger } from "../shared/logger.js"

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
 * @param [options.filename] - The filename for the TypeScript definitions file. Defaults to 'components.schema.ts'.
 *
 *
 * @example Default configuration
 * ```ts title=vite.config.ts
 * import { schema } from 'kitto/vite'
 *
 * export default defineConfig({
 *   plugins: [schema()]
 * })
 * ```
 *
 * @example Custom output path
 * ```ts title=vite.config.ts
 * import { schema } from 'kitto/vite'
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
 * import { schema } from 'kitto/vite'
 *
 * export default defineConfig({
 *   plugins: [schema({
 *     filename: 'storyblok-types.ts'
 *   })]
 * })
 *
 * @example Custom interval
 * ```ts title=vite.config.ts
 * import { schema } from 'kitto/vite'
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
 * import { schema } from 'kitto/vite'
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
 */
export default function schema({
	output_path,
	interval_ms,
	storyblok_personal_access_token,
	storyblok_space_id,
	filename,
}: Options = {}): Plugin {
	let interval: ReturnType<typeof setInterval> | null = null
	let mode = "development"
	let build_run: Promise<void> | null = null

	// ensure output_path does not end with a slash
	const out_dir = output_path?.replace(/\/?$/, "") ?? "src/lib"
	const schema_ts_file = path.join(out_dir, filename ?? "components.schema.ts")

	async function generate(): Promise<void> {
		const env = loadEnv(mode, process.cwd(), "")
		const token = storyblok_personal_access_token ?? env.STORYBLOK_PERSONAL_ACCESS_TOKEN
		const space_id = storyblok_space_id ?? env.STORYBLOK_SPACE_ID

		// Skip rather than throw: plenty of builds (CI without secrets, contributors
		// without Storyblok access) have no business failing over generated types.
		if (!token || !space_id) {
			logger.warn(
				"STORYBLOK_PERSONAL_ACCESS_TOKEN and STORYBLOK_SPACE_ID are both required to generate component types — skipping"
			)
			return
		}

		const x = await exec()

		const components_file = path.join(
			".svelte-kit/storyblok/components",
			space_id,
			"components.json"
		)

		try {
			// Check if components file exists
			let existing_components = ""

			try {
				await access(components_file, constants.F_OK)
				existing_components = await readFile(components_file, "utf-8")
			} catch {
				// No existing file, that's fine
			}

			// Fetch the new components
			const url = `https://mapi.storyblok.com/v1/spaces/${space_id}/components`
			const headers = new Headers({ Authorization: token })
			const response = await fetch(url, { headers })
			const { components: new_components } = await response.json()

			// Make the file writable
			await $`chmod u+w ${components_file}`.quiet().nothrow()

			// Nothing to do only if the schema is unchanged *and* the output is still there —
			// checking the cache alone means a deleted output file never comes back.
			const output_exists = await access(schema_ts_file, constants.F_OK).then(
				() => true,
				() => false
			)

			if (
				output_exists &&
				existing_components &&
				JSON.stringify(JSON.parse(existing_components)) === JSON.stringify(new_components)
			)
				return

			// Create the components directory if it doesn't exist
			await mkdir(path.dirname(components_file), { recursive: true })

			// Write the data to the components file
			await writeFile(components_file, JSON.stringify(new_components, null, 2))

			const here = (str: string) =>
				process.env.SCHEMA_DEV
					? path.join("src/lib/schema", str)
					: path.join("node_modules/storyloco/packages/vite/dist/schema", str)

			// Generate types
			logger.start("Generating TypeScript definitions...")
			await $`chmod u+w ${schema_ts_file}`.quiet().nothrow()
			await $`${x} storyblok@4.6.6 ts generate -s ${space_id} -p .svelte-kit/storyblok --compiler-options ${here("compiler_options.js")} --custom-fields-parser ${here("custom_fields_parser.js")} --strict`.quiet()

			logger.succeed("TypeScript definitions generated.")

			// Get generated files
			let component_types: string
			let general: string

			try {
				component_types = await readFile(
					`.svelte-kit/storyblok/types/${space_id}/storyblok-components.d.ts`,
					"utf-8"
				)
			} catch {
				logger.warn("Component types file not found, skipping type generation")
				return
			}

			try {
				general = await readFile(".svelte-kit/storyblok/types/storyblok.d.ts", "utf-8")
			} catch {
				logger.warn("General types file not found, skipping type generation")
				return
			}
			const general_replaced = general.replace(
				`// This file was generated by the Storyblok CLI.
// DO NOT MODIFY THIS FILE BY HAND.
import type { ISbStoryData } from '@storyblok/js';`,
				""
			)

			// determine how many folders are in output_path
			const output_path_parts = out_dir.split("/")
			const import_path = output_path_parts.map(() => `..`).join("/")

			// Replicates the storyblok CLI's `getComponentType` (no prefix/suffix), so these
			// entries reference the interface names it generates below.
			const type_name = (component: string) => {
				const sanitized = component
					.replace(/[^a-z0-9]/gi, "_")
					.replace(/_+/g, "_")
					.replace(/^_+|_+$/g, "")
				const camel = sanitized
					.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
					.replace(/_/g, "")
				const pascal = camel ? camel[0].toUpperCase() + camel.slice(1) : camel
				return /^\d/.test(pascal) ? `_${pascal}` : pascal
			}

			const content_types: Array<string> = new_components
				.filter((component: { is_root?: boolean }) => component.is_root)
				.map((component: { name: string }) => component.name)
				.sort()

			const header = `
			               /**
			                * AUTO-GENERATED FILE. DO NOT EDIT.
			                * Generated by ${name} plugin on ${new Date().toISOString()}.
			                * Any changes will be overwritten.
			                */

			               import type { StoryblokCustomPlugins } from "${import_path}/vite.config.js"

			               /**
			                * No \`SbBlokData\` intersection: its string index signature would reject the
			                * generated interfaces, which (deliberately) declare no index signature.
			                */
			               export type Blok<T> = T & { component?: string; _uid?: string; _editable?: string }

			               /**
			                * Content-type (root) components keyed by component name — the bloks a story
			                * can be. The CLI types every component identically, so this comes from the
			                * space's component list instead.
			                */
			               export interface ContentTypes {
			               ${content_types.map((name) => `"${name}": ${type_name(name)}`).join("\n")}
			               }

			               export type ContentType = ContentTypes[keyof ContentTypes]

			               /** Lets storyloco type reads by \`content_type\` without a type argument. */
			               declare module "storyloco" {
			                 interface Registry extends ContentTypes {}
			               }
			             `

			let content = component_types.replace(
				`// This file was generated by the storyblok CLI.
// DO NOT MODIFY THIS FILE BY HAND.`,
				header
			)

			content = content.replace(/^.*\sfrom\s+'\.{2}\/storyblok\.d\.ts';\s*$/gm, "")

			content = content + general_replaced
			content = content.replace(/\["StoryblokCustomPlugins/g, 'StoryblokCustomPlugins["')

			// Try and use unknown instead of any
			content = content.replace(/Record<string, any>/g, "Record<string, unknown>")
			content = content.replace(/any\[]/g, "unknown[]")

			// Make _uid and component optional (helps us reuse Storyblok types for non-storyblok components)
			content = content.replace(/^([a-zA-Z0-9_]+):/gm, "$1?:")

			const formatted = await format_code(path.basename(schema_ts_file), content)

			// Write the final file
			logger.start("Finalising schema file...")
			await writeFile(schema_ts_file, formatted)

			// Lock the file
			await $`chmod a-w ${schema_ts_file}`.quiet()
			logger.succeed(
				`Storyblok component types generated successfully to ${Logger.color.magenta(schema_ts_file)}`
			)
		} catch (err) {
			const message = err instanceof Error ? err.message : "An unknown error occurred."
			logger.fail(message)
		}
	}

	return {
		name,
		configResolved(config) {
			mode = config.mode
		},
		/**
		 * Types are needed by anything that type-checks a build — CI especially, where
		 * the generated file is gitignored and no dev server ever runs. Vite builds each
		 * environment separately, so this hook fires more than once; generate once and
		 * let the later calls await the same run.
		 */
		async buildStart() {
			build_run ??= generate()
			await build_run
		},
		async configureServer(server) {
			mode = server.config.mode
			interval_ms = interval_ms ?? 60000 // 1 minute

			const seconds = interval_ms / 1000
			logger.info(
				`Regenerating Storyblok component types every ${seconds} ${seconds === 1 ? "second" : "seconds"}`
			)

			await generate()

			interval = setInterval(generate, interval_ms)
		},
		closeBundle() {
			if (interval) clearInterval(interval)
		},
	}
}
