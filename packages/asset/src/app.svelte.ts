import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Asset } from '../types.js'
import ky from 'ky'
import type { R2Asset, Paths, R2FolderTree } from 'moxyloco/r2'
import { SvelteSet } from 'svelte/reactivity'
import { toast } from 'shared'

type Plugin = FieldPluginResponse<Asset | null>

export class AssetManager {
	plugin: Plugin | null = $state(null)
	content: Asset | null = $state(null)
	selected: Array<string> = $state([])
	expanded_folders: Set<string> = $state(new SvelteSet())
	toggle_folder_expansion = (folder_id: string) => {
		if (this.expanded_folders.has(folder_id)) {
			this.expanded_folders.delete(folder_id)
		} else {
			this.expanded_folders.add(folder_id)
		}
	}
	show_deleted = $state(false)
	search_query: string = $state('')
	loading_assets = $state(false)
	focus_x = $derived(this.content?.focus?.split(':')[0].split('x')[0])
	focus_y = $derived(this.content?.focus?.split(':')[0].split('x')[1])
	back = $state(false)
	folder_modal = $state(false)
	folder_name = $state('')
	loading = $state(false)
	create_folder_modal = $state(false)
	rename_folder_modal = $state(false)
	move_folder_modal = $state(false)
	active_folder_id = $state<string | null>(null)
	parent_folder_id = $state<string | null>(null)
	move_asset_modal = $state(false)

	close_rename_folder_modal = () => {
		this.rename_folder_modal = false
		this.folder_name = ''
		this.active_folder_id = null
	}
	open_rename_folder_modal = (folder: R2FolderTree) => {
		this.rename_folder_modal = true
		this.active_folder_id = folder.id
		this.folder_name = folder.name
		this.parent_folder_id = folder.parent_id || null
	}
	open_move_folder_modal = (folder: R2FolderTree) => {
		this.move_folder_modal = true
		this.active_folder_id = folder.id
		this.folder_name = folder.name
		this.parent_folder_id = folder.parent_id || null
	}
	close_move_folder_modal = () => {
		this.move_folder_modal = false
		this.parent_folder_id = null
	}
	open_create_folder_modal = (parent_folder_id?: string) => {
		this.create_folder_modal = true
		this.parent_folder_id = parent_folder_id || null
	}
	close_create_folder_modal = () => {
		this.create_folder_modal = false
		this.parent_folder_id = null
	}
	open_move_asset_modal = (asset_or_assets: R2Asset | Array<string>) => {
		this.move_asset_modal = true
		if (!Array.isArray(asset_or_assets)) {
			this.selected = [asset_or_assets.id]
		}
	}
	close_move_asset_modal = () => {
		this.move_asset_modal = false
		this.active_asset = undefined
		this.selected = []
	}

	assets: Array<R2Asset> | undefined = $state(undefined)
	folders: Array<R2FolderTree> | undefined = $state(undefined)
	meta: Paths.ListAssets.Responses.$200['meta'] = $state()
	active_asset: R2Asset | undefined = $derived.by(() => {
		// State doesnt persist between modal opens, so we use sessionStorage to store which view we need
		if (sessionStorage.getItem('view') === 'details' && this.is_modal_open) {
			return this.content?._data
		}
	})
	active_folder = $derived(sessionStorage.getItem('active_folder') || null)
	open_actions: string | null = $state(null)
	is_image = $derived(this.active_asset?.attributes.content_type?.startsWith('image/'))
	limit = 96
	#initial = $state(true)
	#search_timeout: number | null = $state(null)
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

	view_folder = (folder_id: string) => {
		if (folder_id) sessionStorage.setItem('active_folder', folder_id)
		this.active_folder = folder_id
		this.show_deleted = false
		this.list_assets(1)
	}

	active_asset_details = (item?: R2Asset) => {
		if (item) sessionStorage.setItem('view', 'details')
		if (!this.is_modal_open) this.plugin?.actions?.setModalOpen(true)
		if (!item) return
		this.active_asset = item
		this.set_asset(item)
	}

	close_item_details = () => {
		sessionStorage.setItem('view', 'picker')
		this.plugin?.actions?.setModalOpen(false)
		this.active_asset = undefined
	}

	open_asset_picker = () => {
		sessionStorage.setItem('view', 'picker')
		this.plugin?.actions?.setModalOpen(true)
	}

