# Ralph Loop - PeriCode Integration Requirements

## Comprehensive Specification for the Ralph Loop Subsystem

---

## 1. Overview

### 1.1 What is Ralph Loop?

Ralph Loop implements the Ralph Wiggum iterative development technique: a `while true`
loop that repeatedly feeds the **same prompt** to a Claude agent. The agent sees its own
previous work in the filesystem and git history, creating a self-referential feedback loop
that drives iterative improvement until a task is complete.

### 1.2 Core Mechanic

```
┌──────────────────────────────────────────────────────────┐
│                      Ralph Loop Cycle                    │
│                                                          │
│   ┌──────────┐     ┌──────────────┐     ┌────────────┐  │
│   │ Same     │────>│ Agent works  │────>│ Agent tries │  │
│   │ Prompt   │     │ on task      │     │ to exit     │  │
│   └──────────┘     │ (reads files,│     └─────┬──────┘  │
│       ^            │  edits code, │            │         │
│       │            │  runs tests) │      Exit blocked?   │
│       │            └──────────────┘       ┌────┴────┐    │
│       │                                   │         │    │
│       └────────────── YES ────────────────┘   NO ───┼──> │  EXIT
│                                                     │    │
│                                             (promise │    │
│                                              matched │    │
│                                              or max  │    │
│                                              iters)  │    │
└──────────────────────────────────────────────────────────┘
```

### 1.3 Key Principle

The prompt **never changes** between iterations. Self-reference comes from the agent
reading its own prior modifications to files, test output, git diffs, and other artifacts
on disk -- not from feeding output back as input.

---

## 2. Functional Requirements

### 2.1 Loop Lifecycle

#### FR-2.1.1: Loop Initialization

The system MUST support launching a Ralph Loop with the following parameters:

| Parameter            | Type     | Required | Default     | Description                                               |
|----------------------|----------|----------|-------------|-----------------------------------------------------------|
| `prompt`             | string   | YES      | -           | The task prompt fed to the agent every iteration          |
| `maxIterations`      | integer  | NO       | 0 (infinite)| Maximum iterations before forced termination              |
| `completionPromise`  | string   | NO       | null        | Exact text the agent must output inside `<promise>` tags  |
| `projectId`          | string   | YES      | -           | The PeriCode project this loop runs against               |
| `model`              | string   | NO       | user default| Claude model to use (sonnet, opus, haiku)                 |
| `skillIds`           | string[] | NO       | []          | Skills to attach to the agent for each iteration          |
| `sandboxPolicy`      | enum     | NO       | "workspace" | "read-only", "workspace-write", "full"                   |
| `budgetLimitUsd`     | float    | NO       | null        | Maximum total spend across all iterations                 |
| `allowedTools`       | string[] | NO       | all         | Tools the agent is permitted to use                       |
| `useWorktree`        | boolean  | NO       | true        | Whether to create an isolated git worktree                |
| `autoCommit`         | boolean  | NO       | false       | Whether to auto-commit after each iteration               |
| `autoCommitMessage`  | string   | NO       | "ralph: iteration {n}" | Commit message template (`{n}` = iteration)  |

**Validation rules:**
- `prompt` must be non-empty (after trimming whitespace)
- `maxIterations` must be >= 0 (0 = unlimited)
- `completionPromise` if provided must be non-empty after trimming
- At least one of `maxIterations > 0` or `completionPromise` SHOULD be set
  (warn user if neither is set -- loop will be infinite)
- `budgetLimitUsd` if provided must be > 0

#### FR-2.1.2: Iteration Execution

Each iteration MUST follow this sequence:

1. **Pre-iteration check**: Evaluate all exit conditions BEFORE sending prompt
2. **Prompt injection**: Send the original prompt to the Claude agent with a system
   message indicating the current iteration number
3. **Agent execution**: Agent runs with full tool access per configuration
4. **Output capture**: Capture complete agent response (text blocks, tool calls, results)
5. **Promise detection**: If `completionPromise` is set, scan agent's final text output
   for `<promise>EXACT_TEXT</promise>` tag
6. **Iteration tracking**: Increment iteration counter, record cost/tokens
7. **Post-iteration check**: Evaluate all exit conditions
8. **Loop or exit**: If no exit condition met, return to step 1

#### FR-2.1.3: State Persistence

The system MUST persist loop state that survives:
- App restarts (the loop resumes where it left off)
- Agent crashes (the loop retries the current iteration)
- Network interruptions (the loop pauses and resumes on reconnection)

**State file schema** (stored in SQLite `ralph_loops` table):

