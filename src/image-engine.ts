import {
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  MagickImageCollection,
  initializeImageMagick,
} from "@imagemagick/magick-wasm";
import { readFile, writeFile } from "node:fs/promises";

let initialization: Promise<void> | undefined;

function initialize(): Promise<void> {
  if (!initialization) {
    initialization = readFile(new URL(import.meta.resolve("@imagemagick/magick-wasm/magick.wasm")))
      .then((wasm) => initializeImageMagick(wasm));
  }
  return initialization;
}

const outputFormats = {
  gif: MagickFormat.Gif,
  png: MagickFormat.Png,
  jpg: MagickFormat.Jpeg,
  jpeg: MagickFormat.Jpeg,
  webp: MagickFormat.WebP,
  heic: MagickFormat.Heic,
  tiff: MagickFormat.Tiff,
  bmp: MagickFormat.Bmp,
} as const;

export type BuiltInConversion = {
  inputs: string[];
  output: string;
  format: keyof typeof outputFormats;
  delay: number;
  loop: number;
  resize?: string;
  quality?: number;
};

export async function convertWithBuiltInImageMagick(options: BuiltInConversion): Promise<void> {
  await initialize();
  const images = MagickImageCollection.create();
  try {
    for (const input of options.inputs) {
      const inputImages = MagickImageCollection.create(await readFile(input));
      images.push(...inputImages.splice(0));
      inputImages.dispose();
    }
    if (images.length === 0) throw new Error("ImageMagick could not read the input image");

    const geometry = options.resize ? new MagickGeometry(options.resize) : undefined;
    for (const image of images) {
      if (geometry) image.resize(geometry);
      if (options.quality) image.quality = options.quality;
      if (options.format === "gif") {
        image.animationDelay = options.delay;
        image.animationIterations = options.loop;
      }
    }
    if (options.format === "gif" && images.length > 1) images.optimize();
    await images.write(outputFormats[options.format], (data) => writeFile(options.output, data));
  } finally {
    images.dispose();
  }
}
