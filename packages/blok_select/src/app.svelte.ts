import { createFieldPlugin, type FieldPluginResponse } from '@storyblok/field-plugin'
import type { BlokSelect } from '../types.js'
import type { UUID } from 'crypto'

type Plugin = FieldPluginResponse<BlokSelect | null | ''>

export type Blok = {
	_uid: UUID
	component: string
	blocks?: Blok[]
	_title?: string | null
	[key: string]: unknown
}

const mock = {
	story: {
		name: 'About us',
		created_at: '2025-11-26T21:55:27.828Z',
		published_at: '2026-04-01T13:54:18.696Z',
		updated_at: '2026-04-01T13:54:18.724Z',
		id: 116754546281952,
		uuid: '6a11e3d4-3426-43e3-a2e9-6a91fbea9969',
		content: {
			_uid: 'b5dcc613-8eec-4f20-91ce-08efaa635b1f',
			blocks: [
				{
					cta: '',
					_uid: 'e93dbb4e-8e56-4a92-9024-01bf7cd8de37',
					image: {
						id: 116752772846959,
						alt: '',
						name: '',
						focus: '437x558:438x559',
						title: '',
						source: '',
						filename:
							'https://a.storyblok.com/f/288451930684115/853x1280/a4004f2874/legacy-grandmother-and-child.jpeg',
						copyright: '',
						fieldtype: 'asset',
						meta_data: {
							alt: '',
							title: '',
							source: '',
							copyright: '',
						},
						is_external_url: false,
					},
					title: {
						type: 'doc',
						content: [
							{
								type: 'paragraph',
								attrs: {
									textAlign: null,
								},
								content: [
									{
										text: 'Bringing hope, help and healing in the ',
										type: 'text',
										marks: [
											{
												type: 'textStyle',
												attrs: {
													color: '',
												},
											},
										],
									},
									{
										text: 'Middle East',
										type: 'text',
										marks: [
											{
												type: 'textStyle',
												attrs: {
													color: '',
												},
											},
											{
												type: 'bold',
											},
										],
									},
								],
							},
						],
					},
					video: '',
					subtitle: {
						type: 'doc',
						content: [
							{
								type: 'paragraph',
								attrs: {
									textAlign: null,
								},
								content: [
									{
										text: 'Mosaic Middle East is a Christian charity working across ethnic and religious divides. Our work is rooted in local communities there. We are also known as The Foundation for Relief and Reconciliation in the Middle East.',
										type: 'text',
										marks: [
											{
												type: 'textStyle',
												attrs: {
													color: '',
												},
											},
										],
									},
								],
							},
						],
					},
					component: 'hero',
					footer_link: '',
					footer_text: {
						type: 'doc',
						content: [
							{
								type: 'paragraph',
							},
						],
					},
					padding_top: '',
					display_footer: false,
					padding_bottom: '',
					cta_supporting_text: 'Join over 10,000 people in supporting the middle east',
					use_active_campaign: false,
				},
				{
					_uid: 'ccd65cc0-d7f8-4a3f-9d77-225e69447d22',
					blocks: [
						{
							_uid: 'e6206be8-8801-4ecd-8ac5-3456e8310644',
							anchors: [
								{
									_uid: '62ae4ff7-b883-4cba-adbb-c5811803ddf5',
									block: {
										id: '6f89aa62-6e7d-490e-ae1b-399309ab52f1',
									},
									label: 'Our ambition',
									component: 'anchor',
								},
								{
									_uid: 'cf6ccd33-8e19-4e35-8f9b-c35d0cf8773a',
									block: {
										id: '412d1d7c-9bb9-4e50-82e1-684c259bc5a6',
									},
									label: 'Our impact',
									component: 'anchor',
								},
							],
							component: 'anchors',
						},
						{
							_uid: 'b5c575c7-7960-4902-9213-a941f72b71b2',
							blocks: [
								{
									_uid: 'd2c768f8-ba5b-461f-9767-7e00826c16ec',
									body: {
										type: 'doc',
										content: [
											{
												type: 'paragraph',
												attrs: {
													textAlign: null,
												},
												content: [
													{
														text: 'We empower refugees and other vulnerable groups as a Christian relief and development organisation. One of our strengths is that we are deeply involved with communities in the Middle East. We listen a lot. ',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
													{
														type: 'hard_break',
													},
													{
														type: 'hard_break',
													},
													{
														text: 'And then we respond.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
													{
														type: 'hard_break',
													},
													{
														text: 'Our listening and our years of experience on the ground in Iraq and Jordan has led us to develop the following strategic vision. Our mission is to bring hope, help and healing in the Middle East.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
													{
														type: 'hard_break',
													},
													{
														type: 'hard_break',
													},
													{
														text: 'Together with our donors and supporters we are expressing Christian compassion to some of the most vulnerable people in our world. In doing so we echo the words of the Apostle Paul “And now these three remain: faith, hope and love. But the greatest of these is love.” (1 Corinthians 13:13)',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
										],
									},
									flip: false,
									link: '',
									Quote: '',
									image: {
										id: 161149466045251,
										alt: '',
										name: '',
										focus: '',
										title: '',
										source: '',
										filename:
											'https://a.storyblok.com/f/288451930684115/926x820/337bd5cdcd/3a1b9fc78efa5895b682ff7069b9aad9c5836834.png',
										copyright: '',
										fieldtype: 'asset',
										meta_data: {},
										is_external_url: false,
									},
									title: 'Our ambition',
									component: 'sidekick',
									appearance: '',
									padding_top: '',
									mosaic_pattern: false,
									padding_bottom: '',
								},
								{
									_uid: '251c923a-55e3-455e-9155-60ee3ef979e1',
									body: {
										type: 'doc',
										content: [
											{
												type: 'heading',
												attrs: {
													level: 2,
													textAlign: null,
												},
												content: [
													{
														text: '12,000 Iraqi Christian refugees supported in Jordan',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'paragraph',
												attrs: {
													textAlign: null,
												},
												content: [
													{
														text: 'There is a growing need for our relief and empowerment work. We hope to expand our capacity from the 2020 level of 7,700 people supported each year.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'heading',
												attrs: {
													level: 2,
													textAlign: null,
												},
												content: [
													{
														text: '4 new Olive Tree Centres',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'paragraph',
												attrs: {
													textAlign: null,
												},
												content: [
													{
														text: 'Our first Olive Tree Centre in Madaba, Jordan supports hundreds of Christian refugees with a range of educational, therapeutic and empowerment programmes. In partnership with local Jordanian churches, we will enable new Centres and greatly expand their impact.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'heading',
												attrs: {
													level: 2,
													textAlign: null,
												},
												content: [
													{
														text: '2,000 beneficiaries of our Nineveh SEED Development Programme',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'paragraph',
												attrs: {
													textAlign: null,
												},
												content: [
													{
														text: 'Partnering with Iraqi NGO’s we’ve already provided new business and job-creation projects on the Nineveh Plain. We hope to complete a further 35-45 projects in the three years to 2024.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'heading',
												attrs: {
													level: 2,
													textAlign: null,
												},
												content: [
													{
														text: '1,000 refugees through advocacy support',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
											{
												type: 'paragraph',
												attrs: {
													textAlign: null,
												},
												content: [
													{
														text: 'Refugees often find themselves in a state of limbo, unable to find a sustainable future for themselves and their families. We are developing a pioneering new programme to advocate for their needs, including healthcare, education and applications for asylum in other countries.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
										],
									},
									flip: true,
									link: '',
									Quote: '',
									image: {
										id: 117324377066962,
										alt: '',
										name: '',
										focus: '',
										title: 'Ghadeer Art Teacher',
										source: 'Mosaic Middle East',
										filename:
											'https://a.storyblok.com/f/288451930684115/1092x1092/8eab963574/gadeer-art-teacher-oth-jordan-teacher.jpeg',
										copyright: 'Mosaic Middle East',
										fieldtype: 'asset',
										meta_data: {
											alt: '',
											title: 'Ghadeer Art Teacher',
											source: 'Mosaic Middle East',
											copyright: 'Mosaic Middle East',
										},
										is_external_url: false,
									},
									title: '',
									component: 'sidekick',
									appearance: '',
									padding_top: '',
									mosaic_pattern: false,
									padding_bottom: '20',
								},
							],
							component: 'area',
						},
						{
							_uid: 'f3abdb16-aa5b-41a1-8355-9cc51a4988a2',
							blocks: [
								{
									_uid: '63876bc6-1aec-4d8b-94e1-98e8bef0ebab',
									body: {
										type: 'doc',
										content: [
											{
												type: 'paragraph',
												attrs: {
													textAlign: null,
												},
												content: [
													{
														text: 'We empower refugees and other vulnerable groups as a Christian relief and development organisation. One of our strengths is that we are deeply involved with communities in the Middle East. We listen a lot. ',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
													{
														type: 'hard_break',
													},
													{
														type: 'hard_break',
													},
													{
														text: 'And then we respond.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
													{
														type: 'hard_break',
													},
													{
														text: 'Our listening and our years of experience on the ground in Iraq and Jordan has led us to develop the following strategic vision. Our mission is to bring hope, help and healing in the Middle East.',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
													{
														type: 'hard_break',
													},
													{
														type: 'hard_break',
													},
													{
														text: 'Together with our donors and supporters we are expressing Christian compassion to some of the most vulnerable people in our world. In doing so we echo the words of the Apostle Paul “And now these three remain: faith, hope and love. But the greatest of these is love.” (1 Corinthians 13:13)',
														type: 'text',
														marks: [
															{
																type: 'textStyle',
																attrs: {
																	color: '',
																},
															},
														],
													},
												],
											},
										],
									},
									flip: false,
									link: '',
									Quote: '',
									image: {
										id: 122078163145111,
										alt: '',
										name: '',
										focus: '',
										title: '',
										source: '',
										filename:
											'https://a.storyblok.com/f/288451930684115/837x920/99d64e4c5e/whatsapp-image-2024-04-29-at-12-13-06-8-2-e1718109239580.jpeg',
										copyright: '',
										fieldtype: 'asset',
										meta_data: {},
										is_external_url: false,
									},
									title: 'Our impact',
									component: 'sidekick',
									appearance: '',
									padding_top: '',
									mosaic_pattern: false,
									padding_bottom: '',
								},
								{
									_uid: 'de2858dd-1284-4a20-a52c-274855150168',
									blocks: [
										{
											_uid: '4337196d-b4a0-490c-84cf-1ae8a3441ce8',
											number: '7698',
											component: 'statistic',
											description: 'People provided with emergency relief support',
										},
										{
											_uid: 'c3189607-e16d-41f2-b42a-e838884a63a4',
											number: '17',
											component: 'statistic',
											description: 'Live changing projects delivered',
										},
										{
											_uid: '65fdf275-c5f2-49cc-9357-3f01db8a1767',
											number: '106259',
											component: 'statistic',
											description: 'Clinic consultations provided',
										},
									],
									component: 'statistics',
									padding_top: '',
									padding_bottom: '',
								},
							],
							component: 'area',
						},
					],
					component: 'area',
				},
				{
					_uid: 'd8a01ba4-63ce-4e34-bfb1-fdb001e5efd6',
					insights: [
						'1e995602-a7b8-480b-9861-b2f72e53b606',
						'b5651267-a649-498b-8fa7-431ba7a4957a',
					],
					component: 'insights_carousel',
					padding_top: '20',
					padding_bottom: '20',
				},
			],
			metatags: '',
			component: 'page',
		},
		slug: 'about-us',
		full_slug: 'about-us',
		sort_by_date: null,
		position: -60,
		tag_list: [],
		is_startpage: false,
		parent_id: null,
		meta_data: null,
		group_id: '8ee88892-6eb6-4141-bbba-2ca913be1523',
		first_published_at: '2025-12-04T06:05:08.628Z',
		release_id: null,
		lang: 'default',
		path: null,
		alternates: [],
		default_full_slug: null,
		translated_slugs: null,
	},
	cv: 1775051659,
	rels: [],
	links: [],
}

export class BlokSelectManager {
	plugin = $state<Plugin | null>(null)
	content = $state<BlokSelect>({ id: '' })
	loaded = $derived(this.plugin?.type === 'loaded')
	bloks = $derived.by(() => {
		const story_content = this.plugin?.data?.story?.content ?? {}
		const blocks =
			'blocks' in story_content
				? (story_content.blocks as Array<Blok>)
				: (mock.story.content.blocks as Array<Blok>)
		return blocks.map((blok) => {
			// try and determine the title of the blok by looking at the keys for likely candidates
			const title_keys = ['title', 'headline', 'name', 'label']
			const title = title_keys.find((key) => key in blok)

			return {
				...blok,
				_title: title && typeof blok[title] === 'string' ? blok[title] : null,
			}
		})
	})

	constructor() {
		this.initialize_plugin()
	}

	private initialize_plugin() {
		createFieldPlugin<BlokSelect>({
			enablePortalModal: true,
			onUpdateState: (state) => {
				this.plugin = state as Plugin
				if (state.data?.content) this.content = state.data.content
			},
		})
	}

	select_blok = (blok_id: UUID) => {
		this.content.id = blok_id
		this.update()
	}

	update = () => {
		if (this.plugin?.type !== 'loaded') return

		const state = $state.snapshot(this.content)
		this.plugin.actions.setContent(state)
	}

	/** String title from common blok keys (works for nested bloks without `_title`) */
	blok_title(blok: Blok): string | null {
		const title_keys = ['title', 'headline', 'name', 'label'] as const
		for (const key of title_keys) {
			if (key in blok && typeof blok[key] === 'string') return blok[key] as string
		}
		return null
	}

	/** Only bloks with nested `blocks` are selectable (containers) */
	blok_has_blocks(blok: Blok): boolean {
		return Array.isArray(blok.blocks) && blok.blocks.length > 0
	}

	blok_display_label(blok: Blok): string {
		if (blok._title) return blok._title
		return this.blok_title(blok) ?? ''
	}
}