```sql
CREATE TABLE ralph_loops (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  prompt TEXT NOT NULL,
  status TEXT CHECK(status IN (
    'initializing', 'running', 'paused', 'completed',
    'failed', 'cancelled', 'budget_exhausted', 'max_iterations_reached'
  )) DEFAULT 'initializing',
  current_iteration INTEGER DEFAULT 0,
  max_iterations INTEGER DEFAULT 0,
  completion_promise TEXT,
  exit_reason TEXT,                -- Human-readable reason for exit
  exit_state TEXT,                 -- Machine-readable exit code
  model TEXT,
  skill_ids JSON DEFAULT '[]',
  sandbox_policy TEXT DEFAULT 'workspace-write',
  budget_limit_usd REAL,
  budget_spent_usd REAL DEFAULT 0.0,
  allowed_tools JSON,
  use_worktree INTEGER DEFAULT 1,
  worktree_path TEXT,
  worktree_branch TEXT,
  auto_commit INTEGER DEFAULT 0,
  auto_commit_message TEXT DEFAULT 'ralph: iteration {n}',
  config JSON DEFAULT '{}',        -- Additional config blob
  started_at DATETIME,
  paused_at DATETIME,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ralph_iterations (
  id TEXT PRIMARY KEY,
  loop_id TEXT NOT NULL REFERENCES ralph_loops(id),
  iteration_number INTEGER NOT NULL,
  status TEXT CHECK(status IN ('running', 'completed', 'failed', 'skipped')),
  session_id TEXT,                 -- Claude session ID for this iteration
  prompt_sent TEXT NOT NULL,       -- The exact prompt sent (should be identical each time)
  agent_output TEXT,               -- Full text output from agent
  tool_calls JSON,                 -- Array of tool calls made
  promise_detected INTEGER DEFAULT 0,
  promise_text TEXT,               -- What was inside <promise> tags, if anything
  cost_usd REAL DEFAULT 0.0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  files_modified JSON DEFAULT '[]', -- List of files changed this iteration
  error_message TEXT,
  duration_ms INTEGER,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME
);
```

---

### 2.2 Exit States

The Ralph Loop MUST terminate under exactly these conditions, checked in priority order:

| Priority | Exit State                | Code                      | Trigger                                                                                  | Behavior                                                   |
|----------|---------------------------|---------------------------|------------------------------------------------------------------------------------------|------------------------------------------------------------|
| 1        | **User Cancelled**        | `cancelled`               | User clicks cancel button or runs `/cancel-ralph`                                        | Immediately halt agent, save state, clean up               |
| 2        | **State Corruption**      | `state_corrupted`         | Loop state file is missing, unreadable, or has invalid field values                      | Log error, halt loop, notify user, preserve last good state|
| 3        | **Budget Exhausted**      | `budget_exhausted`        | Cumulative `budget_spent_usd >= budget_limit_usd`                                        | Complete current iteration, then stop. Do NOT start new.   |
| 4        | **Agent Crash (Fatal)**   | `agent_crash`             | Agent process dies with unrecoverable error 3 times consecutively                        | Stop loop, surface error to user with crash details        |
| 5        | **Completion Promise Met**| `promise_fulfilled`       | Agent output contains `<promise>TEXT</promise>` where TEXT exactly matches `completionPromise` | Mark loop as completed successfully, notify user          |
| 6        | **Max Iterations Reached**| `max_iterations_reached`  | `current_iteration >= max_iterations` (when `max_iterations > 0`)                        | Mark loop as completed, notify user                       |
| 7        | **Network Unavailable**   | `network_error`           | API unreachable for > 5 minutes                                                          | Pause loop (not terminate), resume when network returns   |
| 8        | **App Shutdown**          | `app_shutdown`            | User quits PeriCode while loop is running                                                | Persist state as `paused`, resume on next app launch      |
| 9        | **No Progress Detected**  | `stalled`                 | Agent produces identical output for N consecutive iterations (configurable, default: 5)  | Pause loop, notify user, suggest prompt adjustment        |

#### Exit State Details

**`cancelled`**
- User-initiated via UI button, command palette, or keyboard shortcut (Escape, then confirm)
- The in-flight agent request is aborted mid-stream if possible
- Partial iteration data is saved with status `skipped`
- Worktree is preserved (not cleaned up) so user can inspect work
- UI shows: "Ralph loop cancelled at iteration N. Worktree preserved at [path]."

**`state_corrupted`**
- Checked at the START of each iteration
- Validation: all required fields present, types correct, iteration counter monotonically increasing
- On corruption: attempt to reconstruct state from `ralph_iterations` table
- If reconstruction fails: halt with clear error message
- Never silently continue with corrupted state

**`budget_exhausted`**
- Checked BEFORE starting each new iteration (not mid-iteration)
- Cost tracking includes: API token costs from `ResultMessage.cost_usd`
- When 80% of budget is consumed: show warning notification
- When 95%: show urgent warning
- When 100%: stop after current iteration completes
- UI shows: "Budget limit of $X.XX reached after N iterations. Total spent: $Y.YY"

**`agent_crash`**
- Transient crashes (network blip, rate limit): retry with exponential backoff (1s, 2s, 4s, max 30s)
- After 3 consecutive failures on the SAME iteration: escalate to fatal
- Non-consecutive crashes reset the counter
- Save crash details (error message, stack trace, iteration number) for debugging
- UI shows: "Agent crashed 3 times on iteration N. Error: [message]. Loop stopped."

**`promise_fulfilled`**
- Promise matching is **exact string comparison** (case-sensitive, whitespace-trimmed)
- Promise must appear inside `<promise>...</promise>` XML-style tags
- Only the LAST assistant message in the iteration is scanned
- If multiple `<promise>` tags exist, use the FIRST one
- Partial matches do NOT count (e.g., promise "DONE" does not match "NOT DONE")
- UI shows: "Ralph loop completed! Promise 'TEXT' fulfilled at iteration N."
- Confetti animation or success indicator in thread view

