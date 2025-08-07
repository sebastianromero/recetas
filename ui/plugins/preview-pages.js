// vite-plugin-preview-pages.js
import handlebars from "handlebars";
import requireFromString from "require-from-string";
import { createRequire } from "module";
import { glob } from "glob";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, basename, relative } from "path";
import yaml from "js-yaml";

const require = createRequire(import.meta.url);
let asciidoctor;

async function loadAsciidoctor() {
  if (!asciidoctor) {
    try {
      const Asciidoctor = await import("asciidoctor");
      asciidoctor = Asciidoctor.default();
    } catch (error) {
      console.error("❌ Error loading Asciidoctor:", error);
      console.warn(
        "Asciidoctor not available, skipping preview pages generation",
      );
      return null;
    }
  }
  return asciidoctor;
}

export function previewPagesPlugin() {
  return {
    name: "preview-pages",
    async generateBundle() {
      const asciidoc = await loadAsciidoctor();
      if (!asciidoc) return;

      try {
        const previewSrc = "./preview-src";
        const srcDir = "./src";
        const outputDir = "./public";

        // Verificar que existen los directorios necesarios
        if (!existsSync(previewSrc)) {
          console.log("No preview-src directory found, skipping preview pages");
          return;
        }

        console.log("Building preview pages with Handlebars templates...");

        // Cargar el modelo de datos de la UI
        const uiModel = await loadSampleUiModel(previewSrc);

        // Registrar partials
        await registerPartials(srcDir);

        // Registrar helpers
        await registerHelpers(srcDir);

        // Compilar layouts
        const layouts = await compileLayouts(srcDir);

        // Asegurar que el directorio public/_/img existe para los diagramas de Kroki
        const imgDir = join(process.cwd(), "public", "_", "img");
        if (!existsSync(imgDir)) {
          mkdirSync(imgDir, { recursive: true });
        }

        // Buscar archivos .adoc en preview-src
        const adocFiles = glob.sync("**/*.adoc", { cwd: previewSrc });

        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        adocFiles.forEach((file) => {
          try {
            const inputPath = join(previewSrc, file);
            const outputPath = join(outputDir, file.replace(".adoc", ".html"));

            // Crear directorio de salida si no existe
            const outputDirPath = dirname(outputPath);
            if (!existsSync(outputDirPath)) {
              mkdirSync(outputDirPath, { recursive: true });
            }

            // Crear contexto para esta página
            const pageUiModel = { ...uiModel };
            pageUiModel.page = { ...pageUiModel.page };

            const siteRootPath = relative(dirname(outputPath), outputDir);
            pageUiModel.siteRootPath = siteRootPath || ".";
            pageUiModel.uiRootPath = join(pageUiModel.siteRootPath, "_");

            if (basename(file, ".adoc") === "404") {
              pageUiModel.page = { layout: "404", title: "Page Not Found" };
            } else {
              // Leer y procesar archivo .adoc
              const content = readFileSync(inputPath, "utf8");

              // Asegurar que el directorio de imágenes existe antes de procesar
              const imgDir = join(process.cwd(), "public", "_", "img");
              if (!existsSync(imgDir)) {
                mkdirSync(imgDir, { recursive: true });
              }

              // Procesar con manejo de errores mejorado
              let doc;

              doc = asciidoc.load(content, {
                safe: "server",
                base_dir: imgDir,
                attributes: {
                  stem: "latexmath",
                  "source-highlighter": "highlight.js",
                  "kroki-fetch-diagram": true,
                  experimental: true,
                },
              });
              console.log(`Successfully loaded ${file}`);

              // Extraer atributos de página
              pageUiModel.page.attributes = Object.entries(doc.getAttributes())
                .filter(([name, val]) => name.startsWith("page-"))
                .reduce((accum, [name, val]) => {
                  accum[name.slice(5)] = val;
                  return accum;
                }, {});

              pageUiModel.page.layout = doc.getAttribute(
                "page-layout",
                "default",
              );
              pageUiModel.page.title = doc.getDocumentTitle();

              let htmlContent;
              try {
                htmlContent = doc.convert();
                console.log(
                  `Successfully converted ${file}, checking for diagrams...`,
                );
              } catch (convertError) {
                console.warn(
                  `⚠️  Error converting ${file}, using fallback:`,
                  convertError.message,
                );
              }

              pageUiModel.page.contents = Buffer.from(updatedHtmlContent);
            }

            // Compilar la página usando el layout correspondiente
            const layoutTemplate = layouts.get(pageUiModel.page.layout);
            if (!layoutTemplate) {
              throw new Error(`Layout not found: ${pageUiModel.page.layout}`);
            }

            const html = layoutTemplate(pageUiModel);

            // Escribir archivo de salida
            writeFileSync(outputPath, html);
            console.log(`✓ Generated: ${outputPath}`);
          } catch (fileError) {
            console.error(`❌ Error processing ${file}:`, fileError.message);
            console.warn(`⚠️  Skipping ${file} due to processing error`);
            // Continuar con el siguiente archivo en lugar de fallar completamente
          }
        });

        console.log(
          "✅ Preview pages build completed with Handlebars templates!",
        );
      } catch (error) {
        console.error("❌ Error building preview pages:", error);
        throw error;
      }
    },
  };
}

function loadSampleUiModel(src) {
  return new Promise((resolve, reject) => {
    try {
      const content = readFileSync(join(src, "ui-model.yml"), "utf8");
      resolve(yaml.load(content));
    } catch (error) {
      reject(error);
    }
  });
}

function registerPartials(src) {
  return new Promise((resolve, reject) => {
    try {
      const partialFiles = glob.sync("partials/*.hbs", { cwd: src });

      partialFiles.forEach((file) => {
        const filePath = join(src, file);
        const content = readFileSync(filePath, "utf8");
        const name = basename(file, ".hbs");
        handlebars.registerPartial(name, content);
        console.log(`  ✓ Registered partial: ${name}`);
      });

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function registerHelpers(src) {
  return new Promise((resolve, reject) => {
    try {
      // Registrar helpers personalizados básicos
      handlebars.registerHelper("resolvePage", resolvePage);
      handlebars.registerHelper("resolvePageURL", resolvePageURL);

      const helperFiles = glob.sync("helpers/*.js", { cwd: src });

      helperFiles.forEach((file) => {
        const filePath = join(src, file);
        const content = readFileSync(filePath, "utf8");
        const name = basename(file, ".js");
        const helper = requireFromString(content);
        handlebars.registerHelper(name, helper);
        console.log(`  ✓ Registered helper: ${name}`);
      });

      resolve();
    } catch (error) {
      reject(error);
    }
  });
}

function compileLayouts(src) {
  return new Promise((resolve, reject) => {
    try {
      const layouts = new Map();
      const layoutFiles = glob.sync("layouts/*.hbs", { cwd: src });

      layoutFiles.forEach((file) => {
        const filePath = join(src, file);
        const content = readFileSync(filePath, "utf8");
        const name = basename(file, ".hbs");
        layouts.set(name, handlebars.compile(content));
        console.log(`  ✓ Compiled layout: ${name}`);
      });

      resolve(layouts);
    } catch (error) {
      reject(error);
    }
  });
}

function resolvePage(spec, context = {}) {
  return context.hash || spec;
}

function resolvePageURL(spec, context = {}) {
  return context.hash ? context.hash.url || "#" : "#";
}
