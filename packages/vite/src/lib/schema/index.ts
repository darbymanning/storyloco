/** Storyblok's helpers and types, with shorter names and the same inference. */
export * from "@storyblok/schema"
export {
	defineSchema as schema,
	defineSchema as define_schema,
	defineBlock as block,
	defineField as field,
	defineFolder as folder,
	defineDatasource as datasource,
	defineFieldPlugin as field_plugin,
	hideWhen as hide_when,
	requiredWhen as required_when,
} from "@storyblok/schema"