**`max_iterations_reached`**
- Simple counter comparison, checked BEFORE starting new iteration
- `current_iteration` is 1-indexed (first iteration = 1)
- Loop stops when `current_iteration >= max_iterations`
- UI shows: "Ralph loop reached maximum of N iterations."

**`network_error`**
- On first API failure: retry immediately
- On persistent failure: retry with backoff up to 30 seconds
- After 5 minutes of continuous failure: transition to `paused` state
- Monitor network connectivity in background
- Auto-resume when connectivity returns (with user notification)
- UI shows: "Ralph loop paused (network unavailable). Will resume automatically."

**`app_shutdown`**
- On `before-quit` Electron event: serialize all running loop states to `paused`
- On next app launch: detect paused loops and prompt user:
  "Ralph loop '[prompt preview]' was paused at iteration N. Resume?"
- User can choose: Resume / Cancel / Resume Later

**`stalled`**
- Compare agent text output (ignoring tool calls) across consecutive iterations
- Use normalized comparison (trimmed, whitespace-collapsed)
- Configurable threshold: default 5 identical outputs in a row
- On stall detection: pause loop, notify user
- UI shows: "Ralph loop appears stalled (same output for 5 iterations).
  Consider adjusting your prompt. [Resume] [Cancel] [Edit Prompt & Restart]"

---

### 2.3 Loop Control Operations

#### FR-2.3.1: Pause / Resume

| Operation | Description                                                           |
|-----------|-----------------------------------------------------------------------|
| **Pause** | Stop after current iteration completes. State saved. Worktree intact. |
| **Resume**| Continue from `current_iteration + 1` with same prompt and config.    |

Resume MUST:
- Re-validate that worktree still exists (recreate if deleted)
- Re-validate project path still exists
- Check if any exit conditions are already met before starting
- Use the same Claude session if possible (via `resume` option), or start fresh if session expired

#### FR-2.3.2: Edit Prompt & Restart

Allow user to modify the prompt and restart from iteration 1:
- Creates a NEW loop record (preserving history of the old one)
- Old loop marked as `cancelled` with `exit_reason: "prompt_edited"`
- New loop inherits all config from old loop except the prompt
- Worktree is reused (not recreated) so previous work persists

#### FR-2.3.3: Fork Iteration

Allow user to fork a loop at a specific iteration:
- Creates a new loop starting from the file state at iteration N
- New worktree created as a copy of the original worktree at that point
- Original loop continues unaffected
- Useful for exploring alternative approaches from a known-good state

#### FR-2.3.4: Adjust Max Iterations

Allow user to increase/decrease `maxIterations` while loop is running:
- Takes effect at the next iteration boundary
- Can set to 0 (unlimited) or any positive integer
- If new limit is <= current iteration, loop stops at next check

#### FR-2.3.5: Adjust Budget

Allow user to increase `budgetLimitUsd` while loop is running:
- Only increase (never decrease below current spend)
- Takes effect immediately

---

### 2.4 Prompt Requirements

#### FR-2.4.1: Prompt Template System

Support variable interpolation in prompts:

| Variable              | Expands To                                           |
|-----------------------|------------------------------------------------------|
| `{iteration}`         | Current iteration number                             |
| `{max_iterations}`    | Configured max iterations (or "unlimited")           |
| `{elapsed_time}`      | Time since loop started (e.g., "2h 15m")             |
| `{budget_remaining}`  | Remaining budget in USD (or "unlimited")             |
| `{budget_spent}`      | Budget consumed so far in USD                        |
| `{files_changed}`     | Comma-separated list of files modified last iteration|
| `{git_diff_summary}`  | Short summary of uncommitted changes                 |
| `{last_error}`        | Error message from last iteration (if any)           |
| `{project_name}`      | Name of the PeriCode project                         |
| `{branch}`            | Current git branch name                              |

Variables are optional. The prompt works identically whether variables are used or not.

#### FR-2.4.2: Prompt Presets

Ship built-in prompt templates for common use cases:

**1. Test-Driven Development**
```markdown
## Task
{user_task_description}

## Process
1. Read existing code and tests
2. If no tests exist, write failing tests first
3. Implement or fix code to make tests pass
4. Run the test suite: `{test_command}`
5. If tests fail, analyze failures and iterate
6. If all tests pass, verify edge cases
7. When ALL tests pass with good coverage:
   <promise>ALL TESTS PASSING</promise>

## Rules
- Do NOT output the promise unless ALL tests genuinely pass
- Do NOT delete or weaken tests to make them pass
- Commit after each meaningful change
```

**2. Bug Fix**
```markdown
## Bug Description
{bug_description}

## Reproduction Steps
{repro_steps}

## Process
1. Reproduce the bug by running: `{repro_command}`
2. Analyze root cause
3. Implement fix
4. Verify fix resolves the bug
5. Run full test suite to check for regressions
6. When bug is fixed AND no regressions:
   <promise>BUG FIXED</promise>

## Rules
- Do NOT output the promise unless the bug is genuinely fixed
- Do NOT introduce regressions
```

**3. Feature Build (Greenfield)**
```markdown
## Feature
{feature_description}

## Requirements
{requirements_list}

## Process
1. Plan the implementation (files, modules, interfaces)
2. Implement incrementally, one module at a time
3. Write tests for each module
4. Run tests after each module
5. Integrate modules
6. Run full test suite
7. When ALL requirements met AND tests pass:
   <promise>FEATURE COMPLETE</promise>

## Quality Checks
- All requirements implemented
- Tests cover happy path and error cases
- No hardcoded values or TODOs remaining
- Code follows project conventions
```

