import {
  ImageMagick,
  MagickFormat,
  MagickGeometry,
  MagickImageCollection,
  initializeImageMagick,
} from "@imagemagick/magick-wasm";
import { readFile, stat, writeFile } from "node:fs/promises";

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

export type ImageInspection = {
  format: string;
  width: number;
  height: number;
  bytes: number;
  frames: number;
  durationMs: number;
  transparency: boolean;
  thumbnail: {
    width: number;
    height: number;
    rgba: string;
  };
};

function readImages(data: Uint8Array, destination: ReturnType<typeof MagickImageCollection.create>): void {
  const source = MagickImageCollection.create(data);
  destination.push(...source.splice(0));
  source.dispose();
}

export async function inspectWithBuiltInImageMagick(inputs: string[]): Promise<ImageInspection> {
  await initialize();
  const images = MagickImageCollection.create();
  try {
    let bytes = 0;
    for (const input of inputs) {
      const [data, details] = await Promise.all([readFile(input), stat(input)]);
      bytes += details.size;
      readImages(data, images);
    }
    const first = images[0];
    if (!first) throw new Error("ImageMagick could not read the source image");

    const width = first.width;
    const height = first.height;
    const format = String(first.format);
    const transparency = images.some((image) => image.hasAlpha && !image.isOpaque);
    const durationMs = images.reduce((total, image) => {
      const ticks = image.animationTicksPerSecond || 100;
      return total + (image.animationDelay / ticks) * 1000;
    }, 0);

    first.resize(new MagickGeometry("24x12>"));
    const rgba = first.getPixels((pixels) => pixels.toByteArray(0, 0, first.width, first.height, "RGBA"));
    if (!rgba) throw new Error("ImageMagick could not render the source preview");

    return {
      format,
      width,
      height,
      bytes,
      frames: images.length,
      durationMs: Math.round(durationMs),
      transparency,
      thumbnail: {
        width: first.width,
        height: first.height,
        rgba: Buffer.from(rgba).toString("base64"),
      },
    };
  } finally {
    images.dispose();
  }
}

export async function convertWithBuiltInImageMagick(options: BuiltInConversion): Promise<void> {
  await initialize();
  const images = MagickImageCollection.create();
  try {
    for (const input of options.inputs) {
      readImages(await readFile(input), images);
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
