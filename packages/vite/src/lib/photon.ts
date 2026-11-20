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

/**
 * Addresses matching what's typed so far, from Photon (photon.komoot.io): OpenStreetMap data, no
 * key, fair use. Rejects when the service can't be reached.
 */
export async function search_addresses(
	query: string,
	signal?: AbortSignal
): Promise<Array<FoundAddress>> {
	const url = `https://photon.komoot.io/api/?limit=5&lang=en&q=${encodeURIComponent(query)}`
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
