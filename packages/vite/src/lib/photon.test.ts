import { expect, test } from "bun:test"
import { address_from_photon } from "./photon.js"

test("a house is its number and street, without its name repeating them", () => {
	expect(
		address_from_photon({
			type: "house",
			housenumber: "10",
			name: "10 Downing Street",
			street: "Downing Street",
			district: "Covent Garden",
			city: "London",
			state: "England",
			country: "United Kingdom",
			postcode: "SW1A 2AA",
			countrycode: "GB",
		})
	).toEqual({
		label: "10 Downing Street, London, England, SW1A 2AA, United Kingdom",
		address: {
			street: "10 Downing Street",
			locality: "London",
			region: "England",
			postal_code: "SW1A 2AA",
			country: "GB",
		},
	})
})

test("a named building leads its street line", () => {
	const { address } = address_from_photon({
		type: "house",
		name: "Capenhurst Technology Park",
		street: "Capenhurst Lane",
		city: "Chester",
		countrycode: "GB",
	})
	expect(address.street).toBe("Capenhurst Technology Park, Capenhurst Lane")
})

test("a street or a town alone fills only what it knows", () => {
	expect(
		address_from_photon({ type: "street", name: "Morris Avenue", city: "Denville" }).address
	).toMatchObject({ street: "Morris Avenue", locality: "Denville", postal_code: "" })
	expect(
		address_from_photon({ type: "city", name: "Singapore", countrycode: "SG" }).address
	).toMatchObject({ street: "", locality: "Singapore", country: "SG" })
})
