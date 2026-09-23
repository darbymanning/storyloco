import { describe, expect, test } from "bun:test"
import { format_currency, to_currency } from "./currency.js"

describe("to_currency", () => {
	test("spreadsheet money becomes the field value", () => {
		expect(to_currency("£1,234.50", "GBP")).toEqual({
			plugin: "uiloco-currency",
			currency: "GBP",
			amount: 1234.5,
			formatted: "£1,234.50",
		})
		expect(to_currency(80.83, "GBP")?.formatted).toBe("£80.83")
		expect(to_currency(" 9.42 ", "GBP")?.amount).toBe(9.42)
		expect(to_currency("1,000,000", "USD")?.formatted).toBe("$1,000,000.00")
		expect(to_currency("12.50 EUR", "EUR")?.amount).toBe(12.5)
		expect(to_currency("¥1500", "JPY")?.formatted).toBe("¥1,500")
		expect(to_currency("0", "GBP")?.amount).toBe(0)
		expect(to_currency(500.23)).toEqual({
			plugin: "uiloco-currency",
			currency: "GBP",
			amount: 500.23,
			formatted: "£500.23",
		})
	})

	test("blank is null", () => {
		expect(to_currency("", "GBP")).toBeNull()
		expect(to_currency("  ", "GBP")).toBeNull()
		expect(to_currency(null, "GBP")).toBeNull()
		expect(to_currency(undefined, "GBP")).toBeNull()
	})

	test("refuses what it cannot be sure of", () => {
		for (const bad of ["-5", "POA", "1,23", "12.3.4", "1e3", "NaN", "12,50", "1.005"]) {
			expect(() => to_currency(bad, "GBP")).toThrow()
		}
		expect(() => to_currency("1500.5", "JPY")).toThrow()
		expect(() => to_currency(Number.NaN, "GBP")).toThrow()
	})
})

test("format_currency matches the plugin", () => {
	expect(format_currency(130000, "GBP")).toBe("£130,000.00")
})
