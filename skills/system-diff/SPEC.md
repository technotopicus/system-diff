# The system-diff spec

One JSON file describes the whole video. Two complete ones sit in [`examples/`](examples): [`welcome-email-queue.json`](examples/welcome-email-queue.json) uses both diagrams, and [`order-cancellation.json`](examples/order-cancellation.json) is a statechart alone. Copy their shape; their content belongs to other changes.

```json
{
  "title": "Send welcome emails through a queue",
  "source": "Pull request 482",
  "nodes": [],
  "edges": [],
  "statechart": {},
  "facts": [],
  "failure": {},
  "beats": {}
}
```

`title` says what the change does, in under 60 characters. `source` is optional and names where the change lives.

The video draws up to two diagrams. `nodes` and `edges` make the **component view**: what runs and what talks to what. `statechart` makes the **statechart**: the states one thing moves through. A spec carries one or both, and each diagram gets a before beat and an after beat.

## Nodes: the components

```json
{ "id": "queue", "label": "Email queue", "detail": "email_jobs table", "column": 2, "row": 1, "change": "added", "evidence": "db/migrations/0042_email_jobs.sql:1" }
```

- `label` is the name a teammate would say out loud, up to about 16 characters. `detail` is one supporting fact, up to about 24.
- `change` is `added`, `removed` or `changed`; leave it out for a component the change does not touch. A `changed` node also takes `detailBefore`, and the video swaps it for `detail`.
- `column` and `row` place the node on a grid of up to 4 columns and 3 rows. Columns follow the work as it moves, left to right: where a request or a piece of data starts on the left, where it ends up on the right. Rows hold things that sit side by side at the same stage.
- The before and after frames share one grid, so a cell that only an added node uses is empty in the before frame. Rows and columns that no node uses take no space.
- At most 8 nodes. A bigger change needs grouping: draw the three services the change treats alike as one node.
- Place an added node where its flows run along one row or one column, and keep unrelated nodes off the line between two connected ones.
- A removed node or flow shows in the before frame and is gone from the after frame, so an added node can sit on the line of a removed flow.

## Edges: the flows

```json
{ "from": "signup", "to": "queue", "label": "add a job", "change": "added", "evidence": "api/signup.ts:52" }
```

- `from` and `to` are node ids. The arrow points at `to`, the way the work moves: a caller to the service it asks to do something, and a queue or table to the worker that takes its work from it.
- One edge per pair of nodes. Fold a reply or a write-back into the label or a fact.
- `label` is a verb phrase of up to about 12 characters: what moves, or what the caller does.
- An edge is `changed` when what it carries changes, such as a call that becomes asynchronous. A new timeout or retry count on the same call is a fact.
- `change` works as for nodes. A `changed` edge also takes `labelBefore`.
- A flow that moves is two edges: the old one `removed`, the new one `added`.

## Statechart: the states of one thing

```json
"statechart": {
  "subject": "a welcome email",
  "states": [
    { "id": "queued", "label": "Queued", "column": 1, "row": 2, "change": "added", "evidence": "api/signup.ts:52" },
    { "id": "sending", "label": "Sending", "column": 2, "row": 2 },
    { "id": "sent", "label": "Sent", "column": 3, "row": 2, "tone": "good" }
  ],
  "transitions": [
    { "from": "start", "to": "queued", "change": "added", "evidence": "api/signup.ts:52" },
    { "from": "queued", "to": "sending", "label": "worker takes it", "change": "added", "evidence": "workers/email.ts:19" },
    { "from": "sending", "to": "sent", "label": "provider accepts" }
  ]
}
```

- `subject` is the one thing whose states these are, written with its article in lower case: "an order", "a welcome email", "the connection". The video heads the diagram "The states of an order".
- A state's `label` is what a person would call that stage, up to about 16 characters: "Paid", "Waiting to retry". Keep variable names and status codes out of it.
- A transition's `label` is the event that causes it, as someone watching would say it, up to about 16 characters: "customer cancels", "the send fails", "a minute passes".
- A transition with `"from": "start"` marks the state the thing begins in, and takes no label. When the change moves the beginning, mark the old one `removed` and the new one `added`.
- `tone` on a state marks an outcome: `good` for where things should end, `bad` for where they should not, `warn` for a stage that needs attention. Leave it off the stages in between.
- `change` works as for nodes and edges. A `changed` state or transition also takes `labelBefore`.
- States sit on the same grid as nodes: up to 4 columns and 3 rows, at most 8 states. Lay the main path left to right along one row, and put side paths, such as retries and failures, in the rows above and below.
- Two states can have a transition each way, and a state can have a transition to itself.
- Draw a retry the way the code does it. When the thing stays in the same status and tries again, that is a transition from the state to itself, labelled with the event and the limit: "a try fails, up to twice". When it moves to a waiting status first, that status is its own state, such as "Waiting to retry", with a transition there and one back.
- Aim for 10 transitions or fewer. Past that, merge stages that behave alike and leave out a transition every state has, such as a reset.

