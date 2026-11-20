import { describe, expect, test } from "bun:test"
import { organization, tidy_organization, type Organization } from "./seo.js"

const origin = "https://eatechnology.com"
const logo = `${origin}/logo.png`

const ea: Organization = {
	legal_name: "EA Technology Limited",
	founding_date: "1966-04-01",
	description: "Power engineering consultancy and instrument maker.",
	disambiguating_description: "UK power engineering firm, not the US IT firm EA Technologies.",
	same_as: [
		"https://www.linkedin.com/company/ea-technology",
		"https://www.wikidata.org/wiki/Q5321625",
	],
	brands: ["VisNet", "Fundamentals"],
	entities: [
		{
			name: "EA Technology Limited",
			street: "Capenhurst Technology Park, Capenhurst",
			locality: "Chester",
			postal_code: "CH1 6ES",
			country: "GB",
			head_office: true,
		},
		{
			name: "EA Technology, LLC",
			street: "400 Morris Avenue, Suite 240",
			locality: "Denville",
			region: "NJ",
			postal_code: "07834",
			country: "US",
		},
		{
			name: "EA Technology Pty Ltd",
			street: "381 MacArthur Avenue",
			locality: "Hamilton",
			region: "QLD",
			postal_code: "4007",
			country: "AU",
		},
		{
			name: "EA Technology Asset Management Pte Ltd",
			street: "4 Kaki Bukit Avenue 1, #01-02",
			locality: "Singapore",
			postal_code: "417939",
			country: "SG",
		},
	],
}

describe("organization", () => {
	test("a full value is the whole entity, the head office as its address and the rest beneath it", () => {
		expect(organization(ea, { origin, logo, name: "EA Technology", url: `${origin}/` })).toEqual({
			"@type": "Organization",
			"@id": "https://eatechnology.com/#organization",
			name: "EA Technology",
			url: "https://eatechnology.com/",
			logo,
			legalName: "EA Technology Limited",
			foundingDate: "1966-04-01",
			description: "Power engineering consultancy and instrument maker.",
			disambiguatingDescription: "UK power engineering firm, not the US IT firm EA Technologies.",
			sameAs: [
				"https://www.linkedin.com/company/ea-technology",
				"https://www.wikidata.org/wiki/Q5321625",
			],
			brand: [
				{ "@type": "Brand", name: "VisNet" },
				{ "@type": "Brand", name: "Fundamentals" },
			],
			address: {
				"@type": "PostalAddress",
				streetAddress: "Capenhurst Technology Park, Capenhurst",
				addressLocality: "Chester",
				postalCode: "CH1 6ES",
				addressCountry: "GB",
			},
			subOrganization: [
				{
					"@type": "Organization",
					name: "EA Technology, LLC",
					legalName: "EA Technology, LLC",
					address: {
						"@type": "PostalAddress",
						streetAddress: "400 Morris Avenue, Suite 240",
						addressLocality: "Denville",
						addressRegion: "NJ",
						postalCode: "07834",
						addressCountry: "US",
					},
				},
				{
					"@type": "Organization",
					name: "EA Technology Pty Ltd",
					legalName: "EA Technology Pty Ltd",
					address: {
						"@type": "PostalAddress",
						streetAddress: "381 MacArthur Avenue",
						addressLocality: "Hamilton",
						addressRegion: "QLD",
						postalCode: "4007",
						addressCountry: "AU",
					},
				},
				{
					"@type": "Organization",
					name: "EA Technology Asset Management Pte Ltd",
					legalName: "EA Technology Asset Management Pte Ltd",
					address: {
						"@type": "PostalAddress",
						streetAddress: "4 Kaki Bukit Avenue 1, #01-02",
						addressLocality: "Singapore",
						postalCode: "417939",
						addressCountry: "SG",
					},
				},
			],
		})
	})

	test("there is no entity without a value, or with one that is all blanks", () => {
		expect(organization(undefined, { origin, logo })).toBeUndefined()
		expect(organization(null, { origin, logo })).toBeUndefined()
		expect(organization({}, { origin, logo })).toBeUndefined()
		expect(
			organization(
				{
					legal_name: "  ",
					same_as: [""],
					brands: [],
					entities: [{ name: "", head_office: true }],
				},
				{ origin, logo, name: "EA Technology" }
			)
		).toBeUndefined()
	})

	test("empty properties are left out, keys and all", () => {
		const entity = organization({ legal_name: "EA Technology Limited", brands: [" "] }, { origin })
		expect(entity).toEqual({
			"@type": "Organization",
			"@id": "https://eatechnology.com/#organization",
			legalName: "EA Technology Limited",
		})
	})

	test("sameAs keeps only full http and https URLs", () => {
		const entity = organization(
			{
				same_as: [
					"linkedin.com/company/ea-technology",
					"mailto:hello@example.com",
					"/about",
					" https://www.youtube.com/@eatechnology ",
					"http://example.com",
				],
			},
			{ origin }
		)
		expect(entity?.sameAs).toEqual(["https://www.youtube.com/@eatechnology", "http://example.com"])
		expect(organization({ same_as: ["not a url"] }, { origin })?.sameAs).toBeUndefined()

		// Node 20 and Safari 17 have no URL.parse
		const parse = URL.parse
		// @ts-expect-error taking it away
		URL.parse = undefined
		expect(organization({ same_as: ["https://example.com"] }, { origin })?.sameAs).toEqual([
			"https://example.com",
		])
		URL.parse = parse
	})

	test("with no head office, every entity is a sub-organisation and there is no address", () => {
		const entity = organization(
			{ entities: [{ name: "One Ltd", country: "GB" }, { locality: "Leeds" }] },
			{ origin }
		)
		expect(entity?.address).toBeUndefined()
		expect(entity?.subOrganization).toEqual([
			{
				"@type": "Organization",
				name: "One Ltd",
				legalName: "One Ltd",
				address: { "@type": "PostalAddress", addressCountry: "GB" },
			},
			{ "@type": "Organization", address: { "@type": "PostalAddress", addressLocality: "Leeds" } },
		])
	})
})

describe("tidy_organization", () => {
	test("trims, and drops blank rows and blank entities", () => {
		expect(
			tidy_organization({
				legal_name: " Acme Ltd ",
				description: "",
				same_as: ["", " https://example.com "],
				brands: ["", "  "],
				entities: [
					{ name: "", street: " " },
					{ name: " Acme GmbH ", region: "", head_office: false },
				],
			})
		).toEqual({
			legal_name: "Acme Ltd",
			same_as: ["https://example.com"],
			entities: [{ name: "Acme GmbH" }],
		})
	})

	test("a tidy value is left as it is", () => {
		expect(tidy_organization(ea)).toEqual(ea)
	})
})
