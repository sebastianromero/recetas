import {defineConfig} from 'vite'
import {resolve} from 'path'

// @ts-ignore
import {copyTemplatesPlugin} from './plugins/copy-templates.js'
// @ts-ignore
import {uiBundlePlugin} from './plugins/ui-bundle.js'
// @ts-ignore
import {staticFilesPlugin} from './plugins/static-files.js'
// @ts-ignore
import {previewPagesPlugin} from './plugins/preview-pages.js'
// @ts-ignore
import {devPreviewPlugin} from './plugins/dev-preview.js'


import viteImagemin from 'vite-plugin-imagemin'
import * as path from "node:path";

export default defineConfig(({mode}) => {
	const isDev = mode === 'development'

	return {
		root: isDev ? 'public' : 'src',
		base: './',
		publicDir: isDev ? false : '../public',
		resolve: {
			alias: {
				'/css/site.css': resolve(__dirname, 'src/css/site.css'),
				'/js/main.js': resolve(__dirname, 'src/main.js')
			}
		},
		plugins: [
			devPreviewPlugin(),
			copyTemplatesPlugin(),
			staticFilesPlugin(),
			previewPagesPlugin(),
			uiBundlePlugin({
				sourceDir: 'public/_',
				outputDir: 'build',
				bundleName: 'ui',
				enabled: !isDev
			}),
			!isDev && viteImagemin({
				gifsicle: {optimizationLevel: 7},
				optipng: {optimizationLevel: 7},
				mozjpeg: {quality: 80},
				svgo: {
					plugins: [
						{name: 'cleanupIDs', params: {preservePrefixes: ['icon-', 'view-']}},
						{name: 'removeViewBox', params: {enable: false}},
						{name: 'removeDesc', params: {enable: false}}
					]
				}
			})
		].filter(Boolean),
		build: {
			outDir: '../public/_',
			emptyOutDir: true,
			rollupOptions: {
				input: {
					main: resolve(__dirname, 'src/main.js')
				},
				output: {
					entryFileNames: 'js/[name].js',
					chunkFileNames: 'js/[name].js',
					assetFileNames: (assetInfo) => {
						if (assetInfo.name?.endsWith('.css')) {
							return 'css/[name][extname]'
						}
						if (assetInfo.name?.match(/\.(woff|woff2|ttf)$/)) {
							return 'font/[name][extname]'
						}
						if (assetInfo.name?.match(/\.(png|jpg|jpeg|gif|svg|ico|webp)$/)) {
							return 'img/[name][extname]'
						}
						return 'assets/[name][extname]'
					}
				}
			},
			copyPublicDir: false
		},
		server: {
			fs: {
				allow: ['..', path.resolve(__dirname, 'node_modules')]
			},
			watch: {
				usePolling: true,
			},
			port: 5252,
			host: '0.0.0.0'
		},
		css: {
			postcss: {
				plugins: [
					require('postcss-import'),
					require('postcss-custom-properties')({preserve: true}),
					require('postcss-calc'),
					require('autoprefixer'),
					require('cssnano')({preset: 'default'})
				]
			}
		},
		optimizeDeps: {}
	}
})
