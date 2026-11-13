# Voices

The `system-diff` script speaks each narration line with one of three engines.

| Engine | Cost | Needs | Flags |
|---|---|---|---|
| none | free | nothing | `--voice none` |
| Kokoro | free | a one-off download of about 500 MB; runs on this machine, offline afterwards | `--voice kokoro --voice-name <voice>` |
| the user's own | theirs | a command that turns text into an audio file | `--tts-command '<command>'` |

## Kokoro voices

`af_heart`, `am_michael`, `bf_emma` and `bm_george` are the four to offer first: an American and a British voice of each gender. An unknown `--voice-name` makes the script list every voice it has.

## The command contract

`--tts-command` takes any shell command with two placeholders:

- `{text}` becomes the line to speak, already quoted for the shell.
- `{out}` becomes an output path with no extension, already quoted. The command writes its audio there with any extension ffmpeg can read (`.wav`, `.mp3`, `.aiff`, `.ogg`).

The command runs once per line, and each line is cached, so a paid engine is charged once per new line.

```
node <script> setup --tts-command 'say -o {out}.aiff {text}'
node <script> setup --tts-command 'edge-tts --voice en-US-AndrewNeural --text {text} --write-media {out}.mp3'
```

The first is the built-in macOS voice. The second is [edge-tts](https://github.com/rany2/edge-tts), which the user installs themselves.

## An engine behind an API key

For ElevenLabs, OpenAI or any other hosted voice, have the user point the command at a small script of their own that takes the text and the output path and calls the API:

```
node <script> setup --tts-command '~/bin/speak.sh {text} {out}.mp3'
```

The key stays in an environment variable that their script reads. The config stores the command as typed, so a key written into the command would be saved in plain text; keep it out.

## Testing a voice

`say` speaks one line with any engine before it is saved, so the user can hear it:

```
node <script> say "After this change, signup adds a job to a queue and returns right away." --out <scratch folder>/test.wav --tts-command '<command>'
```