**4. Refactoring**
```markdown
## Refactoring Goal
{refactoring_goal}

## Scope
{files_or_modules_in_scope}

## Process
1. Read and understand existing code
2. Run existing tests to establish baseline: `{test_command}`
3. Make incremental refactoring changes
4. Run tests after each change to prevent regressions
5. When refactoring is complete AND all tests still pass:
   <promise>REFACTORING COMPLETE</promise>

## Constraints
- Do NOT change external behavior (same inputs -> same outputs)
- Do NOT break existing tests
- Preserve all existing functionality
```

#### FR-2.4.3: Prompt Validation

Before starting a loop, validate the prompt and warn about:

| Check                    | Severity | Message                                                          |
|--------------------------|----------|------------------------------------------------------------------|
| No completion promise    | WARNING  | "No completion promise set. Loop will only stop at max iterations or manually." |
| No max iterations        | WARNING  | "No iteration limit set. Loop will run indefinitely unless a promise is fulfilled." |
| Neither promise nor max  | DANGER   | "Neither completion promise nor iteration limit set. Loop will run FOREVER until manually cancelled." |
| Promise but no `<promise>` in prompt | INFO | "Tip: Include the `<promise>` syntax in your prompt so the agent knows how to signal completion." |
| Very short prompt (<20 chars) | INFO | "Prompt seems very short. More detailed prompts produce better results with Ralph." |
| Prompt contains `exit` or `stop` keywords | INFO | "Prompt contains exit/stop language. Note: the agent cannot exit the loop voluntarily." |

---

### 2.5 Monitoring & Observability

#### FR-2.5.1: Real-Time Dashboard

The Ralph Loop thread view MUST display:

| Element                  | Description                                            | Update Frequency |
|--------------------------|--------------------------------------------------------|------------------|
| **Iteration Counter**    | "Iteration 7 / 20" or "Iteration 7 / unlimited"       | Per iteration    |
| **Status Indicator**     | Color-coded: green=running, yellow=paused, red=failed  | Real-time        |
| **Elapsed Time**         | Wall clock since loop started                          | Every second     |
| **Cost Tracker**         | "$0.47 / $5.00 budget" or "$0.47 (no limit)"          | Per iteration    |
| **Token Usage**          | Total tokens in/out across all iterations              | Per iteration    |
| **Progress Ring**        | Visual % based on iteration/maxIterations              | Per iteration    |
| **Last Tool Calls**      | Collapsible list of tool calls from current iteration  | Real-time stream |
| **Files Modified**       | Cumulative list of all files changed across iterations | Per iteration    |
| **Streaming Output**     | Live-streaming agent text output                       | Real-time stream |
| **Iteration History**    | Collapsible timeline of past iterations with summaries | Per iteration    |

#### FR-2.5.2: Iteration Timeline

Each iteration in the timeline shows:
- Iteration number
- Duration
- Cost
- Number of tool calls
- Files modified
- Whether a promise was attempted
- Error (if any)
- Expandable full conversation log

#### FR-2.5.3: Notifications

| Event                     | Notification Type    | Content                                                     |
|---------------------------|---------------------|--------------------------------------------------------------|
| Loop completed (promise)  | System tray + toast | "Ralph completed! Promise fulfilled at iteration N."         |
| Loop completed (max iter) | System tray + toast | "Ralph reached max iterations (N)."                          |
| Loop stalled              | System tray + toast | "Ralph appears stalled after N identical iterations."        |
| Budget warning (80%)      | Toast only          | "Ralph loop budget 80% consumed ($X.XX of $Y.YY)."          |
| Budget exhausted          | System tray + toast | "Ralph loop stopped: budget exhausted ($X.XX)."             |
| Agent crash               | System tray + toast | "Ralph agent crashed on iteration N. [View Details]"         |
| Loop paused (network)     | Toast only          | "Ralph paused (network unavailable)."                        |
| Loop resumed (network)    | Toast only          | "Ralph resumed (network restored). Continuing iteration N."  |

---

### 2.6 Git Integration

#### FR-2.6.1: Worktree Management

- Each Ralph Loop SHOULD run in an isolated git worktree (configurable)
- Worktree branch name: `pericode/ralph/<loop-id-short>/<sanitized-prompt-prefix>`
- Worktree directory: `<project-path>/.pericode-worktrees/ralph-<loop-id-short>/`
- On loop completion: worktree remains until user explicitly accepts/rejects changes
- On loop cancellation: worktree remains (user may want to inspect partial work)

#### FR-2.6.2: Auto-Commit

When `autoCommit` is enabled:
- Commit all changes at the end of each iteration
- Commit message: user-configurable template with `{n}` interpolation
- Default: `"ralph: iteration {n}"`
- Commits go to the worktree branch (never to main/master)
- This creates a clean git history showing what changed each iteration

#### FR-2.6.3: Diff Review on Completion

When a Ralph Loop completes:
- Show aggregated diff (all changes from iteration 1 to N vs. original branch)
- Also allow viewing per-iteration diffs
- Accept/reject workflow same as standard PeriCode diff review (see Phase 2 of PLAN.md)
- "Accept" merges worktree branch into the original branch
- "Reject" deletes worktree branch

