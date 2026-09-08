#!/usr/bin/env node
import { Command, Option } from "commander";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runTui } from "./tui.js";

const execFileAsync = promisify(execFile);
const formats = ["gif", "png", "jpg", "jpeg", "webp", "heic", "tiff", "bmp"] as const;
type Format = (typeof formats)[number];

type ImageOptions = {
  paste?: boolean;
  output?: string;
  format?: Format;
  delay: string;
  loop: string;
  resize?: string;
  quality?: string;
  overwrite?: boolean;
  copy?: boolean;
};

function fail(message: string): never {
  process.stderr.write(`cvt: ${message}\n`);
  process.exit(1);
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFileAsync(process.platform === "win32" ? "where.exe" : "/usr/bin/which", [command]);
    return true;
  } catch {
    return false;
  }
}

function capture(command: string, args: string[], input?: string): Promise<Buffer> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0
      ? done(Buffer.concat(stdout))
      : reject(new Error(Buffer.concat(stderr).toString().trim() || `${command} exited with code ${code}`)));
    child.stdin.end(input);
  });
}

function lastErrorLine(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return String(error) || fallback;
  return error.message.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) ?? fallback;
}

async function readClipboardImage(destination: string): Promise<string> {
  if (process.platform === "win32") return readWindowsClipboard(destination);
  if (process.platform === "linux") return readLinuxClipboard(destination);

  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", [
      "-l", "JavaScript", "-e",
      'ObjC.import("AppKit"); ObjC.unwrap($.NSPasteboard.generalPasteboard.stringForType("public.file-url"))',
    ]);
    const clipboardFile = fileURLToPath(stdout.trim());
    if (clipboardFile && (await stat(clipboardFile)).isFile()) return clipboardFile;
  } catch {
    // The clipboard may contain image pixels instead of a file reference.
  }

  const script = `
    on run argv
      try
        set imageData to the clipboard as «class PNGf»
      on error
        try
          set imageData to the clipboard as TIFF picture
        on error
          error "The clipboard does not contain an image or image file. Copy one, then try again."
        end try
      end try
      set outputFile to open for access POSIX file (item 1 of argv) with write permission
      try
        set eof outputFile to 0
        write imageData to outputFile
      on error errorMessage
        close access outputFile
        error errorMessage
      end try
      close access outputFile
    end run
  `;

  try {
    await execFileAsync("/usr/bin/osascript", ["-e", script, destination]);
    return destination;
  } catch (error) {
    fail(lastErrorLine(error, "could not read an image from the clipboard"));
  }
}

async function readWindowsClipboard(destination: string): Promise<string> {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $files = [System.Windows.Forms.Clipboard]::GetFileDropList()
    if ($files.Count -gt 0) { Write-Output $files[0]; exit 0 }
    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
      $image = [System.Windows.Forms.Clipboard]::GetImage()
      $image.Save($env:CVT_CLIPBOARD_DEST, [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output $env:CVT_CLIPBOARD_DEST
      exit 0
    }
    Write-Error "The clipboard does not contain an image or image file."
    exit 2
  `;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
      env: { ...process.env, CVT_CLIPBOARD_DEST: destination },
    });
    return stdout.trim();
  } catch (error) {
    fail(lastErrorLine(error, "could not read an image from the Windows clipboard"));
  }
}

async function readLinuxClipboard(destination: string): Promise<string> {
  const wayland = await commandExists("wl-paste");
  const x11 = await commandExists("xclip");
  if (!wayland && !x11) fail("clipboard support needs wl-clipboard on Wayland or xclip on X11");
  try {
    const listArgs = wayland ? ["--list-types"] : ["-selection", "clipboard", "-t", "TARGETS", "-o"];
    const types = (await capture(wayland ? "wl-paste" : "xclip", listArgs)).toString();
    if (types.includes("text/uri-list")) {
      const uriArgs = wayland
        ? ["--no-newline", "--type", "text/uri-list"]
        : ["-selection", "clipboard", "-t", "text/uri-list", "-o"];
      const uriList = (await capture(wayland ? "wl-paste" : "xclip", uriArgs)).toString();
      const first = uriList.split(/\r?\n/).find((line) => line.startsWith("file://"));
      if (first) return fileURLToPath(first.trim());
    }
    const mime = ["image/png", "image/jpeg", "image/webp", "image/tiff", "image/bmp"]
      .find((candidate) => types.includes(candidate));
    if (!mime) fail("the clipboard does not contain an image or image file");
    const imageArgs = wayland
      ? ["--type", mime]
      : ["-selection", "clipboard", "-t", mime, "-o"];
    await writeFile(destination, await capture(wayland ? "wl-paste" : "xclip", imageArgs));
    return destination;
  } catch (error) {
    fail(lastErrorLine(error, "could not read an image from the Linux clipboard"));
  }
}

async function copyFileToClipboard(file: string): Promise<void> {
  if (process.platform === "win32") {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $files = New-Object System.Collections.Specialized.StringCollection
      [void]$files.Add($env:CVT_CLIPBOARD_FILE)
      [System.Windows.Forms.Clipboard]::SetFileDropList($files)
    `;
    try {
      await execFileAsync("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
        env: { ...process.env, CVT_CLIPBOARD_FILE: file },
      });
      return;
    } catch (error) {
      fail(lastErrorLine(error, "could not copy the converted file to the Windows clipboard"));
    }
  }
  if (process.platform === "linux") {
    const uri = `${pathToFileURL(file).href}\n`;
    try {
      if (await commandExists("wl-copy")) await capture("wl-copy", ["--type", "text/uri-list"], uri);
      else if (await commandExists("xclip")) await capture("xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-i"], uri);
      else fail("clipboard support needs wl-clipboard on Wayland or xclip on X11");
      return;
    } catch (error) {
      fail(lastErrorLine(error, "could not copy the converted file to the Linux clipboard"));
    }
  }
  const script = `
    on run argv
      set the clipboard to POSIX file (item 1 of argv)
    end run
  `;
  try {
    await execFileAsync("/usr/bin/osascript", ["-e", script, file]);
  } catch (error) {
    fail(lastErrorLine(error, "could not copy the converted file to the clipboard"));
  }
}

