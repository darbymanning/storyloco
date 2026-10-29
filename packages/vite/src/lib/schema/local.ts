import { runnerImport } from "vite"

/**
 * A space's schema defined in code with `@storyblok/schema` (`defineSchema`, `defineBlock`,
 * `defineField`…), read for its types. Nothing is imported from the package itself: its
 * definitions are plain objects, and reading them as such keeps it an optional dependency of
 * the site's rather than ours.
 */
interface LocalField {
	name?: string
	type?: string
	allow?: Array<string | { folder?: string; tag?: string }>
	deny?: unknown
	datasource?: string
	[key: string]: unknown
}

interface LocalBlock {
	name: string
	fields?: Array<LocalField>
	folder?: string | { name: string; parent?: unknown } | null
	[key: string]: unknown
}

interface LocalSchema {
	blocks: Record<string, LocalBlock>
}

/** A component as the Management API returns it, which the type generator reads. */
export interface Component {
	name: string
	schema: Record<string, Record<string, unknown>>
	[key: string]: unknown
}

/** `defineFolder` keeps its parent as another folder; a path names it the way `allow` does. */
function folder_path(folder: LocalBlock["folder"]): string | undefined {
	if (!folder) return undefined
	if (typeof folder === "string") return folder
	const parent = folder.parent as LocalBlock["folder"] | undefined
	const above = folder_path(parent)
	return above ? `${above}/${folder.name}` : folder.name
}

/**
 * The definitions as the Management API would hold them, as `storyblok schema push` writes them:
 * the ordered `fields` become a `schema` keyed by name, `allow` becomes `component_whitelist`
 * (turning `restrict_components` on for `bloks` and `richtext`), and `datasource` becomes
 * `datasource_slug`.
 *
 * Folder and tag restrictions are resolved to block names here rather than left as lists: the
 * type generator needs names, and a space's folder ids don't exist until a push. A tag can't be
 * resolved locally, so it leaves the field unrestricted, which types it as any block.
 */
export function to_components(schema: LocalSchema): Array<Component> {
	const blocks = Object.values(schema.blocks)
	const in_folder = (path: string) =>
		blocks
			.filter((block) => {
				const own = folder_path(block.folder)
				return own === path || own?.startsWith(`${path}/`)
			})
			.map((block) => block.name)

	return blocks.map(({ fields = [], folder: _folder, ...rest }) => ({
		...rest,
		schema: Object.fromEntries(
			fields
				.filter((field): field is LocalField & { name: string } => typeof field.name === "string")
				.map(({ name, allow, deny: _deny, datasource, ...field }, pos) => {
					const value: Record<string, unknown> = { pos, ...field }
					const names = allow?.flatMap((entry) =>
						typeof entry === "string" ? [entry] : entry.folder ? in_folder(entry.folder) : []
					)
					const by_tag = allow?.some((entry) => typeof entry !== "string" && entry.tag)
					if (names && !by_tag) {
						value.component_whitelist = names
						if (field.type === "bloks" || field.type === "richtext")
							value.restrict_components = true
					}
					if (datasource !== undefined) value.datasource_slug = datasource
					return [name, value]
				})
		),
	}))
}

/**
 * The schema entry's components, and the files it was read from (for a dev server to watch).
 * The entry exports the `defineSchema` result as `schema` or as its default.
 */
export async function load_local(entry: string) {
	const { module, dependencies } = await runnerImport<{
		schema?: LocalSchema
		default?: LocalSchema
	}>(entry)
	const schema = module.schema ?? module.default
	if (!schema?.blocks)
		throw new Error(`${entry} exports no schema: export the defineSchema result as \`schema\``)
	return { components: to_components(schema), dependencies: dependencies ?? [] }
}
