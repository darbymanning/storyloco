import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Asset } from '../types.js'
import ky from 'ky'
import type { R2AssetResource, R2FolderResource, R2ListResponse } from 'moxyloco/r2'

type Plugin = FieldPluginResponse<Asset | null>

export class AssetManager {
	plugin: Plugin | null = $state(null)
	content: Asset | null = $state(null)
	assets: Array<R2AssetResource> | undefined = $state(undefined)
	folders: Array<R2FolderResource> | undefined = $state(undefined)
	meta: R2ListResponse['meta'] = $state()
	open_item: R2AssetResource | undefined = $derived.by(() => {
		// State doesnt persist between modal opens, so we use sessionStorage to store which view we need
		if (sessionStorage.getItem('view') === 'details' && this.is_modal_open) {
			return this.content?._data
		}
	})
	open_actions: string | null = $state(null)
	is_image = $derived(this.open_item?.attributes.content_type?.startsWith('image/'))
	limit = 96
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

	open_item_details = (item?: R2AssetResource) => {
		if (item) sessionStorage.setItem('view', 'details')
		if (!this.is_modal_open) this.plugin?.actions?.setModalOpen(true)
		if (!item) return
		this.open_item = item
		this.set_asset(item)
	}

	close_item_details = () => {
		sessionStorage.setItem('view', 'picker')
		this.plugin?.actions?.setModalOpen(false)
		this.open_item = undefined
	}

	open_asset_picker = () => {
		sessionStorage.setItem('view', 'picker')
		this.plugin?.actions?.setModalOpen(true)
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
			prefixUrl: 'https://assets.uilo.co/api/r2/',
			headers: {
				authorization: `Bearer ${this.#secrets?.r2_secret}`,
			},
		})
	}

	update(c?: Partial<Asset>) {
		if (this.plugin?.type !== 'loaded') return
		const existing_content = this.content || {}
		const state = $state.snapshot({ ...existing_content, ...c }) as Asset
		if (!state.id) return
		this.content = state
		this.plugin.actions.setContent(state)
	}

	set_asset = (asset: R2AssetResource | null) => {
		if (!asset) {
			this.content = null
			this.update()
			return
		}

		const { alt, title, source, copyright } = asset.attributes

		const meta_data: Asset['meta_data'] = {
			alt,
			title,
			source,
			copyright,
		}

		if (asset.attributes.width && asset.attributes.height) {
			meta_data.size = `${asset.attributes.width}x${asset.attributes.height}`
		}

		this.content = {
			// Storyblok attributes
			id: asset.id,
			alt,
			filename: asset.links.self,
			focus: asset.attributes.focus,
			title,
			source,
			copyright,
			is_external_url: false,
			meta_data,

			// Additional attributes
			width: asset.attributes.width,
			height: asset.attributes.height,
			format: asset.attributes.format,
			size_bytes: asset.attributes.size_bytes,
			_data: asset,
		}

		this.update()
	}

	select = (asset: R2AssetResource | null) => {
		this.set_asset(asset)
		this.update()
		this.plugin?.actions?.setModalOpen(false)
	}

	update_asset = async (): Promise<void> => {
		if (!this.#secrets) return

		await this.r2.patch<R2AssetResource>(`${this.#secrets.r2_bucket}/${this.open_item?.id}`, {
			json: this.open_item,
		})
	}

	create_folder = async (folder: string): Promise<void> => {
		if (!this.#secrets) return
		const req = await this.r2.post(`${this.#secrets.r2_bucket}/${folder}`)
		if (req?.ok) await this.list()
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

	delete = async (asset: R2AssetResource) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((item) => item.id !== asset.id)

		await this.r2.delete(`${this.#secrets.r2_bucket}/${asset.id}`)
		if (this.content?.filename === asset.id) this.select(null)
		await this.list()
	}

	delete_multiple = async (assets: Array<string>) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets?')
		if (!confirm) return
		if (this.assets?.length)
			this.assets = this.assets.filter((item) => !assets.some((asset) => asset === item.id))

		await this.r2.delete(this.#secrets.r2_bucket, { json: assets })
		if (assets.some((e) => e === this.content?.filename)) this.select(null)
		await this.list()
	}

	save_and_close = () => {
		this.update()
		this.update_asset()
		this.close_item_details()
	}

	toggle_actions(id: string) {
		this.open_actions = this.open_actions === id ? null : id
	}

	get is_modal_open() {
		return this.plugin?.type === 'loaded' && this.plugin.data?.isModalOpen
	}

	set_focus(e: MouseEvent) {
		if (!this.content) return
		this.content.focus = e
			? `${e.offsetX}x${e.offsetY}:${e.offsetX + 1}x${e.offsetY + 1}`
			: undefined
		this.update()
	}

	upload = async (e: Event) => {
		if (!(e.target instanceof HTMLInputElement) || !e.target.files) return

		const body = new FormData()
		for (const file of e.target.files) body.append('file', file)

		if (!this.#secrets) return
		const req = await this.r2.post(this.#secrets.r2_bucket, { body })

		if (req?.ok) {
			this.list()
			e.target.value = ''
		}
	}

	next_page = () => {
		if (!this.meta?.page) return
		this.list(this.meta.page + 1)
	}

	previous_page = () => {
		if (!this.meta?.page) return
		this.list(this.meta.page - 1)
	}

	go_to_page = (page: number) => {
		if (!this.meta?.page) return
		this.list(page)
	}
}
