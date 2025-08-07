// vite-plugin-dev-preview.js
import handlebars from 'handlebars'
import requireFromString from 'require-from-string'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, basename, relative, dirname } from 'path'
import { glob } from 'glob'
import yaml from 'js-yaml'
import { watch } from 'chokidar'
import { spawn } from 'child_process'

let asciidoctor
let uiModel
let layouts
let partialsRegistered = false
let helpersRegistered = false

// Función para cargar Asciidoctor con Kroki Worker
async function loadAsciidoctor () {
	if (!asciidoctor) {
		try {
			const Asciidoctor = await import('asciidoctor')
			asciidoctor = Asciidoctor.default()

			// Suprimir warnings de Kroki relacionados con diagramas no soportados
			const originalWarn = console.warn
			const originalError = console.error

			console.warn = function (...args) {
				const message = args[0]

				if (
					typeof message === 'object' &&
					message &&
					message.message &&
					(message.message.includes('server returns 404') ||
						(message.message.includes('Skipping') &&
							message.message.includes('block') &&
							!message.message.includes('blockdiag') &&
							!message.message.includes('actdiag') &&
							!message.message.includes('seqdiag') &&
							!message.message.includes('svgbob') &&
							!message.message.includes('pikchr') &&
							!message.message.includes('wavedrom')))
				) {
					return // No mostrar warnings de estos diagramas en formato objeto
				}
				originalWarn.apply(console, args)
			}

		} catch (error) {
			console.error('❌ Error loading Asciidoctor:', error)
			console.warn(
				'Asciidoctor not available, skipping preview pages generation'
			)
			return null
		}
	}
	return asciidoctor
}

// Función para limpiar el cache y forzar recarga
function invalidateCache () {
	uiModel = null
	layouts = null
	partialsRegistered = false
	helpersRegistered = false
	// Limpiar partials y helpers registrados en Handlebars
	handlebars.unregisterPartial()
	Object.keys(handlebars.helpers).forEach((name) => {
		if (
			![
				'if',
				'unless',
				'each',
				'with',
				'lookup',
				'blockHelperMissing',
				'helperMissing',
				'log'
			].includes(name)
		) {
			delete handlebars.helpers[name]
		}
	})
	console.log('🔄 Cache invalidated - will reload on next request')
}

// Función para ejecutar build automático solo para templates/contenido
function rebuildTemplates () {
	console.log('🔨 Templates changed - rebuilding preview pages...')
	const buildProcess = spawn('npm', ['run', 'build:preview'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		shell: true
	})

	buildProcess.stdout.on('data', (data) => {
		console.log(`📦 Build: ${data.toString().trim()}`)
	})

	buildProcess.stderr.on('data', (data) => {
		console.error(`❌ Build error: ${data.toString().trim()}`)
	})

	buildProcess.on('close', (code) => {
		if (code === 0) {
			console.log('✅ Templates build completed successfully')
		} else {
			console.error(`❌ Templates build failed with exit code ${code}`)
		}
	})
}

async function initializeHandlebars () {
	if (!partialsRegistered || !helpersRegistered || !layouts || !uiModel) {
		const previewSrc = './preview-src'
		const srcDir = './src'

		// Cargar modelo de datos
		if (!uiModel) {
			try {
				const content = readFileSync(join(previewSrc, 'ui-model.yml'), 'utf8')
				uiModel = yaml.load(content)
			} catch (error) {
				console.error('Error loading ui-model.yml:', error)
				uiModel = {
					site: { title: 'Preview' },
					page: { title: 'Preview Page' }
				}
			}
		}

		// Registrar partials
		if (!partialsRegistered) {
			const partialFiles = glob.sync('partials/*.hbs', { cwd: srcDir })
			partialFiles.forEach((file) => {
				const filePath = join(srcDir, file)
				const content = readFileSync(filePath, 'utf8')
				const name = basename(file, '.hbs')
				handlebars.registerPartial(name, content)
			})
			partialsRegistered = true
		}

		// Registrar helpers
		if (!helpersRegistered) {
			handlebars.registerHelper(
				'resolvePage',
				(spec, context = {}) => context.hash || spec
			)
			handlebars.registerHelper('resolvePageURL', (spec, context = {}) =>
				context.hash ? context.hash.url || '#' : '#'
			)

			const helperFiles = glob.sync('helpers/*.js', { cwd: srcDir })
			helperFiles.forEach((file) => {
				const filePath = join(srcDir, file)
				const content = readFileSync(filePath, 'utf8')
				const name = basename(file, '.js')
				const helper = requireFromString(content)
				handlebars.registerHelper(name, helper)
			})
			helpersRegistered = true
		}

		// Compilar layouts
		if (!layouts) {
			layouts = new Map()
			const layoutFiles = glob.sync('layouts/*.hbs', { cwd: srcDir })
			layoutFiles.forEach((file) => {
				const filePath = join(srcDir, file)
				const content = readFileSync(filePath, 'utf8')
				const name = basename(file, '.hbs')
				layouts.set(name, handlebars.compile(content))
			})
		}
	}
}

