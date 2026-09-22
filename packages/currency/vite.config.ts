import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { plugins } from '@storyblok/field-plugin/vite'
import css_injected_by_js from 'vite-plugin-css-injected-by-js'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
	plugins: [
		svelte(),
		...plugins,
		css_injected_by_js(),
		tailwindcss(),
		{
			// public sites reaching localhost also need the private network preflight approved
			name: 'allow-private-network',
			configureServer: (server) => {
				// unshifted so it runs before Vite's CORS middleware answers the preflight
				server.middlewares.stack.unshift({
					route: '',
					handle: (_req, res, next) => {
						res.setHeader('Access-Control-Allow-Private-Network', 'true')
						next()
					},
				})
			},
		},
	],
	build: {
		rollupOptions: {
			output: {
				format: 'commonjs',
				entryFileNames: `[name].js`,
				chunkFileNames: `[name].js`,
				assetFileNames: `[name].[ext]`,
			},
		},
	},
	server: {
		port: 8080,
		host: true,
		// Vite only allows localhost origins by default, which blocks the hosted sandbox and editor
		cors: { origin: [/^https:\/\/([\w-]+\.)?storyblok\.com$/, /^https?:\/\/localhost(:\d+)?$/] },
	},
	resolve: {
		alias: {
			'shared/global.css': path.resolve(__dirname, '../shared/src/lib/global.css'),
			'shared/utils': path.resolve(__dirname, '../shared/src/lib/utils.ts'),
			shared: path.resolve(__dirname, '../shared/src/lib/index.ts'),
			'$lib/utils.js': path.resolve(__dirname, '../shared/src/lib/utils.js'),
			'$lib/components/ui': path.resolve(__dirname, '../shared/src/lib/components/ui'),
		},
	},
})
