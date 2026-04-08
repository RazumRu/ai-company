---
name: improve-system-agents
description: "Improve system agent instructions or instruction block definitions using prompt engineering best practices. Rewrites the target markdown file with better structure, clarity, and effectiveness."
context: main
model: opus
allowed-tools: [Read, Write, Edit, Bash, Glob, Grep, Agent, AskUserQuestion, WebSearch]
argument-hint: "<agent-or-block-id> [improvement request]"
disable-model-invocation: false
---

# Improve System Agents

Rewrites a system agent or instruction block definition using prompt engineering best practices. Performs live research, rewrites with a subagent, and runs a self-review pass before presenting the result for approval.

## When to use

- A system agent is producing poor output or making wrong tool choices
- An instruction block is too vague, too long, or structurally weak
- You want to apply prompt engineering best practices to an existing definition
- You have a specific improvement in mind and want it applied cleanly

## When NOT to use

- To add entirely new agents or blocks (create the file manually first)
- To change frontmatter metadata (id, name, tools — edit those directly)
- For code changes unrelated to agent instructions

---

## Process

### Phase 1: Target Resolution

Parse `$ARGUMENTS`:
- First word = target id (e.g. `architect`, `js-agent`)
- Remaining words = the user's improvement request (may be empty)

Glob both directories to find candidate files:
- `apps/api/system-agents/*.md`
- `apps/api/instruction-blocks/*.md`

Read each file and match by the `id:` field in frontmatter. Record:
- `target_path` — absolute path to the matched file
- `file_type` — `system-agent` or `instruction-block` (based on directory)
- `improvement_request` — the user's words after the id (may be empty)

**If no arguments provided:**
List all available ids from both directories and ask via `AskUserQuestion`:
```
Which agent or instruction block do you want to improve?

Available system agents: architect, engineer, reviewer
Available instruction blocks: js-agent

Enter the id and optionally describe what to improve (e.g. "architect add better tool usage guidance")
```

**If no match found:**
Show the available ids and ask the user to try again via `AskUserQuestion`.

Read the full content of the matched file and store it as `original_content`.

---

### Phase 2: Live Research

Use WebSearch to find domain-specific best practices for the agent's role. Construct the search query from the agent's name and role, for example:

- `architect` agent → search `"software architecture agent system prompt best practices"`
- `engineer` agent → search `"software engineering AI agent instructions prompt engineering"`
- `js-agent` block → search `"JavaScript TypeScript AI coding agent instructions best practices"`

Extract 3–5 concrete, actionable insights from the search results. These supplement the embedded best practices below and make the rewrite domain-aware.

---

### Phase 3: Rewrite

Spawn a rewrite subagent (model=sonnet):

```
Agent(prompt="""
You are a prompt engineer specializing in system prompt design for LLM-powered agents.

Your task: rewrite the BODY of the following agent definition file to make it clearer, more structured, and more effective. Preserve the frontmatter exactly as-is.

=== ORIGINAL FILE ===
{original_content}

=== FILE TYPE ===
{file_type}
(system-agent = full system prompt for a LangGraph agent running in a sandboxed environment
 instruction-block = supplementary domain instructions appended to an agent's system prompt)

=== USER'S IMPROVEMENT REQUEST ===
{improvement_request or "(none — apply general best practices)"}

=== LIVE RESEARCH INSIGHTS ===
{live_research_results}

=== EMBEDDED BEST PRACTICES ===

**Structure Principles**
- Use a clear section hierarchy: Identity/Role → Goal/Objective → Context → Tool Usage Rules → Behavioral Constraints → Output Format → Examples
- Use markdown headings (##) to create navigable structure — flat prose walls are an anti-pattern
- Front-load the most critical instructions — models pay more attention to content near the start
- Group related rules under descriptive headings — scattered rules get lost

**Role & Identity**
- Define a specific, actionable role — not just "be helpful" but "You are a senior code reviewer specializing in..."
- Include a goal statement that explains WHAT the agent should accomplish
- Add contextual backstory/motivation that shapes HOW the agent approaches tasks
- The role should actively influence tool selection and task approach

**Tool Usage Instructions**
- Each tool mentioned should have 3-4+ sentences: what it does, when to use it, when NOT to use it, caveats
- Add disambiguation between similar tools ("use X instead of Y when...")
- Include sequencing guidance when tool order matters
- Short or vague tool descriptions lead to wrong tool selection

**Constraints & Rules**
- Prefer affirmative rules ("Always do X") over prohibitive ("Never do Y") — but use both
- Prioritize constraints: state which wins when rules conflict
- Add brief justification for each constraint ("why" improves adherence)
- Make constraints testable — if you can't verify compliance, the rule is too vague
- Group constraints by topic, not randomly scattered

**The Goldilocks Principle**
- Too specific/brittle: enumerating every edge case overstuffs context and breaks on unlisted scenarios
- Too vague: "be helpful and accurate" gives no actionable signal
- Sweet spot: strong heuristics + diverse canonical examples, not exhaustive rule lists

**Anti-Patterns to Eliminate**
- Vague role definitions ("be helpful", "assist the user")
- Flat prose walls without structure
- Contradictory rules without priority
- Hardcoded repo-specific details that should be injected at runtime
- Missing tool usage guidance when tools are listed in frontmatter
- No examples or demonstrations of correct behavior
- Laundry-list edge cases instead of general heuristics

**For System Agents Specifically**
- Instructions become the system prompt for a LangGraph agent
- The agent runs inside a sandboxed environment with specific tools connected
- Instructions must be GENERIC — not repo-specific — since they run against various user repos
- Tool descriptions from the tools list are appended separately at runtime; the system prompt focuses on role, approach, and constraints
- Reference "the repository's instruction file" or "the agentInstructions field from gh_clone" rather than specific filenames (CLAUDE.md) or commands (pnpm run full-check)

**For Instruction Blocks Specifically**
- These are supplementary instruction sets appended to an agent's system prompt
- Keep them focused on a specific domain/technology
- They must be complementary (not contradictory) to the base agent instructions
- Make them actionable and concrete — not vague best practices

=== YOUR OUTPUT ===
Return the COMPLETE rewritten file — frontmatter (unchanged) followed by the rewritten body.
Do NOT include commentary or explanation. Return ONLY the file content.
""")
```