---

### 2.7 Integration with PeriCode Features

#### FR-2.7.1: Skills Integration

- Skills can be attached at loop creation time
- Skill instructions are prepended to the prompt for EVERY iteration
- Skill tools are added to the agent's allowed tools
- Skill constraints (budget, model) are applied per-iteration

#### FR-2.7.2: Automation Integration

Ralph Loops can be triggered as Automations:

```typescript
interface RalphAutomation {
  type: 'ralph-loop';
  prompt: string;
  maxIterations: number;           // REQUIRED for automations (no infinite loops)
  completionPromise?: string;
  skillIds?: string[];
  budgetLimitUsd: number;          // REQUIRED for automations
  sandboxPolicy: 'read-only' | 'workspace-write';  // No 'full' for automations
}
```

Additional constraints for automated Ralph Loops:
- `maxIterations` is REQUIRED (no infinite automated loops)
- `budgetLimitUsd` is REQUIRED
- `sandboxPolicy` cannot be 'full' (safety)
- Results go to the Automation Inbox like any other automation
- Max runtime of 4 hours (configurable in settings)

#### FR-2.7.3: Multi-Ralph

Users can run multiple Ralph Loops simultaneously:
- Each runs in its own thread, worktree, and agent instance
- Subject to the global concurrent agent limit
- Each loop has independent state, budget, and iteration tracking
- Dashboard shows all active Ralph Loops across projects

---

## 3. Non-Functional Requirements

### 3.1 Performance

| Metric                              | Target                                  |
|-------------------------------------|-----------------------------------------|
| Iteration transition time           | < 2 seconds (time between agent exit and next prompt sent) |
| State persistence write             | < 100ms                                 |
| UI update latency (streaming)       | < 200ms from agent output to screen     |
| Memory per active loop              | < 100MB (excluding agent SDK overhead)  |
| Concurrent loops supported          | At least 5 simultaneous                 |

### 3.2 Reliability

| Requirement                         | Specification                           |
|-------------------------------------|-----------------------------------------|
| State durability                    | Survive app crash, power loss, OS restart|
| Data integrity                      | SQLite WAL mode, atomic writes          |
| Crash recovery                      | Auto-detect interrupted loops on startup |
| Idempotent resume                   | Resuming a paused loop multiple times has no side effects |

### 3.3 Security

| Requirement                         | Specification                           |
|-------------------------------------|-----------------------------------------|
| Worktree isolation                  | Agent cannot read/write outside worktree|
| Budget enforcement                  | Cannot be bypassed by the agent         |
| Prompt injection resistance         | Agent cannot modify its own loop state  |
| Sandbox enforcement                 | `can_use_tool` callback enforces sandbox policy |

### 3.4 Usability

| Requirement                         | Specification                           |
|-------------------------------------|-----------------------------------------|
| Loop creation                       | < 3 clicks from project view            |
| Status at a glance                  | Loop state visible in sidebar badge     |
| Cancel accessibility                | Cancel button always visible + keyboard shortcut |
| Prompt editing                      | Full-featured editor with syntax highlighting |

---

## 4. The Prompt (Agent System Message)

This is the system message injected into the Claude agent at the START of each
Ralph Loop iteration. It wraps the user's prompt with loop-awareness context.

### 4.1 System Prompt Template

```markdown
# Ralph Loop - Iteration {iteration} of {max_iterations_display}

You are operating inside a Ralph Loop - an iterative development cycle where you
receive the same task prompt repeatedly. Your previous work persists in the files
and git history. Each iteration is an opportunity to make progress, fix issues,
and move closer to completion.

## Loop Context

- **Current iteration**: {iteration}
- **Max iterations**: {max_iterations_display}
- **Elapsed time**: {elapsed_time}
- **Budget remaining**: {budget_remaining_display}
- **Files you modified in previous iterations**: {files_changed_cumulative}

## Your Behavior in This Loop

1. **Read before writing**: At the start of each iteration, examine the current
   state of files. Your previous iterations may have already made progress.
   Do NOT redo work that is already done correctly.

2. **Build incrementally**: Each iteration should make meaningful forward progress.
   Do not start over from scratch unless the existing approach is fundamentally flawed.

3. **Verify your work**: After making changes, run tests, linters, or other
   verification commands to confirm your changes are correct.

4. **Be honest about completion**: Do NOT claim the task is done if it isn't.
   The loop will continue giving you chances to fix issues.

{completion_promise_section}

## Important Rules

- You CANNOT exit this loop voluntarily. The loop controls when you stop.
- Do NOT try to delete or modify `.claude/ralph-loop.local.md` or any loop state files.
- Do NOT output a false completion promise. The loop is designed to continue
  until genuine completion. Trust the process.
- Focus on the task. Do not discuss the loop mechanism itself unless relevant
  to the task.

---

## Task

{user_prompt}
```

### 4.2 Completion Promise Section (conditionally included)

When `completionPromise` is set, this section is appended:

```markdown
## Completion Signal

When the task is **genuinely and completely done**, output this EXACT text:

<promise>{completion_promise}</promise>

**STRICT REQUIREMENTS:**
- The promise MUST be completely and unequivocally TRUE when you output it
- Do NOT output the promise to escape the loop if the task is not actually done
- Do NOT output the promise if tests are failing, code is broken, or requirements are unmet
- If you are unsure whether the task is complete, do NOT output the promise.
  Continue working instead - the next iteration will give you another chance.
- Even if you feel stuck or believe the task is impossible, do NOT lie.
  Instead, document what you've tried and what's blocking you.
```

