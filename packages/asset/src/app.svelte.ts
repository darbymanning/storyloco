import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Asset } from '../types.js'
import ky from 'ky'
import type { R2Asset, R2Folder, Paths } from 'moxyloco/r2'

type Plugin = FieldPluginResponse<Asset | null>

export class AssetManager {
	plugin: Plugin | null = $state(null)
	content: Asset | null = $state(null)
	selected: Array<string> = $state([])
	expanded_folders: Array<boolean> = $state([])
	show_deleted = $state(false)
	focus_x = $derived(this.content?.focus?.split(':')[0].split('x')[0])
	focus_y = $derived(this.content?.focus?.split(':')[0].split('x')[1])
	back = $state(false)
	folder_modal = $state(false)
	folder_name = $state('')
	loading = $state(false)

	assets: Array<R2Asset> | undefined = $state(undefined)
	folders: Array<R2Folder> | undefined = $state(undefined)
	meta: Paths.ListAssets.Responses.$200['meta'] = $state()
	open_item: R2Asset | undefined = $derived.by(() => {
		// State doesnt persist between modal opens, so we use sessionStorage to store which view we need
		if (sessionStorage.getItem('view') === 'details' && this.is_modal_open) {
			return this.content?._data
		}
	})
	active_folder = $derived(sessionStorage.getItem('active_folder') || null)
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

	select_folder = (folder: string | null) => {
		this.show_deleted = false
		if (folder) sessionStorage.setItem('active_folder', folder)
		else sessionStorage.removeItem('active_folder')
		this.active_folder = folder
	}

	open_item_details = (item?: R2Asset) => {
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
				// mirror incoming content exactly; include null to clear ui state
				this.content = (this.plugin.data?.content as Asset | null) ?? null
				if (this.#initial) this.#initial = false
			},
		})
	}

	get r2() {
		return ky.create({
			prefixUrl: import.meta.env.DEV
				? 'http://localhost:5173/api/r2/'
				: 'https://assets.uilo.co/api/r2/',
			headers: {
				authorization: `Bearer ${this.#secrets?.r2_secret}`,
			},
		})
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return
		const state = $state.snapshot(this.content)
		this.content = state
		this.plugin.actions.setContent(state)
	}

	set_asset = (asset: R2Asset | null) => {
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
			filename: asset.links?.self || '',
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

	select_asset = (asset: R2Asset | null) => {
		this.set_asset(asset)
		if (this.is_modal_open) this.plugin?.actions?.setModalOpen(false)
	}

	update_asset = async (): Promise<void> => {
		if (!this.#secrets) return

		await this.r2.patch<R2Asset>(`${this.#secrets.r2_bucket}/assets/${this.open_item?.id}`, {
			json: this.open_item,
		})
	}

	create_folder = async (folder: string): Promise<void> => {
		if (!this.#secrets) return
		const current_folder = this.active_folder
		const path = current_folder ? `${current_folder}/${folder}` : folder
		const req = await this.r2.post(`${this.#secrets.r2_bucket}/folders`, {
			json: { path },
		})
		if (req?.ok) await this.list_folders()
	}

	list_folders = async () => {
		if (!this.#secrets) return
		const res = await this.r2
			.get<Paths.ListFolders.Responses.$200>(`${this.#secrets.r2_bucket}/folders`)
			.json()
		this.folders = res.data
	}

	list_assets = async (page?: number) => {
		if (!this.#secrets) return

		const params = new URLSearchParams([
			['limit', this.limit.toString()],
			['page', page?.toString() || '1'],
		])

		if (this.active_folder) params.set('folder_path', this.active_folder)
		if (this.show_deleted) params.set('deleted', 'true')

		const target = `${this.#secrets.r2_bucket}/assets?${params.toString()}`

		const res = await this.r2.get<Paths.ListAssets.Responses.$200>(target).json()
		this.assets = res.data
		this.meta = res.meta
	}

	delete_asset = async (asset: R2Asset) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((item) => item.id !== asset.id)

		await this.r2.delete(`${this.#secrets.r2_bucket}/assets/${asset.id}`)
		if (this.content?.id === asset.id) this.select_asset(null)
		await this.list_assets()
	}

	delete_many_assets = async (assets: Array<string>) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets?')
		if (!confirm) return
		if (this.assets?.length)
			this.assets = this.assets.filter((item) => !assets.some((asset) => asset === item.id))

		await this.r2.delete(`${this.#secrets.r2_bucket}/assets`, { json: assets })
		if (assets.some((e) => e === this.content?.id)) this.select_asset(null)
		await this.list_assets()
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

	upload = async ({ target }: Event) => {
		if (!(target instanceof HTMLInputElement) || !target.files) return

		const body = new FormData()
		for (const file of target.files) body.append('file', file)

		if (this.active_folder) body.append('folder_path', this.active_folder)

		if (!this.#secrets) return
		const req = await this.r2.post(`${this.#secrets.r2_bucket}/assets`, { body })

		if (!req.ok) return

		this.list_assets()
		target.value = ''
	}

	restore = async (asset: R2Asset) => {
		if (!this.#secrets) return
		await this.r2.post(`${this.#secrets.r2_bucket}/assets/${asset.id}/restore`)
		this.list_assets()
	}

	restore_multiple = async (asset_ids: Array<string>) => {
		if (!this.#secrets) return
		await this.r2.post(`${this.#secrets.r2_bucket}/restore`, { json: asset_ids })
	}

	next_page = () => {
		if (!this.meta?.page) return
		this.list_assets(this.meta.page + 1)
	}

	previous_page = () => {
		if (!this.meta?.page) return
		this.list_assets(this.meta.page - 1)
	}

	go_to_page = (page: number) => {
		if (!this.meta?.page) return
		this.list_assets(page)
	}
}
