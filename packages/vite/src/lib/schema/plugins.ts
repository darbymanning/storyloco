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
