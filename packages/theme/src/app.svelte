<script lang="ts">
	import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
	import { onMount } from 'svelte'
	import { dash } from 'radashi'
	import { ChevronDownIcon } from '@lucide/svelte'
	import { cn } from 'shared/utils'
	import { slide } from 'svelte/transition'

	type Theme = {
		name: string
		primary: string
		value: string
		secondary?: string
		tertiary?: string
	}

	type Plugin = FieldPluginResponse<Content>
	type Content = string | null

	let plugin: Plugin | null = $state(null)
	let content: Content = $state(null)
	let open = $state(false)

	onMount(() => {
		createFieldPlugin<Content>({
			validateContent(content) {
				if (typeof content !== 'string' || content === 'none') {
					return { content: null }
				}

				return { content }
			},
			onUpdateState(state) {
				plugin = state as Plugin
				if (plugin?.type === 'loaded') content = plugin.data.content
			},
		})
	})

	function update() {
		if (plugin?.type !== 'loaded') return
		const state = $state.snapshot(content)
		plugin.actions.setContent(state === 'none' ? null : state)
	}

	const themes: Array<Theme> = $derived.by(() => {
		if (plugin?.type !== 'loaded') return []

		return Object.entries(plugin.data.options).map(([key, value]) => {
			const [primary, secondary, tertiary] = value.split(',')
			return {
				name: key,
				value: `theme-${dash(key)}`,
				primary,
				secondary,
				tertiary,
			}
		})
	})

	const selected = $derived.by(() => {
		if (plugin?.type !== 'loaded') return

		return themes.find((theme) => theme.value === content)
	})
</script>

<div class="@container">
	{#if themes?.length}
		<button
			class="border border-input rounded p-1 px-3.5 bg-input-background min-h-11.5 text-start outline-none focus-visible:border-ring flex items-center justify-between w-full hover:border-primary"
			onclick={() => (open = !open)}
		>
			<span class:text-muted-foreground={!selected}>{selected?.name || 'Select a theme…'}</span>
			<ChevronDownIcon size={16} class={cn({ 'rotate-180': open }, 'transition-transform')} />
		</button>
		{#if open}
			<fieldset
				class="bg-input-background border border-input rounded grid @[220px]:grid-cols-2 @sm:grid-cols-3 divide-y mt-1 overflow-hidden p-3 gap-3 max-h-120 overflow-y-auto"
				transition:slide
			>
				{#each themes as { value, name, primary, secondary, tertiary }, index}
					{#snippet Label(value: string)}
						<input
							class={cn(
								'sr-only',
								`
                        dark:[&:checked+label]:text-background
                        [&:checked+label]:border-primary
                        [&:checked+label]:bg-white

                        focus-visible:[&:checked+label]:outline-primary
                        focus-visible:[&:checked+label]:outline-2
                        focus-visible:[&:checked+label]:outline-offset-2
                        `,
								{
									'dark:[&:checked+label_figure_span]:border-background': value === 'none',
								}
							)}
							id={value}
							type="radio"
							value={value === 'none' ? null : value}
							bind:group={content}
							onchange={update}
						/>
						<label
							for={value}
							class="grid text-xs text-center items-center gap-2 p-3 border rounded relative cursor-pointer justify-center hover:bg-primary/10 border-input bg-secondary hover:border-primary transition-colors"
						>
							<figure
								class={cn(
									'flex justify-center [&>span]:size-10 @xl:[&>span]:size-12 [&>span]:border-white [&>span]:rounded-full [&>span]:border-2 [&>span:not(:first-child)]:-ml-[25%] [&>span]:relative isolate m-auto',
									{ '[&>span]:border-foreground': value === 'none' }
								)}
							>
								{#if value === 'none'}
									<span></span>
								{:else}
									<span class="z-30" title={primary} style="background-color: {primary}"></span>
									{#if secondary}
										<span class="z-10" title={secondary} style="background-color: {secondary}"
										></span>
									{/if}
									{#if tertiary}
										<span class="z-10" title={tertiary} style="background-color: {tertiary}"></span>
									{/if}
								{/if}
							</figure>
							<span class="truncate" title={value}>
								{value === 'none' ? 'Default' : name}
							</span>
						</label>
					{/snippet}
					{#if index === 0}
						{@render Label('none')}
					{/if}
					{@render Label(value)}
				{/each}
			</fieldset>
		{/if}
	{/if}
</div>
