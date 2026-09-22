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
