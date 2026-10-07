import { type Plugin, loadEnv } from "vite"
import { Logger } from "../shared/logger.js"
import { fetch_redirects, type Redirect } from "./fetch.js"

const name = "vite-storyblok-redirects"
const logger = new Logger(name)

interface Options {
	datasource?: string
	public_storyblok_access_token?: string
}

/**
 * @remarks
 * Vite plugin that bakes a Storyblok datasource's redirects into the build, along with what
 * `handle_redirects` needs to keep them live: it refreshes them from Storyblok every minute.
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
	const token =
		public_storyblok_access_token ?? loadEnv("", "", "").PUBLIC_STORYBLOK_ACCESS_TOKEN ?? ""
	let baked: Promise<Array<Redirect>> | undefined

	const load_redirects = () =>
		(baked ??= fetch_redirects(datasource, token).catch((err) => {
			logger.fail(`Error generating redirects: ${err instanceof Error ? err.message : err}`)
			return []
		}))

	return {
		name,
		resolveId(id) {
			if (id === "virtual:storyblok-redirects") return id
		},
		async load(id) {
			if (id !== "virtual:storyblok-redirects") return
			return [
				`export const redirects = ${JSON.stringify(await load_redirects(), null, 2)}`,
				`export const datasource = ${JSON.stringify(datasource)}`,
				`export const token = ${JSON.stringify(token)}`,
			].join("\n")
		},
		async buildStart() {
			baked = undefined
			const redirects = await load_redirects()
			logger.succeed(`Redirects virtual module generated`)
			if (redirects.length === 0) logger.info("No redirects configured")
			for (const [from, to] of redirects) logger.info(`${from} -> ${to}`)
		},
	}
}
