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
		art = null,
	}: {
		/** A picture for someone with no photo and no name of their own, like a guest: the inside of an svg, made here */
		art?: string | null
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
	<img
		{src}
		alt=""
		draggable="false"
		loading="lazy"
		referrerpolicy="no-referrer"
		onerror={() => failed++}
	/>
{:else if art}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- drawn by the editor itself, from an id's hash -->
	<svg class="art" viewBox="0 0 32 32" aria-hidden="true">{@html art}</svg>
{:else}
	<span class="initials">{initials}</span>
{/if}

<style>
	img {
		block-size: 100%;
		border-radius: inherit;
		display: block;
		inline-size: 100%;
		object-fit: cover;
	}

	/* centred in whatever it fills, whether or not that centres what's in it */
	.initials {
		block-size: 100%;
		display: grid;
		inline-size: 100%;
		line-height: 1;
		place-items: center;
	}

	/* two tones of their one colour: a pale paper, and a deep ink the picture and its dots are in */
	.art {
		background: color-mix(in srgb, var(--c, #8a8f9c) 24%, #fbf7ef);
		block-size: 100%;
		color: color-mix(in srgb, var(--c, #8a8f9c) 58%, #0d1030);
		display: block;
		inline-size: 100%;
	}
</style>