### 4.3 Iteration System Message (sent alongside the prompt)

A brief system message is injected as a separate system message for each iteration:

```
Ralph Loop | Iteration {iteration}{max_display} | Cost: ${budget_spent} | {status_hint}
```

Where `status_hint` is one of:
- `"Starting fresh"` (iteration 1)
- `"Continuing from previous work"` (iteration 2+)
- `"Budget warning: {percent}% consumed"` (when > 80%)
- `"Final iteration (max reached)"` (last iteration before max)

---

## 5. UI Wireframes (Text-Based)

### 5.1 New Ralph Loop Dialog

```
┌─────────────────────────────────────────────────────────┐
│  New Ralph Loop                                    [X]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Prompt                                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Build a REST API for user management.             │  │
│  │                                                   │  │
│  │ Requirements:                                     │  │
│  │ - CRUD endpoints for users                        │  │
│  │ - JWT authentication                              │  │
│  │ - Input validation                                │  │
│  │ - Tests with >80% coverage                        │  │
│  │                                                   │  │
│  │ When all requirements met and tests pass:         │  │
│  │ <promise>FEATURE COMPLETE</promise>               │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  [Use Template v]  [Attach Skill v]                     │
│                                                         │
│  ─── Completion ─────────────────────────────────────── │
│                                                         │
│  Completion Promise    [ FEATURE COMPLETE          ]    │
│  Max Iterations        [ 30                        ]    │
│                                                         │
│  ─── Advanced ───────────────────────────────────────── │
│                                                         │
│  Model                 [ sonnet             v ]         │
│  Budget Limit          [ $5.00              ]           │
│  Sandbox               [ workspace-write    v ]         │
│  [x] Use git worktree                                   │
│  [ ] Auto-commit each iteration                         │
│                                                         │
│  ⚠ Warning: Without a completion promise, the loop     │
│    will only stop at 30 iterations.                     │
│                                                         │
│                        [ Cancel ]  [ Start Ralph ]      │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Ralph Loop Thread View

```
┌──────────────────────────────────────────────────────────────────┐
│  [<] Back    Ralph: Build a REST API...          [||] [X] [...]  │
├──────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  ITERATION 7 / 30   ████████░░░░░░  23%    $1.24 / $5.00  │  │
│  │  Running for 12m 34s    Tokens: 45.2k in / 18.7k out      │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌─ Iteration 1 ──────────────────── 0:45 ── $0.12 ──────────┐  │
│  │  Created project structure, added Express boilerplate.     │  │
│  │  Files: package.json, src/index.ts, src/routes/users.ts    │  │
│  │  [Expand]                                                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌─ Iteration 2 ──────────────────── 1:12 ── $0.18 ──────────┐  │
│  │  Implemented CRUD endpoints. Added user model.             │  │
│  │  Files: src/models/user.ts, src/routes/users.ts            │  │
│  │  [Expand]                                                  │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ...                                                             │
│  ┌─ Iteration 7 (current) ──────────────────── RUNNING ───────┐  │
│  │                                                            │  │
│  │  ▼ Tool: Bash                                              │  │
│  │    $ npm test                                              │  │
│  │    > 12 passing, 3 failing                                 │  │
│  │                                                            │  │
│  │  Analyzing test failures...                                │  │
│  │  The DELETE endpoint is returning 200 instead of 204.      │  │
│  │  Fixing src/routes/users.ts line 47█                       │  │
│  │                                                            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ Files Changed (cumulative):                                │  │
│  │  M package.json          M src/index.ts                    │  │
│  │  A src/models/user.ts    M src/routes/users.ts             │  │
│  │  A src/middleware/auth.ts A tests/users.test.ts             │  │
│  │  [View Diff]                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│            [ Pause ]  [ Adjust Iterations ]  [ Cancel Loop ]     │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Ralph Loop Completion View

```
┌──────────────────────────────────────────────────────────────────┐
│  [<] Back    Ralph: Build a REST API...          COMPLETED       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Ralph Loop Completed Successfully             │  │
│  │                                                            │  │
│  │  Promise fulfilled: "FEATURE COMPLETE"                     │  │
│  │  Iterations: 12 / 30                                       │  │
│  │  Duration: 28m 15s                                         │  │
│  │  Total cost: $2.87                                         │  │
│  │  Files changed: 8 files (+342 / -12 lines)                 │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ─── Changes ────────────────────────────────────────────────── │
│                                                                  │
│  [File Tree]                     [Unified Diff / Split Diff]     │
│  ├── package.json        +3 -1   ┌──────────────────────────┐  │
│  ├── src/                        │ @@ -45,3 +45,5 @@        │  │
│  │   ├── index.ts        +12 -2  │  router.delete('/:id',   │  │
│  │   ├── models/                 │-   res.status(200)        │  │
│  │   │   └── user.ts     +45 -0  │+   res.status(204)        │  │
│  │   ├── routes/                 │    .json({ deleted: true  │  │
│  │   │   └── users.ts    +89 -3  │                           │  │
│  │   └── middleware/             │                           │  │
│  │       └── auth.ts     +67 -0  │                           │  │
│  └── tests/                      │                           │  │
│      └── users.test.ts   +126 -6 │                           │  │
│                                  └──────────────────────────┘  │
│                                                                  │
│       [ Accept All ]  [ Accept Selected ]  [ Reject ]  [ Edit ] │
└──────────────────────────────────────────────────────────────────┘
```

