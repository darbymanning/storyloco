import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Input, Field } from '../types.js'
import { merge } from 'lodash-es'
import { SvelteSet } from 'svelte/reactivity'

type Plugin = FieldPluginResponse<Input | null | ''>

export class InputManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Input>({
		name: '',
		label: '',
		type: 'text',
		required: false,
		disabled: false,
	})
	custom_name = $state(false)
	show_options = $state(false)
	open_options = new SvelteSet<string>()
	unlocked_values = new SvelteSet<string>()
	#update_timeout = $state<NodeJS.Timeout | null>(null)

	can_be_multiple = (content: Input): content is Input & { multiple: boolean } => {
		return ['file', 'select'].includes(content.type)
	}

	can_have_options = (
		content: Input
	): content is Input & {
		options: Array<{
			value: string
			label: string
			required?: boolean
			disabled: boolean
			checked?: boolean
			id: string
		}>
	} => {
		return ['select', 'checkbox', 'radio'].includes(content.type)
	}

	can_be_required = (content: Input): content is Input & { required: boolean } => {
		return !['checkbox', 'hidden'].includes(content.type)
	}

	can_have_placeholder = (content: Input): content is Input & { placeholder: string } => {
		return [
			'text',
			'email',
			'url',
			'tel',
			'textarea',
			'select',
			'number',
			'date',
			'time',
			'datetime-local',
			'month',
			'week',
		].includes(content.type)
	}

	can_be_disabled = (content: Input): content is Input & { disabled: boolean } => {
		return !['radio', 'hidden', 'checkbox'].includes(content.type)
	}

	can_have_value = (content: Input): content is Input => {
		return [
			'text',
			'email',
			'url',
			'tel',
			'textarea',
			'number',
			'date',
			'time',
			'datetime-local',
			'month',
			'week',
			'hidden',
		].includes(content.type)
	}

	has_options = (
		content: any
	): content is {
		options: Array<{
			value: string
			label: string
			required?: boolean
			disabled?: boolean
			checked?: boolean
			selected?: boolean
			id: string
		}>
	} => {
		return 'options' in content
	}

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<Input>({
			onUpdateState: (state) => {
				this.plugin = state as Plugin

				const incoming_content = state.data?.content
				if (!incoming_content) return

				// merge the incoming content instead of replacing it entirely
				// this preserves object references for dnd
				merge(this.content, incoming_content)
			},
		})
	}

	update = () => {
		if (this.#update_timeout) clearTimeout(this.#update_timeout)
		this.#update_timeout = setTimeout(this.#update, 1000)
	}

	#update = () => {
		if (this.plugin?.type !== 'loaded') return

		// ensure required is not present for checkbox
		if (this.content.type === 'checkbox') {
			if ('required' in this.content) delete this.content.required
		} else {
			// ensure required is present for all other types
			this.content.required = this.content.required ??= false
		}

		const prev_type =
			typeof this.plugin.data.content !== 'string' ? this.plugin.data.content?.type : null

		const type_changed = this.content.type !== prev_type

		if (type_changed) {
			// ensure options is present for multiple input types
			if (this.can_have_options(this.content)) {
				switch (this.content.type) {
					case 'checkbox':
						this.content.options = [
							{
								value: '',
								label: '',
								required: false,
								disabled: false,
								checked: false,
								id: crypto.randomUUID(),
							},
						]
						break

					case 'radio':
						this.content.options = [
							{ value: '', disabled: false, checked: false, label: '', id: crypto.randomUUID() },
						]
						break

					case 'select':
						this.content.options = [
							{
								value: '',
								disabled: false,
								selected: false,
								label: '',
								id: crypto.randomUUID(),
							},
						]
						break

					default:
						break
				}
			} else {
				if (this.has_options(this.content)) delete (this.content as any).options
			}

			// ensure multiple is present for file input
			if (this.can_be_multiple(this.content)) this.content.multiple ??= false

			if (this.content.type !== 'checkbox') this.content.disabled = this.content.disabled ??= false
		}

		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}

	add_option = (insert: (index: number, item: any) => void) => {
		if (!this.can_have_options(this.content)) return

		let option:
			| Field.Select['options'][number]
			| Field.Checkbox['options'][number]
			| Field.Radio['options'][number]
			| undefined

		switch (this.content.type) {
			case 'select':
				option = {
					value: '',
					disabled: false,
					selected: false,
					label: '',
					id: crypto.randomUUID(),
				}
				break

			case 'checkbox':
				option = {
					value: '',
					label: '',
					required: false,
					disabled: false,
					checked: false,
					id: crypto.randomUUID(),
				}
				break

			case 'radio':
				option = {
					value: '',
					label: '',
					disabled: false,
					checked: false,
					id: crypto.randomUUID(),
				}
				break

			default:
				break
		}

		if (option) insert(this.content.options.length, option)

		this.update()
	}

	toggle_options = (index: number) => {
		if (!this.has_options(this.content)) return

		const option = this.content.options[index]
		if (!option || !('id' in option) || !option.id) return

		if (this.open_options.has(option.id)) {
			this.open_options.delete(option.id)
		} else {
			this.open_options.add(option.id)
		}
	}
}
