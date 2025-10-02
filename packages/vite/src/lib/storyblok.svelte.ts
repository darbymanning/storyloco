import {
	storyblokInit,
	apiPlugin,
	renderRichText as richtext,
	useStoryblokBridge,
	StoryblokComponent as Block,
	storyblokEditable as editable,
	useStoryblokApi,
	type ISbStoryData,
} from "@storyblok/svelte"
import type { Component } from "svelte"
import { SvelteMap } from "svelte/reactivity"

/**
 * Wrapper interface for storyblok stories with reactive state management
 * @template T - The story data type extending ISbStoryData
 *
 * @example
 * ```typescript
 * // In a page component (+page.svelte)
 * let { data: _data } = $props()
 *
 * const data = $derived(client.connect(_data.story))
 *
 * // Now you have full type safety for the story content
 * if (data.story?.content.title) {
 *   // TypeScript knows this is a string
 *   console.log(data.story.content.title)
 * }
 * ```
 */
export interface Storyblok<T extends ISbStoryData> {
	/** The current story data, can be null */
	story: T | null
}

/** Type for dynamic component imports */
type Import<T = unknown> = () => Promise<T>

/** Type alias for the storyblok api instance */
type API = ReturnType<typeof useStoryblokApi>

/**
 * Main Storyblok client class that handles component registration, API calls, and story bridging
 * Provides a unified interface for working with Storyblok in Svelte applications
 */
export class StoryblokClient {
	/** Map of registered Svelte components by name */
	components = new SvelteMap<string, Component>()
	/** Internal flag to prevent multiple initializations */
	#initialized = false
	/** Array of relation field names to resolve when fetching stories */
	relations: Array<string> = []

	/**
	 * Check if the current URL is in Storyblok preview mode
	 * @param url - The URL to check
	 * @returns True if in preview mode
	 */
	is_preview(url: URL): boolean {
		return url.searchParams.has("_storyblok")
	}

	/** Storyblok access token for API authentication */
	#access_token: string
	/** Map of component categories to their import functions */
	#component_maps: Record<string, Record<string, Import>>

	// API method declarations - these are assigned during initialization
	/** Fetch a single story or collection of stories */
	declare get: API["get"]
	/** Fetch all stories matching criteria (handles pagination automatically) */
	declare getAll: API["getAll"]
	/** Fetch a specific story by slug */
	declare getStory: API["getStory"]
	/** Make a POST request to the Storyblok API */
	declare post: API["post"]
	/** Make a PUT request to the Storyblok API */
	declare put: API["put"]
	/** Make a DELETE request to the Storyblok API */
	declare delete: API["delete"]

	/**
	 * Create a new StoryblokClient instance
	 * @param access_token - Your Storyblok access token
	 * @param component_maps - Map of component categories to their import functions
	 */
	constructor(access_token: string, component_maps: Record<string, Record<string, Import>>) {
		this.#access_token = access_token
		this.#component_maps = component_maps
	}

	/**
	 * Initialize the client by loading components and setting up the API
	 * This method is idempotent and can be called multiple times safely
	 */
	async init() {
		if (this.#initialized) return

		// Load all components from the provided maps
		for (const [_map_name, imports] of Object.entries(this.#component_maps)) {
			for (const [path, import_fn] of Object.entries(imports)) {
				const name = path.split("/").pop()?.replace(".svelte", "") ?? ""
				if (name) {
					const component = (await import_fn()) as { default: Component }
					this.components.set(name, component.default)
				}
			}
		}

		// Initialize the Storyblok SDK
		storyblokInit({
			accessToken: this.#access_token,
			use: [apiPlugin],
			components: Object.fromEntries(this.components),
		})

		// Bind API methods to this instance
		const api = useStoryblokApi()
		this.get = api.get.bind(api)
		this.getAll = api.getAll.bind(api)
		this.getStory = api.getStory.bind(api)
		this.post = api.post?.bind(api)
		this.put = api.put?.bind(api)
		this.delete = api.delete?.bind(api)

		this.#initialized = true
	}

	/** Storyblok editable function for making content editable in preview mode */
	editable = editable

	/**
	 * Connect a story to Storyblok's live preview system for real-time updates
	 * @param current - The current story data
	 * @returns A reactive wrapper with the story data
	 * @template T - The story data type
	 *
	 * @example
	 * ```typescript
	 * const data = $derived(client.connect(story))
	 * // data.story will update automatically when content changes in Storyblok
	 * ```
	 */
	connect<T extends ISbStoryData>(current: T): Storyblok<T> {
		let story = $state<T | null>(current)

		$effect(() => {
			if (!current) return

			useStoryblokBridge(current.id, (updated) => (story = updated as T), {
				resolveLinks: "url",
				resolveRelations: this.relations,
			})
		})

		return {
			get story() {
				return story
			},
		}
	}
}

/** Re-export commonly used Storyblok utilities */
export { editable, Block, richtext }
