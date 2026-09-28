import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import Mux from '@mux/mux-node'
import type { MuxAsset, Video, VimeoVideo } from '../types.js'
import { format_date, format_elapse } from 'kitto'
import ky, { HTTPError } from 'ky'
import * as UpChunk from '@mux/upchunk'

export type { MuxAsset }

type Plugin = FieldPluginResponse<Video | null>

// passthrough marker for assets deleted while still preparing
const PENDING_DELETE = 'delete-when-ready'

export type Job = { key: number; name: string; label: string; percent?: number; error?: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export class MuxManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Video | null>(null)
	assets = $state<Array<MuxAsset> | null>(null)
	open_actions = $state<string | null>(null)
	timeout = $state<NodeJS.Timeout | null>(null)
	video_options_open = $state(false)
	// uploads and imports in flight; percent is undefined while there's no measurable progress
	jobs = $state<Array<Job>>([])

	// sign-in (OAuth) connections from the Mux Library space plugin can't delete: Mux answers
	// DELETE with 404 for them. null until moxy has said which kind this field's secret is.
	connection = $state<{
		sign_in: boolean
		environment_id: string | null
		organization_id: string | null
	} | null>(null)
	// a video Mux wouldn't let us delete, so the field can point to the Mux dashboard instead
	undeletable = $state<{ title: string; url: string } | null>(null)

	#poll: NodeJS.Timeout | null = $state(null)
	#initial = $state(true)
	#secrets: { mux_secret: string; vimeo_secret?: string } | null = $derived.by(() => {
		if (this.plugin?.type !== 'loaded') return null

		const mux_secret = this.plugin.data.options.MOXY_MUX_SECRET_ID
		const vimeo_secret = this.plugin.data.options.MOXY_VIMEO_SECRET_ID

		return { mux_secret, vimeo_secret }
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

	private initialize_plugin() {
		createFieldPlugin<Video | null>({
			enablePortalModal: true,
			validateContent(content) {
				if (typeof content !== 'object') return { content: null }
				return { content: content as Video }
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

	get mux() {
		return new Mux({
			baseURL: 'https://moxy.uilo.co/api/mux/',
			// moxy swaps in the real credentials; the SDK just refuses to run with empty ones
			tokenId: 'moxy',
			tokenSecret: 'moxy',
			defaultHeaders: {
				authorization: `Bearer ${this.#secrets?.mux_secret}`,
			},
		})
	}

	get vimeo() {
		return ky.create({
			prefixUrl: 'https://moxy.uilo.co/api/vimeo/',
			headers: {
				authorization: `Bearer ${this.#secrets?.vimeo_secret}`,
			},
		})
	}

	get_poster(video: MuxAsset) {
		const playback_id = video.playback_ids?.[0]?.id
		return playback_id ? `https://image.mux.com/${playback_id}/thumbnail.jpg` : undefined
	}

	update(c?: Partial<Video>) {
		if (this.plugin?.type !== 'loaded') return
		const existing_content = this.content || {}
		const state = $state.snapshot({ ...existing_content, ...c })
		this.content = state
		this.plugin.actions.setContent(state)
	}

	set_video = (video: MuxAsset | null) => {
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

	// ponytail: a failed lookup leaves connection null, so the field keeps its old delete behaviour
	#load_connection = async () => {
		this.connection ??= await ky
			.get('https://moxy.uilo.co/api/mux-connection', {
				headers: { authorization: `Bearer ${this.#secrets?.mux_secret}` },
			})
			.json<NonNullable<MuxManager['connection']>>()
			.catch(() => null)
	}

	// the dashboard needs the organization in the path; without it, it can land on the wrong org
	#dashboard_url = (id: string) => {
		const { organization_id, environment_id } = this.connection ?? {}
		return organization_id && environment_id
			? `https://dashboard.mux.com/organizations/${organization_id}/environments/${environment_id}/video/assets/${id}`
			: 'https://dashboard.mux.com'
	}

	list = async () => {
		if (!this.mux) throw new Error('Mux not initialised')
		// every page, not just Mux's first 100 videos
		const list_all = async () => {
			const assets = []
			for await (const asset of this.mux.video.assets.list({ limit: 100 })) assets.push(asset)
			return assets
		}
		const [assets] = await Promise.all([list_all(), this.#load_connection()])

		// finish deferred deletes (see `delete`) now Mux allows them; failures just retry next list.
		// Sign-in connections can never delete, so their flagged videos stay listed rather than vanish.
		if (!this.connection?.sign_in) {
			await Promise.allSettled(
				assets
					.filter((asset) => asset.passthrough === PENDING_DELETE && asset.status !== 'preparing')
					.map((asset) => this.mux.video.assets.delete(asset.id))
			)
		}
		this.assets = this.connection?.sign_in
			? assets
			: assets.filter((asset) => asset.passthrough !== PENDING_DELETE)

		// keeps polling for pending deletes too, so they go as soon as they're ready
		const has_preparing = assets.some(({ status }) => status === 'preparing')

		if (has_preparing)
			this.#poll = setTimeout(this.list, 3000) // 3 seconds
		else if (this.#poll) clearTimeout(this.#poll)
	}

	delete = async (id: string) => {
		if (this.plugin?.type !== 'loaded' || !this.plugin.data.options.MOXY_MUX_SECRET_ID || !this.mux)
			throw new Error('Mux not initialised')
		const asset = this.assets?.find((asset) => asset.id === id)
		const undeletable = () =>
			(this.undeletable = {
				title: asset?.meta?.title || 'this video',
				url: this.#dashboard_url(id),
			})
		this.undeletable = null
		if (this.connection?.sign_in) return undeletable()

		const confirm = window.confirm('Are you sure you want to delete this video?')
		if (!confirm) return
		const before = this.assets
		if (this.assets?.length) this.assets = this.assets.filter((asset) => asset.id !== id)
		try {
			// Mux refuses to delete (or abort) a preparing asset, so flag it and let `list` delete it once ready
			if (asset?.status === 'preparing')
				await this.mux.video.assets.update(id, { passthrough: PENDING_DELETE })
			else await this.mux.video.assets.delete(id)
		} catch (error) {
			// a 404 for a video we can still list means Mux won't let this connection delete it
			if ((error as { status?: number }).status === 404 && asset) {
				this.assets = before
				return undeletable()
			}
			throw error
		}
		if (this.content?.mux_video?.id === id) this.set_video(null)
		await this.list()
	}

	get_upload_endpoint = async (title?: string) => {
		if (!this.mux) throw new Error('Mux not initialised')

		return (
			await this.mux.video.uploads.create({
				cors_origin: 'https://storyblok.com',
				new_asset_settings: {
					playback_policy: ['public'],
					encoding_tier: 'baseline',
					...(title && { meta: { title } }),
				},
			})
		).url
	}

	#start_job(name: string, label: string) {
		this.jobs.push({ key: Math.random(), name, label })
		return this.jobs[this.jobs.length - 1]
	}

	dismiss_job = (job: Job) => (this.jobs = this.jobs.filter((j) => j.key !== job.key))

	// runs an upload or import as a job; failures stay on the job until dismissed
	async #run_job(name: string, label: string, work: (job: Job) => Promise<void>) {
		const job = this.#start_job(name, label)
		try {
			await work(job)
			this.dismiss_job(job)
			await this.list()
		} catch (error) {
			job.error =
				error instanceof HTTPError
					? ((await error.response.json().catch(() => null))?.message ?? error.message)
					: message(error)
		}
	}

	// chunked, resumable uploads straight to Mux (UpChunk is what mux-uploader uses underneath)
	upload_files = (files: FileList | Array<File> | null | undefined) => {
		for (const file of files ?? []) {
			if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) continue
			this.#run_job(file.name, 'Uploading…', async (job) => {
				const endpoint = await this.get_upload_endpoint(file.name.replace(/\.[^.]+$/, ''))
				await new Promise<void>((resolve, reject) => {
					const upload = UpChunk.createUpload({ endpoint, file })
					upload.on('progress', (e) => (job.percent = Math.round(e.detail)))
					upload.on('success', () => resolve())
					upload.on('error', (e) => reject(new Error(e.detail.message)))
				})
			})
		}
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
		if (!this.content?.mux_video || !this.plugin?.actions) return
		const asset = await this.plugin.actions.selectAsset()
		if (asset) this.update({ poster: asset.filename })
		else this.update({ poster: this.get_poster(this.content.mux_video) })
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

	// '' for content saved without a date (e.g. written by hand or by an older version)
	date(date?: string): string {
		if (!date) return ''
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

	#youtube_label(progress?: { stage?: string; part?: number }) {
		switch (progress?.stage) {
			case 'downloading':
				return `Downloading ${progress.part === 2 ? 'audio' : 'video'} from YouTube…`
			case 'merging':
				return 'Merging video and audio…'
			case 'uploading':
				return 'Uploading to Mux…'
			case 'finishing':
				return 'Handing over to Mux…'
			default:
				return 'Starting YouTube import…'
		}
	}

	get has_vimeo() {
		return !!this.#secrets?.vimeo_secret
	}

	// true once the link is accepted; the import itself runs as a job
	add_vimeo_url = (e: Event) => {
		e.preventDefault()
		const form = e.target
		if (!(form instanceof HTMLFormElement)) return false

		// handles vimeo.com/867092030, /867092030/02e4819d25, /channels/staffpicks/867092030 and similar
		const vimeo_regex =
			/vimeo\.com\/(?:channels\/\w+\/|groups\/\w+\/|album\d+\/|video\/)?(\d+)(?:\/[\w-]+)?/
		const video_id = form.vimeo_url.value.match(vimeo_regex)?.[1]
		if (!video_id) return false
		form.reset()

		void this.#run_job(`Vimeo video ${video_id}`, 'Importing from Vimeo…', async (job) => {
			const video = await this.vimeo.get<VimeoVideo>(`videos/${video_id}`).json()
			job.name = video.name
			const largest_file = video.files.find(
				(file) => file.size === Math.max(...video.files.map((file) => file.size))
			)
			if (!largest_file) throw new Error('Vimeo has no downloadable file for this video')

			await this.mux.video.assets.create({
				inputs: [{ url: largest_file.link }],
				playback_policy: ['public'],
				encoding_tier: 'baseline',
				meta: { title: video.name, external_id: video_id },
			})
		})
		return true
	}

	add_youtube_url = (e: Event) => {
		e.preventDefault()
		const form = e.target
		if (!(form instanceof HTMLFormElement)) return false

		// handles watch?v=, youtu.be/, shorts/, embed/, live/ and m./music. subdomains
		const match = form.youtube_url.value.match(
			/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/|v\/))([\w-]{11})/
		)
		const video_id = match?.[1]
		if (!video_id) return false
		form.reset()

		void this.#run_job(`YouTube video ${video_id}`, this.#youtube_label(), async (job) => {
			// moxy downloads the video and pushes it into a Mux direct upload, streaming NDJSON progress
			const res = await ky.post('https://moxy.uilo.co/api/youtube', {
				json: { video_id },
				headers: { authorization: `Bearer ${this.#secrets?.mux_secret}` },
				timeout: false,
			})
			const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
			let buffer = ''
			let upload_id: string | undefined
			let done = false
			for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
				const lines = (buffer + chunk.value).split('\n')
				buffer = lines.pop()!
				for (const line of lines.filter(Boolean)) {
					const event = JSON.parse(line)
					if (event.error) throw new Error(`YouTube import failed: ${event.error}`)
					if (event.upload_id) upload_id = event.upload_id
					else if (event.done) done = true
					else {
						job.label = this.#youtube_label(event)
						job.percent = event.percent == null ? undefined : Math.round(event.percent)
					}
				}
			}
			if (!upload_id || !done) throw new Error('YouTube import stopped unexpectedly')

			// the asset appears once Mux has picked up the finished upload
			job.label = this.#youtube_label({ stage: 'finishing' })
			job.percent = undefined
			while ((await this.mux.video.uploads.retrieve(upload_id)).status === 'waiting') {
				await new Promise((resolve) => setTimeout(resolve, 1000))
			}
		})
		return true
	}
}
