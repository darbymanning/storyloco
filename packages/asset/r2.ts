/**
 * Vendored subset of the `moxyloco/r2` types.
 *
 * These are hand-copied from the moxy R2 OpenAPI client so storyloco consumers
 * don't need `moxyloco` (and its `openapi-client-axios` dependency) installed
 * just to read the asset field-plugin types. Only the schemas and operations the
 * plugin actually uses are modelled here.
 */

/* Asset resource in JSON:API format */
export interface R2Asset {
	/* Resource type */
	type: 'asset'

	/* Unique asset identifier (uuid) */
	id: string

	attributes: R2AssetAttributes

	links?: {
		/* URL to this asset */
		self?: string

		/* Public URL for accessing the asset */
		public?: string
	}
}

/* Asset attributes */
export interface R2AssetAttributes {
	/* Original filename */
	filename: string

	/* Display name for the asset (can be different from filename) */
	name?: string

	/* File size in bytes */
	size_bytes: number

	/* MIME type of the file */
	content_type?: string

	/* Detected file format (e.g. "jpeg", "png") */
	format?: string

	/* Image width in pixels (for images) */
	width?: number

	/* Image height in pixels (for images) */
	height?: number

	/* When the asset was uploaded (date-time) */
	created_at: string

	/* Title for the asset */
	title?: string

	/* Alt text for accessibility */
	alt?: string

	/* Source attribution */
	source?: string

	/* Copyright information */
	copyright?: string

	/* Focus point for image cropping */
	focus?: string

	/* Whether the asset is soft-deleted */
	deleted?: boolean

	/* When the asset was deleted, if applicable (date-time) */
	deleted_at?: string | null
}

/* Folder resource in JSON:API format */
export interface R2Folder {
	/* Resource type */
	type: 'folder'

	/* Unique folder identifier (uuid) */
	id: string

	attributes: R2FolderAttributes
}

/* Folder attributes */
export interface R2FolderAttributes {
	/* Folder name */
	name: string

	/* UUID of parent folder (null for root folders) */
	parent_id?: string | null

	/* Number of assets in this folder */
	asset_count: number
}

/* Structured folder tree format with unlimited nesting */
export interface R2FolderTree {
	/* Folder name */
	name: string

	/* Folder UUID */
	id: string

	/* UUID of parent folder (null for root folders) */
	parent_id?: string | null

	/* Number of assets in this folder */
	asset_count: number

	/* Child folders (recursive) */
	children: Array<R2FolderTree>
}

/* Request/response shapes for the R2 operations the plugin calls */
export namespace Paths {
	export namespace ListAssets {
		export namespace Responses {
			export interface $200 {
				data?: Array<R2Asset>
				included?: Array<R2Folder>
				meta?: {
					page?: number
					limit?: number
					total?: number
					total_pages?: number
				}
				links?: {
					self?: string
					next?: string
					prev?: string
				}
			}
		}
	}

	export namespace UpdateAssetsBulk {
		export interface RequestBody {
			/* Array of asset UUIDs to update */
			assets: Array<string>
			metadata: {
				name?: string
				alt?: string
				title?: string
				source?: string
				copyright?: string
				focus?: string
				/* UUID of the folder to move the assets to (null for no folder) */
				folder_id?: string | null
			}
		}

		export namespace Responses {
			export type $204 = Record<string, never>
		}
	}

	export namespace UpdateAssetMetadata {
		export interface RequestBody {
			name?: string
			alt?: string
			title?: string
			source?: string
			copyright?: string
			focus?: string
			/* UUID of the folder to move the asset to (null for no folder) */
			folder_id?: string | null
		}

		export namespace Responses {
			export interface $200 {
				data?: R2Asset
			}
		}
	}

	export namespace CreateFolder {
		export interface RequestBody {
			/* Folder name */
			name: string

			/* UUID of parent folder (null for root folders) */
			parent_id?: string | null
		}

		export namespace Responses {
			export interface $201 {
				data?: R2Folder
				meta?: {
					/* Indicates the folder was created */
					created?: boolean
				}
			}
		}
	}

	export namespace ListFolders {
		export namespace Responses {
			export interface $200 {
				data?: {
					/* JSON:API format folder list */
					list?: Array<R2Folder>

					/* Structured tree format for easier frontend consumption */
					structured?: Array<R2FolderTree>
				}
				meta?: {
					/* Total number of folders */
					total?: number
				}
			}
		}
	}
}
