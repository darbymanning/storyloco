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
}>
