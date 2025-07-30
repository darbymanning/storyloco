import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { ISbStories } from '@storyblok/js'
import type { Link, LinkType, Rel, Target } from '../types.js'
import { LinkIcon, ExternalLinkIcon, MailIcon, ImageIcon } from '@lucide/svelte'
import { format_date, format_elapse } from 'kitto'

type Plugin = FieldPluginResponse<Link | null>

export class LinkManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Link>({ type: 'internal' })

	private initial = $state(true)

	// story search state
	stories = $state<ISbStories['data']['stories']>([])
	timeout = $state<NodeJS.Timeout | null>(null)
	loading = $state(false)

	// pagination
	per_page = 10
	page = $state(1)
	total = $state(0)
	next = $derived(this.page < Math.ceil(this.total / this.per_page))
	prev = $derived(this.page > 1)

	// filters
	filter_content_types = $state(new Set<string>(['page']))

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
	loaded = $derived(this.plugin?.type === 'loaded')
	token = $derived(this.plugin?.data?.token || import.meta.env.VITE_STORYBLOK_API_TOKEN)
	Icon = $derived(this.icon_map.get(this.content.type))

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
					this.content = state.data.content
					this.initial = false
				} else if (state.data?.content === null) {
					// initialize with default content if none exists
					this.content = { type: 'internal' }
				}
			},
		})
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
				break

			case 'asset':
				delete this.content.asset
				delete this.content.target
				break

			case 'external':
				delete this.content.target
				delete this.content.rel
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
				name: story.name,
				published_at: story.published_at,
			},
		}

		this.update()
		this.plugin.actions.setModalOpen(false)
	}

	search = async (event: Event) => {
		const input = event.target as HTMLInputElement

		if (this.timeout) clearTimeout(this.timeout)

		this.timeout = setTimeout(async () => {
			this.loading = true
			await this.get_stories({ search_term: input.value })
			this.loading = false
		}, 500)
	}

	get_stories = async (params: { search_term?: string; page?: number } = {}): Promise<void> => {
		if (!this.plugin || !this.token) throw new Error('Plugin not loaded')

		const url = new URL('https://api.storyblok.com/v2/cdn/stories')

		url.searchParams.set('token', this.token)
		url.searchParams.set('per_page', this.per_page.toString())
		url.searchParams.set('version', 'draft')
		if (!params.search_term) url.searchParams.set('sort_by', 'name:asc')
		url.searchParams.set('cv', Date.now().toString())
		url.searchParams.set('page', params.page?.toString() || '1')
		url.searchParams.set(
			'filter_query[component][in]',
			Array.from(this.filter_content_types).join(',')
		)

		if (params.search_term) url.searchParams.set('search_term', params.search_term)

		const result = await fetch(url.toString())
		const data = (await result.json()) as ISbStories['data']

		// update pagination state
		this.total = Number(result.headers.get('total') || 0)
		if (params.page) this.page = params.page

		this.stories = data.stories
	}

	get_content_types = async (): Promise<Set<string>> => {
		if (!this.plugin || !this.token) throw new Error('Plugin not loaded')

		const url = new URL('https://api.storyblok.com/v2/cdn/stories')

		url.searchParams.set('token', this.token)
		url.searchParams.set('per_page', '-1')
		url.searchParams.set('version', 'draft')
		url.searchParams.set('cv', Date.now().toString())

		const result = await fetch(url.toString())
		const data = (await result.json()) as ISbStories['data']

		return new Set(
			data.stories.map((story) => story.content.component).filter(Boolean) as Array<string>
		)
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
			const url = new URL(`mailto:${this.content.email}`)
			if (this.content.subject) url.searchParams.set('subject', this.content.subject)
			if (this.content.body) url.searchParams.set('body', this.content.body)
			if (this.content.cc) url.searchParams.set('cc', this.content.cc)
			if (this.content.bcc) url.searchParams.set('bcc', this.content.bcc)
			this.content.url = url.toString()
		}

		this.update()
	}

	select_asset = async () => {
		if (!this.plugin?.actions) return
		const asset = await this.plugin.actions.selectAsset()

		if (!asset) return

		this.content.url = asset.filename
		if (this.content.type === 'asset') {
			this.content.asset = asset
		}
		this.update()
	}

	// utility methods
	set_modal_open = (is_open: boolean) => {
		if (!this.plugin?.actions) return
		this.plugin.actions.setModalOpen(is_open)
	}

	title_case = (str: string) => {
		return str.charAt(0).toUpperCase() + str.slice(1)
	}

	date = (date?: string | null): string => {
		if (!date) return 'N/A'
		return format_elapse(date) || format_date('{MMM} {D}, {YYYY} at {h}:{mm} {A}', date)
	}
}
