import { spawn } from "node:child_process";
import { extname, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";

const ESC = "\u001b[";
const formats = ["gif", "png", "jpg", "webp", "heic", "tiff", "bmp"] as const;
type Format = (typeof formats)[number];
type Field = "source" | "files" | "format" | "output" | "delay" | "resize" | "convert";

type State = {
  source: "clipboard" | "files";
  files: string;
  format: Format;
  output: string;
  delay: string;
  resize: string;
  focus: number;
  status: string;
  error: string;
  busy: boolean;
};

const fields: Field[] = ["source", "files", "format", "output", "delay", "resize", "convert"];
const hitRows = new Map<number, Field>();

function stripDropEscapes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/\\([ '\\()])/g, "$1");
}

function parseFiles(value: string): string[] {
  return value.split("|").map(stripDropEscapes).filter(Boolean);
}

function defaultOutput(state: State): string {
  if (state.source === "clipboard" || !state.files.trim()) return `clipboard.${state.format}`;
  const first = parseFiles(state.files)[0] ?? "converted";
  const extension = extname(first);
  return `${extension ? first.slice(0, -extension.length) : first}.${state.format}`;
}

function pad(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(1, width - 1))}…` : value.padEnd(width);
}

function runConversion(state: State): Promise<{ ok: boolean; message: string }> {
  const args = [process.argv[1]!, "image"];
  if (state.source === "clipboard") args.push("--paste");
  else args.push(...parseFiles(state.files));
  args.push("--output", resolve(state.output || defaultOutput(state)), "--format", state.format, "--overwrite");
  if (state.format === "gif") args.push("--delay", state.delay || "10");
  if (state.resize.trim()) args.push("--resize", state.resize.trim());

  return new Promise((done) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => output += data.toString());
    child.stderr.on("data", (data) => output += data.toString());
    child.once("error", (error) => done({ ok: false, message: error.message }));
    child.once("exit", (code) => done({
      ok: code === 0,
      message: output.trim().split("\n").at(-1) || `Conversion exited with code ${code}`,
    }));
  });
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write("cvt: interactive mode needs a terminal. Run cvt --help for command options.\n");
    process.exitCode = 1;
    return;
  }

  const state: State = {
    source: "clipboard",
    files: "",
    format: "gif",
    output: "clipboard.gif",
    delay: "10",
    resize: "",
    focus: 0,
    status: "Ready",
    error: "",
    busy: false,
  };
  let previousDefault = defaultOutput(state);
  let stopped = false;

  const updateDefaultOutput = () => {
    const next = defaultOutput(state);
    if (!state.output || state.output === previousDefault) state.output = next;
    previousDefault = next;
  };

  const render = () => {
    const width = Math.max(54, Math.min(process.stdout.columns || 80, 92));
    const inner = width - 4;
    const lines: string[] = [];
    hitRows.clear();
    const add = (content = "", field?: Field) => {
      lines.push(`${ESC}2K  ${content}`);
      if (field) hitRows.set(lines.length, field);
    };
    const selected = (field: Field) => fields[state.focus] === field;
    const marker = (field: Field) => selected(field) ? `${ESC}38;5;81m›${ESC}0m` : " ";
    const input = (field: Field, value: string, placeholder: string) => {
      const shown = value || `${ESC}2m${placeholder}${ESC}22m`;
      return `${marker(field)} ${field === "files" ? "Files " : field === "output" ? "Output" : field === "delay" ? "Delay " : "Resize"}  ${ESC}48;5;236m ${pad(shown, inner - 13)} ${ESC}0m`;
    };

    lines.push(`${ESC}2J${ESC}H`);
    add(`${ESC}1;38;5;81mCVT${ESC}0m  ${ESC}2mimage converter${ESC}0m`);
    add("─".repeat(inner));
    add(`${marker("source")} Source  ${state.source === "clipboard" ? `${ESC}48;5;81;30m Clipboard ${ESC}0m  Files` : `Clipboard  ${ESC}48;5;81;30m Files ${ESC}0m`}`, "source");
    add();
    add(input("files", state.files, state.source === "clipboard" ? "not used while Clipboard is selected" : "type or drag a file here; use | between frames"), "files");
    add();
    add(`${marker("format")} Format  ${formats.map((format) => format === state.format ? `${ESC}48;5;81;30m ${format.toUpperCase()} ${ESC}0m` : ` ${format.toUpperCase()} `).join(" ")}`, "format");
    add();
    add(input("output", state.output, defaultOutput(state)), "output");
    add();
    add(input("delay", state.delay, "10, hundredths of a second"), "delay");
    add(input("resize", state.resize, "optional, for example 800x600 or 50%"), "resize");
    add();
    add(`${marker("convert")} ${selected("convert") ? `${ESC}48;5;81;30m  Convert  ${ESC}0m` : `${ESC}48;5;238m  Convert  ${ESC}0m`}   ${state.busy ? `${ESC}38;5;220mConverting…${ESC}0m` : state.status}`, "convert");
    if (state.error) {
      add(`${ESC}1;38;5;203mConversion failed${ESC}0m`);
      add(`${ESC}38;5;203m${pad(state.error, inner)}${ESC}0m`);
    }
    add();
    add(`${ESC}2m↑↓/Tab move   ←→ choose   Enter select   mouse works   q quit${ESC}0m`);
    add(`${ESC}2mThe converted file is copied automatically. Paste it into any app.${ESC}0m`);
    process.stdout.write(lines.join("\n"));
  };

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write(`${ESC}?1000l${ESC}?1006l${ESC}?25h${ESC}?1049l`);
  };

  const convert = async () => {
    if (state.busy) return;
    if (state.source === "files" && parseFiles(state.files).length === 0) {
      state.status = "Add at least one file";
      render();
      return;
    }
    state.busy = true;
    state.status = "Working";
    state.error = "";
    render();
    const result = await runConversion(state);
    state.busy = false;
    state.status = result.ok ? `${ESC}38;5;82m${result.message}${ESC}0m` : "Error";
    state.error = result.ok ? "" : result.message.replace(/^cvt:\s*/, "");
    render();
  };

  const choose = (direction: number) => {
    const field = fields[state.focus];
    if (field === "source") {
      state.source = state.source === "clipboard" ? "files" : "clipboard";
      updateDefaultOutput();
    } else if (field === "format") {
      const index = formats.indexOf(state.format);
      state.format = formats[(index + direction + formats.length) % formats.length]!;
      updateDefaultOutput();
    }
  };

  const edit = (text: string) => {
    const field = fields[state.focus];
    if (field === "files" || field === "output" || field === "delay" || field === "resize") {
      state[field] += text;
      if (field === "files") updateDefaultOutput();
    }
  };

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write(`${ESC}?1049h${ESC}?25l${ESC}?1000h${ESC}?1006h`);
  render();

  process.stdout.on("resize", render);
  process.stdin.on("keypress", async (text, key) => {
    if (stopped || state.busy) return;
    if (key.ctrl && key.name === "c" || key.name === "escape" || (text === "q" && !["files", "output", "delay", "resize"].includes(fields[state.focus]!))) {
      cleanup();
      return;
    }
    if (key.name === "tab" || key.name === "down") state.focus = (state.focus + 1) % fields.length;
    else if (key.name === "up") state.focus = (state.focus - 1 + fields.length) % fields.length;
    else if (key.name === "left") choose(-1);
    else if (key.name === "right") choose(1);
    else if (key.name === "return") {
      const field = fields[state.focus];
      if (field === "convert") await convert();
      else if (field === "source" || field === "format") choose(1);
      else state.focus = (state.focus + 1) % fields.length;
    } else if (key.name === "backspace") {
      const field = fields[state.focus];
      if (field === "files" || field === "output" || field === "delay" || field === "resize") {
        state[field] = state[field].slice(0, -1);
        if (field === "files") updateDefaultOutput();
      }
    } else if (text && !key.ctrl && !key.meta && text >= " ") edit(text);
    render();
  });

  process.stdin.on("data", (data: Buffer) => {
    const match = data.toString().match(/\u001b\[<0;(\d+);(\d+)M/);
    if (!match) return;
    const x = Number(match[1]);
    const y = Number(match[2]);
    const field = hitRows.get(y);
    if (!field) return;
    state.focus = fields.indexOf(field);
    if (field === "source") choose(1);
    if (field === "format") {
      const start = 12;
      const approximate = Math.max(0, Math.min(formats.length - 1, Math.floor((x - start) / 7)));
      state.format = formats[approximate]!;
      updateDefaultOutput();
    }
    if (field === "convert") void convert();
    render();
  });

  await new Promise<void>((done) => {
    const timer = setInterval(() => {
      if (stopped) {
        clearInterval(timer);
        done();
      }
    }, 50);
  });
}
