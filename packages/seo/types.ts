import type { Organization } from '../vite/src/lib/seo.js'

export type {
	Organization,
	OrganizationEntity,
	OrganizationEntityLd,
	OrganizationOptions,
	PostalAddress,
} from '../vite/src/lib/seo.js'
export { organization } from '../vite/src/lib/seo.js'

export type SEO = Partial<{
	title?: string
	og_image?: string
	og_title?: string
	description?: string
	twitter_image?: string
	twitter_title: string
	og_description: string
	twitter_description: string
	/** Ask search engines not to list the page */
	noindex: boolean
	/** Ask search engines not to follow the page's links */
	nofollow: boolean
	/** The address search engines should treat as this page's own, when it isn't the page's URL */
	canonical: string
	/** The site's organisation, on a field whose schema includes the group: `seo({ include: ['organization'] })` */
	organization: Organization
}>
