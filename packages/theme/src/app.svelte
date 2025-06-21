<script lang="ts">
	import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
	import { onMount } from 'svelte'
	import { snake } from 'radashi'
	import Color from 'color'
	import { cn } from 'shared/utils'

	type Theme = {
		name: string
		hex: string
		value: string
	}

	type Plugin = FieldPluginResponse<string | undefined>

	let plugin: Plugin | null = $state(null)
	let content: string | undefined = $state()

	onMount(() => {
		createFieldPlugin<string>({
			enablePortalModal: true,
			onUpdateState(state) {
				plugin = state as Plugin
			},
		})
	})

	function update() {
		if (plugin?.type !== 'loaded') return
		const state = $state.snapshot(content)
		plugin.actions.setContent(state)
	}

	const themes: Array<Theme> = $derived.by(() => {
		if (plugin?.type !== 'loaded') return []

		return Object.entries(plugin.data.options).map(([key, value]) => {
			return {
				name: key,
				hex: value,
				value: snake(key),
			}
		})
	})

	function is_light(hex: string): boolean {
		try {
			return Color(hex).isLight()
		} catch {
			return false
		}
	}
</script>

{#if themes?.length}
	<fieldset class="flex items-center gap-2">
		{#each themes as { value, name, hex }, index}
			{#snippet label(value: string)}
				<input
					class="sr-only [&:checked+label]:border-[var(--color)] [&:checked+label]:bg-[var(--color-hover)]/10"
					id={value}
					type="radio"
					{value}
					bind:group={content}
					onchange={update}
				/>
				<label
					for={value}
					class={cn([
						'flex items-center gap-2 p-3 px-4 border rounded relative border-transparent transition-colors cursor-pointer',
						{
							'bg-muted-foreground/10 hover:bg-[var(--color-hover)]/10': value !== 'none',
						},
					])}
					class:selected={content === value}
					style={value === 'none'
						? ''
						: `
                     --color: ${hex};
                     --color-hover: ${is_light(hex) ? Color(hex).darken(0.8).hex() : hex};
               `}
				>
					{#if value === 'none'}
						None
					{:else}
						<svg
							class="size-4"
							viewBox="0 0 183 184"
							fill="none"
							xmlns="http://www.w3.org/2000/svg"
						>
							<path
								d="M133.476 6.95414C111.783 -4.24286 86.6097 0.589255 78.855 15.6182L78.816 15.6571C66.9435 3.6288 40.6656 6.34363 23.3116 23.5158C5.97051 40.675 4.10002 65.8488 16.0244 77.8772L15.9855 77.9161C0.865623 85.502 -4.40814 111.871 6.58103 133.693C17.5442 155.49 40.6527 164.492 55.7465 156.88L55.6426 156.984C59.7733 170.623 78.9849 184.483 100.794 183.638C125.189 182.677 145.725 160.14 143.166 143.423C159.858 146.137 178.082 130.017 182.031 105.909C185.967 81.813 174.12 58.8994 157.416 56.1456L157.455 56.1066C165.21 41.0777 155.208 18.1122 133.502 6.92815"
								fill="var(--color)"
							/>
						</svg>
						{name}
					{/if}
				</label>
			{/snippet}
			{#if index === 0}
				{@render label('none')}
			{/if}
			{@render label(value)}
		{/each}
	</fieldset>
{/if}
