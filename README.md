# cvt

`cvt` converts image files and images copied to the clipboard on macOS, Windows, and Linux. It can make a GIF from one image or combine several images into an animation.

## Run without installing

```sh
npx @lagandevs/cvt
```

`npx` downloads the package into its cache and opens the interactive interface. It does not add `cvt` globally. To run a one-line conversion through `npx`, put the CLI arguments after the package name:

```sh
npx @lagandevs/cvt photo.png -o photo.gif
```

Run `cvt` with no arguments to open the interactive terminal interface. Use the keyboard or mouse to choose a source and format, enter an output path, then convert without leaving the interface. You can drag a file from Finder into the Files field.

After each conversion, `cvt` puts the converted file on the desktop clipboard. Paste it into Finder, Explorer, your Linux file manager, or another app. Pass `--no-copy` when using the one-line command if you only want the file saved to disk.

## Examples

```sh
# Image to GIF
cvt photo.png -o photo.gif

# Several images to an animated GIF
cvt frame-1.png frame-2.png frame-3.png -o animation.gif --delay 12

# Copy an image, then read it straight from the clipboard
cvt --paste -o copied-image.gif

# PNG, JPEG, WebP, HEIC, TIFF, and BMP conversions
cvt photo.heic -o photo.jpg --quality 88
cvt photo.png -o photo.webp --resize '1200x1200>'
```

Run `cvt --help` for every option. If you omit the input file, `cvt` reads the clipboard automatically. If you omit the output, it creates a GIF beside the source file, or `clipboard.gif` in the current directory.

## Development

```sh
pnpm install
pnpm check
pnpm build
pnpm install --global .
```

## Requirements

- Node.js 20 or newer
- Linux clipboard access: `wl-clipboard` on Wayland or `xclip` on X11

`cvt` includes [ImageMagick](https://imagemagick.org/) through the `@imagemagick/magick-wasm` WebAssembly build. Users do not need to install ImageMagick. If a system ImageMagick binary exists, `cvt` can use it as a fallback for HEIC encoding, which the smaller WebAssembly build omits.

Use Windows Terminal, iTerm2, Terminal.app, or a modern Linux terminal for mouse support in the interactive interface.
