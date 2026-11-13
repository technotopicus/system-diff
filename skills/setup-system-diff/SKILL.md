---
name: setup-system-diff
description: "Set this machine up for the system-diff skill: install what its renderer needs, choose an optional voice, and prove it all works with a test clip. Run once before the first system diff, or again to change the voice."
disable-model-invocation: true
---

# Setup System Diff

Take this machine from nothing to a working test clip, and record what worked in `~/.system-diff/config.json`, which the `system-diff` skill reads on every run. Everything setup downloads goes into `~/.system-diff`; the user's repositories are left alone.

This skill needs the `system-diff` skill installed beside it. Below, `<script>` is the absolute path of `../system-diff/scripts/system-diff.mjs` from this skill's folder.

## 1. Node

Run `node --version`. The script needs Node 20 or newer.

When Node is missing or older, offer to install it with the package manager this machine already has (`brew install node`, `winget install OpenJS.NodeJS.LTS`, the distribution's own, or `nvm`), and run that once the user agrees. A user who would rather do it themselves gets https://nodejs.org/en/download, and you wait.

Done when `node --version` prints 20 or newer.

## 2. Explore

Run `node <script> doctor`. It lists each tool, whether this machine has it, and what setup would download when it does not. On a machine that is already set up it also shows the current choices, which become your recommended answers.

Done when you can tell the user exactly what setup will download and roughly how big it is.

## 3. Ask

In one message, tell the user what will be downloaded and that it goes into `~/.system-diff`, then ask the one real question, worded so "yes" accepts the recommendation:

**Voice.** Should the videos be narrated?

- **Kokoro** (recommended): a free neural voice that runs on this machine, with no account or key. A one-off download of about 500 MB.
- **No voice**: captions only, nothing extra to download. A voice can be added later by running this skill again.
- **Their own engine**: any text-to-speech tool they already use, free or paid. [`VOICE.md`](VOICE.md) has the contract and recipes.

Done when the user has agreed to the downloads and chosen a voice.

## 4. Install and test

Run setup once, with the one line that matches the chosen voice:

```
node <script> setup --voice none
node <script> setup --voice kokoro
node <script> setup --tts-command '<their command>'
```

It installs what is missing, tests the browser, ffmpeg and the voice, builds a test clip, and writes the config only when every part worked. When it fails, show the user the error; fix it, or put the choice back to them.

For Kokoro, that first run installs the voice. Then let the user choose which voice by ear: speak one line in each of `af_heart`, `am_michael`, `bf_emma` and `bm_george` into a temporary folder, and give the user the four file paths to play.

```
node <script> say "After this change, signup adds a job to a queue and returns right away." --out <temporary folder>/<voice>.wav --voice kokoro --voice-name <voice>
```

Then run `node <script> setup --voice kokoro --voice-name <their pick>`.

Done when the last setup run ends with `Ready.`

## 5. Show the result

Give the user the path of the test clip, `~/.system-diff/test/system-diff.mp4`, to watch. Tell them the skill is ready: they can now ask for a system diff of any pull request or branch, and running this skill again changes the voice.
