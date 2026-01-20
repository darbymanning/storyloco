import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { BlokSelect } from '../types.js'
import type { UUID } from 'crypto'

type Plugin = FieldPluginResponse<BlokSelect | null | ''>

type Blok = {
	_uid: UUID
	component: string
	[key: string]: unknown
}

export class BlokSelectManager {
	plugin = $state<Plugin | null>(null)
	content = $state<BlokSelect>({ id: '' })
	loaded = $derived(this.plugin?.type === 'loaded')
	bloks = $derived.by(() => {
		const story_content = this.plugin?.data?.story?.content ?? {}
		const blocks = 'blocks' in story_content ? (story_content.blocks as Array<Blok>) : import.meta.env.DEV ? [
         {
            _uid: crypto.randomUUID(),
            component: 'test-1',
            title: 'Test 1',
         },
         {
            _uid: crypto.randomUUID(),
            component: 'test-2',
            title: 'Test 2',
         },
      ] : []
		return blocks.map((blok) => {
			// try and determine the title of the blok by looking at the keys for likely candidates
			const title_keys = ['title', 'headline', 'name', 'label']
			const title = title_keys.find((key) => key in blok)

			return {
				...blok,
				_title: title ? blok[title] : null,
			}
		})
	})

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<BlokSelect>({
			enablePortalModal: true,
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (state.data?.content) this.content = state.data.content
			},
		})
	}

	select_blok = (blok_id: UUID) => {
		this.content.id = blok_id
		this.update()
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return

		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}
}
