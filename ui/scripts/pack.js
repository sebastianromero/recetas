// scripts/pack.js
import { createWriteStream, mkdirSync, existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join, relative, dirname } from "path";
import archiver from "archiver";

async function getFilesRecursively(dir, basePath = dir) {
  const files = [];
  const entries = await readdir(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = await stat(fullPath);

    if (stats.isDirectory()) {
      const subFiles = await getFilesRecursively(fullPath, basePath);
      files.push(...subFiles);
    } else {
      files.push({
        path: fullPath,
        relativePath: relative(basePath, fullPath),
      });
    }
  }

  return files;
}

export async function createUIBundle(sourceDir, outputDir, bundleName = "ui") {
  // Ensure output directory exists
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = join(outputDir, `${bundleName}-bundle.zip`);

  return new Promise(async (resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(
        `UI bundle created: ${outputPath} (${archive.pointer()} total bytes)`,
      );
      resolve(outputPath);
    });

    archive.on("error", reject);
    archive.pipe(output);

    try {
      const files = await getFilesRecursively(sourceDir);

      for (const file of files) {
        archive.file(file.path, { name: file.relativePath });
      }

      await archive.finalize();
    } catch (error) {
      reject(error);
    }
  });
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const sourceDir = process.argv[2] || "public/_";
  const outputDir = process.argv[3] || "build";
  const bundleName = process.argv[4] || "ui";

  createUIBundle(sourceDir, outputDir, bundleName)
    .then((path) => {
      console.log(`Bundle created successfully: ${path}`);
      if (!process.env.CI) {
        console.log(`Antora option: --ui-bundle-url=${path}`);
      }
    })
    .catch((error) => {
      console.error("Error creating bundle:", error);
      process.exit(1);
    });
}
