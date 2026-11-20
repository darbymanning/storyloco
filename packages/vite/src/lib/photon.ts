/** An address as the SEO field's legal entities hold it. */
export interface Address {
	street: string
	locality: string
	region: string
	postal_code: string
	country: string
}

export interface FoundAddress {
	/** The whole address on one line, to pick it by */
	label: string
	address: Address
}

const PLACES = ["city", "district", "locality", "county", "state", "country"]

/** One Photon result's `properties`, as an address. */
export function address_from_photon(place: Record<string, unknown>): FoundAddress {
	const p = place as Record<string, string | undefined>
	const road = [p.housenumber, p.street].filter(Boolean).join(" ")
	const is_place = PLACES.includes(p.type ?? "")
	// a building's own name leads its street line, unless it only repeats the road
	const name = is_place || p.name === road || p.name === p.street ? "" : p.name
	const address = {
		street: [name, road].filter(Boolean).join(", "),
		locality: p.city ?? (is_place ? p.name : undefined) ?? p.district ?? p.county ?? "",
		region: p.state ?? "",
		postal_code: p.postcode ?? "",
		country: p.countrycode ?? "",
	}
	const label = [address.street, address.locality, address.region, address.postal_code, p.country]
	return { label: label.filter(Boolean).join(", "), address }
}

const API = "https://photon.komoot.io/api/?lang=en"

let near: Promise<string> | undefined

/**
 * Parameters that lean results towards the country the browser's languages name (`en-GB` is the
 * UK), which is where the editor usually works, wherever they happen to be today. Photon leans
 * towards a point, so the country's own is looked up from it, once.
 */
function bias(): Promise<string> {
	return (near ??= (async () => {
		const region = navigator.languages.map((tag) => new Intl.Locale(tag).region).find(Boolean)
		const country = region && new Intl.DisplayNames("en", { type: "region" }).of(region)
		if (!country) return ""
		const response = await fetch(
			`${API}&limit=1&osm_tag=place:country&q=${encodeURIComponent(country)}`
		)
		const { features } = (await response.json()) as {
			features: Array<{ geometry: { coordinates: [number, number] } }>
		}
		const [lon, lat] = features[0].geometry.coordinates
		return `&lat=${lat}&lon=${lon}&zoom=5&location_bias_scale=0.5`
	})().catch(() => ""))
}

/**
 * Addresses matching what's typed so far, from Photon (photon.komoot.io): OpenStreetMap data, no
 * key, fair use. Rejects when the service can't be reached.
 */
export async function search_addresses(
	query: string,
	signal?: AbortSignal
): Promise<Array<FoundAddress>> {
	const url = `${API}&limit=5&q=${encodeURIComponent(query)}${await bias()}`
	const response = await fetch(url, { signal })
	if (!response.ok) throw new Error(`Photon answered ${response.status}`)
	const { features = [] } = (await response.json()) as {
		features?: Array<{ properties: Record<string, unknown> }>
	}
	const found = features.map((feature) => address_from_photon(feature.properties))
	return found.filter(
		(one, index) => one.label && found.findIndex((other) => other.label === one.label) === index
	)
}
