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

