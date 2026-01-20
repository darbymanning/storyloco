<script lang="ts">
	import { BlokSelectManager } from './app.svelte.js'
	import { RadioGroup } from 'shared'
	import type { UUID } from 'crypto'

	const blok_select = new BlokSelectManager()
   $inspect(blok_select.content.id)
</script>

{#snippet Badge(text: string)}
	<span class="bg-muted-foreground/10 px-2 py-1 rounded-md">{text}</span>
{/snippet}

{#if blok_select.bloks?.length}
<div class="grid rounded-md">
	<RadioGroup.Root
      class="gap-0 border rounded-md divide-y"
		bind:value={blok_select.content.id}
		onValueChange={(value: UUID | undefined) => {
			if (value) blok_select.select_blok(value)
		}}
	>
		{#each blok_select.bloks as blok}
			<label class="flex items-center gap-4 cursor-pointer p-2">
				<RadioGroup.Item value={blok._uid} />
				<span class="grid gap-1 text-xs justify-items-start">
					{#if blok._title}
						{@render Badge(blok.component)} {blok._title}
					{:else}
						{@render Badge(blok.component)}
					{/if}
				</span>
			</label>
		{/each}
	</RadioGroup.Root>
   </div>
{/if}