Store the result as `rewritten_content`.

---

### Phase 4: Self-Review

Spawn a reviewer subagent (model=sonnet) to evaluate the rewrite:

```
Agent(prompt="""
You are a prompt engineering reviewer. Evaluate the rewritten agent definition below against the original and the checklist.

=== ORIGINAL ===
{original_content}

=== REWRITTEN ===
{rewritten_content}

=== CHECKLIST ===
1. Clear role/identity definition (not vague, not just "be helpful")
2. Structured with markdown headings (not a flat prose wall)
3. Goal/objective stated explicitly
4. Tool usage guidance present (if the frontmatter lists tools)
5. Constraints are prioritized and include brief justifications
6. No anti-patterns: vague roles, contradictions, hardcoded repo-specific content
7. Appropriate altitude — strong heuristics, not exhaustive edge cases or empty platitudes
8. User's specific request addressed: {improvement_request or "(none)"}
9. For system agents: no repo-specific commands, filenames, or paths
10. Overall quality strictly better than the original

=== YOUR OUTPUT ===
Verdict: PASS or REVISE

If PASS: write only "PASS" followed by a 1-2 sentence summary of key improvements made.
If REVISE: write "REVISE" followed by a numbered list of specific issues that must be fixed. Be concrete — point to exact problems, not general advice.
""")
```

Parse the reviewer verdict:
- **PASS** — proceed to Phase 5
- **REVISE** — spawn the rewrite subagent again, appending the reviewer's issues to the prompt under a `=== REVIEWER FEEDBACK ===` section. Then proceed to Phase 5 with the revised output. (Max 1 revision loop — do not loop indefinitely.)

---

### Phase 5: Diff Presentation

Show the user the full rewritten file content so they can read and evaluate it:

```
=== REWRITTEN FILE CONTENT ===

{rewritten_content}
```

Then ask via `AskUserQuestion`:

```
The rewrite is ready. What would you like to do?

A) Apply — save the rewritten file to {target_path}
B) Adjust — describe what to change and I'll revise
C) Reject — discard changes
```

**If "Adjust"**: ask the user what to change, then loop back to Phase 3 with the additional feedback appended as `=== USER ADJUSTMENT REQUEST ===`. Skip Phase 4 on adjustment loops.

**If "Reject"**: confirm discarded and end.

---

### Phase 6: Apply

Write the rewritten content to `target_path` using the Write tool.

Confirm to the user:

```
Done. Updated: {target_path}

The file has been rewritten in place. No git operations were performed.
```

---

## Example invocations

```
/improve-system-agents architect
/improve-system-agents engineer add clearer tool sequencing guidance
/improve-system-agents js-agent the constraints section is too vague
/improve-system-agents reviewer make the role definition more specific
```
