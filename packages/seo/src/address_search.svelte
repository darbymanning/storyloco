<script lang="ts">
	import { Input } from 'shared'
	import { search_addresses, type Address, type FoundAddress } from '../../vite/src/lib/photon.js'

	let { label, onpick }: { label: string; onpick: (address: Address) => void } = $props()

	let query = $state('')
	let results = $state<Array<FoundAddress>>([])
	let status = $state<'idle' | 'empty' | 'failed'>('idle')
	let input = $state<HTMLInputElement | null>(null)
	let list = $state<HTMLUListElement | null>(null)
	let timer: ReturnType<typeof setTimeout>
	let controller: AbortController | undefined

	function search() {
		clearTimeout(timer)
		controller?.abort()
		results = []
		status = 'idle'
		if (query.trim().length < 3) return
		timer = setTimeout(async () => {
			controller = new AbortController()
			try {
				results = await search_addresses(query.trim(), controller.signal)
				if (!results.length) status = 'empty'
			} catch (error) {
				if ((error as Error).name !== 'AbortError') status = 'failed'
			}
		}, 300)
	}

	function pick(found: FoundAddress) {
		onpick(found.address)
		query = ''
		results = []
		input?.focus()
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			query = ''
			search()
		} else if (event.key === 'ArrowDown' && results.length) {
			event.preventDefault()
			list?.querySelector('button')?.focus()
		}
	}
</script>

<div class="grid grid-cols-1 gap-1">
	<Input
		bind:ref={input}
		type="search"
		placeholder="Search for an address…"
		aria-label={label}
		autocomplete="off"
		bind:value={query}
		oninput={search}
		{onkeydown}
	/>
	{#if results.length}
		<ul
			bind:this={list}
			class="divide-y divide-input rounded-md border border-input"
			aria-label="Addresses found"
		>
			{#each results as found (found.label)}
				<li>
					<button
						class="w-full px-3 py-2 text-left text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
						onclick={() => pick(found)}
					>
						{found.label}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="text-xs text-muted-foreground" role="status">
		{#if status === 'empty'}
			No address found. Fill it in below.
		{:else if status === 'failed'}
			Address search is unavailable. Fill it in below.
		{/if}
	</p>
</div>
