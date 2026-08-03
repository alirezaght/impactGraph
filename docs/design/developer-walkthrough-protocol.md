# Developer Walkthrough Protocol (PRD §44 Phase 0)

**Status: instrument ready, session not yet run.** This file is the script and the recording
template. It deliberately contains **no results** — the two backlog items it serves
(`epic-17-quality.md`: "Workflow validated with at least a couple of developers" and "Run and
document developer walkthrough feedback") stay open until real developers have used the tool on
their own repositories and their answers are written into the Results section below.

Filling that section with anything other than what a participant actually said would make the
record worthless, and would violate the same principle the product enforces on itself: generated
prose is never the system of record.

## Why this session exists

Every quality gate we have measures whether the tool does what we _intended_. None measures
whether what we intended is useful. Specifically, three claims are untested by any suite:

1. **That the impact model is believable.** §41 measures recall against hand-written ground
   truth we also wrote. A developer looking at their own code is the only source that can say
   "this is wrong" about a component we thought was right.
2. **That clarification questions are worth answering.** §C3 forbids asking unless interpretations
   materially diverge. Whether the surviving questions feel _material_ — rather than pedantic — is
   a judgement only a domain owner can make.
3. **That the review verdicts are actionable.** §24.1 categories are precise. Whether "Divergent"
   tells a developer what to actually do is not something a test can assert.

## Participants

Two to four developers. Each must bring a repository they **already know well** — the entire point
is that they can catch a wrong answer. A repository the facilitator picked defeats the exercise.

Useful spread, if available: one TypeScript monorepo, one polyglot service (Python or Java plus
Terraform), one repository with a genuinely messy history.

## Setup (facilitator, before the session)

- Install the packaged `.vsix` — not a dev build. Packaging bugs are part of what is being tested.
- Confirm privacy mode is `selected-snippets` (the default) and no API key is configured, so the
  first pass exercises the deterministic path only.
- Have `impactgraph index --format json` ready as a fallback if the extension misbehaves; a broken
  UI should not end the session.

## Script

Timebox 60 minutes. Record what happens, not what should happen.

### 1. Cold open (5 min) — do not explain the tool first

Ask the participant to open their repository with the extension installed and describe **what they
think it does** from the UI alone. Their first guess is a usability finding.

### 2. Initialize and index (10 min)

Run `ImpactGraph: Initialize Workspace`, then `Reindex Workspace`.

Record: wall-clock time; whether the detection summary named their stack correctly; anything it
missed; whether any warning was comprehensible.

### 3. Architecture view (10 min)

Ask them to find a component they own and check what ImpactGraph believes about it.

Record: **every wrong fact**, verbatim. Wrong context assignment, missing dependency, a symbol
attributed to the wrong file. These are the highest-value output of the whole session.

### 4. Analyze a real specification (15 min)

They paste a real spec — a ticket, a design note, anything genuine. Run `Analyze Specification`.

Record, per predicted impact: **correct / wrong / surprising-but-right**. That third category is
the product thesis (§46); if it is empty across all participants, the thesis is in trouble and we
need to know.

Then: were the open questions worth answering? Ask them to answer one and say whether the answer
changed anything they cared about.

### 5. Review an implementation (15 min)

If they have a branch with real work: approve the analysis, then `Review Working Tree`.

Record: was each Missing / Unexpected / Divergent finding fair? Did any finding tell them
something they did not already know? Would they act on it?

### 6. Close (5 min)

Two questions, verbatim answers:

- "Would you run this again next sprint, unprompted?"
- "What is the one thing that would make you stop using it?"

## Recording template

Copy per participant. **Quote, do not summarize.**

```
Participant:            <role, familiarity with the repo>
Repository:             <languages, rough size, monorepo?>
Date / facilitator:

Cold-open guess:        "<verbatim>"
Index time:             <s>   Detection correct? <yes/no — what was wrong>

WRONG FACTS (verbatim, with the component):
  1.
  2.

Impacts:      correct <n>   wrong <n>   surprising-but-right <n>
  Surprising-but-right examples:
  Wrong examples (and why the participant says so):

Questions:    asked <n>   felt material <n>
  Any question they called pedantic:

Review findings:  fair <n>   unfair <n>   taught them something <n>

"Run again next sprint?"     "<verbatim>"
"What would make you stop?"  "<verbatim>"

Facilitator observations (things they did, not said):
```

## Results

_Empty until a session has been run. When it has: one filled template per participant, then a
short synthesis naming the changes the feedback justifies — and the backlog items close referring
to this section._
