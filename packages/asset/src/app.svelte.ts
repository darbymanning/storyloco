import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Asset } from '../types.js'
import { format_date, format_elapse } from 'kitto'
import ky from 'ky'
import type { R2AssetResource, R2FolderResource, R2ListResponse } from 'moxyloco/r2'

export type R2List = any
export type R2Item = any

type Plugin = FieldPluginResponse<Asset | null>

export class AssetManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Asset | null>(null)
	assets = $state<Array<R2AssetResource> | undefined>(undefined)
	folders = $state<Array<R2FolderResource> | undefined>(undefined)
	meta = $state()
	open_item: R2AssetResource | undefined = $state(undefined)
	open_actions = $state<string | null>(null)
	limit = 2

	#initial = $state(true)
	#secrets: {
		r2_secret: string
		r2_bucket: string
	} | null = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null

		const r2_secret = this.plugin.data.options.MOXY_R2_SECRET_ID
		const r2_bucket = this.plugin.data.options.R2_BUCKET

		return { r2_secret, r2_bucket }
	})

	constructor() {
		this.initialize_plugin()

		$effect(() => {
			document.documentElement.setAttribute(
				'data-modal-open',
				this.is_modal_open ? 'true' : 'false'
			)
		})
	}

	open_item_details(item: R2Item) {
		if (!this.is_modal_open) this.plugin?.actions?.setModalOpen(true)
		this.open_item = item
		this.content = {
			...this.content,
			filename: `https://r2.uilo.co/${item.id}`,
			meta_data: {
				alt: item.alt,
				title: item.title,
				source: item.source,
				copyright: item.copyright,
				width: Number(item.Metadata.width),
				height: Number(item.Metadata.height),
				format: item.Metadata.format,
			},
		}
	}

	close_item_details() {
		this.plugin?.actions?.setModalOpen(false)
		this.open_item = undefined
	}

	private initialize_plugin() {
		createFieldPlugin<Asset | null>({
			enablePortalModal: true,
			validateContent(content) {
				if (typeof content !== 'object') return { content: null }
				return { content: content as Asset }
			},
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (this.plugin.data?.content) {
					this.content = this.plugin.data.content
					if (this.#initial) this.#initial = false
				}
			},
		})
	}

	get r2() {
		return ky.create({
			prefixUrl: 'https://moxy.uilo.co/api/r2/',
			headers: {
				authorization: `Bearer ${this.#secrets?.r2_secret}`,
			},
		})
	}

	update(c?: Partial<Asset>) {
		if (this.plugin?.type !== 'loaded') return
		const existing_content = this.content || {}
		const state = $state.snapshot({ ...existing_content, ...c })
		this.content = state
		this.plugin.actions.setContent(state)
	}

	set_asset = (asset: Asset | null) => {
		if (!asset) {
			this.content = null
			this.update()
			return
		}

		this.content = {
			...this.content,
			...asset.meta_data,
		}
		this.update()
		this.plugin?.actions?.setModalOpen(false)
	}

	update_asset = async () => {
		if (!this.#secrets) return

		const req = await this.r2.put(`${this.#secrets.r2_bucket}/${this.open_item?.id}`, {
			json: this.open_item?.attributes,
		})
		return req?.ok
	}

	create_folder = async (folder: string) => {
		if (!this.#secrets) return
		const req = await this.r2.post<R2List>(`${this.#secrets.r2_bucket}/${folder}`)
		return req?.ok
	}

	list = async (page?: number) => {
		if (!this.#secrets) return

		const params = new URLSearchParams([
			['limit', this.limit.toString()],
			['page', page?.toString() || '1'],
		])

		const res = await this.r2
			.get<R2ListResponse>(`${this.#secrets.r2_bucket}?${params.toString()}`)
			.json()
		this.assets = res.data
		this.folders = res.included
		this.meta = res.meta
	}

	upload = async (body: File) => {
		if (!this.#secrets) return
		const req = await this.r2.post<R2List>(this.#secrets.r2_bucket, { body })

		return req?.ok
	}

	delete = async (asset: Asset) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((item) => item.id !== asset.id)

		await this.r2.delete(`${this.#secrets.r2_bucket}/${asset.id}`)
		if (this.content?.filename === asset.id) this.set_asset(null)
		await this.list()
	}

	delete_multiple = async (assets: Asset[]) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((item) => !assets.includes(item.id))

		await this.r2.delete(this.#secrets.r2_bucket, { json: assets.map((e) => e.id) })
		if (assets.some((e) => e.id === this.content?.filename)) this.set_asset(null)
		await this.list()
	}

	date(date: string): string {
		const d = new Date(Number(date) * 1000)
		return format_elapse(d) || format_date('{MMM} {D}, {YYYY}', d)
	}

	toggle_actions(id: string) {
		this.open_actions = this.open_actions === id ? null : id
	}

	get is_modal_open() {
		return this.plugin?.type === 'loaded' && this.plugin.data?.isModalOpen
	}
}
