import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { ChurchsuiteCategories, ChurchsuiteCategory } from '../types.js'

type Plugin = FieldPluginResponse<ChurchsuiteCategories | null>

export class CategoriesManager {
	plugin = $state<Plugin | null>(null)
	selected = $state<ChurchsuiteCategories>([])
	categories = $state<Array<ChurchsuiteCategory> | null>(null)
	error = $state<string | null>(null)
	endpoint = $derived(
		this.plugin?.type === 'loaded' ? (this.plugin.data.options.endpoint as string) || null : null
	)
	missing_options = $derived(this.plugin?.type === 'loaded' && !this.endpoint)
	loading = $derived(this.categories === null && !this.error && !this.missing_options)

	constructor() {
		$effect(() => {
			if (this.endpoint) this.load(this.endpoint)
		})

		createFieldPlugin<ChurchsuiteCategories | null>({
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				const content = state.data?.content
				// legacy values can hold the ids as strings
				if (Array.isArray(content)) this.selected = content.map(Number)
			},
		})
	}

	load = async (endpoint: string) => {
		try {
			const response = await fetch(endpoint)
			if (!response.ok) throw new Error(`${response.status}`)
			const categories: Array<ChurchsuiteCategory> = await response.json()
			this.categories = categories.toSorted((a, b) => a.name.localeCompare(b.name))
			this.error = null
		} catch {
			this.error = 'Could not load categories from ChurchSuite'
		}
	}

	toggle = (id: number) =>
		this.set(
			this.selected.includes(id)
				? this.selected.filter((selected) => selected !== id)
				: [...this.selected, id]
		)

	set = (ids: ChurchsuiteCategories) => {
		this.selected = ids
		if (this.plugin?.type !== 'loaded') return
		this.plugin.actions.setContent($state.snapshot(this.selected))
	}
}
