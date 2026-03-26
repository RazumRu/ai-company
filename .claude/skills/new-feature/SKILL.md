---
name: new-feature
description: "Create a new feature or task spec via structured interview. Asks clarifying questions, explores the codebase, and saves a complete spec to .generated/project-features/. Use when you want to plan a feature before implementing it with /orchestrate."
allowed-tools:
  - Read
  - Glob
  - Grep
  - Bash
  - Task
  - Write
  - Edit
  - AskUserQuestion
argument-hint: "[feature or problem description]"
---

# New Feature — Structured Interview & Spec Creation

You are creating a new feature or task specification for the Geniro platform. Your goal is to interview the user, explore the codebase, and produce a complete, actionable spec saved to `.generated/project-features/`.

## Feature Request

$ARGUMENTS

## Phase 0: Initialize

1. **Create the features directory** if it doesn't exist:
   ```bash
   mkdir -p .generated/project-features/completed
   ```

2. **Propose a kebab-case name** for this feature based on the description (e.g., `graph-template-marketplace`, `thread-auto-naming`, `runtime-health-check`). Ask the user to confirm or suggest a different name.

3. **Check for existing feature** with the same name:
   ```bash
   ls .generated/project-features/*.md 2>/dev/null
   ```
   If a feature with this name already exists, warn the user and ask if they want to update it or choose a different name.

## Phase 1: Interview

Conduct a structured interview to understand the feature fully. The interview has three rounds, adapted from the `/spec` protocol.

### CRITICAL: Use AskUserQuestion for ALL questions (with fallback)

**Try `AskUserQuestion` first.** Always attempt to use the tool so the user can select from predefined choices.

For every question you ask:
1. **Formulate 2–4 concrete answer options** based on your understanding of the feature and codebase patterns
2. **Use short, descriptive labels** for each option (1–5 words)
3. **Add a description** explaining the implications of each choice
4. **Use `multiSelect: true`** when multiple options can apply simultaneously
5. **Always include a meaningful "Other" implicitly** — the tool adds it automatically for custom input
6. **Group related questions** — you can ask up to 4 questions per `AskUserQuestion` call
7. **Use the `header` field** for a short category label (e.g., "Scope", "Priority", "Data model")

**Example — instead of asking:**
> "Should this feature support real-time updates via WebSocket, or is polling sufficient?"

**Use AskUserQuestion with options:**
- Label: "WebSocket (real-time)", Description: "Push updates instantly via existing Socket.IO infrastructure"
- Label: "Polling", Description: "Client polls API periodically, simpler but adds latency"
- Label: "Both", Description: "WebSocket primary, polling as fallback"

### FALLBACK: Empty Answer Detection

**After every `AskUserQuestion` call, check if the answers are empty.** The tool sometimes auto-completes without the user actually selecting anything. Signs of empty/auto-completed answers:
- The tool result says "User has answered your questions" but contains no actual selections
- All answer values are empty strings, null, or missing
- The answers object has no meaningful content

**If answers are empty, IMMEDIATELY fall back to plain text:**
1. Present the SAME questions as a numbered list with lettered options
2. Clearly label which option you recommend with "(Recommended)"
3. Ask the user to reply with their choices (e.g., "1A, 2B, 3C" or just describe their preference)
4. **Do NOT proceed without real answers** — wait for the user to respond

**Plain text fallback format:**
```
It looks like the question picker didn't capture your answers. Let me ask as plain text instead:

**1. [Question text]**
   a) [Option 1 label] — [description]
   b) [Option 2 label] — [description]
   c) [Option 3 label] — [description]

**2. [Question text]**
   a) [Option 1 label] — [description]
   b) [Option 2 label] — [description]

Please reply with your choices (e.g., "1a, 2b") or describe your preference.
```

### Round 1: General Understanding

Based on the feature description, ask the user clarifying questions about:

- **Goals**: What problem does this solve? Who benefits?
- **Scope**: What's in scope vs explicitly out of scope?
- **Success criteria**: How do we know this is done correctly?
- **Priority**: Must-have vs nice-to-have aspects
- **Constraints**: Performance requirements, backward compatibility, deadlines

Present **3–7 focused questions** via `AskUserQuestion`. Do not ask obvious questions the description already answers. Do not ask questions you can answer yourself by reading the codebase. Provide concrete answer choices for each question based on common patterns.

**Wait for the user to respond before proceeding to Round 2.**

### Round 2: Code-Informed Questions

After Round 1 answers, **explore the relevant parts of both codebases** using Task (delegate to an explore agent):

**API (geniro/):**
- Search for existing features similar to what's being requested
- Check relevant entities, services, and controllers
- Look at database schema implications
- Check existing notification/WebSocket patterns if relevant

**Web (geniro/apps/web/):**
- Search for existing UI patterns similar to what's being requested
- Check relevant pages, components, and hooks
- Look at `src/autogenerated/` for available API types
- Check existing state management patterns

Based on what you find in the code, ask the user questions about:

