/** Storyloco's field plugins, by the name every space deploys them under, with their value types. */
export const plugin_types = {
	"uiloco-mux": 'import("storyloco/mux").Video',
	"uiloco-link": 'import("storyloco/link").Link',
	"uiloco-heading": 'import("storyloco/heading").Heading',
	"uiloco-input": 'import("storyloco/input").Input',
	"uiloco-currency": 'import("storyloco/currency").Currency',
	"uiloco-asset": 'import("storyloco/asset").Asset',
	"uiloco-dates": 'import("storyloco/dates").Dates',
	"uiloco-time": 'import("storyloco/time").Time',
	"uiloco-seo": 'import("storyloco/seo").SEO',
	"uiloco-hubspot-form": 'import("storyloco/hubspot_form").HubspotForm',
	"uiloco-plans": 'import("storyloco/plans").Types',
	"uiloco-churchsuite-categories":
		'import("storyloco/churchsuite_categories").ChurchsuiteCategories',
	"uiloco-blok-select": 'import("storyloco/blok_select").BlokSelect',
	"uiloco-theme": "string | null",
} as const

/**
 * `plugin_types`, and the names older spaces deployed some of them under: what a field plugin is
 * typed as when the app's `StoryblokCustomPlugins` doesn't say.
 */
export const known_plugins: Record<string, string> = {
	...plugin_types,
	"loco-link-field": 'import("storyloco/link").Link',
	"mux-video": 'import("storyloco/mux").Video',
	"video-mux": 'import("storyloco/mux").Video',
	"heading-field": 'import("storyloco/heading").Heading',
	"mux-field": 'import("storyloco/mux").Video',
	"loco-mux": 'import("storyloco/mux").Video',
	"loco-link": 'import("storyloco/link").Link',
	"link-field": 'import("storyloco/link").Link',
	"loco-input": 'import("storyloco/input").Input',
	"loco-time": "string",
	"loco-currency": 'import("storyloco/currency").Currency',
	"loco-asset": 'import("storyloco/asset").Asset',
	"loco-dates": 'import("storyloco/dates").Dates',
	"seo-metatags": 'import("storyloco/seo").SEO',
	"theme-field": "string",
}
