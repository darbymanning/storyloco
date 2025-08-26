import { type Plugin, loadEnv } from "vite"
import { writeFile, readFile, access, constants, mkdir } from "node:fs/promises"
import path from "node:path"
import { $ } from "./shell.js"
import exec from "./x.js"
import ora from "ora"
import chalk from "chalk"
import * as prettier from "prettier"

const name = "vite-storyblok-schema"

const logger = ora({
	prefixText: chalk.yellow(`[${name}]`),
})

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
 * import { storyblok_schema } from 'kitto/vite'
 *
 * export default defineConfig({
 *   plugins: [storyblok_schema()]
 * })
 * ```
 *
 * @example Custom output path
 * ```ts title=vite.config.ts
 * import { storyblok_schema } from 'kitto/vite'
 *
 * export default defineConfig({
 *   plugins: [storyblok_schema({
 *     output_path: 'src/lib/storyblok'
 *   })]
 * })
 * ```
 *
 * @example Custom filename
 * ```ts title=vite.config.ts
 * import { storyblok_schema } from 'kitto/vite'
 *
 * export default defineConfig({
 *   plugins: [storyblok_schema({
 *     filename: 'storyblok-types.ts'
 *   })]
 * })
 *
 * @example Custom interval
 * ```ts title=vite.config.ts
 * import { storyblok_schema } from 'kitto/vite'
 *
 * export default defineConfig({
 *   plugins: [storyblok_schema({
 *     interval_ms: 10000 // 10 seconds
 *   })]
 * })
 * ```
 *
 * @example Field plugin type definitions
 * ```ts title=vite.config.ts
 * import { storyblok_schema } from 'kitto/vite'
 *
 * export interface StoryblokCustomPlugins {
 *   "mux-video": { foo: "bar" }
 *   "heading-field": { foo: "bar" }
 * }
 *
 * export default defineConfig({
 *   plugins: [storyblok_schema()]
 * })
 * ```
 */
export default function storyblok_schema({
	output_path,
	interval_ms,
	storyblok_personal_access_token,
	storyblok_space_id,
	filename,
}: Options = {}): Plugin {
	let interval: ReturnType<typeof setInterval> | null = null

	return {
		name,
		async configureServer(server) {
			const env = loadEnv(server.config.mode, process.cwd(), "")
			const x = await exec()

			interval_ms = interval_ms ?? 60000 // 1 minute

			// ensure output_path does not end with a slash
			output_path = output_path?.replace(/\/?$/, "") ?? "src/lib"
			storyblok_personal_access_token =
				storyblok_personal_access_token ?? env.STORYBLOK_PERSONAL_ACCESS_TOKEN
			storyblok_space_id = storyblok_space_id ?? env.STORYBLOK_SPACE_ID

			const components_file = path.join(
				".svelte-kit/storyblok/components",
				storyblok_space_id,
				"components.json"
			)

			const schema_ts_file = path.join(output_path, filename ?? "components.schema.ts")

			const seconds = interval_ms / 1000
			logger.info(
				`Regenerating Storyblok component types every ${seconds} ${seconds === 1 ? "second" : "seconds"}`
			)

			generate()

			interval = setInterval(generate, interval_ms)

			async function generate() {
				if (!storyblok_personal_access_token)
					throw new Error("Storyblok personal access token is required")
				if (!storyblok_space_id) throw new Error("Storyblok space ID is required")

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
					const url = `https://mapi.storyblok.com/v1/spaces/${storyblok_space_id}/components`
					const headers = new Headers({ Authorization: storyblok_personal_access_token })
					const response = await fetch(url, { headers })
					const { components: new_components } = await response.json()

					// Make the file writable
					await $`chmod u+w ${components_file}`.quiet().nothrow()

					// Compare existing and new components
					if (
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
							? path.join("src/lib", str)
							: path.join("node_modules/storyloco/packages/vite/dist", str)

					// Generate types
					logger.start("Generating TypeScript definitions...")
					await $`chmod u+w ${schema_ts_file}`.quiet().nothrow()
					await $`${x} storyblok@4.2.0 ts generate -s ${storyblok_space_id} -p .svelte-kit/storyblok --compiler-options ${here("compiler_options.js")} --custom-fields-parser ${here("custom_fields_parser.js")} --strict`.quiet()

					logger.succeed("TypeScript definitions generated.")

					// Get generated files
					const component_types = await readFile(
						`.svelte-kit/storyblok/types/${storyblok_space_id}/storyblok-components.d.ts`,
						"utf-8"
					)

					const general = await readFile(".svelte-kit/storyblok/types/storyblok.d.ts", "utf-8")
					const general_replaced = general.replace(
						`// This file was generated by the Storyblok CLI.
// DO NOT MODIFY THIS FILE BY HAND.
import type { ISbStoryData } from '@storyblok/js';`,
						""
					)

					// determine how many folders are in output_path
					const output_path_parts = output_path?.split("/") ?? []
					const import_path = output_path_parts.map(() => `..`).join("/")

					const header = `
					               /**
					                * AUTO-GENERATED FILE. DO NOT EDIT.
					                * Generated by ${name} plugin on ${new Date().toISOString()}.
					                * Any changes will be overwritten.
					                */

					               import type { StoryblokCustomPlugins } from "${import_path}/vite.config.js"
					               import type { SbBlokData } from "@storyblok/svelte"

					               export type Blok<T> = SbBlokData & T
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

					const formatted = await prettier.format(content, { parser: "typescript" })

					// Write the final file
					logger.start("Finalising schema file...")
					await writeFile(schema_ts_file, formatted)

					// Lock the file
					await $`chmod a-w ${schema_ts_file}`.quiet()
					logger.succeed(
						`Storyblok component types generated successfully to ${chalk.magenta(schema_ts_file)}`
					)
				} catch (err) {
					const message = err instanceof Error ? err.message : "An unknown error occurred."
					logger.fail(message)
				}
			}
		},
		closeBundle() {
			if (interval) clearInterval(interval)
		},
	}
}
