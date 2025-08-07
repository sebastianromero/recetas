// vite-plugin-copy-templates.js
import { copyFileSync, mkdirSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";

function copyRecursiveSync(src, dest) {
  const exists = statSync(src, { throwIfNoEntry: false });
  if (!exists) return;

  const stats = statSync(src);
  const isDirectory = stats.isDirectory();

  if (isDirectory) {
    mkdirSync(dest, { recursive: true });
    readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(join(src, childItemName), join(dest, childItemName));
    });
  } else {
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
}

export function copyTemplatesPlugin() {
  return {
    name: "copy-templates",
    writeBundle() {
      // Copy Handlebars templates
      copyRecursiveSync("src/layouts", "public/_/layouts");
      copyRecursiveSync("src/partials", "public/_/partials");
      copyRecursiveSync("src/helpers", "public/_/helpers");

      // Copy ui.yml if it exists
      try {
        copyFileSync("src/ui.yml", "public/_/ui.yml");
      } catch (e) {
        // ui.yml doesn't exist, that's ok
      }

      // Copy static files
      try {
        copyRecursiveSync("src/static", "public/_");
      } catch (e) {
        // static folder doesn't exist, that's ok
      }

      console.log("Templates and assets copied successfully!");
    },
  };
}