export function devPreviewPlugin () {
	return {
		name: 'dev-preview',
		configureServer (server) {
			// Configurar watchers para hot reload
			const templateWatcher = watch(
				[
					'src/layouts/**/*.hbs',
					'src/partials/**/*.hbs',
					'src/helpers/**/*.js'
				],
				{
					ignored: /node_modules/,
					persistent: true
				}
			)

			templateWatcher.on('change', (path) => {
				console.log(`🔄 Template changed: ${path}`)
				invalidateCache()
				// Solo recargar la página, no rebuild automático
				server.ws.send({
					type: 'full-reload'
				})
			})

			templateWatcher.on('add', (path) => {
				console.log(`➕ Template added: ${path}`)
				invalidateCache()
				server.ws.send({
					type: 'full-reload'
				})
			})

			templateWatcher.on('unlink', (path) => {
				console.log(`➖ Template removed: ${path}`)
				invalidateCache()
				server.ws.send({
					type: 'full-reload'
				})
			})

			// NO interceptar cambios de CSS - dejar que Vite maneje el HMR nativo
			// Solo loguear cambios para debug
			const cssWatcher = watch(['src/css/**/*.css'], {
				ignored: /node_modules/,
				persistent: true
			})

			cssWatcher.on('change', (path) => {
				console.log(`🎨 CSS changed: ${path} - using Vite HMR`)
				// No hacer nada más, dejar que Vite maneje el HMR
			})

			cssWatcher.on('add', (path) => {
				console.log(`➕ CSS added: ${path} - using Vite HMR`)
				// No hacer nada más, dejar que Vite maneje el HMR
			})

			// Watch para archivos de preview (AsciiDoc, ui-model.yml)
			const previewWatcher = watch(
				['preview-src/**/*.adoc', 'preview-src/ui-model.yml'],
				{
					ignored: /node_modules/,
					persistent: true
				}
			)

			previewWatcher.on('change', (path) => {
				console.log(`🔄 Preview content changed: ${path}`)
				if (path.includes('ui-model.yml')) {
					invalidateCache()
				}
				// Solo rebuild para cambios en archivos AsciiDoc (contenido)
				if (path.endsWith('.adoc')) {
					rebuildTemplates()
				}
				server.ws.send({
					type: 'full-reload'
				})
			})

			previewWatcher.on('add', (path) => {
				console.log(`➕ Preview content added: ${path}`)
				if (path.endsWith('.adoc')) {
					rebuildTemplates()
				}
				server.ws.send({
					type: 'full-reload'
				})
			})

			// Cleanup watchers on server close
			server.httpServer?.on('close', () => {
				templateWatcher.close()
				cssWatcher.close()
				previewWatcher.close()
			})

			// Middleware para generar y servir páginas de preview en tiempo real
			server.middlewares.use(async (req, res, next) => {
				const url = req.url || '/'

				// Solo manejar rutas específicas de preview, dejar que Vite maneje el resto
				if (
					!url.endsWith('.html') &&
					url !== '/' &&
					url !== '' &&
					!url.startsWith('/_/')
				) {
					return next()
				}

				// Servir assets desde public/_ (EXCEPTO CSS que maneja Vite directamente)
				if (url.startsWith('/_/')) {
					// Permitir que Vite maneje CSS para HMR
					if (url.endsWith('.css')) {
						return next() // Dejar que Vite maneje el CSS
					}

					const assetPath = join('./public', url)
					if (existsSync(assetPath)) {
						try {
							const content = readFileSync(assetPath)

							// Determinar el tipo de contenido
							let contentType = 'application/octet-stream'
							if (url.endsWith('.js')) {
								contentType = 'application/javascript'
							} else if (url.endsWith('.woff2')) {
								contentType = 'font/woff2'
							} else if (url.endsWith('.woff')) {
								contentType = 'font/woff'
							} else if (url.endsWith('.svg')) {
								contentType = 'image/svg+xml'
							}

							res.setHeader('Content-Type', contentType)
							res.end(content)
							return
						} catch (err) {
							console.error(`Error serving asset ${url}:`, err)
						}
					}
					res.statusCode = 404
					res.end(`Asset not found: ${url}`)
					return
				}

				// Redirigir raíz a index.html
				if (url === '/' || url === '') {
					res.writeHead(302, { Location: '/index.html' })
					res.end()
					return
				}

				// Manejar páginas HTML específicas de preview
				if (url === '/index.html' || url === '/404.html') {
					const asciidoc = await loadAsciidoctor()
					if (!asciidoc) {
						res.statusCode = 500
						res.end('Asciidoctor not available')
						return
					}

					await initializeHandlebars()

					const pageName = basename(url, '.html')
					const adocPath = join('./preview-src', `${pageName}.adoc`)

					if (existsSync(adocPath)) {
						try {
							// Crear contexto para esta página
							const pageUiModel = { ...uiModel }
							pageUiModel.page = { ...pageUiModel.page }

							pageUiModel.siteRootPath = '.'
							pageUiModel.uiRootPath = './_'

							if (pageName === '404') {
								pageUiModel.page = { layout: '404', title: 'Page Not Found' }
							} else {
								// Leer y procesar archivo .adoc
								const content = readFileSync(adocPath, 'utf8')

								// Asegurar que el directorio de imágenes existe antes de procesar
								const imgDir = join(process.cwd(), 'public', '_', 'img')
								if (!existsSync(imgDir)) {
									mkdirSync(imgDir, { recursive: true })
								}

								// Procesar con manejo de errores mejorado
								let doc
								try {
									doc = asciidoc.load(content, {
										safe: 'server',
										base_dir: imgDir,
										attributes: {
											stem: 'latexmath',
											'source-highlighter': 'highlight.js',
											// "kroki-server-url":
											//   process.env.KROKI_WORKER_URL ||
											//   "https://docs-ui-kroki-worker.trenzaduria.workers.dev",
											'kroki-fetch-diagram': true,
											experimental: true
										}
									})
								} catch (loadError) {
									console.warn(
										`⚠️  Error loading ${pageName}, skipping diagrams:`,
										loadError.message
									)
									// Reintentar sin kroki si hay error
									doc = asciidoc.load(content, {
										safe: 'server',
										base_dir: imgDir,
										attributes: {
											stem: 'latexmath',
											'source-highlighter': 'highlight.js',
											experimental: true
										}
									})
								}

								// Extraer atributos de página
								pageUiModel.page.attributes = Object.entries(
									doc.getAttributes()
								)
									.filter(([name, val]) => name.startsWith('page-'))
									.reduce((accum, [name, val]) => {
										accum[name.slice(5)] = val
										return accum
									}, {})

								pageUiModel.page.layout = doc.getAttribute(
									'page-layout',
									'default'
								)
								pageUiModel.page.title = doc.getDocumentTitle()

								let htmlContent
								htmlContent = doc.convert()

								pageUiModel.page.contents = Buffer.from(htmlContent)
							}

							// Compilar la página usando el layout correspondiente
							const layoutTemplate = layouts.get(pageUiModel.page.layout)
							if (!layoutTemplate) {
								throw new Error(`Layout not found: ${pageUiModel.page.layout}`)
							}

							let html = layoutTemplate(pageUiModel)

							// En desarrollo, reemplazar enlaces a CSS/JS para usar el servidor de Vite
							html = html.replace(
								/href="\.\/_\/css\/main\.css"/g,
								'href="/css/site.css"'
							)
							html = html.replace(
								/href="_\/css\/main\.css"/g,
								'href="/css/site.css"'
							)
							html = html.replace(
								/src="\.\/_\/js\/main\.js"/g,
								'src="/js/main.js"'
							)
							html = html.replace(
								/src="_\/js\/main\.js"/g,
								'src="/js/main.js"'
							)

							// Inyectar el cliente de Vite para HMR automático
							const viteClientScript = `
<script type="module" src="/@vite/client"></script>`

							// Inyectar antes del </head>
							html = html.replace(/<\/head>/i, `${viteClientScript}\n</head>`)

							res.setHeader('Content-Type', 'text/html; charset=utf-8')
							res.end(html)
							return
						} catch (error) {
							console.error(`Error generating ${url}:`, error)
							res.statusCode = 500
							res.setHeader('Content-Type', 'text/html; charset=utf-8')
							res.end(`
                <h1>Error generando página</h1>
                <pre>${error.message}</pre>
                <p>Verifica que los templates y datos estén correctos.</p>
              `)
							return
						}
					}
				}

				// Servir assets estáticos de preview-src que no sean .adoc
				if (url === '/multirepo-ssg.svg') {
					const svgPath = './preview-src/multirepo-ssg.svg'
					if (existsSync(svgPath)) {
						try {
							const content = readFileSync(svgPath)
							res.setHeader('Content-Type', 'image/svg+xml')
							res.end(content)
							return
						} catch (err) {
							console.error('Error serving SVG:', err)
						}
					}
				}

				// Si llegamos aquí, la página no existe
				if (url.endsWith('.html')) {
					res.statusCode = 404
					res.setHeader('Content-Type', 'text/html; charset=utf-8')
					res.end(`
            <h1>Preview page not found</h1>
            <p>Page <code>${url}</code> does not exist in preview-src/</p>
          `)
					return
				}

				next()
			})
		}
	}
}
