import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { plugins } from '@storyblok/field-plugin/vite'
import css_injected_by_js from 'vite-plugin-css-injected-by-js'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
	plugins: [svelte(), ...plugins, css_injected_by_js(), tailwindcss()],
	build: {
		rollupOptions: {
			output: {
				format: 'commonjs',
				// Storyblok serves the plugin as one file: a chunk split off (the asset picker's lazy
				// drag-and-drop) leaves it reaching for `exports`, which its frame doesn't have
				codeSplitting: false,
				entryFileNames: `[name].js`,
				chunkFileNames: `[name].js`,
				assetFileNames: `[name].[ext]`,
			},
		},
	},
	server: {
		port: 8080,
		host: true,
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
