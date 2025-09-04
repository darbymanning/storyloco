const types = [
	'text',
	'email',
	'number',
	'tel',
	'url',
	'date',
	'time',
	'datetime-local',
	'month',
	'week',
	'checkbox',
	'radio',
	'select',
	'textarea',
	'file',
	'hidden',
] as const

namespace Input {
	export type Type = (typeof types)[number]

	export type Base = {
		name: string
		type: Type
		required: boolean
		disabled: boolean
		value?: string
	}

	export type Placeholderable = Base & {
		placeholder?: string
	}

	export type File = Base & {
		type: 'file'
		multiple: boolean
		accept?: string
	}

	export type Select = Placeholderable & {
		type: 'select'
		options: Array<{ value: string; disabled: boolean; selected: boolean }>
		multiple: boolean
	}

	export type Checkbox = Omit<Base, 'required' | 'disabled'> & {
		type: 'checkbox'
		options: Array<{ value: string; required: boolean; disabled: boolean; checked: boolean }>
	}

	export type Radio = Base & {
		type: 'radio'
		options: Array<{ value: string; disabled: boolean; checked: boolean }>
	}

	export type Text = Placeholderable & {
		type: 'text'
	}

	export type Email = Placeholderable & {
		type: 'email'
	}

	export type Number = Placeholderable & {
		type: 'number'
	}

	export type Tel = Placeholderable & {
		type: 'tel'
	}

	export type URL = Placeholderable & {
		type: 'url'
	}

	export type Date = Placeholderable & {
		type: 'date'
	}

	export type Time = Placeholderable & {
		type: 'time'
	}

	export type DatetimeLocal = Placeholderable & {
		type: 'datetime-local'
	}

	export type Month = Placeholderable & {
		type: 'month'
	}

	export type Week = Placeholderable & {
		type: 'week'
	}

	export type Textarea = Placeholderable & {
		type: 'textarea'
	}

	export type Hidden = Base & {
		type: 'hidden'
	}

	export type Input =
		| File
		| Select
		| Checkbox
		| Radio
		| Text
		| Email
		| Number
		| Tel
		| URL
		| Date
		| Time
		| DatetimeLocal
		| Month
		| Week
		| Textarea
		| Hidden
}

export const types_map = new Map<Input.Type, string>([
	['text', 'Text'],
	['email', 'Email'],
	['number', 'Number'],
	['tel', 'Telephone'],
	['url', 'URL'],
	['date', 'Date'],
	['time', 'Time'],
	['datetime-local', 'Datetime Local'],
	['month', 'Month'],
	['week', 'Week'],
	['checkbox', 'Checkbox'],
	['radio', 'Radio'],
	['select', 'Select'],
	['textarea', 'Textarea'],
	['file', 'File'],
	['hidden', 'Hidden'],
] as const)

// convenient re-export to keep existing imports working
export type Input = Input.Input
