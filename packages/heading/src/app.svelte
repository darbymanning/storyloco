<script lang="ts">
	import { Input } from 'shared'
	import type { Heading } from '../types.js'
	import { HeadingManager } from './app.svelte.js'

	const manager = new HeadingManager()

	const loaded = $derived(manager.plugin?.type === 'loaded')
</script>

{#if loaded}
	<fieldset class="flex gap-2">
		<Input class="flex-1" bind:value={manager.content.text} oninput={manager.update} />
		<select
			class="rounded outline-none focus-visible:border-ring border-input border bg-input-background min-h-11.5"
			bind:value={
				() => manager.content.level, (v) => (manager.content.level = Number(v) as Heading['level'])
			}
			onchange={manager.update}
		>
			{#each [1, 2, 3, 4, 5, 6] as level}
				<option value={level}>H{level}</option>
			{/each}
		</select>
	</fieldset>
{/if}
