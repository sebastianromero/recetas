import { createUIBundle } from "../scripts/pack.js";

export function uiBundlePlugin(options = {}) {
  const {
    sourceDir = "public/_",
    outputDir = "build",
    bundleName = "ui",
    enabled = true,
  } = options;

  return {
    name: "ui-bundle",
    async writeBundle() {
      if (!enabled) return;

      try {
        const bundlePath = await createUIBundle(
          sourceDir,
          outputDir,
          bundleName,
        );

        // Log similar to the original Gulp task
        if (!process.env.CI) {
          console.log(`Antora option: --ui-bundle-url=${bundlePath}`);
        }
      } catch (error) {
        console.error("Error creating UI bundle:", error);
        throw error;
      }
    },
  };
}
