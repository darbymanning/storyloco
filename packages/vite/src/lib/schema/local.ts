import { runnerImport } from "vite"
import { validateSchema, type SchemaLike } from "@storyblok/schema"
import path from "node:path"

/**
 * A space's schema defined in code with `@storyblok/schema` (`defineSchema`, `defineBlock`,
 * `defineField`…), read for its types. Nothing is imported from the package itself: its
 * definitions are plain objects, so either the upstream helpers or `storyloco/schema` work.
 */
/** A block name, or the blocks in a folder or with a tag, as `allow` and `deny` list them */
type Entry = string | { folder?: string; tag?: string }

interface LocalField {
	name?: string
	type?: string
	allow?: ReadonlyArray<Entry>
	deny?: ReadonlyArray<Entry>
	datasource?: string
	[key: string]: unknown
}

interface LocalBlock {
	name: string
	fields?: ReadonlyArray<LocalField>
	folder?: string | { name: string; parent?: unknown } | null
	tags?: ReadonlyArray<string>
	is_nestable?: boolean
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
 * Folder and tag entries are resolved to block names here, as `@storyblok/schema`'s own types
 * resolve them: a folder takes the blocks in it or any folder within (compared case-insensitively),
 * a tag the blocks that declare it. The type generator needs names, and a space's folder and tag ids
 * don't exist until a push. It reads only a whitelist, so a `deny` becomes one too: every nestable
 * block it doesn't name.
 */
export function to_components(schema: LocalSchema): Array<Component> {
	const blocks = Object.values(schema.blocks)
	const matches = (block: LocalBlock, entry: Entry) => {
		if (typeof entry === "string") return block.name === entry
		if (entry.tag) return !!block.tags?.includes(entry.tag)
		const own = folder_path(block.folder)?.toLowerCase()
		const path = entry.folder?.toLowerCase()
		return !!own && !!path && (own === path || own.startsWith(`${path}/`))
	}
	const names = (keep: (block: LocalBlock) => boolean) =>
		blocks.filter(keep).map((block) => block.name)

	return blocks.map(({ fields = [], folder: _folder, tags: _tags, ...rest }) => ({
		...rest,
		schema: Object.fromEntries(
			fields
				.filter((field): field is LocalField & { name: string } => typeof field.name === "string")
				.map(({ name, allow, deny, datasource, ...field }, pos) => {
					const value: Record<string, unknown> = { pos, ...field }
					const picks_blocks = field.type === "bloks" || field.type === "richtext"
					// A name in `allow` passes through, as it may be a block defined elsewhere. The editor
					// ignores a `deny` beside a non-empty `allow`, and on a field that picks no blocks.
					const whitelist = allow?.length
						? [
								...new Set(
									allow.flatMap((entry) =>
										typeof entry === "string" ? [entry] : names((block) => matches(block, entry))
									)
								),
							]
						: deny?.length && picks_blocks
							? names(
									(block) =>
										block.is_nestable !== false && !deny.some((entry) => matches(block, entry))
								)
							: allow
					if (whitelist) {
						value.component_whitelist = whitelist
						if (picks_blocks) value.restrict_components = true
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
export async function load_local(entry: string, on_file?: (file: string) => void) {
	const { module, dependencies } = await runnerImport<{
		schema?: LocalSchema
		default?: LocalSchema
	}>(entry, {
		plugins: [
			{
				name: "storyloco-schema-dependencies",
				enforce: "pre",
				load(id) {
					// Register files before parsing/evaluating them: runnerImport only returns
					// its dependency list on success, but broken imports need watching too.
					const file = id.split("?")[0]
					if (path.isAbsolute(file)) on_file?.(file)
					return null
				},
			},
		],
	})
	const schema = module.schema ?? module.default
	if (!schema?.blocks)
		throw new Error(`${entry} exports no schema: export the defineSchema result as \`schema\``)
	const validation = validateSchema(schema as SchemaLike)
	const errors = validation.issues.filter((issue) => issue.severity === "error")
	if (errors.length)
		throw new Error(
			`${entry}\n${errors.map((issue) => `${issue.entity} ${issue.path.join(".")}: ${issue.message}`).join("\n")}`
		)
	return {
		schema,
		named: !!module.schema,
		components: to_components(schema),
		dependencies: dependencies ?? [],
	}
}
