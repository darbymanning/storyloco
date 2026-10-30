import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { stripVTControlCharacters } from "node:util"

/**
 * A schema's scope: the folders it owns in a space other schemas share. Every block it defines
 * is in one, and the components in them that it doesn't define are its own stale ones. Folders
 * are compared as the Storyblok CLI prints them, by slug, so "My Layout" is `my-layout`.
 */
export type Scope = Array<string>

const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9/]+/g, "-")
		.replace(/(^-|-$)|-?(\/)-?/g, "$2")

/** Whether a folder path is one of the scope's folders, or inside one */
export function in_scope(folder: string | undefined, scope: Scope) {
	if (!folder) return false
	const own = slug(folder)
	return scope.some((owned) => own === slug(owned) || own.startsWith(`${slug(owned)}/`))
}

/** What the space holds that a scoped check needs: its components, and the folders they're in */
export interface Space {
	components: Array<{ id: number; name: string; component_group_uuid?: string | null }>
	component_groups: Array<{ uuid: string; name: string; parent_uuid?: string | null }>
}

/** Each component's folder path in the space, by name, and every folder's path */
export function folders(space: Space) {
	const groups = new Map(space.component_groups.map((group) => [group.uuid, group]))
	const path_of = (uuid?: string | null): string | undefined => {
		const group = uuid ? groups.get(uuid) : undefined
		if (!group) return undefined
		const above = path_of(group.parent_uuid)
		return above ? `${above}/${group.name}` : group.name
	}
	return {
		components: new Map(space.components.map((c) => [c.name, path_of(c.component_group_uuid)])),
		paths: space.component_groups.map((group) => path_of(group.uuid)!),
	}
}

/** The Management API's host for a region */
const HOSTS: Record<string, string> = {
	eu: "mapi.storyblok.com",
	us: "api-us.storyblok.com",
	ca: "api-ca.storyblok.com",
	ap: "api-ap.storyblok.com",
	cn: "app.storyblokchina.cn",
}

/** A personal access token from the environment, or else the Storyblok CLI's own login */
async function login(env: NodeJS.ProcessEnv, region?: string) {
	const token = env.STORYBLOK_PERSONAL_ACCESS_TOKEN ?? env.STORYBLOK_TOKEN
	if (token) return { token, region: region ?? env.STORYBLOK_REGION ?? "eu" }
	const file = path.join(env.HOME ?? homedir(), ".storyblok/credentials.json")
	const saved = await readFile(file, "utf8").then(
		(text) =>
			Object.values(JSON.parse(text) as Record<string, { password?: string; region?: string }>),
		() => []
	)
	const credentials = saved.find((entry) => !region || entry.region === region) ?? saved[0]
	if (!credentials?.password)
		throw new Error(
			"A scoped check reads the space: set STORYBLOK_PERSONAL_ACCESS_TOKEN or log in with the Storyblok CLI."
		)
	return { token: credentials.password, region: region ?? credentials.region ?? "eu" }
}

/** A Management API client for the space, on the token the CLI is given */
export async function management(
	space: string,
	env: NodeJS.ProcessEnv,
	region?: string,
	request = fetch
) {
	const { token, region: resolved } = await login(env, region)
	const base = `https://${HOSTS[resolved] ?? HOSTS.eu}/v1/spaces/${space}`
	async function call<T>(method: string, route: string): Promise<T> {
		const response = await request(`${base}/${route}`, {
			method,
			headers: { Authorization: token },
		})
		if (!response.ok) throw new Error(`Storyblok ${method} ${route}: ${response.status}`)
		return (response.status === 204 ? {} : await response.json()) as T
	}
	return {
		async read(): Promise<Space> {
			const [{ components }, { component_groups }] = await Promise.all([
				call<Pick<Space, "components">>("GET", "components"),
				call<Pick<Space, "component_groups">>("GET", "component_groups"),
			])
			return { components, component_groups }
		},
		delete: (id: number) => call("DELETE", `components/${id}`),
	}
}

const ENTITY = /^\s+[-+~=]\s+(.+?)\s+\((\w+)\)\s*$/

/**
 * The Storyblok CLI's diff or push output with only the scope's own entities in it: its folders,
 * the components it defines and the space's components in its folders, and the datasources it
 * defines. Whatever else the space holds belongs to another schema, so it's counted, not shown.
 */
export function scoped(
	output: string,
	scope: Scope,
	local: { components: Array<string>; datasources: Array<string> },
	space: Space
) {
	const { components, paths } = folders(space)
	const owned = {
		Folders: (name: string) => in_scope(paths.find((p) => slug(p) === slug(name)) ?? name, scope),
		Components: (name: string) =>
			local.components.includes(name) || in_scope(components.get(name), scope),
		Datasources: (name: string) => local.datasources.includes(name),
	}
	let section: keyof typeof owned | undefined
	let hidden = 0
	const changed: Array<string> = []
	// the CLI colours its output when FORCE_COLOR is set, as CI often does; read it plain
	const lines = stripVTControlCharacters(output)
		.split("\n")
		.filter((line) => {
			const heading = line.trim()
			if (heading in owned) {
				section = heading as keyof typeof owned
				return true
			}
			const entity = line.match(ENTITY)
			// the CLI's own summary counts the whole space, so it's replaced
			if (/^\s*(Summary:|⚠️)/.test(line)) return false
			if (!entity || !section) return true
			if (!owned[section](entity[1])) {
				hidden++
				return false
			}
			if (entity[2] !== "unchanged") changed.push(`${entity[1]} (${entity[2]})`)
			return true
		})
	// a heading whose entities were all another schema's goes too
	const shown = lines.filter(
		(line, i) => !(line.trim() in owned) || ENTITY.test(lines[i + 1] ?? "")
	)
	return { text: shown.join("\n"), changed, hidden }
}
