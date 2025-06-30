import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import Mux from '@mux/mux-node'
import type { Video } from '../types.js'
import { format_date, format_elapse } from 'kitto'

export type MuxAsset = Mux.Video.Assets.Asset

type Plugin = FieldPluginResponse<Video | null>

export class MuxManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Video | null>(null)
	assets = $state<Array<MuxAsset> | null>(null)
	open_actions = $state<string | null>(null)
	timeout = $state<NodeJS.Timeout | null>(null)
	video_options_open = $state(false)

	private initial = $state(true)

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
		createFieldPlugin<Video | null>({
			enablePortalModal: true,
			validateContent(content) {
				if (typeof content !== 'object') return { content: null }
				return { content: content as Video }
			},
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (this.initial && this.plugin.data?.content) {
					this.content = this.plugin.data.content
					this.initial = false
				}
			},
		})
	}

	get mux() {
		if (this.plugin?.type !== 'loaded' || !this.plugin.data.options.MOXY_SECRET_ID) return null
		return new Mux({
			baseURL: 'https://moxy.admin-54b.workers.dev/api/',
			tokenId: '',
			tokenSecret: '',
			defaultHeaders: {
				authorization: `Bearer ${this.plugin.data.options.MOXY_SECRET_ID}`,
			},
		})
	}

	get_poster(video: MuxAsset) {
		const playback_id = video.playback_ids?.[0]?.id
		return playback_id ? `https://image.mux.com/${playback_id}/thumbnail.jpg` : undefined
	}

	update(c?: Partial<Video>) {
		if (this.plugin?.type !== 'loaded') return
		const state = $state.snapshot({ ...this.content, ...c })
		this.plugin.actions.setContent(state)
	}

	set_video(video: MuxAsset | null) {
		if (!video) {
			this.content = null
			this.update()
			return
		}
		const playback_id = video.playback_ids?.[0]?.id
		this.content = {
			...this.content,
			playback_id,
			title: video.meta?.title,
			m3u8_url: playback_id ? `https://stream.mux.com/${playback_id}.m3u8` : undefined,
			poster: this.get_poster(video),
			mux_video: video,
		}
		this.update()
		this.plugin?.actions?.setModalOpen(false)
	}

	async list() {
		if (!this.mux) throw new Error('Mux not initialised')
		this.assets = (await this.mux.video.assets.list()).data
	}

	async delete(id: string) {
		if (this.plugin?.type !== 'loaded' || !this.plugin.data.options.MOXY_SECRET_ID || !this.mux)
			throw new Error('Mux not initialised')
		const confirm = window.confirm('Are you sure you want to delete this video?')
		if (!confirm) return
		if (this.assets?.length) this.assets = this.assets.filter((asset) => asset.id !== id)
		await this.mux.video.assets.delete(id)
		if (this.content?.mux_video?.id === id) this.set_video(null)
		await this.list()
	}

	async get_upload_endpoint() {
		if (!this.mux) throw new Error('Mux not initialised')
		return (
			await this.mux.video.uploads.create({
				cors_origin: 'https://storyblok.com',
				new_asset_settings: {
					playback_policy: ['public'],
					encoding_tier: 'baseline',
				},
			})
		).url
	}

	toggle_actions(id: string) {
		this.open_actions = this.open_actions === id ? null : id
	}

	async set_title(title: string, id: string) {
		if (this.timeout) clearTimeout(this.timeout)
		this.update({ title })
		this.timeout = setTimeout(async () => {
			if (!this.mux) return
			await this.mux.video.assets.update(id, {
				meta: { title },
			})
		}, 1000)
	}

	async select_poster() {
		if (!this.content?.mux_video) return
		const asset = await this.plugin?.actions?.selectAsset()
		if (!asset) this.update({ poster: this.get_poster(this.content.mux_video) })
		else this.update({ poster: asset.filename })
	}

	async delete_poster() {
		if (!this.content?.mux_video) return
		this.update({ poster: this.get_poster(this.content.mux_video) })
	}

	format_duration(seconds: number): string {
		const hours = Math.floor(seconds / 3600)
		const minutes = Math.floor((seconds % 3600) / 60)
		const remaining_seconds = Math.floor(seconds % 60)
		if (hours > 0) {
			return `${hours}:${minutes.toString().padStart(2, '0')}:${remaining_seconds.toString().padStart(2, '0')}`
		}
		return `${minutes}:${remaining_seconds.toString().padStart(2, '0')}`
	}

	date(date: string): string {
		const d = new Date(Number(date) * 1000)
		return format_elapse(d) || format_date('{MMM} {D}, {YYYY}', d)
	}

	get is_mux_poster() {
		return this.content?.poster?.startsWith('https://image.mux.com/')
	}

	get poster() {
		if (this.is_mux_poster) return `${this.content?.poster}?width=558&height=314&fit_mode=smartcrop`
		if (this.content?.poster?.endsWith('.svg')) return this.content.poster
		return `${this.content?.poster}/m/558x314/smart`
	}

	get is_modal_open() {
		return this.plugin?.type === 'loaded' && this.plugin.data?.isModalOpen
	}
}
