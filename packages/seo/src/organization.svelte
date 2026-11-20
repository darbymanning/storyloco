<script lang="ts">
	import { tick } from 'svelte'
	import { Button, Input, Label, Switch, Textarea } from 'shared'
	import { ChevronRightIcon, PlusIcon, TrashIcon } from '@lucide/svelte'
	import {
		is_profile_url,
		parse_url,
		tidy_organization,
		type OrganizationEntity,
	} from '../../vite/src/lib/seo.js'
	import type { SEOManager } from './app.svelte.js'
	import AddressSearch from './address_search.svelte'

	let { seo }: { seo: SEOManager } = $props()

	// only the working copy has ids: a card keeps its own state when one above it is removed
	type Entity = OrganizationEntity & { id: number }
	let next_id = 0

	// a working copy: the saved value has its blank rows taken out, and a row just added is blank
	function working_copy() {
		const saved = $state.snapshot(seo.content.organization)
		return {
			legal_name: '',
			founding_date: '',
			description: '',
			disambiguating_description: '',
			same_as: [] as Array<string>,
			brands: [] as Array<string>,
			...saved,
			entities: (saved?.entities ?? []).map((entity): Entity => ({ ...entity, id: next_id++ })),
		}
	}

	const org = $state(working_copy())

	const json = () => JSON.stringify(seo.content.organization) ?? ''
	// what the field holds as far as this copy knows, and the saves Storyblok has yet to send back
	let known = json()
	const sent: Array<string> = []

	// Storyblok sends every save back, later, and by then there may be a newer one: only a value
	// that isn't one of ours came from outside, and replaces the working copy
	$effect(() => {
		const incoming = json()
		if (incoming === known) return
		const echo = sent.indexOf(incoming)
		if (echo >= 0) {
			sent.splice(0, echo + 1)
			return
		}
		known = incoming
		sent.length = 0
		Object.assign(org, working_copy())
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
		const draft = $state.snapshot(org)
		// a row still holding only its site's prefix has no profile in it yet
		draft.same_as = draft.same_as.filter((url) => !SITES.some((site) => site.prefix === url.trim()))
		const tidy = tidy_organization(draft)
		if (tidy) seo.content.organization = tidy
		else delete seo.content.organization
		known = json()
		sent.push(known)
		if (sent.length > 20) sent.shift()
		seo.update()
	}

	async function add<T>(rows: Array<T>, row: T, event: Event) {
		const list = (event.currentTarget as HTMLElement).closest('fieldset')
		rows.push(row)
		await tick()
		const input = [...(list?.querySelectorAll<HTMLInputElement>('[data-first]') ?? [])].at(-1)
		input?.focus()
		return input
	}

	function remove(rows: Array<unknown>, index: number, event: MouseEvent) {
		// the button goes with its row, so hand focus to the list's add button
		const list = (event.currentTarget as HTMLElement).closest('fieldset')
		rows.splice(index, 1)
		save()
		list?.querySelector<HTMLButtonElement>('[data-add]')?.focus()
	}

	function set_head_office(entity: Entity, on: boolean) {
		for (const other of org.entities) other.head_office = false
		entity.head_office = on
		save()
	}

	// where an organisation usually has a page, and how that page's address starts
	const SITES = [
		{ label: 'LinkedIn', host: 'linkedin.com', prefix: 'https://www.linkedin.com/company/' },
		{ label: 'YouTube', host: 'youtube.com', prefix: 'https://www.youtube.com/@' },
		{ label: 'X', host: 'x.com', prefix: 'https://x.com/' },
		{ label: 'Facebook', host: 'facebook.com', prefix: 'https://www.facebook.com/' },
		{ label: 'Instagram', host: 'instagram.com', prefix: 'https://www.instagram.com/' },
		{ label: 'GitHub', host: 'github.com', prefix: 'https://github.com/' },
		{ label: 'Wikipedia', host: 'wikipedia.org', prefix: 'https://en.wikipedia.org/wiki/' },
		{ label: 'Wikidata', host: 'wikidata.org', prefix: 'https://www.wikidata.org/wiki/' },
		{
			label: 'Crunchbase',
			host: 'crunchbase.com',
			prefix: 'https://www.crunchbase.com/organization/',
		},
		{
			label: 'Companies House',
			host: 'company-information.service.gov.uk',
			prefix: 'https://find-and-update.company-information.service.gov.uk/company/',
		},
		{
			label: 'OpenCorporates',
			host: 'opencorporates.com',
			prefix: 'https://opencorporates.com/companies/',
		},
	]

	function profile_label(url: string) {
		// X's old address still works, and plenty of profiles still use it
		const host = parse_url(url.trim())?.hostname.replace(/(^|\.)twitter\.com$/, '$1x.com')
		return SITES.find((site) => host === site.host || host?.endsWith(`.${site.host}`))?.label
	}

	async function add_profile(event: Event) {
		const select = event.currentTarget as HTMLSelectElement
		const prefix = SITES.find((site) => site.label === select.value)?.prefix ?? ''
		select.value = ''
		const input = await add(org.same_as, prefix, event)
		input?.setSelectionRange(prefix.length, prefix.length)
	}

	const small_button =
		'size-6 shrink-0 rounded-md flex items-center justify-center transition-colors outline-none text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-destructive/10 hover:text-destructive'
	const hint = 'text-xs text-muted-foreground'
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
			<Input
				id="org_founding_date"
				type="date"
				max={new Date().toLocaleDateString('en-CA')}
				class="invalid:border-destructive"
				bind:value={org.founding_date}
				oninput={save}
			/>
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
			<select
				class="h-9 cursor-pointer justify-self-start rounded-md bg-transparent px-2 text-sm font-medium text-teal-muted outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
				aria-label="Add a profile"
				data-add
				onchange={add_profile}
			>
				<option value="">+ Add profile…</option>
				{#each SITES as site (site.label)}
					<option>{site.label}</option>
				{/each}
				<option>Another link</option>
			</select>
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
			{#each org.entities as entity, index (entity.id)}
				{@const id = `org_entity_${entity.id}`}
				<div
					class="@container grid grid-cols-1 gap-1.5 rounded-md border border-input p-3"
					role="group"
					aria-label={entity.name?.trim() || `Legal entity ${index + 1}`}
				>
					<div class="flex h-6 items-center gap-1">
						<Label for="{id}_name" class={hint}>Registered name</Label>
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

					<Label for="{id}_street" class={hint}>Street address</Label>
					<Input id="{id}_street" autocomplete="off" bind:value={entity.street} oninput={save} />

					<div class="mt-1 grid grid-cols-1 gap-2 @min-[16rem]:grid-cols-2">
						<div class="grid gap-1.5">
							<Label for="{id}_locality" class={hint}>Town or city</Label>
							<Input
								id="{id}_locality"
								autocomplete="off"
								bind:value={entity.locality}
								oninput={save}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="{id}_region" class={hint}>State or region</Label>
							<Input
								id="{id}_region"
								autocomplete="off"
								bind:value={entity.region}
								oninput={save}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="{id}_postal_code" class={hint}>Postcode</Label>
							<Input
								id="{id}_postal_code"
								autocomplete="off"
								bind:value={entity.postal_code}
								oninput={save}
							/>
						</div>
						<div class="grid gap-1.5">
							<Label for="{id}_country" class={hint}>Country code</Label>
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
				add(org.entities, { id: next_id++, head_office: !org.entities.length }, event)
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
