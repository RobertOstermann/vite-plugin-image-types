# vite-plugin-image-types

This [vite](https://vitejs.dev/) plugin generates a type file for the image paths in the `public` directory.

<a href="https://www.npmjs.com/package/vite-plugin-image-types">
  <img alt="npm version" src="https://img.shields.io/npm/v/vite-plugin-image-types.svg?style=flat-square" />
</a>
<a href="https://www.npmjs.com/package/vite-plugin-image-types">
  <img alt="npm downloads" src="https://img.shields.io/npm/dm/vite-plugin-image-types.svg?style=flat-square" />
</a>

## Features

🔥 Generate image types as part of the development process

## Installation

```bash
# using npm
npm install -D vite-plugin-image-types
# using pnpm
pnpm install -D vite-plugin-image-types
# using yarn
yarn add --dev vite-plugin-image-types
```

## Usage

**Vite config**

```ts
import { imageTypes } from "vite-plugin-image-types";

export default defineConfig({
  plugins: [imageTypes()],
});
```

## Options

| Name                     | Type                                          | Description                                                                              | Default                                                                                |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `imageDir`               | `string`                                      | The relative directory (from the public directory) to search for image files.            | `""`                                                                                   |
| `outputFile`             | `string`                                      | Path to the generated TypeScript file containing image types.                            | `"src/types/ImagePaths.ts"`                                                            |
| `imagePathName`          | `string`                                      | The name of the generated string union type representing all image paths.                | `"ImagePath"`                                                                          |
| `imageInformationName`   | `string`                                      | The name of the generated object type that includes file metadata (e.g., width, height). | `"ImageFile"`                                                                          |
| `exportImageInformation` | `boolean`.                                    | Whether to export the image information type along with image paths.                     | `false`                                                                                |
| `excludeDirs`            | `string[]`                                    | List of directories to exclude from image scanning.                                      | `[]`                                                                                   |
| `fileExtensions`         | `string[]`                                    | Allowed image file extensions to include.                                                | `[".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".bmp", ".tiff", ".avif"]` |
| `watchMode`              | `"vite"` \| `"chokidar"` \| `"hybrid"`        | File watching strategy: Vite’s built-in, Chokidar, or a hybrid approach.                 | `"hybrid"`                                                                             |
| `debounceMs`             | `number`                                      | Debounce time in milliseconds for batching updates.                                      | `250`                                                                                  |
| `eslintFormat`           | `boolean`                                     | Whether to automatically format the output file using ESLint’s auto-fix.                 | `false`                                                                                |
| `prettierFormat`         | `boolean`                                     | Whether to format the output file with Prettier.                                         | `false`                                                                                |
| `logLevel`               | `"none"` \| `"error"` \| `"warn"` \| `"info"` | Log verbosity level.                                                                     | `"info"`                                                                               |

## Example Output

```ts
// src/types/ImagePaths.ts
export type ImagePath = "/logo.ico" | "/logo.png";

export type ImageFile = { title: string; path: ImagePath | (string & {}); aspectRatio: string };

const ImageFiles: Record<ImagePath, ImageFile> = {
  "/logo.ico": {
    title: "logo.ico",
    path: "/logo.ico",
    aspectRatio: "257 / 257",
  },
  "/logo.png": {
    title: "logo.png",
    path: "/logo.png",
    aspectRatio: "126 / 126",
  },
};

export { ImageFiles };
```

## Publishing to npm

To publish a new version of this package to npm, follow these steps:

1. **Login to npm** (if not already logged in):

   ```bash
   npm login
   ```

2. **Bump the version** according to [semver](https://semver.org/):

   ```bash
   # patch release (bug fixes)
   npm version patch
   # minor release (new features, backwards compatible)
   npm version minor
   # major release (breaking changes)
   npm version major
   ```

3. **Publish to npm**:
   ```bash
   npm publish
   ```

> **Note:** Make sure you have the necessary permissions to publish to the `vite-plugin-image-types` package on npm.
