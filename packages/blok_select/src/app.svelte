<script lang="ts">
	import { BlokSelectManager, type Blok } from './app.svelte.js'
	import { RadioGroup } from 'shared'
	import type { UUID } from 'crypto'

	const blok_select = new BlokSelectManager()
</script>

{#snippet Badge(text: string)}
	<span class="bg-muted-foreground/10 px-2 py-1 rounded-md">{text}</span>
{/snippet}

{#snippet blok_node(blok: Blok, top_level: boolean)}
	{#if top_level}
		<div class="grid gap-1 rounded border border-border/50 bg-muted/10 p-2">
			<label class="flex flex-wrap items-center gap-2 cursor-pointer">
				<RadioGroup.Item value={blok._uid} />
				{@render Badge(blok.component)}
				{#if blok_select.blok_display_label(blok)}
					<span class="text-xs">{blok_select.blok_display_label(blok)}</span>
				{/if}
				{#if blok_select.blok_has_blocks(blok)}
					<span class="text-muted-foreground text-xs">({blok.blocks!.length})</span>
				{/if}
			</label>
			{#if blok_select.blok_has_blocks(blok)}
				<details class="group ml-2 border-l border-border pl-2 open:pb-1">
					<summary
						class="cursor-pointer list-none text-xs text-muted-foreground flex items-center gap-1 [&::-webkit-details-marker]:hidden"
					>
						<span class="inline-block transition-transform group-open:rotate-90" aria-hidden="true"
							>▸</span
						>
						Nested bloks
					</summary>
					<div class="mt-1 grid gap-1">
						{#each blok.blocks! as child (child._uid)}
							{@render blok_node(child, false)}
						{/each}
					</div>
				</details>
			{/if}
		</div>
	{:else if blok_select.blok_has_blocks(blok)}
		<div class="grid gap-1 rounded border border-border/50 bg-muted/10 p-2">
			<label class="flex flex-wrap items-center gap-2 cursor-pointer">
				<RadioGroup.Item value={blok._uid} />
				{@render Badge(blok.component)}
				{#if blok_select.blok_display_label(blok)}
					<span class="text-xs">{blok_select.blok_display_label(blok)}</span>
				{/if}
				<span class="text-muted-foreground text-xs">({blok.blocks!.length})</span>
			</label>
			<details class="group ml-2 border-l border-border pl-2 open:pb-1">
				<summary
					class="cursor-pointer list-none text-xs text-muted-foreground flex items-center gap-1 [&::-webkit-details-marker]:hidden"
				>
					<span class="inline-block transition-transform group-open:rotate-90" aria-hidden="true"
						>▸</span
					>
					Nested bloks
				</summary>
				<div class="mt-1 grid gap-1">
					{#each blok.blocks! as child (child._uid)}
						{@render blok_node(child, false)}
					{/each}
				</div>
			</details>
		</div>
	{:else}
		<div class="text-xs text-muted-foreground py-0.5 pl-2 border-l border-transparent">
			<span class="font-mono text-[0.65rem]">{blok.component}</span>
			{#if blok_select.blok_display_label(blok)}
				<span class="ml-2 text-foreground">{blok_select.blok_display_label(blok)}</span>
			{/if}
		</div>
	{/if}
{/snippet}

{#if blok_select.bloks?.length}
	<div class="grid rounded-md">
		<RadioGroup.Root
			class="gap-2 border rounded-md p-2"
			bind:value={blok_select.content.id}
			onValueChange={(value: UUID | undefined) => {
				if (value) blok_select.select_blok(value)
			}}
		>
			{#each blok_select.bloks as blok}
				{@render blok_node(blok, true)}
			{/each}
		</RadioGroup.Root>
	</div>
{/if}
