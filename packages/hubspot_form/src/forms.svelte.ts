import type { HubspotForm } from '../types.js'
import ky from 'ky'

/**
 * A HubSpot portal's forms, listed through moxy once the field's `MOXY_HUBSPOT_SECRET_ID` is
 * known. Shared by the HubSpot form field and the link field's form links; make one while a
 * component initialises, since it starts listing in an effect.
 */
export class HubspotForms {
	forms = $state<Array<HubspotForm> | null>(null)
	#error = $state<string | null>(null)
	#loading = $state(false)
	#portal: string | null = null
	#secret: () => string | undefined
	// plain, not state: the effect mustn't re-run, and so retry forever, when a listing fails
	#listed: string | undefined

	error = $derived.by(() => (this.#secret() ? this.#error : null))
	loading = $derived.by(
		() => this.#loading || (this.forms === null && !this.#error && !!this.#secret())
	)

	constructor(secret: () => string | undefined) {
		this.#secret = secret
		$effect(() => {
			const key = secret()
			if (key && key !== this.#listed) this.#list(key)
		})
	}

	async #list(secret: string) {
		this.#listed = secret
		this.#loading = true
		try {
			const response = await ky
				.get('https://moxy.uilo.co/api/hubspot/forms', {
					headers: { Authorization: `Bearer ${secret}` },
				})
				.json<{ portal: string; results: Array<HubspotForm> }>()
			this.#portal = response.portal
			this.forms = response.results
			this.#error = null
		} catch (error: any) {
			const status = error?.response?.status
			this.#error =
				status === 401
					? 'This field’s HubSpot connection was replaced. Open HubSpot from the Apps menu to set it up again.'
					: status === 409
						? 'HubSpot no longer accepts this space’s connection. Reconnect it from the HubSpot app.'
						: 'Could not load forms from HubSpot'
		} finally {
			this.#loading = false
		}
	}

	/** A listed form as a field stores it, with its portal */
	pick = (id: string): HubspotForm | null => {
		const form = this.forms?.find((form) => form.id === id)
		return form ? { ...form, ...(this.#portal && { portal: this.#portal }) } : null
	}
}
