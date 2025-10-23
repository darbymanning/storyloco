<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js'
	import type { HTMLAttributes } from 'svelte/elements'

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props()
</script>

<div
	bind:this={ref}
	data-slot="dialog-footer"
	class={cn(
		'-m-6 mt-0 flex flex-col-reverse gap-2 border-t bg-accent p-4 px-6 sm:flex-row sm:justify-end',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
