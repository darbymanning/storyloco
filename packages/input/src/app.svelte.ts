import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Input } from '../types.js'
import { merge } from 'lodash-es'

type Plugin = FieldPluginResponse<Input | null | ''>

export class InputManager {
	plugin = $state<Plugin | null>(null)
	content = $state<Input>({
		name: '',
		type: 'text',
		required: false,
		disabled: false,
	})

	show_options = $state(false)

	can_be_multiple = (content: Input): content is Input & { multiple: boolean } => {
		return ['file', 'select'].includes(content.type)
	}

	can_have_options = (
		content: Input
	): content is Input & {
		options: Array<{ value: string; required?: boolean; disabled: boolean; checked?: boolean }>
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
			required?: boolean
			disabled?: boolean
			checked?: boolean
			selected?: boolean
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
						this.content.options = [{ value: '', required: false, disabled: false, checked: false }]
						break

					case 'radio':
						this.content.options = [{ value: '', disabled: false, checked: false }]
						break

					case 'select':
						this.content.options = [
							{ value: '', disabled: false, selected: false, required: false },
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

		let option

		switch (this.content.type) {
			case 'select':
				option = { value: '', disabled: false, selected: false, required: false }

				break

			case 'checkbox':
				option = { value: '', required: false, disabled: false, checked: false }
				break

			case 'radio':
				option = { value: '', disabled: false, checked: false }
				break

			default:
				break
		}

		insert(this.content.options.length, option)

		this.update()
	}

	delete_option = (index: number) => {
		if (!this.has_options(this.content)) return
		this.content.options = this.content.options.filter((_, i) => i !== index)
		this.update()
	}
}
