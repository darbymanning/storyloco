export interface Zone {
	/** IANA id, e.g. `Europe/London` */
	id: string
	/** last part of the id, e.g. `Buenos Aires` */
	city: string
	country: string
	/** emoji flag for the country, 🌐 for UTC or when the country isn't known */
	flag: string
	/** `BST`, `CEST`, `EDT`; empty where there's no well-known name */
	abbr: string
	/** `GMT+1`, `GMT-4`, `GMT` */
	offset: string
	/** current wall-clock time there, `14:05` */
	time: string
	search: string
}

const name_part = (zone: string, locale: string, style: string, date: Date) =>
	new Intl.DateTimeFormat(locale, {
		timeZone: zone,
		timeZoneName: style as Intl.DateTimeFormatOptions['timeZoneName'],
	})
		.formatToParts(date)
		.find((part) => part.type === 'timeZoneName')?.value ?? ''

// regional indicator letters, the same trick as the currency plugin
// ponytail: Windows has no flag emoji and shows the two letters instead
const flag_for = (code: string) =>
	String.fromCodePoint(...[...code].map((char) => 0x1f1a5 + char.charCodeAt(0)))

// zone id -> country, from the browser's own data: every two-letter region code it can name
// ponytail: Intl.Locale#getTimeZones isn't in Firefox yet, so there country search quietly finds nothing
let cache: Map<string, { code: string; name: string }> | undefined
function countries(): Map<string, { code: string; name: string }> {
	if (cache) return cache
	const names = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
	const map = new Map<string, { code: string; name: string }>()
	for (let a = 65; a < 91; a++) {
		for (let b = 65; b < 91; b++) {
			const code = String.fromCharCode(a, b)
			const locale = new Intl.Locale('und', { region: code }) as Intl.Locale & {
				getTimeZones?: () => string[] | undefined
			}
			const zones = locale.getTimeZones?.()
			const name = zones && names.of(code)
			// first code wins: Chrome also maps London to the reserved `UK`, which would replace `GB`
			if (name) for (const zone of zones) if (!map.has(zone)) map.set(zone, { code, name })
		}
	}
	return (cache = map)
}

export function describe(id: string, now = new Date()): Zone {
	const country = countries().get(id)
	// engines print a zero offset as `GMT` or `GMT+0`
	const offset = name_part(id, 'en-GB', 'shortOffset', now).replace(/^GMT\+0$/, 'GMT')
	// en-GB knows BST and CEST, en-US knows EDT and PST; anything else just repeats the offset
	const abbr =
		[name_part(id, 'en-GB', 'short', now), name_part(id, 'en-US', 'short', now)].find(
			(name) => name !== offset && !/^GMT[+-]/.test(name)
		) ?? ''
	const city = id.split('/').at(-1)!.replaceAll('_', ' ')
	const place = id === 'UTC' ? 'Coordinated Universal Time' : (country?.name ?? id.split('/')[0]!)
	const flag = country ? flag_for(country.code) : '🌐'
	const time = new Intl.DateTimeFormat('en-GB', {
		timeZone: id,
		hour: '2-digit',
		minute: '2-digit',
	}).format(now)
	const search = [id.replaceAll('_', ' '), place, abbr, offset, offset.replace('GMT', 'UTC')]
		.join(' ')
		.toLowerCase()
	return { id, city, country: place, flag, abbr, offset, time, search }
}

/** Every zone the browser knows, plus UTC, sorted by city: people look for a place, not an offset. */
export function list_zones(now = new Date()): Zone[] {
	const ids = Intl.supportedValuesOf('timeZone')
	if (!ids.includes('UTC')) ids.push('UTC')
	return ids.map((id) => describe(id, now)).sort((a, b) => a.city.localeCompare(b.city))
}

/** Every word has to match somewhere; cities starting with the query come first. */
export function filter_zones(zones: Zone[], query: string): Zone[] {
	const q = query.trim().toLowerCase()
	const words = q.split(/\s+/).filter(Boolean)
	const starts = (zone: Zone) => Number(zone.city.toLowerCase().startsWith(q))
	return zones
		.filter((zone) => words.every((word) => zone.search.includes(word)))
		.sort((a, b) => starts(b) - starts(a))
}