- **Integration points**: How this connects to existing features you found
- **Data model**: What entities/fields are involved (informed by actual schema)
- **UI/UX**: Specific interaction patterns, where in the app this lives
- **Migration**: How existing data/users transition to the new behavior
- **Existing patterns**: Whether to reuse or diverge from patterns you found

Present **3–5 code-informed questions** via `AskUserQuestion`. Reference specific files/patterns you found. Use your codebase findings to create informed answer choices (e.g., "Reuse GraphEntity pattern" vs "New standalone entity").

**Wait for the user to respond before proceeding to Round 3.**

### Round 3: Edge Cases & Confirmation

After Round 2 answers, present a comprehensive edge case checklist via `AskUserQuestion` with `multiSelect: true`. Group related edge cases and let the user select which ones apply:

- **Error states**: What happens when things fail (network, validation, permissions)
- **Concurrent access**: Multiple users/agents operating on the same resource
- **Permission/auth**: Who can do what, access control boundaries
- **Empty/null/boundary**: No data, maximum data, first-time experience
- **Backward compatibility**: How existing data, API clients, and users are affected
- **Real-time sync**: WebSocket event implications, race conditions

For each question, propose your recommended handling as the first option (with "(Recommended)" suffix), and offer alternatives. The user picks which approach they prefer.

**Wait for the user to respond before continuing.**

### Follow-Up Rounds (as many as needed)

After Round 3, **assess whether you have enough information to write a complete spec.** If any of the following are true, run additional follow-up rounds before producing the spec:

- A user answer was ambiguous, vague, or contradictory — ask for clarification
- The user selected "Other" and provided a custom answer that raises new questions
- Codebase exploration revealed complexities the user hasn't addressed yet
- You cannot confidently fill a required spec section (Requirements, Data Model, API Changes, UI Changes, Edge Cases)
- The user's answers in one round conflict with answers from a previous round

**For each follow-up round:**
1. Explain briefly (1 sentence) what's still unclear and why
2. Ask **1–4 targeted questions** via `AskUserQuestion` to resolve the gaps
3. Wait for the user to respond
4. Re-assess — if gaps remain, run another follow-up round

**Stop asking follow-up questions when:**
- You can confidently write every section of the spec
- The user signals they want to wrap up ("that's enough", "just write it", "move on")
- You've done 3+ follow-up rounds — at that point, make your best judgment for remaining gaps and note assumptions in the "Open Questions" section

**Note:** For small features or tasks, you may compress or skip rounds if the user provides enough information upfront. Don't over-interview for simple tasks.

## Phase 2: Create Feature Spec

After all rounds are complete and you have sufficient clarity, produce the final spec and save it to `.generated/project-features/<feature-name>.md`:

```markdown
---
name: <feature-name>
status: approved
created: <today's date>
updated: <today's date>
size: S|M|L
type: feature|bugfix|refactor|task
---

# <Feature Title>

## Problem Statement
[1-2 sentences describing the problem and who it affects]

## Requirements

### Must-Have
1. [R1: requirement with clear acceptance criterion]
2. [R2: requirement with clear acceptance criterion]
...

### Nice-to-Have
1. [requirement with acceptance criterion]
...

## Scope

### In Scope
- [specific deliverable]
...

### Out of Scope
- [explicitly excluded item with reason]
...

## Data Model Impact
- [entity changes, new fields, migrations needed]

## API Changes
- [new/modified endpoints, request/response shapes]

## UI Changes
- [new/modified pages, components, interactions]

## Edge Cases & Error Handling
1. [edge case] — [expected behavior]
2. ...

## Success Criteria
1. [measurable, testable criterion]
2. ...

## Constraints
- [technical, timeline, or compatibility constraints]

## Code Research Findings
- [key findings from codebase exploration that inform the implementation]
- [existing patterns to reuse, relevant files, integration points]

## Open Questions
- [anything still unresolved — should be empty if interview was thorough]
```

## Phase 3: Save & Confirm

1. **Write the spec** to `.generated/project-features/<feature-name>.md` using the Write tool.

2. **Show the user the saved spec** and confirm:
   ```
   ✅ Feature spec saved to: .generated/project-features/<feature-name>.md

   Status: approved
   Size: [S/M/L]

   To implement this feature, run:
     /orchestrate feature: <feature-name>

   To see all features:
     /features list
   ```

3. **If the user wants changes**, edit the file and re-confirm.

## Rules

- **Try AskUserQuestion first, fall back to plain text** — attempt the tool for every question. If answers come back empty, immediately re-present as numbered plain-text questions and wait for the user to reply
- **Be concise in questions** — 1-2 sentences per question, not paragraphs
- **Don't repeat information** — if the user already stated something, reference it, don't ask again
- **Don't over-interview** — if the feature is straightforward, compress or skip rounds
- **Be opinionated** — propose sensible defaults as the first option (with "(Recommended)") instead of asking open-ended "what should happen here?"
- **Ground questions in code** — Round 2 questions should reference actual files and patterns you found, not hypothetical concerns
- **Always save to file** — even if the spec seems simple, save it to `.generated/project-features/` so it's tracked
- **Set status to approved** by default — the interview itself serves as the approval process
