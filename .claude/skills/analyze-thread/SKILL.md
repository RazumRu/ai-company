---
name: analyze-thread
description: "Analyze a Geniro thread conversation to find issues: redundant tool calls, errors, gaps, optimization problems, and awkward agent responses. Fetches messages directly from Postgres. Use when debugging agent behavior or optimizing thread performance."
context: fork
agent: thread-analyzer-agent
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
  - WebSearch
  - WebFetch
argument-hint: "[thread-id] [optional notes about what went wrong]"
---

# Analyze Thread

Analyze the following Geniro thread for quality issues, inefficiencies, and improvement opportunities.

## Input

$ARGUMENTS

## Instructions

1. **Parse the input.** The first argument is the thread ID (UUID). Everything after it is optional user notes providing context about what to look for.

2. **If no thread ID was provided**, list the 10 most recent threads so the user can pick one:
   ```sql
   SELECT id, name, status, "createdAt",
     (SELECT COUNT(*) FROM messages m WHERE m."threadId" = t.id AND m."deletedAt" IS NULL) as message_count
   FROM threads t
   WHERE t."deletedAt" IS NULL
   ORDER BY t."createdAt" DESC
   LIMIT 10;
   ```
   Then STOP and ask the user which thread to analyze.

3. **If a thread ID was provided**, proceed with the full analysis workflow as defined in your agent prompt. Use the user notes (if any) to focus your investigation.

4. **Deliver the structured analysis report** with issues, token analysis, and actionable recommendations.

5. **If issues found involve prompt or graph design problems**, generate a ready-to-import test graph JSON with improved instructions. The user can save the JSON as a `.json` file and import it via the **Import** button on the Geniro graphs list page.

## Database Connection

```
Host: localhost
Port: 5439
User: postgres
Password: postgres
Database: geniro
```

Command: `PGPASSWORD=postgres psql -h localhost -p 5439 -U postgres -d geniro -c "<SQL>"`

For queries returning large results, use:
`PGPASSWORD=postgres psql -h localhost -p 5439 -U postgres -d geniro -t -A -F '|' -c "<SQL>"`

(`-t` = tuples only, `-A` = unaligned, `-F '|'` = pipe delimiter for readability)
