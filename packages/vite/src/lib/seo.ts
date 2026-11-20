/** A legal entity of the organisation, with its registered address. */
export interface OrganizationEntity {
	/** Its registered name, e.g. `EA Technology, LLC` */
	name?: string
	street?: string
	/** Town or city */
	locality?: string
	/** State, province or county */
	region?: string
	postal_code?: string
	/** ISO 3166-1 alpha-2 code, e.g. `GB` */
	country?: string
	/** The entity whose address is the organisation's own; the rest are its sub-organisations */
	head_office?: boolean
}

/** What the SEO field's `organization` group stores. Everything is optional. */
export interface Organization {
	legal_name?: string
	/** ISO 8601 date, e.g. `1966-04-01` */
	founding_date?: string
	description?: string
	/** What tells it apart from similarly named organisations */
	disambiguating_description?: string
	/** Profiles on other sites: LinkedIn, Wikidata, Companies House… */
	same_as?: Array<string>
	/** Names of the brands it owns */
	brands?: Array<string>
	entities?: Array<OrganizationEntity>
}

export interface PostalAddress {
	"@type": "PostalAddress"
	streetAddress?: string
	addressLocality?: string
	addressRegion?: string
	postalCode?: string
	addressCountry?: string
}

/** A schema.org Organization, as `organization()` builds it. */
export interface OrganizationEntityLd {
	"@type": "Organization"
	"@id": string
	name?: string
	url?: string
	logo?: string
	legalName?: string
	foundingDate?: string
	description?: string
	disambiguatingDescription?: string
	sameAs?: Array<string>
	brand?: Array<{ "@type": "Brand"; name: string }>
	address?: PostalAddress
	subOrganization?: Array<{
		"@type": "Organization"
		name?: string
		legalName?: string
		address?: PostalAddress
	}>
}

export interface OrganizationOptions {
	/** The site's origin, e.g. `https://example.com`: the entity's `@id` is `${origin}/#organization` */
	origin: string
	logo?: string
	/** The name it trades under */
	name?: string
	url?: string
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "")
const list = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : [])

/** Drops every key whose value is empty: `undefined`, `""`, `false` or `[]`. */
function compact<T extends object>(object: T): T {
	return Object.fromEntries(
		Object.entries(object).filter(([, value]) => (Array.isArray(value) ? value.length : value))
	) as T
}

const ENTITY_KEYS = ["name", "street", "locality", "region", "postal_code", "country"] as const

/**
 * An `organization` value with the blanks taken out: trimmed strings, no empty rows, no entity
 * without a name or an address, and `undefined` when nothing is left. The plugin saves through
 * this, and `organization()` reads through it.
 */
export function tidy_organization(value?: Organization | null): Organization | undefined {
	if (!value || typeof value !== "object") return undefined
	const entities = (Array.isArray(value.entities) ? value.entities : [])
		.map((entity) =>
			compact({
				...Object.fromEntries(ENTITY_KEYS.map((key) => [key, text(entity?.[key])])),
				head_office: entity?.head_office === true,
			} as OrganizationEntity)
		)
		.filter((entity) => ENTITY_KEYS.some((key) => entity[key]))
	const tidy = compact<Organization>({
		legal_name: text(value.legal_name),
		founding_date: text(value.founding_date),
		description: text(value.description),
		disambiguating_description: text(value.disambiguating_description),
		same_as: list(value.same_as),
		brands: list(value.brands),
		entities,
	})
	return Object.keys(tidy).length ? tidy : undefined
}

/** Whether a profile link is a full `http(s)` URL, which is all `sameAs` may hold. */
export function is_profile_url(url: string): boolean {
	return /^https?:$/.test(URL.parse(url)?.protocol ?? "")
}

function postal_address(entity: OrganizationEntity): PostalAddress | undefined {
	const address = compact({
		streetAddress: entity.street,
		addressLocality: entity.locality,
		addressRegion: entity.region,
		postalCode: entity.postal_code,
		addressCountry: entity.country,
	})
	return Object.keys(address).length ? { "@type": "PostalAddress", ...address } : undefined
}

/**
 * The schema.org Organization for a page's JSON-LD, from the SEO field's `organization` group:
 * `organization(layout.seo?.organization, { origin, logo })`. Empty properties are left out, and
 * so is the whole entity (`undefined`) when the group is absent or blank, so it can be called
 * whether or not the field includes the group.
 *
 * The head office's address is the organisation's own; every other entity is a `subOrganization`.
 */
export function organization(
	value: Organization | null | undefined,
	{ origin, logo, name, url }: OrganizationOptions
): OrganizationEntityLd | undefined {
	const tidy = tidy_organization(value)
	if (!tidy) return undefined
	const entities = tidy.entities ?? []
	const head_office = entities.find((entity) => entity.head_office)
	return compact<OrganizationEntityLd>({
		"@type": "Organization",
		"@id": `${origin}/#organization`,
		name,
		url,
		logo,
		legalName: tidy.legal_name,
		foundingDate: tidy.founding_date,
		description: tidy.description,
		disambiguatingDescription: tidy.disambiguating_description,
		sameAs: tidy.same_as?.filter(is_profile_url),
		brand: tidy.brands?.map((name) => ({ "@type": "Brand", name })),
		address: head_office && postal_address(head_office),
		subOrganization: entities
			.filter((entity) => entity !== head_office)
			.map((entity) =>
				compact({
					"@type": "Organization" as const,
					name: entity.name,
					legalName: entity.name,
					address: postal_address(entity),
				})
			),
	})
}
