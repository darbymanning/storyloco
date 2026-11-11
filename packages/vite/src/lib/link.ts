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
