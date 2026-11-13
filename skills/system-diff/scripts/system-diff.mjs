#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const home = process.env.SYSTEM_DIFF_HOME ?? path.join(os.homedir(), ".system-diff");
const configPath = path.join(home, "config.json");
const requireFromHome = createRequire(path.join(home, "package.json"));
const isWindows = process.platform === "win32";
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(home, "browsers");

const SAMPLE_RATE = 48000;
const SPEECH_LEAD = 0.35;
const SPEECH_TAIL = 0.6;
const KOKORO_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_KOKORO_VOICE = "af_heart";
const CHANGES = ["added", "removed", "changed"];
const TONES = ["good", "warn", "bad", "neutral"];
const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

const USAGE = `system-diff: turn a system-diff spec into a short video

  doctor                         report what is installed and whether setup has run
  setup [voice options]          install what is missing, test it, write the config
  say "<text>" --out <file.wav>  speak one line with the configured voice
  check <spec.json>              validate a spec without rendering
  build <spec.json>              render the video

Voice options (setup, say):
  --voice none | kokoro | command
  --voice-name <name>            a Kokoro voice, default ${DEFAULT_KOKORO_VOICE}
  --tts-command '<command>'      any engine; {text} is the line, {out} the output path without extension

Build options:
  --out <directory>              default: a folder under the system temp directory
  --repo <directory>             check that every evidence "path:line" exists in this checkout
  --no-voice                     captions only, even when a voice is configured
  --fps <number>                 default 30`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArguments(values) {
  const options = { positional: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      options.positional.push(value);
      continue;
    }
    const next = values[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[value.slice(2)] = true;
    } else {
      options[value.slice(2)] = next;
      index += 1;
    }
  }
  return options;
}

