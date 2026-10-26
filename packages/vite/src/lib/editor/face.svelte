<!--
	@component
	Someone's face: their Storyblok photo, else their Gravatar, else their initials. Fills whatever
	it's put in, which gives it its shape and colour.
-->
<script lang="ts">
	let {
		name,
		photo = null,
		gravatar = null,
		email = null,
	}: {
		name: string | null
		photo?: string | null
		/** The SHA-256 of their address, as moxy gives it */
		gravatar?: string | null
		/** For someone the page already knows the address of, like a guest it's shared with */
		email?: string | null
	} = $props()

	let hashed = $state<string | null>(null)
	$effect(() => {
		const address = email?.trim().toLowerCase()
		if (!address || gravatar) return
		let current = true
		crypto.subtle.digest("SHA-256", new TextEncoder().encode(address)).then((hash) => {
			if (current)
				hashed = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("")
		})
		return () => (current = false)
	})

	const sources = $derived(
		[
			photo,
			(gravatar ?? hashed) && `https://gravatar.com/avatar/${gravatar ?? hashed}?s=96&d=404`,
		].filter((url): url is string => !!url)
	)
	/** The first that loads: each that fails moves on to the next */
	let failed = $state(0)
	const src = $derived(sources[failed])

	const initials = $derived(
		(name ?? "?")
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part) => part[0])
			.join("")
			.toUpperCase() || "?"
	)
</script>

{#if src}
	<img {src} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => failed++} />
{:else}
	{initials}
{/if}

<style>
	img {
		block-size: 100%;
		border-radius: inherit;
		display: block;
		inline-size: 100%;
		object-fit: cover;
	}
</style>
