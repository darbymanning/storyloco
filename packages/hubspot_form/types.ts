export interface HubspotForm {
	id: string
	name: string
	// the HubSpot portal the form belongs to; missing on values saved before 0.2.0
	portal?: string
}
