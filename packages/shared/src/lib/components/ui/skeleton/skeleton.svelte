<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from '$lib/utils.js'
	import type { HTMLAttributes } from 'svelte/elements'

	let {
		ref = $bindable(null),
		class: classname,
		...rest
	}: WithoutChildren<WithElementRef<HTMLAttributes<HTMLDivElement>>> = $props()
</script>

<div
	bind:this={ref}
	data-slot="skeleton"
	class={cn('bg-muted animate-pulse rounded-md', classname)}
	{...rest}
></div>
