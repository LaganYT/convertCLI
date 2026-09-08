# cvt

`cvt` converts image files and images copied to the macOS clipboard. It can make a GIF from one image or combine several images into an animation.

Run `cvt` with no arguments to open the interactive terminal interface. Use the keyboard or mouse to choose a source and format, enter an output path, then convert without leaving the interface. You can drag a file from Finder into the Files field.

After each conversion, `cvt` puts the converted file on the macOS clipboard. Paste it into Finder or another app with Command-V. Pass `--no-copy` when using the one-line command if you only want the file saved to disk.

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

Requires Node.js 20 or newer and ImageMagick (`brew install imagemagick`). Clipboard input requires macOS.
