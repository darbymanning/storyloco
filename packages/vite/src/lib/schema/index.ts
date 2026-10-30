import {
	defineBlock,
	defineField,
	type Block,
	type BlockContent,
	type BlockFolder,
	type DefinedField,
	type FieldInput,
	type FieldType,
} from "@storyblok/schema"
import type { plugin_types } from "./plugins.js"

/** Storyblok's helpers and types, with shorter names and the same inference. */
export * from "@storyblok/schema"
export {
	defineSchema as schema,
	defineSchema as define_schema,
	defineField as field,
	defineFolder as folder,
	defineDatasource as datasource,
	defineFieldPlugin as field_plugin,
	hideWhen as hide_when,
	requiredWhen as required_when,
} from "@storyblok/schema"

/**
 * Every block by name, as the generated schema file declares them. Empty until types are
 * generated, which is when `Props<"name">` and the names `bloks()` accepts become known;
 * until then `Props` takes only `typeof schema`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Blocks {}

/** A generated block's name, or any name until a schema has been generated. */
type BlockName = [keyof Blocks] extends [never] ? string : keyof Blocks & string

/**
 * A block component's props: `blok` typed by the block's name (from the generated schema,
 * nested blocks and field plugins included) or by its `block()` definition, plus any extras.
 *
 * @example
 * let { blok }: Props<"hero"> = $props()
 * let { blok, class: className }: Props<"hero", { class?: string }> = $props()
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Props<T extends (keyof Blocks & string) | Block, Extra extends object = {}> = Extra & {
	blok: T extends keyof Blocks ? Blocks[T] : T extends Block ? BlockContent<T> : never
}

type Options<T extends FieldType> = Omit<Extract<FieldInput, { type: T }>, "type">

type Named<F extends Record<string, FieldInput>> = Array<
	{ [K in keyof F & string]: DefinedField<K, F[K]> }[keyof F & string]
>

type BlockOptions = Omit<Parameters<typeof defineBlock>[0], "name" | "fields">

/**
 * `defineBlock`, also callable as `block(name, fields, options?)` with fields keyed by name
 * in the order they appear in the editor.
 *
 * @example
 * export const schema = block("hero", {
 *   title: text({ required: true }),
 *   items: bloks("teaser", { minimum: 1 }),
 * })
 */
export const block = ((
	input: string | Parameters<typeof defineBlock>[0],
	fields: Record<string, FieldInput> = {},
	options: BlockOptions = {}
) =>
	typeof input === "string"
		? defineBlock({
				...options,
				name: input,
				// ponytail: integer-like keys ("1") would sort first; no real field name is one
				fields: Object.entries(fields).map(([key, field]) => defineField(key, field as never)),
			})
		: defineBlock(input)) as typeof defineBlock &
	(<const N extends string, const F extends Record<string, FieldInput>>(
		name: N,
		fields: F,
		options?: BlockOptions
	) => Block & { name: N; fields: Named<F> })

const of =
	<T extends FieldType>(type: T) =>
	<const O extends Options<T>>(options?: O) =>
		({ ...options, type }) as O & { type: T }

export const text = of("text")
export const textarea = of("textarea")
export const richtext = of("richtext")
export const markdown = of("markdown")
export const number = of("number")
export const datetime = of("datetime")
export const boolean = of("boolean")
export const option = of("option")
export const options = of("options")
export const asset = of("asset")
export const multiasset = of("multiasset")
export const multilink = of("multilink")
export const table = of("table")
export const section = of("section")
export const tab = of("tab")
export const custom = of("custom")

const plugin =
	<P extends keyof typeof plugin_types>(field_type: P) =>
	<const O extends Omit<Options<"custom">, "field_type">>(options?: O) =>
		({ ...options, type: "custom", field_type }) as O & { type: "custom"; field_type: P }

/** Storyloco's field plugins, as `custom` fields whose values the generated types know. */
export const mux = plugin("uiloco-mux")
export const link = plugin("uiloco-link")
export const heading = plugin("uiloco-heading")
export const input = plugin("uiloco-input")
export const currency = plugin("uiloco-currency")
export const r2_asset = plugin("uiloco-asset")
export const dates = plugin("uiloco-dates")
export const time = plugin("uiloco-time")
export const seo = plugin("uiloco-seo")
export const hubspot_form = plugin("uiloco-hubspot-form")
export const plans = plugin("uiloco-plans")
export const churchsuite_categories = plugin("uiloco-churchsuite-categories")
export const blok_select = plugin("uiloco-blok-select")
export const theme = plugin("uiloco-theme")

type Ref = BlockName | { name: BlockName } | BlockFolder | { tag: string }

/**
 * A `bloks` field. The blocks it allows come first, as one reference (a name, block, folder or
 * `{ tag }`) or a non-empty list of them; a lone options object, or nothing, allows every
 * nestable block. Options never have `name`, `path` or `tag`, which is how they're told apart.
 *
 * @example
 * bloks("teaser")
 * bloks(["teaser", "card"], { minimum: 1, maximum: 6 })
 * bloks({ minimum: 1 })
 */
export function bloks<
	const A extends Ref | readonly [Ref, ...Ref[]],
	const O extends Omit<Options<"bloks">, "allow">,
>(allow: A, options?: O): O & { type: "bloks"; allow: A }
export function bloks<const O extends Options<"bloks">>(options?: O): O & { type: "bloks" }
export function bloks(allow?: unknown, options?: object) {
	const ref =
		typeof allow === "string" ||
		Array.isArray(allow) ||
		(!!allow && typeof allow === "object" && ("name" in allow || "path" in allow || "tag" in allow))
	return ref ? { ...options, type: "bloks", allow } : { ...(allow as object), type: "bloks" }
}
