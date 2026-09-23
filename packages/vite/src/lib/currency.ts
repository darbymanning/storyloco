/**
 * Narrow `Code` to the codes configured in the field's `currencies` option,
 * e.g. `Currency<'GBP' | 'USD'>`.
 */
export interface Currency<Code extends string = Uppercase<string>> {
	/** ISO 4217 code, e.g. `GBP` */
	currency: Code
	amount: number | null
	/** `amount` formatted for display, e.g. `£130,000.00`; `null` when there's no amount */
	formatted: string | null
}

/** The field's value as Storyblok stores it, `plugin` key included — what a Management API write needs. */
export type CurrencyField<Code extends string = Uppercase<string>> = Currency<Code> & {
	plugin: "uiloco-currency"
}

/** `amount` as the plugin displays it, e.g. `£1,234.50`. The plugin formats with this, so the two can't drift. */
export function format_currency(amount: number, currency: string = "GBP"): string {
	return new Intl.NumberFormat("en", {
		style: "currency",
		currency,
		currencyDisplay: "narrowSymbol",
	}).format(amount)
}

function minor_digits(currency: string): number {
	return (
		new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
			.maximumFractionDigits ?? 2
	)
}

/**
 * A spreadsheet cell or plain number as the `uiloco-currency` field's value:
 * `to_currency('£1,234.50', 'GBP')` → `{ plugin, currency: 'GBP', amount: 1234.5, formatted: '£1,234.50' }`.
 *
 * Takes what a CSV export of money looks like — a leading symbol or code, thousands
 * commas — and throws on anything else rather than guessing: negatives, `POA`, a
 * decimal comma, or more places than the currency has (`1.005` in GBP). An import
 * should stop on a bad row, not write a wrong price. Blank returns `null`.
 */
export function to_currency<Code extends Uppercase<string> = "GBP">(
	value: string | number | null | undefined,
	currency: Code = "GBP" as Code
): CurrencyField<Code> | null {
	if (value === null || value === undefined) return null
	const input = String(value).trim()
	if (input === "") return null

	const raw = input
		.replace(/^[^\d\s.,-]{1,3}\s?/, "")
		.replace(/\s?[A-Z]{3}$/, "")
		.replace(/,(?=\d{3}(?:\D|$))/g, "")
	const match = /^(\d+)(?:\.(\d+))?$/.exec(raw)
	if (!match) throw new RangeError(`Not a ${currency} amount: ${JSON.stringify(value)}`)
	if ((match[2]?.length ?? 0) > minor_digits(currency)) {
		throw new RangeError(`${JSON.stringify(value)} has more decimal places than ${currency} allows`)
	}

	const amount = Number(raw)
	return {
		plugin: "uiloco-currency",
		currency,
		amount,
		formatted: format_currency(amount, currency),
	}
}
