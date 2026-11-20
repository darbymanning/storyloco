<script lang="ts">
	import { tick } from 'svelte'
	import { Button, Input, Label, Switch, Textarea } from 'shared'
	import { ChevronRightIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
	import {
		is_profile_url,
		tidy_organization,
		type OrganizationEntity,
	} from '../../vite/src/lib/seo.js'
	import type { SEOManager } from './app.svelte.js'
	import AddressSearch from './address_search.svelte'

	let { seo }: { seo: SEOManager } = $props()

	// a working copy: the saved value has its blank rows taken out, and a row just added is blank
	const org = $state({
		legal_name: '',
		founding_date: '',
		description: '',
		disambiguating_description: '',
		same_as: [] as Array<string>,
		brands: [] as Array<string>,
		entities: [] as Array<OrganizationEntity>,
		// svelte-ignore state_referenced_locally
		...$state.snapshot(seo.content.organization),
	})

	const summary = $derived(
		[
			org.legal_name.trim(),
			org.entities.length &&
				`${org.entities.length} ${org.entities.length === 1 ? 'entity' : 'entities'}`,
		]
			.filter(Boolean)
			.join(' · ')
	)

	function save() {
		const tidy = tidy_organization($state.snapshot(org))
		if (tidy) seo.content.organization = tidy
		else delete seo.content.organization
		seo.update()
	}

	async function add<T>(rows: Array<T>, row: T, event: MouseEvent) {
		const list = (event.currentTarget as HTMLElement).closest('fieldset')
		rows.push(row)
		await tick()
		const inputs = list?.querySelectorAll<HTMLInputElement>('[data-first]')
		inputs?.[inputs.length - 1]?.focus()
	}

	function remove(rows: Array<unknown>, index: number, event: MouseEvent) {
		// the button goes with its row, so hand focus to the list's add button
		const list = (event.currentTarget as HTMLElement).closest('fieldset')
		rows.splice(index, 1)
		save()
		list?.querySelector<HTMLButtonElement>('[data-add]')?.focus()
	}

	function set_head_office(entity: OrganizationEntity, on: boolean) {
		for (const other of org.entities) other.head_office = false
		entity.head_office = on
		save()
	}

	const HOSTS: Record<string, string> = {
		'linkedin.com': 'LinkedIn',
		'youtube.com': 'YouTube',
		'wikidata.org': 'Wikidata',
		'wikipedia.org': 'Wikipedia',
		'crunchbase.com': 'Crunchbase',
		'company-information.service.gov.uk': 'Companies House',
		'opencorporates.com': 'OpenCorporates',
		'x.com': 'X',
		'twitter.com': 'X',
		'facebook.com': 'Facebook',
		'instagram.com': 'Instagram',
		'github.com': 'GitHub',
	}

	function profile_label(url: string) {
		const host = URL.parse(url.trim())?.hostname
		if (!host) return
		for (const domain in HOSTS)
			if (host === domain || host.endsWith(`.${domain}`)) return HOSTS[domain]
	}

	const small_button =
		'size-6 shrink-0 rounded-md flex items-center justify-center transition-colors outline-none text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-destructive/10 hover:text-destructive'
	const small_label = 'text-xs text-muted-foreground'
	const hint = 'text-muted-foreground text-xs'
</script>

{#snippet AddButton(label: string, onclick: (event: MouseEvent) => void)}
	<Button
		variant="ghost"
		class="justify-self-start text-teal-muted hover:text-teal-muted"
		data-add
		{onclick}
	>
		<PlusIcon class="size-4" />
		{label}
	</Button>
{/snippet}

<details class="group rounded-md border border-input">
	<summary
		class="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-3 text-sm font-medium outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
	>
		<ChevronRightIcon
			class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
		/>
		Organisation
		<span class="ml-auto min-w-0 truncate text-xs font-normal text-muted-foreground">
			{summary}
		</span>
	</summary>

	<div class="grid grid-cols-1 gap-6 border-t border-input p-3">
		<p class={hint}>
			Who is behind the site, for search engines and AI assistants. Everything is optional.
		</p>

		<div class="grid gap-2">
			<Label for="org_legal_name">Legal name</Label>
			<Input id="org_legal_name" bind:value={org.legal_name} oninput={save} />
		</div>

		<div class="grid gap-2">
			<Label for="org_founding_date">Founded</Label>
			<Input id="org_founding_date" type="date" bind:value={org.founding_date} oninput={save} />
		</div>

		<div class="grid gap-2">
			<Label for="org_description">Description</Label>
			<Textarea id="org_description" bind:value={org.description} oninput={save} />
		</div>

		<div class="grid gap-2">
			<Label for="org_disambiguating_description">Not to be confused with</Label>
			<Textarea
				id="org_disambiguating_description"
				bind:value={org.disambiguating_description}
				oninput={save}
			/>
			<small class={hint}>
				A sentence that tells it apart from similarly named organisations.
			</small>
		</div>

		<fieldset class="grid grid-cols-1 gap-2">
			<legend class="mb-2 text-sm leading-none font-medium">Profiles</legend>
			{#each org.same_as as url, index (index)}
				{@const label = profile_label(url)}
				<div class="flex items-center gap-1">
					<div class="relative min-w-0 flex-1">
						<Input
							type="url"
							placeholder="https://"
							aria-label="Profile {index + 1} URL"
							aria-invalid={(url.trim() && !is_profile_url(url.trim())) || undefined}
							class={label ? 'pr-28' : ''}
							data-first
							bind:value={org.same_as[index]}
							oninput={save}
						/>
						{#if label}
							<span
								class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
							>
								{label}
							</span>
						{/if}
					</div>
					<button
						class={small_button}
						aria-label="Remove profile {index + 1}"
						title="Remove profile"
						onclick={(event) => remove(org.same_as, index, event)}
					>
						<TrashIcon class="size-4" />
					</button>
				</div>
			{/each}
			{@render AddButton('Add profile', (event) => add(org.same_as, '', event))}
			{#if !org.same_as.length}
				<small class={hint}>
					Its pages elsewhere: LinkedIn, YouTube, Wikidata, Crunchbase, Companies House…
				</small>
			{/if}
		</fieldset>

		<fieldset class="grid grid-cols-1 gap-2">
			<legend class="mb-2 text-sm leading-none font-medium">Brands</legend>
			{#each org.brands as _, index (index)}
				<div class="flex items-center gap-1">
					<Input
						aria-label="Brand {index + 1} name"
						class="min-w-0 flex-1"
						data-first
						bind:value={org.brands[index]}
						oninput={save}
					/>
					<button
						class={small_button}
						aria-label="Remove brand {index + 1}"
						title="Remove brand"
						onclick={(event) => remove(org.brands, index, event)}
					>
						<TrashIcon class="size-4" />
					</button>
				</div>
			{/each}
			{@render AddButton('Add brand', (event) => add(org.brands, '', event))}
		</fieldset>

		<fieldset class="grid grid-cols-1 gap-2">
			<legend class="mb-2 text-sm leading-none font-medium">Legal entities</legend>
			{#each org.entities as entity, index (index)}
				{@const id = `org_entity_${index}`}
				<div
					class="@container grid grid-cols-1 gap-1.5 rounded-md border border-input p-3"
					role="group"
					aria-label={entity.name?.trim() || `Legal entity ${index + 1}`}
				>
					<div class="flex h-6 items-center gap-1">
						<Label for="{id}_name" class={small_label}>Registered name</Label>
						<button
							class="{small_button} ml-auto -mr-1"
							aria-label="Remove {entity.name?.trim() || `legal entity ${index + 1}`}"
							title="Remove legal entity"
							onclick={(event) => remove(org.entities, index, event)}
						>
							<TrashIcon class="size-4" />
						</button>
					</div>
					<Input id="{id}_name" data-first bind:value={entity.name} oninput={save} />

					<div class="mt-2">
						<AddressSearch
							label="Search for the address of {entity.name?.trim() || `legal entity ${index + 1}`}"
							onpick={(address) => {
								Object.assign(entity, address)
								save()
							}}
						/>
					</div>

					<Label for="{id}_street" class={small_label}>Street address</Label>
					<Input id="{id}_street" autocomplete="off" bind:value={entity.street} oninput={save} />

					<div class="mt-1 grid grid-cols-1 gap-2 @min-[16rem]:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="{id}_locality" class={small_label}>Town or city</Label>
							<Input
								id="{id}_locality"
								autocomplete="off"
								bind:value={entity.locality}
								oninput={save}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="{id}_region" class={small_label}>State or region</Label>
							<Input
								id="{id}_region"
								autocomplete="off"
								bind:value={entity.region}
								oninput={save}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="{id}_postal_code" class={small_label}>Postcode</Label>
							<Input
								id="{id}_postal_code"
								autocomplete="off"
								bind:value={entity.postal_code}
								oninput={save}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="{id}_country" class={small_label}>Country code</Label>
							<Input
								id="{id}_country"
								autocomplete="off"
								placeholder="GB"
								maxlength={2}
								class="uppercase placeholder:normal-case"
								bind:value={() => entity.country, (code) => (entity.country = code?.toUpperCase())}
								oninput={save}
							/>
						</div>
					</div>

					<div class="mt-2 flex items-center gap-2">
						<Switch
							id="{id}_head_office"
							bind:checked={() => entity.head_office ?? false, (on) => set_head_office(entity, on)}
						/>
						<Label for="{id}_head_office">Head office</Label>
					</div>
				</div>
			{/each}
			{@render AddButton('Add legal entity', (event) =>
				add(org.entities, { head_office: !org.entities.length }, event)
			)}
			{#if !org.entities.length}
				<small class={hint}>
					The registered companies and their addresses. The head office's address is the
					organisation's own.
				</small>
			{/if}
		</fieldset>
	</div>
</details>
