---
name: dist-task
description: "Execute an infrastructure task in the Geniro distribution repository (geniro-dist/). Use for Helm chart changes, Kubernetes deployment configuration, dependency version updates, adding new components, security hardening, or reviewing infrastructure best practices."
context: fork
agent: dist-agent
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - WebSearch
  - WebFetch
argument-hint: "[task description]"
---

# Distribution Task

Execute the following task in the **geniro-dist/** repository:

$ARGUMENTS

## Before Starting

1. Read `geniro-dist/helm/geniro/Chart.yaml` for chart metadata and dependency versions.
2. Read `geniro-dist/helm/geniro/values.yaml` for current default configuration.
3. Read `geniro-dist/helm/geniro/README.md` for existing documentation.
4. Search the web for current best practices and latest versions when the task involves dependencies or infrastructure patterns.

## After Completing

### Step 1: Validate the chart
```bash
cd geniro-dist && helm lint ./helm/geniro -f ./helm/geniro/ci/test-values.yaml
```
Fix any issues and re-run until it passes.

### Step 2: Test template rendering
```bash
cd geniro-dist && helm template geniro ./helm/geniro -f ./helm/geniro/ci/test-values.yaml > /dev/null
cd geniro-dist && helm template geniro ./helm/geniro -f ./helm/geniro/examples/quickstart-values.yaml > /dev/null
```
Fix any rendering errors.

### Step 3: Archive completed feature (if from backlog)

If `$ARGUMENTS` references a feature from `.claude/.generated/project-features/` (e.g., starts with `feature:` followed by a name), archive it after successful completion:

1. Find the feature file: `.claude/.generated/project-features/<name>.md`
2. Update YAML frontmatter: set `status: completed` and `updated: <today's date>` using the Edit tool
3. Move to completed:
   ```bash
   mkdir -p .claude/.generated/project-features/completed
   mv .claude/.generated/project-features/<name>.md .claude/.generated/project-features/completed/<name>.md
   ```

Skip this step if the task is not from the feature backlog (ad-hoc description).

### Report back with:
- Files created/modified
- Key decisions made
- Helm lint result (pass/fail)
- Template render result (pass/fail)
- Version changes (if any)
- Security considerations (if applicable)
- Any issues or follow-ups
