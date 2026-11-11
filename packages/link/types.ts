import type { Asset } from '../asset/types'
import type { HubspotForm } from '../hubspot_form/types'

interface BaseLink {
	url?: string
	text?: string
}

/**
 * In the order the field offers them, as Storyblok's own link field does; a field's `link_types`
 * option can narrow and reorder them. `form` shows only with HubSpot connected
 * (`MOXY_HUBSPOT_SECRET_ID`), `asset` only with R2.
 */
export const link_types = ['internal', 'external', 'email', 'asset', 'form'] as const
export const target_options = ['_self', '_blank', '_parent', '_top', '_new'] as const
export const rel_options = [
	'noopener',
	'noreferrer',
	'nofollow',
	'noopener noreferrer',
	'noopener noreferrer nofollow',
] as const

export type LinkType = (typeof link_types)[number]
export type Target = (typeof target_options)[number]
export type Rel = (typeof rel_options)[number]

export interface AssetLink extends BaseLink {
	type: 'asset'
	asset?: Asset
	target?: Target
}

export interface ExternalLink extends BaseLink {
	type: 'external'
	target?: Target
	rel?: Rel
}

export interface EmailLink extends BaseLink {
	type: 'email'
	target?: Target
	email?: string
	subject?: string
	body?: string
	cc?: string
	bcc?: string
}

export interface StoryLink extends BaseLink {
	type: 'internal'
	target?: Target
	suffix?: string
	story?: {
		id: number
		uuid: string
		name: string
		published_at: string | null
		/** The story's current path, once Storyblok resolves links (`resolve_links`) */
		url?: string
	}
	// A native link's fields, so `resolve_links` keeps the story's path current after it moves
	fieldtype?: 'multilink'
	linktype?: 'story'
	/** The story's uuid */
	id?: string
	cached_url?: string
}

/** Opens a HubSpot form, in a pop-up, rather than going anywhere */
export interface FormLink extends BaseLink {
	type: 'form'
	form?: HubspotForm
}

export type Link = AssetLink | ExternalLink | EmailLink | StoryLink | FormLink
