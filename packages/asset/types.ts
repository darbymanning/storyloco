import type Mux from '@mux/mux-node'

export interface Video {
	mux_video?: Mux.Video.Assets.Asset
	playback_id?: string
	m3u8_url?: string
	title?: string
	autoplay?: boolean
	muted?: boolean
	loop?: boolean
	playsinline?: boolean
	controls?: boolean
	preload?: 'auto' | 'metadata' | 'none'
	poster?: string
}

export type VimeoVideo = {
	uri: string
	name: string
	description: string
	type: string
	link: string
	player_embed_url: string
	duration: number
	width: number
	language: string
	height: number
	embed: {
		html: string
		badges: {
			hdr: boolean
			live: {
				streaming: boolean
				archived: boolean
			}
			staff_pick: {
				normal: boolean
				best_of_the_month: boolean
				best_of_the_year: boolean
				premiere: boolean
			}
			vod: boolean
			weekend_challenge: boolean
		}
		interactive: boolean
		buttons: {
			watchlater: boolean
			share: boolean
			embed: boolean
			hd: boolean
			fullscreen: boolean
			scaling: boolean
			like: boolean
		}
		logos: {
			vimeo: boolean
			custom: {
				active: boolean
				url: any
				link: any
				use_link: boolean
				sticky: boolean
			}
		}
		play_button: {
			position: string
		}
		title: {
			name: string
			owner: string
			portrait: string
		}
		end_screen: Array<any>
		playbar: boolean
		quality_selector: any
		pip: boolean
		autopip: boolean
		volume: boolean
		color: string
		colors: {
			color_one: string
			color_two: string
			color_three: string
			color_four: string
		}
		event_schedule: boolean
		has_cards: boolean
		outro_type: string
		show_timezone: boolean
		cards: Array<any>
		airplay: boolean
		audio_tracks: boolean
		chapters: boolean
		chromecast: boolean
		closed_captions: boolean
		transcript: boolean
		skipping_forward: boolean
		ask_ai: boolean
		uri: any
		email_capture_form: Array<any>
		speed: boolean
	}
	created_time: string
	modified_time: string
	release_time: string
	content_rating: Array<string>
	content_rating_class: string
	rating_mod_locked: boolean
	license: any
	privacy: {
		view: string
		embed: string
		download: boolean
		add: boolean
		comments: string
	}
	pictures: {
		uri: string
		active: boolean
		type: string
		base_link: string
		sizes: Array<{
			width: number
			height: number
			link: string
			link_with_play_button: string
		}>
		resource_key: string
		default_picture: boolean
	}
	tags: Array<any>
	stats: {
		plays: number
	}
	categories: Array<any>
	uploader: {
		pictures: {
			uri: string
			active: boolean
			type: string
			base_link: string
			sizes: Array<{
				width: number
				height: number
				link: string
			}>
			resource_key: string
			default_picture: boolean
		}
	}
	metadata: {
		connections: {
			comments: {
				uri: string
				options: Array<string>
				total: number
			}
			credits: {
				uri: string
				options: Array<string>
				total: number
			}
			likes: {
				uri: string
				options: Array<string>
				total: number
			}
			pictures: {
				uri: string
				options: Array<string>
				total: number
			}
			texttracks: {
				uri: string
				options: Array<string>
				total: number
			}
			related: any
			recommendations: {
				uri: string
				options: Array<string>
				resource_signature: string
			}
			albums: {
				uri: string
				options: Array<string>
				total: number
			}
			available_albums: {
				uri: string
				options: Array<string>
				total: number
			}
			available_channels: {
				uri: string
				options: Array<string>
				total: number
			}
			versions: {
				uri: string
				options: Array<string>
				total: number
				current_uri: string
				resource_key: string
				create_storyboard_id: string
				latest_incomplete_version: any
			}
		}
		interactions: {
			watchlater: {
				uri: string
				options: Array<string>
				added: boolean
				added_time: any
			}
			report: {
				uri: string
				options: Array<string>
				reason: Array<string>
			}
			view_team_members: {
				uri: string
				options: Array<string>
			}
			edit: {
				uri: string
				options: Array<string>
				blocked_fields: Array<any>
			}
			edit_content_rating: {
				uri: string
				options: Array<string>
				content_rating: Array<string>
			}
			edit_privacy: {
				uri: string
				options: Array<string>
				content_type: string
				properties: Array<{
					name: string
					required: boolean
					options: Array<string>
				}>
			}
			delete: {
				uri: string
				options: Array<string>
			}
			can_update_privacy_to_public: {
				uri: string
				options: Array<string>
			}
			invite: {
				uri: string
				options: Array<string>
			}
			trim: {
				uri: string
				options: Array<string>
			}
			validate: {
				uri: string
				options: Array<string>
			}
		}
		is_vimeo_create: boolean
		is_screen_record: boolean
	}
	manage_link: string
	user: {
		uri: string
		name: string
		link: string
		capabilities: {
			hasLiveSubscription: boolean
			hasEnterpriseLihp: boolean
			hasSvvTimecodedComments: boolean
			hasSimplifiedEnterpriseAccount: boolean
			hasManagementCapabilitiesForComments: boolean
			hasDetailedVideoVersionHistory: boolean
			canViewSimplifiedCommentMentions: boolean
		}
		location: string
		gender: string
		bio: string
		short_bio: string
		created_time: string
		pictures: {
			uri: string
			active: boolean
			type: string
			base_link: string
			sizes: Array<{
				width: number
				height: number
				link: string
			}>
			resource_key: string
			default_picture: boolean
		}
		websites: Array<{
			uri: string
			name: string
			link: string
			type: string
			description: any
		}>
		metadata: {
			connections: {
				albums: {
					uri: string
					options: Array<string>
					total: number
				}
				appearances: {
					uri: string
					options: Array<string>
					total: number
				}
				categories: {
					uri: string
					options: Array<string>
					total: number
				}
				channels: {
					uri: string
					options: Array<string>
					total: number
				}
				feed: {
					uri: string
					options: Array<string>
				}
				followers: {
					uri: string
					options: Array<string>
					total: number
				}
				following: {
					uri: string
					options: Array<string>
					total: number
				}
				groups: {
					uri: string
					options: Array<string>
					total: number
				}
				likes: {
					uri: string
					options: Array<string>
					total: number
				}
				membership: {
					uri: string
					options: Array<string>
				}
				moderated_channels: {
					uri: string
					options: Array<string>
					total: number
				}
				portfolios: {
					uri: string
					options: Array<string>
					total: number
				}
				videos: {
					uri: string
					options: Array<string>
					total: number
				}
				watchlater: {
					uri: string
					options: Array<string>
					total: number
				}
				shared: {
					uri: string
					options: Array<string>
					total: number
				}
				pictures: {
					uri: string
					options: Array<string>
					total: number
				}
				watched_videos: {
					uri: string
					options: Array<string>
					total: number
				}
				folders_root: {
					uri: string
					options: Array<string>
				}
				folders: {
					uri: string
					options: Array<string>
					total: number
				}
				teams: {
					uri: string
					options: Array<string>
					total: number
				}
				permission_policies: {
					uri: string
					options: Array<string>
					total: number
				}
				block: {
					uri: string
					options: Array<string>
					total: number
				}
			}
		}
		location_details: {
			formatted_address: string
			latitude: number
			longitude: number
			city: string
			state: string
			neighborhood: any
			sub_locality: any
			state_iso_code: any
			country: string
			country_iso_code: string
		}
		skills: Array<any>
		available_for_hire: boolean
		can_work_remotely: boolean
		preferences: {
			videos: {
				rating: Array<string>
				privacy: {
					view: string
					comments: string
					embed: string
					download: boolean
					add: boolean
					allow_share_link: boolean
				}
			}
			webinar_registrant_lower_watermark_banner_dismissed: Array<any>
		}
		content_filter: Array<string>
		upload_quota: {
			space: {
				free: number
				max: number
				used: number
				showing: string
				unit: string
			}
			periodic: {
				period: any
				unit: any
				free: any
				max: any
				used: any
				reset_date: any
			}
			lifetime: {
				unit: string
				free: number
				max: number
				used: number
			}
		}
		resource_key: string
		account: string
	}
	last_user_action_event_date: string
	parent_folder: any
	review_page: {
		active: boolean
		link: string
		is_shareable: boolean
	}
	files: Array<{
		quality: string
		rendition: string
		type: string
		width?: number
		height?: number
		link: string
		created_time: string
		fps: number
		size: number
		md5: any
		public_name: string
		size_short: string
	}>
	download: Array<{
		quality: string
		rendition: string
		type: string
		width: number
		height: number
		expires: string
		link: string
		created_time: string
		fps: number
		size: number
		md5: any
		public_name: string
		size_short: string
	}>
	app: {
		name: string
		uri: string
	}
	play: {
		progressive: Array<{
			type: string
			codec: string
			width: number
			height: number
			link_expiration_time: string
			link: string
			created_time: string
			fps: number
			size: number
			md5: any
			rendition: string
		}>
		hls: {
			link_expiration_time: string
			link: string
		}
		dash: {
			link_expiration_time: string
			link: string
		}
		status: string
	}
	status: string
	resource_key: string
	upload: {
		status: string
		link: any
		upload_link: any
		form: any
		approach: any
		size: any
		redirect_url: any
	}
	transcode: {
		status: string
	}
	is_playable: boolean
	has_audio: boolean
}
