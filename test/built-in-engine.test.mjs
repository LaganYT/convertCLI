import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("converts PNG to GIF without a system ImageMagick binary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cvt-built-in-test-"));
  const input = join(directory, "input.png");
  const output = join(directory, "output.gif");
  await writeFile(input, onePixelPng);

  const cli = resolve("dist/cli.js");
  const { stdout } = await execFileAsync(process.execPath, [cli, input, "-o", output, "--no-copy"], {
    env: { ...process.env, PATH: "" },
  });

  assert.match(stdout, /Created .*output\.gif/);
  assert.ok((await stat(output)).size > 0);
  assert.equal((await readFile(output)).subarray(0, 6).toString(), "GIF89a");
});
