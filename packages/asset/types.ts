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