---

## 6. IPC Channels

```typescript
// Ralph Loop IPC Channels
interface RalphIPCChannels {
  // Lifecycle
  'ralph:create': (config: RalphLoopConfig) => RalphLoopInfo;
  'ralph:start': (loopId: string) => void;
  'ralph:pause': (loopId: string) => void;
  'ralph:resume': (loopId: string) => void;
  'ralph:cancel': (loopId: string) => void;
  'ralph:delete': (loopId: string) => void;

  // Configuration (mid-flight)
  'ralph:adjustMaxIterations': (loopId: string, maxIterations: number) => void;
  'ralph:adjustBudget': (loopId: string, newBudgetUsd: number) => void;
  'ralph:editPromptAndRestart': (loopId: string, newPrompt: string) => RalphLoopInfo;
  'ralph:forkAtIteration': (loopId: string, iterationNumber: number) => RalphLoopInfo;

  // Queries
  'ralph:get': (loopId: string) => RalphLoopDetail;
  'ralph:list': (projectId?: string) => RalphLoopInfo[];
  'ralph:getActive': () => RalphLoopInfo[];
  'ralph:getIterations': (loopId: string) => RalphIteration[];
  'ralph:getIteration': (loopId: string, iterationNumber: number) => RalphIterationDetail;

  // Templates
  'ralph:getTemplates': () => RalphPromptTemplate[];
}

// Ralph Loop IPC Events (main -> renderer, streaming)
interface RalphIPCEvents {
  'ralph:iterationStart': (loopId: string, iteration: number) => void;
  'ralph:iterationMessage': (loopId: string, iteration: number, message: StreamMessage) => void;
  'ralph:iterationComplete': (loopId: string, iteration: RalphIteration) => void;
  'ralph:statusChange': (loopId: string, status: RalphStatus, reason?: string) => void;
  'ralph:costUpdate': (loopId: string, costUsd: number, budgetRemainingUsd: number | null) => void;
  'ralph:promiseAttempt': (loopId: string, iteration: number, promiseText: string, matched: boolean) => void;
  'ralph:warning': (loopId: string, type: string, message: string) => void;
  'ralph:completed': (loopId: string, exitState: RalphExitState) => void;
}
```

---

## 7. TypeScript Types

```typescript
// Core types for the Ralph Loop subsystem

type RalphStatus =
  | 'initializing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'budget_exhausted'
  | 'max_iterations_reached'
  | 'stalled';

type RalphExitState =
  | 'promise_fulfilled'
  | 'max_iterations_reached'
  | 'cancelled'
  | 'budget_exhausted'
  | 'agent_crash'
  | 'state_corrupted'
  | 'network_error'
  | 'app_shutdown'
  | 'stalled'
  | 'prompt_edited';  // When user edits prompt and restarts

type RalphSandboxPolicy = 'read-only' | 'workspace-write' | 'full';

interface RalphLoopConfig {
  prompt: string;
  projectId: string;
  maxIterations?: number;          // 0 = unlimited
  completionPromise?: string;
  model?: string;
  skillIds?: string[];
  sandboxPolicy?: RalphSandboxPolicy;
  budgetLimitUsd?: number;
  allowedTools?: string[];
  useWorktree?: boolean;
  autoCommit?: boolean;
  autoCommitMessage?: string;
  stallThreshold?: number;         // Default: 5
}

interface RalphLoopInfo {
  id: string;
  projectId: string;
  threadId: string;
  promptPreview: string;           // First 100 chars of prompt
  status: RalphStatus;
  currentIteration: number;
  maxIterations: number;
  completionPromise: string | null;
  budgetSpentUsd: number;
  budgetLimitUsd: number | null;
  elapsedMs: number;
  createdAt: string;
}

interface RalphLoopDetail extends RalphLoopInfo {
  prompt: string;                  // Full prompt text
  model: string;
  skillIds: string[];
  sandboxPolicy: RalphSandboxPolicy;
  allowedTools: string[] | null;
  useWorktree: boolean;
  worktreePath: string | null;
  worktreeBranch: string | null;
  autoCommit: boolean;
  autoCommitMessage: string;
  exitState: RalphExitState | null;
  exitReason: string | null;
  stallThreshold: number;
  totalTokensIn: number;
  totalTokensOut: number;
  filesModifiedCumulative: string[];
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
}

interface RalphIteration {
  id: string;
  loopId: string;
  iterationNumber: number;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  filesModified: string[];
  promiseDetected: boolean;
  promiseText: string | null;
  durationMs: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface RalphIterationDetail extends RalphIteration {
  sessionId: string | null;
  promptSent: string;
  agentOutput: string;
  toolCalls: ToolCallRecord[];
}

interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
}

interface RalphPromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'tdd' | 'bugfix' | 'feature' | 'refactor' | 'custom';
  template: string;                // Prompt with {placeholders}
  suggestedMaxIterations: number;
  suggestedCompletionPromise: string;
  variables: TemplateVariable[];
}

interface TemplateVariable {
  name: string;                    // e.g., "user_task_description"
  label: string;                   // e.g., "Task Description"
  description: string;
  required: boolean;
  multiline: boolean;
  defaultValue?: string;
}
```

