/**
 * Whether an address looks deliverable: something, one `@`, then a domain with a dot in it and
 * no spaces. Loose on purpose: `+` tags, subdomains, long or unicode TLDs and apostrophes all
 * pass, as they're valid, and the mail server is the real judge. It only catches what's plainly
 * not an address, like a missing `@` or domain, a space, or `name@example`.
 */
export const looks_like_email = (value: string) =>
	/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim())
