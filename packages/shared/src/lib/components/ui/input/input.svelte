<script lang="ts">
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements'
	import { cn, type WithElementRef } from '$lib/utils.js'

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	>

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: classname,
		...rest
	}: Props = $props()
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			'flex h-11.5 w-full min-w-0 rounded-md border border-input bg-transparent px-3 pt-1.5 text-sm font-medium shadow-xs ring-offset-background transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input-background',
			'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
			'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			classname
		)}
		type="file"
		bind:files
		bind:value
		{...rest}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot="input"
		class={cn(
			'flex h-11.5 w-full min-w-0 rounded-md border border-input bg-input-background px-3 py-1 text-base shadow-xs ring-offset-background transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input-background',
			'focus-visible:border-ring',
			'transition-colors hover:border-primary aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
			classname
		)}
		{type}
		bind:value
		{...rest}
	/>
{/if}
