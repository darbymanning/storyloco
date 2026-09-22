import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { Currency } from '../types.js'

type Plugin = FieldPluginResponse<Currency | null | ''>

const upper = (value: string) => value.trim().toUpperCase() as Uppercase<string>

const DEFAULT_CURRENCY = 'GBP'
const FALLBACK = [DEFAULT_CURRENCY, 'USD', 'EUR']

export class CurrencyManager {
	plugin = $state<Plugin | null>(null)
	currency = $state<Uppercase<string>>(DEFAULT_CURRENCY)
	amount = $state<number | null>(null)
	// what's in the box: kept as text so typing "12." or "12.5" isn't rewritten mid-edit
	display = $state('')
	// setContent echoes back through onUpdateState; while typing, the box is the source of truth
	editing = false

	// `currencies` is a comma separated list of ISO 4217 codes
	currencies = $derived.by(() => {
		const raw = this.plugin?.type === 'loaded' ? this.plugin.data.options.currencies : ''
		const list = String(raw ?? '')
			.split(',')
			.map((code) => code.trim().toUpperCase())
			.filter(Boolean)
		const codes = list.length ? list : FALLBACK
		// keep a stored code selectable even if it was later removed from the options
		return this.currency && !codes.includes(this.currency) ? [...codes, this.currency] : codes
	})

	symbol = $derived.by(() => {
		try {
			const parts = new Intl.NumberFormat(undefined, {
				style: 'currency',
				currency: this.currency,
				currencyDisplay: 'narrowSymbol',
			}).formatToParts(0)
			return parts.find((part) => part.type === 'currency')?.value ?? this.currency
		} catch {
			return this.currency
		}
	})

	// ISO 4217 codes start with the country code, so this covers nearly all of them (EUR -> EU)
	flag_for = (code: string) =>
		/^[A-Z]{3}$/.test(code)
			? String.fromCodePoint(...[...code.slice(0, 2)].map((char) => 0x1f1a5 + char.charCodeAt(0)))
			: ''

	flag = $derived(this.flag_for(this.currency))

	// minor units for the selected currency: 2 for GBP, 0 for JPY, 3 for KWD
	digits = $derived.by(() => {
		try {
			return (
				new Intl.NumberFormat(undefined, {
					style: 'currency',
					currency: this.currency,
				}).resolvedOptions().maximumFractionDigits ?? 2
			)
		} catch {
			return 2
		}
	})

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<Currency>({
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (state.type !== 'loaded') return

				const content = state.data.content
				const fallback = upper(String(state.data.options.default_currency ?? ''))
				this.currency = content?.currency || fallback || DEFAULT_CURRENCY
				if (this.editing) return
				this.amount = content?.amount ?? null
				this.format()
			},
		})
	}

	set_currency = (value: string) => {
		this.currency = upper(value)
		this.format()
		this.update()
	}

	// fixed locale so "," always groups and "." is always the decimal point when parsing
	private group = (whole: string) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

	focus = () => {
		this.editing = true
	}

	blur = () => {
		this.editing = false
		this.format()
	}

	format = () => {
		this.display =
			this.amount === null
				? ''
				: new Intl.NumberFormat('en', {
						minimumFractionDigits: this.digits,
						maximumFractionDigits: this.digits,
					}).format(this.amount)
	}

	input = (event: Event & { currentTarget: HTMLInputElement }) => {
		const el = event.currentTarget
		const caret = el.selectionStart ?? el.value.length
		// how many digits/points sit before the caret, so it can be put back after regrouping
		const significant = el.value.slice(0, caret).replace(/[^\d.]/g, '').length

		const raw = el.value.replace(/[^\d.]/g, '')
		// keep a single decimal point and no more places than the currency has
		const [whole = '', ...rest] = raw.split('.')
		const decimals = rest.join('').slice(0, this.digits)
		const has_point = rest.length > 0 && this.digits > 0
		const clean = has_point ? `${whole}.${decimals}` : whole

		this.display = has_point
			? `${this.group(whole.replace(/^0+(?=\d)/, ''))}.${decimals}`
			: this.group(whole.replace(/^0+(?=\d)/, ''))
		el.value = this.display

		let pos = 0
		for (let seen = 0; pos < this.display.length && seen < significant; pos++) {
			if (/[\d.]/.test(this.display[pos] ?? '')) seen++
		}
		el.setSelectionRange(pos, pos)

		const parsed = parseFloat(clean)
		this.amount = Number.isNaN(parsed) ? null : parsed
		this.update()
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return

		const amount =
			typeof this.amount === 'number' && !Number.isNaN(this.amount) ? this.amount : null
		const formatted =
			amount === null
				? null
				: new Intl.NumberFormat('en', {
						style: 'currency',
						currency: this.currency,
						currencyDisplay: 'narrowSymbol',
					}).format(amount)
		this.plugin.actions.setContent({ currency: this.currency, amount, formatted })
	}
}
