import fs from "node:fs";
import path from "node:path";

import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import { ESLint } from "eslint";
import { imageSizeFromFile } from "image-size/fromFile";
import * as prettier from "prettier";
import type { HmrContext, Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { z } from "zod";

const PLUGIN_NAME = "vite-plugin-image-types";

interface ImageFile {
  path: string;
  file: string;
}

/**
 * Configuration options for the image types plugin.
 */
export interface Options {
  /**
   * The relative directory (from the public directory) to search for image files.
   * @default ""
   */
  imageDir?: string;

  /**
   * Path to the generated TypeScript file containing image types.
   * @default "src/types/ImagePaths.ts"
   */
  outputFile?: string;

  /**
   * The name of the generated string union type representing all image paths.
   * @default "ImagePath"
   */
  imagePathName?: string;

  /**
   * The name of the generated object type that includes file metadata (e.g., width, height).
   * @default "ImageFile"
   */
  imageInformationName?: string;

  /**
   * Whether to export the image information type along with image paths.
   * @default false
   */
  exportImageInformation?: boolean;

  /**
   * List of directories to exclude from image scanning.
   * @default []
   */
  excludeDirs?: string[];

  /**
   * Allowed image file extensions to include.
   * @default [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".tiff", ".avif"]
   */
  fileExtensions?: string[];

  /**
   * File watching strategy: Vite’s built-in, Chokidar, or a hybrid approach.
   * @default "hybrid"
   */
  watchMode?: "vite" | "chokidar" | "hybrid";

  /**
   * Debounce time in milliseconds for batching updates.
   * @default 250
   */
  debounceMs?: number;

  /**
   * Whether to automatically format the output file using ESLint’s auto-fix.
   * @default false
   */
  eslintFormat?: boolean;

  /**
   * Whether to format the output file with Prettier.
   * @default false
   */
  prettierFormat?: boolean;

  /**
   * Log verbosity level.
   * @default "info"
   */
  logLevel?: "none" | "error" | "warn" | "info";
}

const OptionsSchema = z.object({
  imageDir: z.string().optional().default(""),
  outputFile: z.string().optional().default("src/types/ImagePaths.ts"),
  imagePathName: z.string().optional().default("ImagePath"),
  imageInformationName: z.string().optional().default("ImageFile"),
  exportImageInformation: z.boolean().optional().default(false),
  excludeDirs: z.array(z.string()).optional().default([]),
  fileExtensions: z
    .array(z.string())
    .optional()
    .default([".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".tiff", ".avif"]),
  watchMode: z.enum(["vite", "chokidar", "hybrid"]).optional().default("hybrid"),
  debounceMs: z.number().optional().default(250),
  eslintFormat: z.boolean().optional().default(false),
  prettierFormat: z.boolean().optional().default(false),
  logLevel: z.enum(["none", "error", "warn", "info"]).optional().default("info"),
});

function imageTypes(options: Partial<Options> = {}): Plugin {
  let root = "";
  let publicDir = "";
  let isDev = false;
  let watcher: FSWatcher | null = null;
  let server: ViteDevServer | null = null;
  let regenerateTimeout: NodeJS.Timeout | null = null;

  const result = OptionsSchema.safeParse(options);
  if (!result.success) {
    throw new Error("❌ Invalid plugin options");
  }

  const parsedOptions = OptionsSchema.parse(options);

  const {
    imageDir,
    outputFile,
    imagePathName,
    imageInformationName,
    exportImageInformation,
    excludeDirs,
    fileExtensions,
    watchMode,
    debounceMs,
    eslintFormat,
    prettierFormat,
    logLevel,
  } = parsedOptions;

  const log = {
    info: (message: string) => {
      if (server && logLevel === "info") {
        server.config.logger.info(`[image-types] ${message}`, {
          timestamp: true,
        });
      }
    },
    success: (message: string) => {
      if (server && logLevel === "info") {
        server.config.logger.info(`[image-types] ✅ ${message}`, {
          timestamp: true,
        });
      }
    },
    warn: (message: string) => {
      if (server && ["info", "warn"].includes(logLevel)) {
        server.config.logger.warn(`[image-types] ⚠️  ${message}`, {
          timestamp: true,
        });
      }
    },
    error: (message: string, error?: any) => {
      if (server && logLevel !== "none") {
        server.config.logger.error(`[image-types] ❌ ${message}`, {
          timestamp: true,
          error,
        });
      }
    },
  };

  // Function to recursively read directories and find image files
  const getImageFiles = (dir: string): ImageFile[] => {
    let results: ImageFile[] = [];

    try {
      const directory = fs.readdirSync(dir);
      directory.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          // Exclude specified directories
          if (excludeDirs.length > 0) {
            const excludePattern = new RegExp(excludeDirs.join("|"));
            if (!excludePattern.test(file)) {
              results = results.concat(getImageFiles(filePath));
            }
          } else {
            results = results.concat(getImageFiles(filePath));
          }
        } else if (fileExtensions.some((ext) => file.toLowerCase().endsWith(ext))) {
          results.push({ path: filePath, file: file });
        }
      });
    } catch {
      log.warn(`Could not read directory`);
    }

    return results;
  };

  // Debounced regenerate function to avoid excessive regenerations
  const debouncedRegenerate = async (reason: string) => {
    if (regenerateTimeout) {
      clearTimeout(regenerateTimeout);
    }

    regenerateTimeout = setTimeout(async () => {
      log.info(`🔄 ${reason}, regenerating image types...`);
      await generateTypes();

      // Trigger HMR update if in dev mode
      if (isDev && server) {
        server.ws.send({
          type: "full-reload",
        });
      }
    }, debounceMs);
  };

  // Setup file watcher for public directory
  const setupWatcher = () => {
    if (!isDev || watchMode === "vite") return;

    const fullImageDir = imageDir ? path.join(publicDir, imageDir) : publicDir;

    if (!fs.existsSync(fullImageDir)) {
      log.warn(`Image directory does not exist. File watcher not started.`);
      return;
    }

    // Create watcher for the image directory
    watcher = chokidar.watch(fullImageDir, {
      ignored: (filePath: string) => {
        const relativePath = path.relative(fullImageDir, filePath);
        const segments = relativePath.split(path.sep);

        // Ignore excluded directories
        if (segments.some((segment) => excludeDirs.includes(segment))) {
          return true;
        }

        // Only watch image files
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          return !fileExtensions.some((ext) => filePath.toLowerCase().endsWith(ext));
        }

        return false;
      },
      persistent: true,
      ignoreInitial: true,
    });

    watcher
      .on("add", () => debouncedRegenerate("Image file added (via chokidar)"))
      .on("unlink", () => debouncedRegenerate("Image file removed (via chokidar)"))
      .on("change", () => debouncedRegenerate("Image file changed (via chokidar)"))
      .on("error", () => log.error("File watcher error"));

    log.info(`⏱️  Watching for image changes`);
  };

  // Cleanup watcher
  const cleanupWatcher = () => {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (regenerateTimeout) {
      clearTimeout(regenerateTimeout);
      regenerateTimeout = null;
    }
  };

  // Generate the TypeScript definitions
  const generateTypes = async (): Promise<void> => {
    const fullImageDir = imageDir ? path.join(publicDir, imageDir) : publicDir;
    const fullOutputFile = path.join(root, outputFile);

    // Ensure the image directory exists
    if (!fs.existsSync(fullImageDir)) {
      log.warn(`Image directory does not exist. Skipping type generation.`);
      return;
    }

    // Ensure output directory exists
    const outputDir = path.dirname(fullOutputFile);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let generatedCode = "";
    const imageFiles = getImageFiles(fullImageDir);
    const imageFileType = `export type ${imageInformationName} = { title: string, path: ${imagePathName} | (string & {}), aspectRatio: string}`;

    if (imageFiles.length === 0) {
      log.warn(`Warning: No image files found in ${fullImageDir}`);

      generatedCode = `export type ${imagePathName} = never\n`;

      if (exportImageInformation) {
        const imageFileRecord = `const ${imageInformationName}s: Record<${imagePathName}, ${imageInformationName}> = {} as const;\n\nexport { ${imageInformationName}s };\n`;
        generatedCode = generatedCode + `\n\n${imageFileType}\n\n${imageFileRecord}`;
      }
    } else {
      // Generate the paths
      generatedCode = `export type ${imagePathName} = ${imageFiles
        .map((file) => {
          const filePath = file.path;
          const relativePath = path.posix.join("/", path.relative(publicDir, filePath));
          return `'${relativePath}'`;
        })
        .join(" | ")}\n`;

      if (exportImageInformation) {
        const imageFileRecord = `const ${imageInformationName}s: Record<${imagePathName}, ${imageInformationName}> = {\n${(
          await Promise.all(
            imageFiles.map(async (file) => {
              const title = file.file;
              const filePath = file.path;
              const relativePath = path.posix.join("/", path.relative(publicDir, filePath));
              try {
                const dimensions = await imageSizeFromFile(filePath);
                return `'${relativePath}': {\ntitle: '${title}',\npath: '${relativePath}',\naspectRatio: '${dimensions.width}/${dimensions.height}'\n}`;
              } catch (error) {
                console.warn(
                  `Warning: Could not get dimensions for ${filePath}:`,
                  (error as Error).message,
                );
                return `'${relativePath}': { title: '${title}', path: '${relativePath}', aspectRatio: '1 / 1' }`;
              }
            }),
          )
        ).join(",\n")}\n};\n\nexport { ${imageInformationName}s };\n`;

        generatedCode = generatedCode + `\n\n${imageFileType}\n\n${imageFileRecord}`;
      }
    }

    try {
      let formattedCode = generatedCode;

      if (prettierFormat) {
        const prettierConfig = await prettier.resolveConfig(path.join(fullOutputFile));
        formattedCode = await prettier.format(formattedCode, {
          parser: "typescript",
          ...prettierConfig,
        });
      }

      if (eslintFormat) {
        const eslintConfig = new ESLint({ fix: true });
        const results = await eslintConfig.lintText(formattedCode, {
          filePath: fullOutputFile,
        });

        formattedCode = results[0].output ?? formattedCode;
      }

      // Write the formatted code to the output file
      fs.writeFileSync(fullOutputFile, formattedCode);

      log.success(`Types generated`);
    } catch {
      log.error("Error generating image types");
    }
  };

  return {
    name: PLUGIN_NAME,
    configResolved(config: ResolvedConfig) {
      root = config.root;
      publicDir = config.publicDir ? config.publicDir : "";
      isDev = config.command === "serve";
    },
    async buildStart() {
      // Generate types on build start
      await generateTypes();

      // Setup file watcher after initial generation
      if (isDev && (watchMode === "chokidar" || watchMode === "hybrid")) {
        setupWatcher();
      }
    },
    async handleHotUpdate({ file }: HmrContext) {
      // Only use Vite's HMR in 'vite' or 'hybrid' mode
      if (!isDev || watchMode === "chokidar") return;

      const fullImageDir = imageDir ? path.join(publicDir, imageDir) : publicDir;

      // Check if the changed file is in our image directory
      if (file.startsWith(fullImageDir)) {
        const isImageFile = fileExtensions.some((ext) => file.toLowerCase().endsWith(ext));

        if (isImageFile) {
          await debouncedRegenerate("Image file changed (via Vite HMR)");
        }
      }
    },
    configureServer(viteServer: ViteDevServer) {
      server = viteServer;
    },
    buildEnd() {
      cleanupWatcher();
    },
    closeBundle() {
      cleanupWatcher();
    },
  };
}

export { imageTypes as default, imageTypes };
