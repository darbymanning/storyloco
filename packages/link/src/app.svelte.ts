import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { ISbStories } from '@storyblok/js'
import { link_types, type Link, type LinkType, type Rel, type Target } from '../types.js'
import type { HubspotForm } from '../../hubspot_form/types.js'
import { HubspotForms } from '../../hubspot_form/src/forms.svelte.js'
import { LinkIcon, ExternalLinkIcon, MailIcon, ImageIcon, ClipboardListIcon } from '@lucide/svelte'
import type { Asset } from '../../asset/types.js'
import { link_types_of, mailto, plugin_link } from '../../vite/src/lib/link.js'

type Plugin = FieldPluginResponse<Link | null>

export class LinkManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Link>({ type: 'internal' })
	loaded = $derived(this.plugin?.type === 'loaded')

	private initial = $state(true)

	// rel state
	rel_checkboxes = $state(new Set<Rel>(['noopener', 'noreferrer', 'nofollow']))
	rel = $state<Array<Rel>>([])
	rel_open = $state(false)

	// maps
	icon_map = new Map<LinkType, any>([
		['asset', ImageIcon],
		['external', ExternalLinkIcon],
		['email', MailIcon],
		['internal', LinkIcon],
		['form', ClipboardListIcon],
	])

	target_map = new Map<Target, string>([
		['_self', 'Self'],
		['_blank', 'Blank'],
		['_parent', 'Parent'],
		['_top', 'Top'],
		['_new', 'New'],
	])

	// view state
	show_options = $state(false)

	// derived state
	is_modal_open = $derived(this.plugin?.type === 'loaded' && this.plugin.data?.isModalOpen)
	token = $derived(this.plugin?.data?.token || import.meta.env.VITE_STORYBLOK_API_TOKEN)
	Icon = $derived(this.icon_map.get(this.content.type))

	// the HubSpot space plugin fills this in on fields it connects
	#hubspot_secret = $derived.by(() =>
		this.plugin?.type === 'loaded' ? this.plugin.data.options.MOXY_HUBSPOT_SECRET_ID : undefined
	)
	// as the asset field reckons it set up: both R2 options filled in
	#r2 = $derived.by(() => {
		const options = this.plugin?.type === 'loaded' ? this.plugin.data.options : {}
		return !!options.MOXY_R2_SECRET_ID && !!options.R2_BUCKET
	})
	// the field's own say in it: its `link_types` option, e.g. `internal, url, form`
	#allowed = $derived.by(() =>
		link_types_of(this.plugin?.type === 'loaded' ? this.plugin.data.options.link_types : undefined)
	)
	/**
	 * The types this field offers: the ones its `link_types` option names, in that order, or else
	 * all of them; asset and form links only where R2 and HubSpot are connected. A field set to
	 * nothing it can serve offers what it can, and a link saved as a type it no longer offers still
	 * shows as what it is.
	 */
	types = $derived.by(() => {
		const servable = (type: LinkType) =>
			type === 'asset' ? this.#r2 : type === 'form' ? !!this.#hubspot_secret : true
		const offered = (this.#allowed ?? link_types).filter(servable)
		const types = offered.length ? offered : link_types.filter(servable)
		return types.includes(this.content.type) ? types : [...types, this.content.type]
	})
	// listed only once a form link needs them, not on every link field
	hubspot = new HubspotForms(() =>
		this.content.type === 'form' ? this.#hubspot_secret : undefined
	)

	constructor() {
		this.initialize_plugin()

		$effect(() => {
			document.documentElement.setAttribute(
				'data-modal-open',
				this.is_modal_open ? 'true' : 'false'
			)
		})
	}

	private initialize_plugin() {
		createFieldPlugin<Link>({
			enablePortalModal: true,
			onUpdateState: (state) => {
				this.plugin = state as Plugin

				// maintain state when rerendering after selecting a story
				if (this.initial && state.data?.content) {
					// a field switched from Storyblok's own link holds its old links in that shape
					this.content = plugin_link(state.data.content as never) as unknown as Link
					this.initial = false
					this.name_story()
				} else if (!state.data?.content) {
					// a new link starts as the first type the field offers
					this.content = { type: this.types[0] }
				}
			},
		})
	}

	/** An old link's story by its uuid, for its name: shown, not saved until something changes */
	private name_story = async () => {
		const story = this.content.type === 'internal' ? this.content.story : undefined
		if (!story?.uuid || story.name || !this.token) return
		const url = new URL(`https://api.storyblok.com/v2/cdn/stories/${story.uuid}`)
		url.searchParams.set('find_by', 'uuid')
		url.searchParams.set('version', 'draft')
		url.searchParams.set('token', this.token)
		url.searchParams.set('cv', Date.now().toString())
		const response = await fetch(url).catch(() => null)
		if (!response?.ok || this.content.type !== 'internal') return
		const { story: found } = (await response.json()) as ISbStories['data'] & {
			story: ISbStories['data']['stories'][number]
		}
		this.content.story = {
			id: found.id,
			uuid: found.uuid,
			name: found.name,
			published_at: found.published_at,
		}
	}

	update = () => {
		if (!this.plugin?.actions) return
		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}

	// action methods
	clear = () => {
		delete this.content.url

		switch (this.content.type) {
			case 'internal':
				delete this.content.story
				delete this.content.target
				delete this.content.suffix
				delete this.content.fieldtype
				delete this.content.linktype
				delete this.content.id
				delete this.content.cached_url
				break

			case 'asset':
				delete this.content.asset
				delete this.content.target
				break

			case 'external':
				delete this.content.target
				delete this.content.rel
				break

			case 'form':
				delete this.content.form
				break

			case 'email':
				delete this.content.email
				delete this.content.subject
				delete this.content.body
				delete this.content.cc
				delete this.content.bcc
				break
		}

		this.update()
	}

	select_story = (story: ISbStories['data']['stories'][number]) => {
		if (!this.plugin?.actions) return

		this.content = {
			type: 'internal',
			text: this.content.text || story.name,
			url: story.path || '/' + story.full_slug,
			story: {
				id: story.id,
				uuid: story.uuid,
				name: story.name,
				published_at: story.published_at,
			},
			fieldtype: 'multilink',
			linktype: 'story',
			id: story.uuid,
			cached_url: story.full_slug,
		}

		this.update()
	}

	select_form = (form: HubspotForm | null) => {
		if (this.content.type !== 'form') return
		if (form) this.content.form = form
		else delete this.content.form
		this.update()
	}

	update_email = () => {
		if (!this.plugin || this.content.type !== 'email') return
		if (!this.content.subject) delete this.content.subject
		if (!this.content.body) delete this.content.body
		if (!this.content.cc) delete this.content.cc
		if (!this.content.bcc) delete this.content.bcc

		if (!this.content.email) {
			delete this.content.email
			delete this.content.url
		}

		if (this.content.email) {
			const { email, subject, body, cc, bcc } = this.content
			this.content.url = mailto(email, { subject, body, cc, bcc })
		}

		this.update()
	}

	select_asset = async (asset: Asset) => {
		if (this.content.type !== 'asset') return

		this.content.url = asset.filename
		this.content.asset = asset
		this.update()
	}

	/** As Storyblok's own link field names them, so the two read alike side by side */
	type_label = (type: LinkType) =>
		({
			internal: 'Internal link',
			external: 'URL',
			email: 'Email',
			asset: 'Asset',
			form: 'HubSpot form',
		})[type]
}
