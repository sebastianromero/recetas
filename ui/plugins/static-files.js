// vite-plugin-static-files.js
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative } from 'path'

export function staticFilesPlugin () {
	return {
		name: 'static-files',
		generateBundle () {
			// Copy static files (equivalent to vfs.src('static/**/*[!~]'))
			const staticDir = 'static'
			const outputDir = 'public/_'

			if (existsSync(staticDir)) {
				copyDirectoryRecursive(
					staticDir,
					outputDir,
					(file) => !file.endsWith('~')
				)
			}

			// Copy vendor JS files (equivalent to vfs.src('js/vendor/*.min.js'))
			const vendorJsDir = 'src/js/vendor'
			const vendorOutputDir = join(outputDir, 'js/vendor')

			if (existsSync(vendorJsDir)) {
				const vendorFiles = readdirSync(vendorJsDir).filter(
					(file) => file.endsWith('.min.js') || file.endsWith('.bundle.js')
				)

				if (vendorFiles.length > 0) {
					if (!existsSync(vendorOutputDir)) {
						mkdirSync(vendorOutputDir, { recursive: true })
					}

					vendorFiles.forEach((file) => {
						const sourcePath = join(vendorJsDir, file)
						const destPath = join(vendorOutputDir, file)
						copyFileSync(sourcePath, destPath)
						console.log(`Copied vendor JS: ${file}`)
					})
				}
			}
			
		}
	}
}

function copyDirectoryRecursive (src, dest, filter = () => true) {
	if (!existsSync(dest)) {
		mkdirSync(dest, { recursive: true })
	}

	const entries = readdirSync(src)

	for (const entry of entries) {
		const srcPath = join(src, entry)
		const destPath = join(dest, entry)
		const stat = statSync(srcPath)

		if (stat.isDirectory()) {
			copyDirectoryRecursive(srcPath, destPath, filter)
		} else if (filter(entry)) {
			if (!existsSync(dirname(destPath))) {
				mkdirSync(dirname(destPath), { recursive: true })
			}
			copyFileSync(srcPath, destPath)
			console.log(`Copied static file: ${relative('static', srcPath)}`)
		}
	}
}
