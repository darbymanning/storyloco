import type { R2Asset, R2AssetAttributes } from 'moxyloco/r2'

interface StoryblokAsset {
	/* The numeric ID */
	id: number

	/* Full path of the asset, including the file name */
	filename: string

	/* The focus point of the image (only for image assets) */
	focus?: string | null

	/* Alt text for the asset (default language) */
	alt?: string | null

	/* Title of the asset */
	title?: string | null

	/* Source of the asset */
	source?: string | null

	/* Copyright information for the asset */
	copyright?: string | null

	/* Whether the asset is an external URL */
	is_external_url: boolean

	/* Metadata for the asset */
	meta_data: {
		/* Alt text for the asset (default language) */
		alt?: string | null

		/* Title of the asset */
		title?: string | null

		/* Source of the asset */
		source?: string | null

		/* Copyright information for the asset */
		copyright?: string | null

		/* Size of the asset in pixels (only for image assets) */
		size?: `${string}x${string}`
	}
}

export interface Asset extends Omit<StoryblokAsset, 'id'> {
	/* The UUID of the asset in the database */
	id: string

	/* The width of the asset */
	width?: R2AssetAttributes['width']

	/* The height of the asset */
	height?: R2AssetAttributes['height']

	/* The format of the asset */
	format?: R2AssetAttributes['format']

	/* Content type of the asset */
	content_type?: R2AssetAttributes['content_type']

	/* The size of the asset in bytes */
	size_bytes: R2AssetAttributes['size_bytes']

	/* The raw data from the database */
	_data: R2Asset

	/* The name of the asset ('Description' in Storyblok UI) */
	name?: string
}

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