	close_modals = () => {
		this.close_move_asset_modal()
		this.close_rename_folder_modal()
		this.close_create_folder_modal()
		this.close_move_folder_modal()
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

				if (this.#initial) {
					this.#initial = false
					// initial fetch for picker view
					this.list_assets(1)
				}
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
			hooks: {
				beforeError: [
					async (error) => {
						const msg = await error.response.json<{ error: string }>()
						if (typeof msg === 'object' && 'error' in msg) {
							toast.error(msg.error)
						} else {
							toast.error('An unknown error occurred')
						}

						return error
					},
				],
			},
		})
	}

	load = async () => {
		if (!this.#secrets) return
		await this.list_assets(1)
		await this.list_folders()
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

		const { alt, title, source, copyright, name } = asset.attributes

		const meta_data: Asset['meta_data'] = {
			alt,
			title,
			source,
			copyright,
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
			name,

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
		this.loading = true

		if (this.selected.length) {
			const json: Paths.UpdateAssetsBulk.RequestBody = {
				assets: this.selected,
				metadata: {
					folder_id: this.parent_folder_id || '',
				},
			}

			await this.r2.patch<Paths.UpdateAssetsBulk.Responses.$204>(
				`${this.#secrets.r2_bucket}/assets`,
				{ json }
			)
		} else {
			const json: Paths.UpdateAssetMetadata.RequestBody = {
				...this.active_asset?.attributes,
				folder_id: this.parent_folder_id || '',
			}
			await this.r2.patch<Paths.UpdateAssetMetadata.Responses.$200>(
				`${this.#secrets.r2_bucket}/assets/${this.active_asset?.id}`,
				{
					json,
				}
			)
		}
		await this.load()
		this.close_move_asset_modal()
		this.loading = false
	}

	update_folder = async (): Promise<void> => {
		if (!this.#secrets) return
		if (!this.folder_name) return
		if (!this.active_folder_id) return
		this.loading = true
		try {
			const req = await this.r2.patch<R2FolderTree>(
				`${this.#secrets.r2_bucket}/folders/${this.active_folder_id}`,
				{
					json: { name: this.folder_name, parent_id: this.parent_folder_id },
				}
			)

			if (req.ok) await this.load()
			this.loading = false
			this.close_modals()
		} catch (error) {
			this.loading = false
		}
	}

	create_folder = async (): Promise<void> => {
		if (!this.#secrets) return
		if (!this.folder_name) return
		this.loading = true

		const json: Paths.CreateFolder.RequestBody = {
			name: this.folder_name,
			parent_id: this.parent_folder_id,
		}
		const req = await this.r2.post<Paths.CreateFolder.Responses.$201>(
			`${this.#secrets.r2_bucket}/folders`,
			{ json }
		)
		if (req.ok) await this.load()
		this.loading = false
		this.close_create_folder_modal()
		this.folder_name = ''
	}

	list_folders = async () => {
		if (!this.#secrets) return
		const res = await this.r2
			.get<Paths.ListFolders.Responses.$200>(`${this.#secrets.r2_bucket}/folders`)
			.json()
		this.folders = res.data?.structured
	}

	list_assets = async (page?: number) => {
		if (!this.#secrets) return
		this.loading_assets = true
		const params = new URLSearchParams([
			['limit', this.limit.toString()],
			['page', page?.toString() || '1'],
		])

		if (this.active_folder) params.set('folder_id', this.active_folder)
		if (this.show_deleted) params.set('deleted', 'true')
		if (this.search_query) params.set('filter[q]', this.search_query)

		const target = `${this.#secrets.r2_bucket}/assets?${params.toString()}`

		try {
			const res = await this.r2.get<Paths.ListAssets.Responses.$200>(target).json()
			this.assets = res.data
			this.meta = res.meta
		} finally {
			this.loading_assets = false
		}
	}

	search_keyup = (event: KeyboardEvent) => {
		const value = (event.target as HTMLInputElement)?.value || ''
		this.search_query = value

		if (this.#search_timeout) window.clearTimeout(this.#search_timeout)

		this.#search_timeout = window.setTimeout(() => {
			this.list_assets(1)
		}, 500)
	}

	soft_delete_asset = async (asset: R2Asset) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((item) => item.id !== asset.id)

		await this.r2.delete(`${this.#secrets.r2_bucket}/assets/${asset.id}`)
		if (this.content?.id === asset.id) this.select_asset(null)
		await this.load()
	}

	hard_delete_asset = async (asset: R2Asset) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this asset permanently?')
		if (!confirm) return
		await this.r2.delete(`${this.#secrets.r2_bucket}/assets/${asset.id}?hard=true`)
		await this.load()
	}

	hard_delete_many_assets = async (asset_ids: Array<string>) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets permanently?')
		if (!confirm) return
		await this.r2.delete(`${this.#secrets.r2_bucket}/assets?hard=true`, { json: asset_ids })
		await this.load()
		this.selected = []
	}

	soft_delete_many_assets = async (assets: Array<string>) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete these assets?')
		if (!confirm) return
		if (this.assets?.length)
			this.assets = this.assets.filter((item) => !assets.some((asset) => asset === item.id))

		await this.r2.delete(`${this.#secrets.r2_bucket}/assets`, { json: assets })
		if (assets.some((e) => e === this.content?.id)) this.select_asset(null)
		await this.load()
		this.selected = []
	}

	delete_folder = async (folder_id: string) => {
		if (!this.#secrets) return
		const confirm = window.confirm('Are you sure you want to delete this folder?')
		if (!confirm) return
		await this.r2.delete(`${this.#secrets.r2_bucket}/folders/${folder_id}`)
		await this.list_folders()
	}

	save_and_close = async () => {
		if (!this.content) return

		this.content.alt = this.active_asset?.attributes.alt
		this.content.title = this.active_asset?.attributes.title
		this.content.source = this.active_asset?.attributes.source
		this.content.copyright = this.active_asset?.attributes.copyright
		this.content.name = this.active_asset?.attributes.name

		this.update()
		await this.update_asset()
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

		if (this.active_folder) body.append('folder_id', this.active_folder)

		if (!this.#secrets) return
		const req = await this.r2.post(`${this.#secrets.r2_bucket}/assets`, { body })

		if (!req.ok) return

		this.load()
		target.value = ''
	}

	restore = async (asset: R2Asset) => {
		if (!this.#secrets) return
		await this.r2.post(`${this.#secrets.r2_bucket}/assets/${asset.id}/restore`)
		this.load()
	}

	restore_many_assets = async (asset_ids: Array<string>) => {
		if (!this.#secrets) return
		await this.r2.post(`${this.#secrets.r2_bucket}/assets/restore`, { json: asset_ids })
		this.load()
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
