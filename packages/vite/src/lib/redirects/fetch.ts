/** A redirect as `[from, to]`, the way the datasource stores it (`name` → `value`). */
export type Redirect = [string, string]

/**
 * Every entry in a Storyblok datasource, as `[from, to]` pairs. A missing datasource is no
 * redirects; any other failure throws, so a caller holding redirects can keep them.
 */
export async function fetch_redirects(datasource: string, token: string): Promise<Array<Redirect>> {
	const per_page = 100
	const cv = Date.now().toString()
	const entries: Array<{ name?: string; value?: string }> = []

	for (let page = 1; ; page++) {
		const url = new URL("https://api.storyblok.com/v2/cdn/datasource_entries")
		url.search = new URLSearchParams({
			datasource,
			token,
			cv,
			per_page: String(per_page),
			page: String(page),
		}).toString()

		const response = await fetch(url, { signal: AbortSignal.timeout(3000) })
		if (response.status === 404) return []
		if (!response.ok) throw new Error(`Storyblok datasource "${datasource}" → ${response.status}`)

		const { datasource_entries = [] } = (await response.json()) as {
			datasource_entries?: typeof entries
		}
		entries.push(...datasource_entries)

		const total = Number(response.headers.get("total"))
		if (datasource_entries.length < per_page || (total && entries.length >= total)) break
	}

	const pairs = entries.filter((e) => e.name && e.value).map((e) => [e.name, e.value] as Redirect)
	return [...new Map(pairs)]
}