function run(command, commandArguments, options = {}) {
  const result = spawnSync(command, commandArguments, { encoding: "utf8", maxBuffer: 1 << 29, ...options });
  return {
    ok: result.status === 0,
    stdout: result.stdout,
    output: options.encoding === "buffer" ? String(result.stderr ?? "") : `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

function readConfig() {
  return existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;
}

function isInstalled(packageName) {
  return existsSync(path.join(home, "node_modules", packageName, "package.json"));
}

function findFfmpeg() {
  if (run("ffmpeg", ["-version"]).ok) return "ffmpeg";
  if (isInstalled("ffmpeg-static")) return requireFromHome("ffmpeg-static");
  return null;
}

function voiceFromOptions(options, fallback) {
  if (options["tts-command"]) return { engine: "command", command: options["tts-command"] };
  if (options.voice === "kokoro" || (options.voice === undefined && options["voice-name"])) {
    return { engine: "kokoro", name: options["voice-name"] ?? DEFAULT_KOKORO_VOICE };
  }
  if (options.voice === "none") return { engine: "none" };
  if (options.voice === "command") fail("--voice command needs --tts-command '<command>'.");
  if (options.voice !== undefined) fail(`Unknown voice "${options.voice}". Use none, kokoro or command.`);
  return fallback;
}

function describeVoice(voice) {
  if (!voice || voice.engine === "none") return "none (captions only)";
  return voice.engine === "kokoro" ? `kokoro (${voice.name})` : `command: ${voice.command}`;
}

function doctor() {
  const config = readConfig();
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const npm = run(isWindows ? "npm.cmd" : "npm", ["--version"], { shell: isWindows });
  const ffmpeg = findFfmpeg();
  const chrome = CHROME_PATHS.find((candidate) => existsSync(candidate));
  const rows = [
    ["node", `v${process.versions.node}`, nodeMajor >= 20 ? "ok" : "too old, needs 20 or newer"],
    ["npm", npm.ok ? npm.output : "missing", npm.ok ? "ok" : "install Node.js, which includes npm"],
    ["ffmpeg", ffmpeg === "ffmpeg" ? "on the PATH" : ffmpeg ?? "missing", ffmpeg ? "ok" : "setup downloads one (about 80 MB)"],
    ["browser", config ? (config.browser === "chrome" ? "Google Chrome" : "Chromium (downloaded)") : chrome ? "Google Chrome" : "no Chrome found", config || chrome ? "ok" : "setup downloads Chromium (about 200 MB)"],
    ["packages", isInstalled("playwright-core") ? "installed" : "missing", isInstalled("playwright-core") ? "ok" : "setup installs playwright-core (about 15 MB)"],
    ["kokoro", isInstalled("kokoro-js") ? "installed" : "not installed", "optional voice (about 500 MB the first time)"],
    ["voice", config ? describeVoice(config.voice) : "not chosen", config ? "ok" : "chosen during setup"],
    ["config", config ? configPath : "missing", config ? `ok, tested ${config.testedAt}` : "setup writes it"],
  ];
  for (const [name, value, note] of rows) console.log(`${name.padEnd(10)}${String(value).padEnd(42)}  ${note}`);
  console.log(`home      ${home}`);
  console.log(config ? "\nReady." : "\nNot set up. Run the setup-system-diff skill.");
  if (!config) process.exitCode = 1;
}

async function launchBrowser(kind) {
  const { chromium } = requireFromHome("playwright-core");
  return chromium.launch(kind === "chrome" ? { channel: "chrome" } : {});
}

async function resolveBrowser() {
  try {
    await (await launchBrowser("chrome")).close();
    return "chrome";
  } catch {
    console.log("No usable Google Chrome here, so installing Chromium...");
  }
  const install = run(process.execPath, [path.join(home, "node_modules", "playwright-core", "cli.js"), "install", "chromium-headless-shell"]);
  if (!install.ok) fail(`Could not download Chromium:\n${install.output}`);
  await (await launchBrowser("chromium")).close();
  return "chromium";
}

let kokoroModel;
async function speakWithKokoro(text, voiceName, outputStem) {
  if (!isInstalled("kokoro-js")) fail("The Kokoro voice is not installed. Run: system-diff.mjs setup --voice kokoro");
  const { KokoroTTS } = requireFromHome("kokoro-js");
  kokoroModel ??= await KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype: "q8", device: "cpu" });
  if (!(voiceName in kokoroModel.voices)) fail(`Unknown Kokoro voice "${voiceName}". Voices: ${Object.keys(kokoroModel.voices).join(", ")}`);
  const audio = await kokoroModel.generate(text, { voice: voiceName });
  await audio.save(`${outputStem}.wav`);
}

function shellQuote(value) {
  return isWindows ? `"${value.replaceAll('"', '\\"')}"` : `'${value.replaceAll("'", "'\\''")}'`;
}

function speakWithCommand(text, template, outputStem) {
  const command = template.replaceAll("{text}", shellQuote(text)).replaceAll("{out}", shellQuote(outputStem));
  const result = run(command, [], { shell: true });
  if (!result.ok) fail(`The voice command failed:\n${command}\n${result.output}`);
}

async function speech(text, voice, ffmpeg) {
  const cacheDirectory = path.join(home, "cache", "speech");
  mkdirSync(cacheDirectory, { recursive: true });
  const key = createHash("sha256").update(JSON.stringify([voice, text])).digest("hex").slice(0, 24);
  const cached = path.join(cacheDirectory, `${key}.pcm`);
  if (existsSync(cached)) return readFileSync(cached);
  const outputStem = path.join(cacheDirectory, key);
  if (voice.engine === "kokoro") await speakWithKokoro(text, voice.name, outputStem);
  else speakWithCommand(text, voice.command, outputStem);
  const produced = readdirSync(cacheDirectory).find((name) => name.startsWith(`${key}.`) && !name.endsWith(".pcm"));
  if (!produced) fail(`The voice wrote no file at ${outputStem}.*`);
  const producedPath = path.join(cacheDirectory, produced);
  const converted = run(ffmpeg, ["-v", "error", "-i", producedPath, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "-"], { encoding: "buffer" });
  rmSync(producedPath);
  if (!converted.ok || converted.stdout.length === 0) fail(`Could not read the voice output ${produced}:\n${converted.output}`);
  writeFileSync(cached, converted.stdout);
  return converted.stdout;
}

function writeWav(filePath, samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  writeFileSync(filePath, Buffer.concat([header, samples]));
}

function validateDiagram(boxes, links, words, problems) {
  const { errors, evidenced } = problems;
  const [boxWord, boxesWord, linkWord, beforeField] = words;
  const ids = new Set(boxes.map((box) => box.id));
  if (boxes.length > 8) errors.push(`${boxes.length} ${boxesWord}; the limit is 8. Group the ones that the change treats alike.`);
  if (ids.size !== boxes.length) errors.push(`Two ${boxesWord} share an id.`);
  const cells = new Set();
  for (const box of boxes) {
    const name = `${boxWord} "${box.id}"`;
    if (!box.id || !box.label) errors.push(`${name} needs an id and a label.`);
    if (box.id === "start") errors.push(`"start" is reserved for where a statechart begins; give the ${boxWord} another id.`);
    if (!Number.isInteger(box.column) || !Number.isInteger(box.row)) errors.push(`${name} needs an integer column and row.`);
    if (cells.has(`${box.column}:${box.row}`)) errors.push(`${name} shares its column and row with another ${boxWord}.`);
    cells.add(`${box.column}:${box.row}`);
    if (box.change && !CHANGES.includes(box.change)) errors.push(`${name} has change "${box.change}"; use added, removed or changed.`);
    if (box.change === "changed" && !box[beforeField]) errors.push(`${name} is changed, so it needs ${beforeField}.`);
    if (box.tone && !TONES.includes(box.tone)) errors.push(`${name} has tone "${box.tone}"; use good, warn, bad or neutral.`);
    if (box.change) evidenced.push([name, box.evidence]);
  }
  const span = (key) => (boxes.length ? Math.max(...boxes.map((box) => box[key])) - Math.min(...boxes.map((box) => box[key])) + 1 : 0);
  if (span("column") > 4) errors.push(`The ${boxesWord} span more than 4 columns.`);
  if (span("row") > 3) errors.push(`The ${boxesWord} span more than 3 rows.`);

  for (const link of links) {
    const name = `${linkWord} ${link.from} to ${link.to}`;
    const isEntry = boxWord === "state" && link.from === "start";
    if ((!ids.has(link.from) && !isEntry) || !ids.has(link.to)) errors.push(`${name} points at a ${boxWord} that does not exist.`);
    if (link.from === link.to && boxWord === "node") errors.push(`${name} starts and ends on the same node.`);
    if (link.change && !CHANGES.includes(link.change)) errors.push(`${name} has change "${link.change}"; use added, removed or changed.`);
    if (link.change === "changed" && !link.labelBefore) errors.push(`${name} is changed, so it needs labelBefore.`);
    if (boxWord === "state" && !isEntry && !link.label) errors.push(`${name} needs a label: the event that causes it.`);
    if (link.change) evidenced.push([name, link.evidence]);
  }
  return ids;
}

function validate(spec, repoDirectory) {
  const errors = [];
  const warnings = [];
  const evidenced = [];
  const problems = { errors, evidenced };
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const states = Array.isArray(spec.statechart?.states) ? spec.statechart.states : [];
  const transitions = Array.isArray(spec.statechart?.transitions) ? spec.statechart.transitions : [];
  const facts = Array.isArray(spec.facts) ? spec.facts : [];
  const beats = spec.beats ?? {};

  if (!spec.title) errors.push("title is missing.");
  if (spec.state) errors.push("state is not a field. Before and after values go in facts; the stages one thing moves through go in statechart.");
  if (nodes.length === 0 && !spec.statechart) errors.push("The spec has no diagram. Give it nodes and edges, a statechart, or both.");
  if (edges.length && nodes.length === 0) errors.push("edges is set, so nodes is needed.");

  const nodeIds = validateDiagram(nodes, edges, ["node", "nodes", "edge", "detailBefore"], problems);
  const pairs = Map.groupBy(edges, (edge) => [edge.from, edge.to].sort().join(" and "));
  for (const [pair, group] of pairs) {
    const together = Math.max(group.filter((edge) => edge.change !== "added").length, group.filter((edge) => edge.change !== "removed").length);
    if (together > 1) errors.push(`More than one flow connects ${pair} at the same time. Draw one, in the direction the work moves, and put the reply in its label or in a fact.`);
  }

  let stateIds = new Set();
  if (spec.statechart) {
    if (!spec.statechart.subject) errors.push('statechart needs a subject: the one thing whose states these are, such as "an order".');
    if (states.length === 0) errors.push("statechart.states is empty.");
    stateIds = validateDiagram(states, transitions, ["state", "states", "transition", "labelBefore"], problems);
    for (const [route, group] of Map.groupBy(transitions, (transition) => `${transition.from} to ${transition.to}`)) {
      const together = Math.max(group.filter((transition) => transition.change !== "added").length, group.filter((transition) => transition.change !== "removed").length);
      if (together > 1) errors.push(`More than one transition goes from ${route} at the same time. Draw one and join the events in its label.`);
    }
    for (const [when, gone] of [["before", "added"], ["after", "removed"]]) {
      const present = states.filter((state) => state.change !== gone);
      const steps = transitions.filter((transition) => transition.change !== gone);
      const reached = new Set(["start"]);
      while (steps.some((step) => reached.has(step.from) && !reached.has(step.to) && reached.add(step.to)));
      if (present.length && reached.size === 1) errors.push(`The statechart has no start ${when} the change. Add a transition with "from": "start" to the state it begins in.`);
      else for (const state of present) {
        if (!reached.has(state.id)) errors.push(`state "${state.id}" cannot be reached from the start ${when} the change. Add the transition that leads to it.`);
      }
    }
  }

  if (facts.length > 4) errors.push(`${facts.length} facts; the limit is 4. Keep the ones a reviewer most needs.`);
  for (const fact of facts) {
    const name = `fact "${fact.label}"`;
    if (!fact.label || !fact.before || !fact.after) errors.push(`${name} needs a label, before and after.`);
    if (fact.tone && !TONES.includes(fact.tone)) errors.push(`${name} has tone "${fact.tone}"; use good, warn, bad or neutral.`);
    evidenced.push([name, fact.evidence]);
  }

  if (spec.failure) {
    const failure = spec.failure;
    const failurePath = Array.isArray(failure.path) ? failure.path : null;
    const failureIds = failurePath ? stateIds : nodeIds;
    if (failurePath) {
      if (failurePath.length === 0 || failurePath.some((id) => !stateIds.has(id))) errors.push("failure.path needs one or more state ids that exist, ending in the state that goes wrong.");
      failurePath.slice(1).forEach((id, index) => {
        const walkable = transitions.some((transition) => transition.from === failurePath[index] && transition.to === id && transition.change !== "removed");
        if (!walkable) errors.push(`failure.path steps from ${failurePath[index]} to ${id}, but no transition does that after the change.`);
      });
    } else {
      const edgeExists = failure.edge && edges.some((edge) => edge.from === failure.edge.from && edge.to === failure.edge.to);
      if (!nodeIds.has(failure.node) && !edgeExists) errors.push("failure needs a node id, an edge with from and to, or a path of state ids, that exists.");
    }
    for (const effect of failure.effects ?? []) {
      if (!failureIds.has(effect.node)) errors.push(`A failure effect points at "${effect.node}", which is not in the diagram that fails.`);
      if (!effect.text) errors.push(`The failure effect on "${effect.node}" needs text.`);
      if (effect.tone && !TONES.includes(effect.tone)) errors.push(`The failure effect on "${effect.node}" has tone "${effect.tone}".`);
    }
    if (!beats.failure?.caption) errors.push("failure is set, so beats.failure.caption is needed.");
    evidenced.push(["failure", failure.evidence]);
  }

  const captioned = [...(nodes.length ? ["before", "after"] : []), ...(spec.statechart ? ["statesBefore", "statesAfter"] : []), "close"];
  for (const name of captioned) {
    if (!beats[name]?.caption) errors.push(`beats.${name}.caption is missing.`);
  }
  const changes = [nodes, edges, states, transitions].flat().filter((item) => item.change).length + facts.length;
  if (changes === 0) errors.push("Nothing changes in this spec. When a change leaves the system as it was, say so instead of making a video.");

  for (const [name, evidence] of evidenced) {
    const citations = [evidence].flat().filter(Boolean);
    if (citations.length === 0) errors.push(`${name} has no evidence. Cite the file and line that shows it, as "path:line".`);
    for (const citation of citations) {
      const located = /^(.+?):(\d+)/.exec(citation);
      if (!repoDirectory || !located || citation.startsWith("base ")) continue;
      const filePath = path.resolve(repoDirectory, located[1]);
      if (!existsSync(filePath)) warnings.push(`${name}: evidence file ${located[1]} is not in ${repoDirectory}.`);
      else if (readFileSync(filePath, "utf8").split("\n").length < Number(located[2])) warnings.push(`${name}: ${located[1]} has no line ${located[2]}.`);
    }
  }
  return { errors, warnings };
}

function readSpec(specPath) {
  if (!specPath || !existsSync(specPath)) fail(`No spec file at ${specPath ?? "(none given)"}.`);
  try {
    return JSON.parse(readFileSync(specPath, "utf8"));
  } catch (error) {
    return fail(`${specPath} is not valid JSON: ${error.message}`);
  }
}

function report(problems) {
  for (const warning of problems.warnings) console.log(`warning: ${warning}`);
  for (const error of problems.errors) console.log(`error: ${error}`);
  if (problems.errors.length) process.exit(1);
  return problems.warnings.length;
}

async function build(specPath, options, overrides = {}) {
  const spec = readSpec(specPath);
  const specWarnings = report(validate(spec, options.repo));
  const config = overrides.config ?? readConfig();
  if (!config) fail("system-diff is not set up on this machine. Run the setup-system-diff skill first.");
  const framesPerSecond = Number(options.fps ?? 30);
  const outputDirectory = path.resolve(options.out ?? path.join(os.tmpdir(), "system-diff", path.basename(specPath, ".json")));
  const framesDirectory = path.join(outputDirectory, "frames");
  const stillsDirectory = path.join(outputDirectory, "stills");
  for (const directory of [framesDirectory, stillsDirectory]) {
    rmSync(directory, { recursive: true, force: true });
    mkdirSync(directory, { recursive: true });
  }

  const template = readFileSync(path.join(scriptDirectory, "template.html"), "utf8");
  const previewPath = path.join(outputDirectory, "preview.html");
  writeFileSync(previewPath, template.replace("__SYSTEM_DIFF_SPEC__", () => JSON.stringify(spec).replaceAll("<", "\\u003c")));

  const browser = await launchBrowser(config.browser);
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const openPage = async () => {
    const page = await context.newPage();
    await page.goto(pathToFileURL(previewPath).href);
    return page;
  };
  const firstPage = await openPage();
  const { order, minimums, pageWarnings } = await firstPage.evaluate(() => ({
    order: SystemDiff.order,
    minimums: SystemDiff.minimumDurations(),
    pageWarnings: SystemDiff.warnings,
  }));

  const voice = options["no-voice"] ? { engine: "none" } : config.voice;
  const durations = {};
  const lines = [];
  let cursor = 0;
  for (const name of order) {
    const text = voice.engine === "none" ? undefined : spec.beats[name]?.say;
    const samples = text ? await speech(text, voice, config.ffmpeg) : null;
    const spoken = samples ? samples.length / 2 / SAMPLE_RATE + SPEECH_LEAD + SPEECH_TAIL : 0;
    durations[name] = Math.max(minimums[name], spoken);
    if (samples) lines.push({ samples, at: cursor + SPEECH_LEAD });
    cursor += durations[name];
  }
  const total = cursor;

  const frameCount = Math.round(total * framesPerSecond);
  const pages = [firstPage, ...(await Promise.all(Array.from({ length: 3 }, openPage)))];
  await Promise.all(
    pages.map(async (page, worker) => {
      await page.evaluate((values) => SystemDiff.setDurations(values), durations);
      for (let frame = worker; frame < frameCount; frame += pages.length) {
        await page.evaluate((time) => SystemDiff.render(time), frame / framesPerSecond);
        await page.screenshot({ path: path.join(framesDirectory, `${String(frame).padStart(5, "0")}.png`) });
      }
    }),
  );
  const stills = await firstPage.evaluate(() => SystemDiff.stills());
  for (const [index, still] of stills.entries()) {
    await firstPage.evaluate((time) => SystemDiff.render(time), still.time);
    await firstPage.screenshot({ path: path.join(stillsDirectory, `${String(index + 1).padStart(2, "0")}.png`) });
  }
  await browser.close();

  const videoPath = path.join(outputDirectory, "system-diff.mp4");
  const inputs = ["-framerate", String(framesPerSecond), "-i", path.join(framesDirectory, "%05d.png")];
  const audio = [];
  if (lines.length) {
    const track = Buffer.alloc(Math.ceil(total * SAMPLE_RATE) * 2);
    for (const line of lines) line.samples.copy(track, Math.round(line.at * SAMPLE_RATE) * 2);
    const narrationPath = path.join(outputDirectory, "narration.wav");
    writeWav(narrationPath, track);
    inputs.push("-i", narrationPath);
    audio.push("-c:a", "aac", "-b:a", "160k");
  }
  const encoded = run(config.ffmpeg, ["-y", "-v", "error", ...inputs, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", ...audio, "-movflags", "+faststart", videoPath]);
  if (!encoded.ok) fail(`ffmpeg could not write the video:\n${encoded.output}`);
  const sheetPath = path.join(outputDirectory, "sheet.png");
  const sheet = run(config.ffmpeg, ["-y", "-v", "error", "-i", path.join(stillsDirectory, "%02d.png"), "-vf", `scale=960:-1,tile=2x${Math.ceil(stills.length / 2)}:color=0xfcfcfc`, "-frames:v", "1", sheetPath]);
  if (!sheet.ok) fail(`ffmpeg could not write the contact sheet:\n${sheet.output}`);
  rmSync(framesDirectory, { recursive: true, force: true });

  const longest = spec.nodes?.length && spec.statechart ? 60 : 45;
  if (total > longest) pageWarnings.push(`The video runs ${total.toFixed(1)} s; keep it under ${longest}. Shorten the narration.`);
  for (const warning of pageWarnings) console.log(`warning: ${warning}`);
  const warningCount = specWarnings + pageWarnings.length;
  console.log(`video    ${videoPath}`);
  console.log(`sheet    ${sheetPath}  (one frame per beat: ${order.join(", ")})`);
  console.log(`stills   ${stillsDirectory}  (the same frames at full size)`);
  console.log(`preview  ${previewPath}#play`);
  console.log(`length   ${total.toFixed(1)} s, voice: ${describeVoice(voice)}`);
  console.log(warningCount ? `${warningCount} warning(s). Fix the spec and build again.` : "No warnings.");
  return videoPath;
}

async function setup(options) {
  if (Number(process.versions.node.split(".")[0]) < 20) fail(`Node ${process.versions.node} is too old. Install Node 20 or newer, then run setup again.`);
  const voice = voiceFromOptions(options, readConfig()?.voice ?? { engine: "none" });
  mkdirSync(home, { recursive: true });
  const manifestPath = path.join(home, "package.json");
  if (!existsSync(manifestPath)) writeFileSync(manifestPath, `${JSON.stringify({ name: "system-diff-home", private: true }, null, 2)}\n`);

  const wanted = ["playwright-core"];
  if (!run("ffmpeg", ["-version"]).ok) wanted.push("ffmpeg-static");
  if (voice.engine === "kokoro") wanted.push("kokoro-js");
  const missing = wanted.filter((packageName) => !isInstalled(packageName));
  if (missing.length) {
    console.log(`Installing ${missing.join(", ")} into ${home}...`);
    const install = run(isWindows ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", ...missing], { cwd: home, shell: isWindows });
    if (!install.ok) fail(`npm install failed:\n${install.output}`);
  }

  const ffmpeg = findFfmpeg();
  if (!ffmpeg || !run(ffmpeg, ["-version"]).ok) fail("ffmpeg is still missing after the install.");
  console.log(`ffmpeg   ${ffmpeg}`);
  const browser = await resolveBrowser();
  console.log(`browser  ${browser}`);
  if (voice.engine !== "none") {
    const samples = await speech("This is the voice system diff will use.", voice, ffmpeg);
    console.log(`voice    ${describeVoice(voice)}, ${(samples.length / 2 / SAMPLE_RATE).toFixed(1)} s test line`);
  } else {
    console.log("voice    none (captions only)");
  }

  const config = { browser, ffmpeg, voice, testedAt: new Date().toISOString().slice(0, 10) };
  console.log("Building a test clip...");
  await build(path.join(scriptDirectory, "..", "examples", "welcome-email-queue.json"), { out: path.join(home, "test"), fps: 10 }, { config });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`config   ${configPath}\nReady.`);
}

async function say(options) {
  const [text] = options.positional;
  if (!text || !options.out) fail('Usage: say "<text>" --out <file.wav> [voice options]');
  const config = readConfig();
  const voice = voiceFromOptions(options, config?.voice);
  if (!voice || voice.engine === "none") fail("No voice is configured. Pass --voice kokoro or --tts-command, or run setup with a voice.");
  const ffmpeg = config?.ffmpeg ?? findFfmpeg();
  if (!ffmpeg) fail("ffmpeg is missing. Run setup first.");
  const samples = await speech(text, voice, ffmpeg);
  writeWav(path.resolve(options.out), samples);
  console.log(`${path.resolve(options.out)}  ${describeVoice(voice)}, ${(samples.length / 2 / SAMPLE_RATE).toFixed(1)} s`);
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArguments(rest);
if (command === "doctor") doctor();
else if (command === "setup") await setup(options);
else if (command === "say") await say(options);
else if (command === "check") {
  const warningCount = report(validate(readSpec(options.positional[0]), options.repo));
  console.log(warningCount ? `The spec is valid, with ${warningCount} warning(s) to resolve.` : "The spec is valid.");
} else if (command === "build") await build(options.positional[0], options);
else console.log(USAGE);