## Facts: values that flip

```json
{ "label": "Signup response", "before": "waits for the email", "after": "returns right away", "tone": "good", "evidence": "api/signup.ts:52" }
```

- A fact is one thing about the system with a before and an after value: a config value, a limit, a schema, who may do what, how long something takes. For something that did not exist before, `before` says so: "none", "not possible".
- At most 4, the ones a reviewer most needs. `label` runs up to about 20 characters, and each of `before` and `after` is a few words, up to about 22.
- `tone` judges the after value: `good`, `warn`, `bad`, or `neutral` (the default) for a change that is neither better nor worse.
- Write values a reader understands without the code: "returns right away", not `await` removed.
- Facts appear beneath the first diagram. A fact a diagram already shows is said twice; keep the one in the diagram. `facts` can be empty when the diagrams say it all.

## Failure: the new way to fail

A component that stops, in the component view:

```json
{
  "node": "worker",
  "effects": [
    { "node": "signup", "text": "still succeeds", "tone": "good" },
    { "node": "queue", "text": "jobs pile up unseen", "tone": "warn" },
    { "node": "provider", "text": "no emails go out", "tone": "bad" }
  ],
  "evidence": "workers/email.ts:12"
}
```

A path into a state that goes wrong, in the statechart:

```json
{
  "path": ["placed", "paid", "cancelled"],
  "effects": [{ "node": "cancelled", "text": "stuck if the refund fails", "tone": "bad" }],
  "evidence": "jobs/refund.ts:41"
}
```

- Name what fails in one of three ways: `"node": "<id>"` for a component that stops, `"edge": { "from": "<id>", "to": "<id>" }` for a call that fails, or `"path": ["<state id>", ...]` for the states a thing passes through on its way to the one that goes wrong. The video walks the path and marks its last state.
- `node` and `edge` need the component view, and `path` needs the statechart. With both diagrams, use the form that shows the failure best. With the statechart alone, a component that stops is drawn as the path its failure sends the thing down, and the caption names the cause.
- `effects` say, in up to about 22 characters each, what happens then. Their `node` is a node id for a `node` or `edge` failure, and a state id for a `path`. Each one is drawn as a note on the bottom edge of its box.
- For a component that stops, give the other components an effect each, including the ones that keep working; that is often the point of the change. The component that stops is marked already and needs no effect.
- For a path, give the last state an effect that says what goes wrong there. Other states take one only when something worth saying happens on the way.
- Leave `failure` out when the change adds no way to fail, and the video skips that beat.

## Evidence

Every node, edge, state and transition with a `change`, every fact and the failure carry `evidence`: the `path:line` that shows the claim, or a list of them when it takes more than one line to show. Paths are relative to the repository root, and lines are at the head of the change.

For something the change deleted, cite the line at the base and write it as `"base path:line"`. `check` verifies head citations against the checkout and leaves base ones alone.

Evidence on unchanged nodes, edges, states and transitions is optional.

## Beats: the words

```json
"beats": {
  "title":        { "say": "This change sends welcome emails through a queue. Here is what it does to the system." },
  "before":       { "caption": "Before: signup sends the welcome email itself, and waits for it.", "say": "..." },
  "after":        { "caption": "After: signup adds a job to a queue, and a worker sends the email.", "say": "..." },
  "statesBefore": { "caption": "Before: an email was sent once. If the send failed, the email was lost.", "say": "..." },
  "statesAfter":  { "caption": "After: an email waits in the queue, and a failed send is tried again.", "say": "..." },
  "failure":      { "caption": "New failure mode: if the worker stops, emails pile up and nobody notices.", "say": "..." },
  "close":        { "caption": "Signup no longer depends on the email provider.", "say": "..." }
}
```

- `before` and `after` belong to the component view, `statesBefore` and `statesAfter` to the statechart. Write the pair for each diagram the spec has. The video plays them in the order above.
- `caption` is the line on screen: one sentence, under 85 characters. Start the diagram captions with `Before:`, `After:` and `New failure mode:`. The close caption is the one thing a reviewer should remember.
- `say` is the narration for that beat, one or two sentences. With no voice configured it is ignored, so the captions alone must carry the story.
- Write `say` for the ear: plain words, full sentences, and spoken names in place of file names, symbols and code ("the signup API", not `signup.ts`).
- A beat lasts as long as its narration, and the voice speaks about 2.3 words a second. Aim for 25 to 45 seconds with one diagram and up to 60 with both: about 85 words of `say` in all with one diagram, about 110 with both. The build warns past 45 and 60 seconds.
