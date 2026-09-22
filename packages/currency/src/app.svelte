<script lang="ts">
	import { Input } from 'shared'
	import { CurrencyManager } from './app.svelte.js'

	const manager = new CurrencyManager()

	// matches the shared Input so the row lines up
	const box =
		'flex h-11.5 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm font-medium shadow-xs dark:bg-input-background'
</script>

<div class="flex items-center gap-2">
	{#if manager.currencies.length > 1}
		<!-- native select: its popup is drawn by the OS, so the iframe can't clip it -->
		<div class="w-32 shrink-0">
			<select
				class="{box} w-full pr-8 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
				aria-label="Currency"
				value={manager.currency}
				onchange={(event) => manager.set_currency(event.currentTarget.value)}
			>
				{#each manager.currencies as code (code)}
					<option value={code} class="bg-popover text-popover-foreground">
						{manager.flag_for(code)}
						{code}
					</option>
				{/each}
			</select>
		</div>
	{:else}
		<div class="{box} w-32 shrink-0">
			{manager.flag}
			{manager.currency}
		</div>
	{/if}
	<div class="relative grow">
		<span
			class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
		>
			{manager.symbol}
		</span>
		<Input
			type="text"
			inputmode="decimal"
			placeholder={(0).toFixed(manager.digits)}
			class="pl-8"
			value={manager.display}
			oninput={manager.input}
			onfocus={manager.focus}
			onblur={manager.blur}
			aria-label="Amount"
		/>
	</div>
</div>
