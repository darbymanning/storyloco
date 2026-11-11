type Value = Record<string, unknown>

const object = (v: unknown): v is Value => !!v && typeof v === "object" && !Array.isArray(v)

/**
 * A native Storyblok link as the link field plugin holds it, so a field switched from Storyblok's
 * link to the plugin still opens the links it already had. A story link keeps the native fields,
 * so `resolve_links` goes on finding its path; an asset link becomes its URL, since the plugin
 * only picks files through R2. Anything already in the plugin's shape is returned as it is.
 */
export function plugin_link(value: Value): Value {
	if (typeof value.type === "string" || value.fieldtype !== "multilink") return value
	const { linktype, url, cached_url, id, anchor, target, email } = value
	const kept = target ? { target } : {}
	if (linktype === "email") {
		const address = String(email || url || "").replace(/^mailto:/, "")
		return address
			? { type: "email", email: address, url: `mailto:${address}`, ...kept }
			: { type: "email" }
	}
	if (linktype === "story") {
		if (typeof id !== "string" || !id) return { type: "internal" }
		// resolved on a page, the story comes with its name; stored, it's only the uuid
		const story = object(value.story)
			? {
					id: value.story.id,
					uuid: value.story.uuid ?? id,
					name: value.story.name,
					published_at: value.story.published_at ?? null,
				}
			: { uuid: id }
		return {
			type: "internal",
			...kept,
			...(anchor ? { suffix: `#${String(anchor).replace(/^#/, "")}` } : {}),
			story,
			fieldtype: "multilink",
			linktype: "story",
			id,
			cached_url,
		}
	}
	return url ? { type: "external", url, ...kept } : { type: "external" }
}

/** The `rel`s an external link can carry, in the order they're written */
export const RELS = ["noopener", "noreferrer", "nofollow"]

/** The kinds of link the link field plugin makes, in the order it offers them by default */
export const LINK_TYPES = ["internal", "external", "email", "asset", "form"] as const
export type LinkType = (typeof LINK_TYPES)[number]

// the names an editor might reach for, as well as the plugin's own
const NAMES: Record<string, LinkType> = {
	internal: "internal",
	story: "internal",
	page: "internal",
	external: "external",
	url: "external",
	email: "email",
	mail: "email",
	asset: "asset",
	file: "asset",
	form: "form",
	hubspot: "form",
}

/**
 * The link types a link field's `link_types` option allows, in its order, so its first is what a
 * new link starts as: `internal, url, form`, any case, commas or spaces between. Names it doesn't
 * know are passed over; `null` when it names none at all, which leaves every type to the field.
 */
export function link_types_of(option: unknown): Array<LinkType> | null {
	if (typeof option !== "string") return null
	const types = option
		.toLowerCase()
		.split(/[\s,]+/)
		.map((name) => NAMES[name])
		.filter((type): type is LinkType => !!type)
	return types.length ? [...new Set(types)] : null
}

/**
 * Whether an address looks deliverable: something, one `@`, then a domain with a dot in it and
 * no spaces. Loose on purpose: `+` tags, subdomains, long or unicode TLDs and apostrophes all
 * pass, as they're valid, and the mail server is the real judge. It only catches what's plainly
 * not an address, like a missing `@` or domain, a space, or `name@example`.
 */
export const looks_like_email = (value: string) =>
	/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim())

/** A `mailto:` link, with whichever of its parts are filled in; the body's line breaks as CRLF (RFC 6068) */
export function mailto(
	email: string,
	parts: { subject?: string; body?: string; cc?: string; bcc?: string } = {}
) {
	const query = Object.entries(parts)
		.filter(([, value]) => value)
		.map(
			([key, value]) =>
				`${key}=${encodeURIComponent(key === "body" ? value!.replace(/\r?\n/g, "\r\n") : value!)}`
		)
		.join("&")
	return `mailto:${email.trim()}${query ? `?${query}` : ""}`
}