function inferredOutput(input: string | undefined, format: Format): string {
  if (!input) return resolve(`clipboard.${format === "jpeg" ? "jpg" : format}`);
  const extension = extname(input);
  const stem = extension ? input.slice(0, -extension.length) : input;
  return resolve(`${stem}.${format === "jpeg" ? "jpg" : format}`);
}

function parsePositiveInteger(value: string, label: string, allowZero = false): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1)) fail(`${label} must be ${allowZero ? "zero or " : ""}a positive integer`);
  return parsed;
}

async function runMagick(args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn("magick", args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(signal ? `ImageMagick stopped by ${signal}` : `ImageMagick exited with code ${code}`));
    });
  });
}

async function convertImages(inputs: string[], options: ImageOptions): Promise<void> {
  if (!(await commandExists("magick"))) {
    const install = process.platform === "darwin" ? "brew install imagemagick"
      : process.platform === "win32" ? "winget install ImageMagick.ImageMagick"
      : "install the imagemagick package with your Linux package manager";
    fail(`ImageMagick is required. Run: ${install}`);
  }
  if (options.paste && inputs.length) fail("use either file inputs or --paste, not both");

  const useClipboard = options.paste || inputs.length === 0;
  let tempDirectory: string | undefined;
  let sourceInputs = inputs.map((input) => resolve(input));

  try {
    if (useClipboard) {
      tempDirectory = await mkdtemp(join(tmpdir(), "cvt-"));
      const clipboardPath = join(tempDirectory, "clipboard-image");
      sourceInputs = [await readClipboardImage(clipboardPath)];
    }

    for (const input of sourceInputs) {
      try {
        if (!(await stat(input)).isFile()) fail(`not a file: ${input}`);
      } catch {
        fail(`file not found: ${input}`);
      }
    }

    const requestedFormat = options.format ?? (options.output ? extname(options.output).slice(1).toLowerCase() : "gif");
    if (!formats.includes(requestedFormat as Format)) fail(`unsupported output format: ${requestedFormat || "none"}`);
    const format = requestedFormat as Format;
    const output = resolve(options.output ?? inferredOutput(useClipboard ? undefined : inputs[0], format));

    if (!options.overwrite) {
      try {
        await stat(output);
        fail(`output already exists: ${output} (pass --overwrite to replace it)`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("cvt:")) throw error;
      }
    }

    const args: string[] = [...sourceInputs];
    if (options.resize) args.push("-resize", options.resize);
    if (options.quality) args.push("-quality", String(parsePositiveInteger(options.quality, "quality")));
    if (format === "gif") {
      args.push("-delay", String(parsePositiveInteger(options.delay, "delay")));
      args.push("-loop", String(parsePositiveInteger(options.loop, "loop", true)));
      args.push("-layers", "Optimize");
    }
    args.push(`${format}:${output}`);

    try {
      await runMagick(args);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
    if (options.copy !== false) {
      await copyFileToClipboard(output);
      process.stdout.write(`Created ${output} and copied it to the clipboard\n`);
    } else {
      process.stdout.write(`Created ${output}\n`);
    }
  } finally {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  }
}

const program = new Command()
  .name("cvt")
  .description("Convert images from files or the desktop clipboard")
  .version("0.1.0")
  .showHelpAfterError();

program
  .command("image", { isDefault: true })
  .description("Convert one image, or combine several images into an animated GIF")
  .argument("[inputs...]", "input image files in frame order")
  .option("-p, --paste", "read an image directly from the desktop clipboard")
  .option("-o, --output <file>", "output path")
  .addOption(new Option("-f, --format <format>", "output format when no extension is given").choices([...formats]))
  .option("--delay <centiseconds>", "GIF frame delay in hundredths of a second", "10")
  .option("--loop <count>", "GIF loop count; 0 loops forever", "0")
  .option("-r, --resize <geometry>", "resize, such as 800x600 or 50%")
  .option("-q, --quality <number>", "output quality")
  .option("-y, --overwrite", "replace an existing output file")
  .option("--no-copy", "do not copy the converted file to the clipboard")
  .addHelpText("after", `
Examples:
  cvt photo.png -o photo.gif
  cvt frame-1.png frame-2.png -o animation.gif --delay 15
  cvt --paste -o clipboard.gif
  cvt photo.heic -o photo.jpg -q 88
  cvt photo.png -f webp -r 1200x1200\>
`)
  .action(convertImages);

if (process.argv.length === 2) {
  runTui().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
} else {
  program.parseAsync().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
}