---

## 8. Service Interface

```typescript
// electron/services/ralph-loop-service.ts

interface RalphLoopService {
  // Lifecycle
  create(config: RalphLoopConfig): Promise<RalphLoopInfo>;
  start(loopId: string): Promise<void>;
  pause(loopId: string): Promise<void>;
  resume(loopId: string): Promise<void>;
  cancel(loopId: string): Promise<void>;
  delete(loopId: string): Promise<void>;

  // Mid-flight adjustments
  adjustMaxIterations(loopId: string, maxIterations: number): Promise<void>;
  adjustBudget(loopId: string, newBudgetUsd: number): Promise<void>;
  editPromptAndRestart(loopId: string, newPrompt: string): Promise<RalphLoopInfo>;
  forkAtIteration(loopId: string, iterationNumber: number): Promise<RalphLoopInfo>;

  // Queries
  get(loopId: string): Promise<RalphLoopDetail>;
  list(projectId?: string): Promise<RalphLoopInfo[]>;
  getActive(): Promise<RalphLoopInfo[]>;
  getIterations(loopId: string): Promise<RalphIteration[]>;
  getIteration(loopId: string, iterationNumber: number): Promise<RalphIterationDetail>;

  // Recovery
  recoverInterruptedLoops(): Promise<RalphLoopInfo[]>;

  // Events
  on(event: 'iterationStart', handler: (loopId: string, iteration: number) => void): void;
  on(event: 'iterationComplete', handler: (loopId: string, iteration: RalphIteration) => void): void;
  on(event: 'statusChange', handler: (loopId: string, status: RalphStatus, reason?: string) => void): void;
  on(event: 'completed', handler: (loopId: string, exitState: RalphExitState) => void): void;
  on(event: 'warning', handler: (loopId: string, type: string, message: string) => void): void;
}
```

---

## 9. Testing Requirements

### 9.1 Unit Tests

| Test Area                  | Cases                                                              |
|----------------------------|--------------------------------------------------------------------|
| **Prompt validation**      | Empty prompt, short prompt, missing promise, missing max iterations |
| **Promise detection**      | Exact match, partial match, no match, multiple tags, malformed tags |
| **Iteration counting**     | Increment, max reached, zero (unlimited), boundary conditions      |
| **Budget tracking**        | Accumulation, threshold warnings, exhaustion, increase mid-flight  |
| **State persistence**      | Write/read cycle, corruption recovery, concurrent access           |
| **Exit state transitions** | All 9 exit states, priority ordering, concurrent triggers          |
| **Stall detection**        | Identical output detection, threshold configuration, reset on diff |
| **Template interpolation** | All variables, missing variables, nested variables, edge cases     |

### 9.2 Integration Tests

| Test Scenario                                      | Verification                                        |
|----------------------------------------------------|-----------------------------------------------------|
| Full loop: start -> 3 iterations -> promise -> exit| Correct state transitions, cost tracking, cleanup   |
| Full loop: start -> max iterations -> exit         | Stops at exactly max, correct exit state             |
| Pause mid-iteration -> resume                      | Resumes at correct iteration, state intact           |
| Cancel mid-iteration                               | Agent killed, partial state saved, worktree preserved|
| Budget exhaustion mid-loop                         | Stops cleanly, correct cost reported                 |
| App crash recovery                                 | Paused loops detected and resumable on restart       |
| Multiple concurrent loops                          | Independent state, no cross-contamination            |
| Edit prompt and restart                            | Old loop cancelled, new loop created, worktree reused|
| Fork at iteration                                  | New worktree, new loop, correct starting state       |

### 9.3 E2E Tests (Playwright)

| Test                                    | Steps                                                    |
|-----------------------------------------|----------------------------------------------------------|
| Create and run Ralph Loop               | Open dialog, fill form, start, verify UI updates         |
| Pause and resume from UI                | Click pause, verify paused state, click resume, verify   |
| Cancel from UI                          | Click cancel, confirm dialog, verify stopped             |
| View iteration timeline                 | Expand iterations, verify content, collapse              |
| Accept changes on completion            | Complete loop, review diff, accept, verify merge         |
| Command palette interaction             | Cmd+K, search "ralph", create/cancel from palette        |

---

## 10. Acceptance Criteria Summary

The Ralph Loop feature is complete when:

1. A user can create a Ralph Loop with a prompt and optional configuration
2. The loop iterates automatically, feeding the same prompt each time
3. The agent sees its previous work in files and produces incremental progress
4. The loop exits correctly for ALL 9 defined exit states
5. Loop state persists across app restarts
6. The UI shows real-time iteration progress, cost, and streaming output
7. Users can pause, resume, cancel, edit prompt, and fork loops
8. Diff review workflow works for completed loops
9. Git worktree isolation prevents conflicts with the main branch
10. Budget limits are enforced and cannot be bypassed
11. Multiple concurrent Ralph Loops operate independently
12. Automated Ralph Loops work through the Automation system
13. All prompt templates produce functional loops
14. Notifications fire for all specified events
15. Recovery from crashes, network errors, and corrupted state works correctly
