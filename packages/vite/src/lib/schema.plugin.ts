import { type Plugin, loadEnv } from "vite"
import { writeFile, readFile, access } from "node:fs/promises"
import { constants } from "node:fs"
import path from "node:path"
import { $ } from "./shell.js"
import exec from "./x.js"

const name = "vite-storyblok-schema"

function msg(text: string) {
  return `\x1b[33m[${name}]\x1b[0m ${text}`
}

function log(method: "info" | "log" | "warn" | "error", ...args: unknown[]) {
  console[method](msg(args[0] as string), ...args.slice(1))
}

const logger = {
  info: (...args: unknown[]) => log("info", ...args),
  log: (...args: unknown[]) => log("log", ...args),
  warn: (...args: unknown[]) => log("warn", ...args),
  error: (...args: unknown[]) => log("error", ...args),
}

interface Options {
  storyblok_personal_access_token?: string
  storyblok_space_id?: string
  output_path?: string
  interval_ms?: number
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
 *     output_path: 'src/lib/storyblok',
 *     interval_ms: 60000 // 1 minute
 *   })]
 * })
 * ```
 */
export default function storyblok_schema({
  output_path,
  interval_ms,
  storyblok_personal_access_token,
  storyblok_space_id,
}: Options = {}): Plugin {
  let interval: ReturnType<typeof setInterval> | null = null

  return {
    name,
    async configureServer(server) {
      const env = loadEnv(server.config.mode, process.cwd(), "")
      const x = await exec()

      interval_ms = interval_ms ?? 60000 // 1 minute

      // ensure output_path ends with a slash
      output_path = output_path?.replace(/\/?$/, "/") ?? "src/lib"
      storyblok_personal_access_token =
        storyblok_personal_access_token ?? env.STORYBLOK_PERSONAL_ACCESS_TOKEN
      storyblok_space_id = storyblok_space_id ?? env.STORYBLOK_SPACE_ID

      const components_file = path.join(output_path, "components.schema.json")
      const schema_ts_file = path.join(output_path, "components.schema.ts")

      const seconds = interval_ms / 1000
      logger.info(
        `Regenerating Storyblok component types every ${seconds} ${seconds === 1 ? "second" : "seconds"}`
      )

      generate()

      interval = setInterval(generate, interval_ms)

      async function generate() {
        try {
          // Check if components file exists
          let existing_components = ""
          try {
            await access(components_file, constants.F_OK)
            existing_components = await readFile(components_file, "utf-8")
          } catch {
            logger.info("No existing components file found.")
          }

          // Log in to Storyblok and pull components
          logger.info("Preparing to pull components...")

          await $`chmod u+w ${components_file}`.quiet().nothrow()
          await $`${x} storyblok logout`.quiet().nothrow()
          await $`${x} storyblok login --token ${storyblok_personal_access_token} --region eu`.quiet()
          await $`${x} storyblok pull-components --space=${storyblok_space_id} -p ${output_path}/ -f schema`.quiet()
          logger.info("Components pulled successfully.")

          // Read the new components file
          const new_components = await readFile(components_file, "utf-8")

          // Compare existing and new components
          if (existing_components === new_components) {
            logger.info("No changes detected in components. Skipping type generation.")
            return
          }

          // Generate types
          logger.info("Generating TypeScript definitions...")
          await $`${x} storyblok-generate-ts source=${components_file} target=${schema_ts_file} compilerOptions.additionalProperties=false compilerOptions.unknownAny=true compilerOptions.format=false`.quiet()
          logger.info("TypeScript definitions generated.")

          // Read the generated file
          const generated_content = await readFile(schema_ts_file, "utf-8")

          const header = `
            /**
             * AUTO-GENERATED FILE. DO NOT EDIT.
             * Generated by storyblok-schema plugin on ${new Date().toISOString()}.
             * Any changes will be overwritten.
             */

            import type { SbBlokData } from "@storyblok/svelte"

            export type Blok<T> = SbBlokData & T
          `

          const content = generated_content.replace(
            "import {StoryblokStory} from 'storyblok-generate-ts'",
            "export type { StoryblokStory } from 'storyblok-generate-ts'"
          )

          // Write the final file
          logger.info("Finalising schema file...")
          await writeFile(schema_ts_file, header + content)
          logger.info(`Schema written to ${schema_ts_file}.`)

          // Format
          logger.info("Formatting file...")
          await $`${x} prettier --write ${schema_ts_file}`.quiet()
          logger.info("File formatted.")

          // Lock the file
          await $`chmod a-w ${schema_ts_file}`.quiet()
          logger.info(
            `\n🎉 Storyblok component types generated successfully to \x1b[35m${schema_ts_file}\x1b[0m`
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : "An unknown error occurred."
          logger.error(message)
        }
      }
    },
    closeBundle() {
      if (interval) clearInterval(interval)
    },
  }
}
