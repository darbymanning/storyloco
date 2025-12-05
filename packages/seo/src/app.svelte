<script lang="ts">
	import { Input, Label, Textarea, Button } from 'shared'
	import { SEOManager } from './app.svelte.js'
	import { AssetManager } from '../../asset/src/app.svelte.js'

	const seo = new SEOManager()

	$effect(() => {
		if (seo.is_modal_open) actions.select_asset()
	})

	const og = (url: string) => `${url}/m/799x551/filters:quality(85)`
	const twitter = (url: string) => `${url}/m/1600x900/filters:quality(85)`

	const actions = {
		async open_picker(type: 'og' | 'twitter'): Promise<void> {
			if (seo.has_r2) {
				sessionStorage.setItem('seo_picker_type', type)
				if (!seo.plugin) return
				if (!seo.plugin.data?.isModalOpen) await seo.plugin.actions?.setModalOpen(true)
			} else {
				const asset = await seo.plugin?.actions?.selectAsset()
				if (!asset) return
				if (type === 'og') seo.content.og_image = og(asset.filename)
				else if (type === 'twitter') seo.content.twitter_image = twitter(asset.filename)
				seo.update()
			}
		},

		async select_asset(): Promise<void> {
			const type = sessionStorage.getItem('seo_picker_type')
			if (!type) return

			const asset = await AssetManager.select_asset(seo.plugin)
			if (!asset) return

			if (type === 'og') seo.content.og_image = og(asset.filename)
			else if (type === 'twitter') seo.content.twitter_image = twitter(asset.filename)

			seo.update()
			sessionStorage.removeItem('seo_picker_type')
		},
	}
</script>

<div class="grid gap-6">
	<div class="grid gap-2">
		<Label for="title">Title</Label>
		<Input bind:value={seo.content.title} oninput={seo.update} id="title" />
	</div>

	<div class="grid gap-2">
		<Label for="description">Description</Label>
		<Textarea bind:value={seo.content.description} oninput={seo.update} id="description" />
		<small class="text-muted-foreground text-xs">
			A one to two sentence description for this object.
		</small>
	</div>

	<div class="grid gap-2">
		<Label for="og_title">OG Title</Label>
		<Input bind:value={seo.content.og_title} oninput={seo.update} id="og_title" />
		<small class="text-muted-foreground text-xs">
			The title of this object as it should appear within the graph, e.g., "The Rock".
		</small>
	</div>

	<div class="grid gap-2">
		<Label for="og_description">OG Description</Label>
		<Textarea bind:value={seo.content.og_description} oninput={seo.update} id="og_description" />
		<small class="text-muted-foreground text-xs">
			A one to two sentence description for this object.
		</small>
	</div>

	<div class="grid gap-2">
		<Label for="og_image">OG Image</Label>
		<Button onclick={() => actions.open_picker('og')} class="w-full text-start grid">
			{#if seo.content.og_image}
				<span class="truncate">{seo.content.og_image}</span>
			{:else}
				Select an asset…
			{/if}
		</Button>
		<small class="text-muted-foreground text-xs">
			The image most likely to be displayed when the object is shared on a social network.
		</small>
	</div>

	<div class="grid gap-2">
		<Label for="twitter_description">Twitter Title</Label>
		<Input bind:value={seo.content.twitter_title} oninput={seo.update} id="twitter_title" />
		<small class="text-muted-foreground text-xs">
			The title of this object as it should appear within the graph, e.g., "The Rock".
		</small>
	</div>

	<div class="grid gap-2">
		<Label for="twitter_description">Twitter Description</Label>
		<Textarea
			bind:value={seo.content.twitter_description}
			oninput={seo.update}
			id="twitter_description"
		/>
		<small class="text-muted-foreground text-xs">
			A one to two sentence description for this object.
		</small>
	</div>

	<div class="grid gap-2">
		<Label for="twitter_image">Twitter Image</Label>
		<Button onclick={() => actions.open_picker('twitter')} class="w-full text-start grid">
			{#if seo.content.twitter_image}
				<span class="truncate">{seo.content.twitter_image}</span>
			{:else}
				Select an asset…
			{/if}
		</Button>
		<small class="text-muted-foreground text-xs">
			The image most likely to be displayed when the object is shared on a social network.
		</small>
	</div>
</div>
