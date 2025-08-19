import type { Asset } from '@storyblok/field-plugin'

interface BaseLink {
	url?: string
	text?: string
}

export const link_types = ['asset', 'external', 'email', 'internal'] as const
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
	}
}

export type Link = AssetLink | ExternalLink | EmailLink | StoryLink
