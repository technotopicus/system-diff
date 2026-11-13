---
name: system-diff
description: "Make a short video of what a change does to the system (its components, flows, state and failure modes) instead of its line diff. Use for a system diff, or when the user wants a video or animatic explaining a pull request, branch or commit range."
---

# System Diff

A **system diff** shows what a change does to the running system: the components and flows it adds, removes or changes, the states a thing can now move through, the facts that flip, and the new way it can fail. The line diff is the evidence; the system diff is the story a reviewer needs.

You model the change as a spec, and the script renders the spec as a video in beats: title, a before and an after for each diagram, failure, close. Below, `<script>` is the absolute path of `scripts/system-diff.mjs` in this skill's folder.

## 1. Check setup

Run `node <script> doctor`. It ends with `Ready.` on a machine that is set up.

On any other ending, or when `node` is missing, stop and ask the user to run `/setup-system-diff`, which installs everything this skill needs.

## 2. Gather the change

The change is a pull request, a branch or a commit range. With nothing named, take the current branch against its base: the pull request's base branch when it has one, otherwise the repository's default branch. Ask the user when neither is clear.

Work in a checkout that sits at the head of the change, because step 4 checks your evidence against the files on disk.

- Read the whole diff (`gh pr diff <number>`, or `git diff <base>...<head>`), and the pull request description when there is one, or the commit messages when there is none.
- For every hunk that touches a call, a query, a schedule, a config value, a schema or a permission, read enough of the code around it, at the base and at the head, to know who calls whom at runtime.

Done when you can say, for the base and for the head: what runs, what each thing talks to, what it stores, and what happens when each thing it depends on is down.

## 3. Model the system change

List the change as claims, each with the `path:line` that shows it. The claims become the spec in step 4 and go to the user in step 6.

- **Components**: things that run or hold data, such as a service, a job, a queue, a table or an external API. Include the unchanged ones a viewer needs to follow the flow.
- **Flows**: one component calling, reading or writing another.
- **States and transitions**: the stages one thing moves through, such as an order, a job, a session or a connection, and the events that move it from one to the next.
- **Facts**: one thing about the system with a before and an after value, such as a config value, a limit, a schema, who may do what, or how long something takes.
- **Failure mode**: the most important new way to fail. Usually a new component or new dependency stops; it can also be an existing one whose failure now costs more, or a state a thing can now get stuck in. Say what happens then: what each other component does, or where the thing ends up.

Every claim cites the line that shows it. A claim with no line to cite is a guess, and stays out of the video.

Some changes leave the system as it was: a refactor, formatting, tests, comments, a rename of something only the code sees. For those, tell the user the change has no system diff and what kind of change it is, and finish there with no video. A rename of something the running system sees, such as a route, a table, a queue or a config key, is a system change.

The claims decide which diagram the video draws:

- **Component view**, when the wiring changes: a component or a flow is added or removed, or a flow carries something different.
- **Statechart**, when a lifecycle changes: a status gains or loses a value, a retry or cancel step appears, or an event now leads somewhere else.
- A value that changes while the wiring and the lifecycle stay the same, such as a longer timeout, is a fact, shown under whichever diagram gives it context.
- **Both**, when both change and each shows something the other cannot. Each diagram adds two beats, so a change that one diagram tells in full gets one.

Done when every hunk of the diff is either covered by a claim or set aside as leaving the system unchanged, and you have chosen the diagrams.

## 4. Write the spec

Turn the claims into a spec, following [`SPEC.md`](SPEC.md), which has every field, the layout rules and how to write the captions and narration. Save it as `system-diff.json` in a scratch folder outside the repository.

Run `node <script> check <spec> --repo <repository root>`.

Done when it prints exactly `The spec is valid.`, with no warnings. `check` confirms each cited line exists; that the line shows the claim is yours to confirm.

## 5. Build and read the sheet

Run `node <script> build <spec> --repo <repository root> --out <scratch folder>`. It prints the video path, its warnings, a contact sheet (one image with a frame from each beat) and a `stills` folder holding the same frames at full size.

Read the contact sheet for the overall picture and the stills for the small text, and check each frame:

- every label, value and caption is whole and readable;
- every flow line runs clear of the boxes and labels it does not connect;
- each before frame shows only what existed before, and each after frame shows everything the change added;
- a statechart's start dot sits on the state the thing begins in;
- the failure frame marks the right component or state, and each note sits on the bottom edge of the one it describes;
- each caption says what its frame shows.

Fix the spec and build again until the build prints `No warnings.` and the sheet passes every check. Most frame problems yield to shorter text or to moving a box to another cell. One that survives both goes in the hand-over, named.

## 6. Hand over

Give the user the video path, one sentence on what it shows, the claims with their evidence, and anything you left out or were unsure of. Posting the video anywhere is the user's decision.
