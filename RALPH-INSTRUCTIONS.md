# Running the PeriCode Ralph Loop

## Prerequisites

1. **Claude Code** installed and authenticated (`claude` command works)
2. **Ralph Loop plugin** installed (`/ralph-loop` command available)
3. **Node.js 20+** and **npm** installed
4. **Git** installed
5. Working directory: `C:\Git\PeriCode`

---

## How to Launch

Open a terminal in `C:\Git\PeriCode` and start Claude Code:

```bash
cd C:\Git\PeriCode
claude
```

Then run:

```
/ralph-loop "$(cat PROMPT.md)" --completion-promise "PERICODE BUILD COMPLETE" --max-iterations 80
```

Alternatively, if you want a shorter invocation that reads the prompt from the file
within the loop:

```
/ralph-loop "Read PROMPT.md and follow its instructions exactly. The full project specification is in PLAN.md." --completion-promise "PERICODE BUILD COMPLETE" --max-iterations 80
```

---

## Configuration Choices

### Iteration Limit

| Scope           | Suggested `--max-iterations` | Rationale                           |
|-----------------|------------------------------|-------------------------------------|
| Phase 1 only    | 20                           | 6 sub-steps, ~3 iterations each     |
| Phases 1-2      | 35                           | 10 sub-steps total                  |
| Phases 1-3      | 50                           | 15 sub-steps total                  |
| Full build      | 80                           | 22 sub-steps + fixes + polish       |
| Conservative    | 120                          | Extra room for retries and fixes    |

The prompt is designed so each sub-step takes 1-3 iterations. Budget 3-4 iterations
per sub-step for a safe estimate.

### Running in Phases

Instead of one 80-iteration loop for everything, you can run phase by phase for
more control. Edit the prompt to scope it:

**Phase 1 only:**
```
/ralph-loop "Read PROMPT.md. ONLY implement Phase 1 (sub-steps 1.1 through 1.6). Stop after Phase 1 is complete. The specification is in PLAN.md." --completion-promise "PHASE 1 COMPLETE" --max-iterations 25
```

**Phase 2 only (after Phase 1 is done):**
```
/ralph-loop "Read PROMPT.md. Phase 1 is already complete. ONLY implement Phase 2 (sub-steps 2.1 through 2.4). The specification is in PLAN.md." --completion-promise "PHASE 2 COMPLETE" --max-iterations 20
```

And so on for each phase. This gives you a chance to review and course-correct
between phases.

---

## Exit States

The loop will stop under these conditions:

| Condition                    | What Happens                                               |
|------------------------------|------------------------------------------------------------|
| **Promise fulfilled**        | Claude outputs `<promise>PERICODE BUILD COMPLETE</promise>` because all phases are done, tests pass, app builds and launches. This is the success state. |
| **Max iterations reached**   | Loop hits the configured limit. Check `PROGRESS.md` to see how far it got. Restart with a fresh loop to continue from where it left off. |
| **Manual cancel**            | You run `/cancel-ralph` to stop the loop. All work committed so far is preserved in git. |
| **Cost concerns**            | Monitor cost in the Claude Code output. Cancel if spending exceeds your comfort level. Restart later to continue. |

### What to do when max iterations is reached

1. Check `PROGRESS.md` to see what's done and what's next
2. Review the git log: `git log --oneline -20`
3. Verify the build: `npm run build && npm test`
4. Start a new loop to continue:
   ```
   /ralph-loop "Read PROMPT.md and follow its instructions. Continue from where PROGRESS.md left off." --completion-promise "PERICODE BUILD COMPLETE" --max-iterations 40
   ```

### What to do when the loop gets stuck

Signs of being stuck:
- Same error repeating across iterations
- PROGRESS.md not advancing
- Agent going in circles

Remedies:
1. `/cancel-ralph` to stop the loop
2. Read the error in the latest output
3. Fix the issue manually or give Claude a targeted prompt:
   ```
   Fix the TypeScript error in electron/services/storage.ts: [paste error]
   ```
4. Commit your fix
5. Restart the loop

---

## Monitoring Progress

While the loop is running, you can monitor from another terminal:

```bash
# Check what phase we're on
cat PROGRESS.md

# Check recent git history
git log --oneline -10

# Check current iteration (from the loop state file)
head -10 .claude/ralph-loop.local.md

# Check if it builds
npm run build

# Check if tests pass
npm test

# Watch file changes in real-time
git diff --stat
```

---

## Estimated Cost

Rough estimate based on typical Ralph Loop behavior:

| Phase   | Iterations | Est. Cost (Sonnet) | Est. Cost (Opus) |
|---------|------------|--------------------| -----------------|
| Phase 1 | 10-20      | $2-5               | $10-25           |
| Phase 2 | 8-15       | $2-4               | $8-20            |
| Phase 3 | 8-15       | $2-4               | $8-20            |
| Phase 4 | 8-15       | $2-4               | $8-20            |
| Phase 5 | 10-20      | $2-5               | $10-25           |
| **Total** | **45-85** | **$10-22**         | **$44-110**      |

These are rough estimates. Actual cost depends on iteration complexity, retries,
and error recovery.

---

## Files Reference

| File                        | Purpose                                              |
|-----------------------------|------------------------------------------------------|
| `PROMPT.md`                 | The Ralph Loop prompt (fed to Claude each iteration) |
| `PLAN.md`                   | Full project specification and architecture          |
| `RALPH-LOOP-REQUIREMENTS.md` | Ralph Loop feature requirements (for PeriCode's own Ralph Loop feature) |
| `PROGRESS.md`               | Auto-maintained by the loop - tracks what's done     |
| `.claude/ralph-loop.local.md` | Ralph Loop state file (auto-managed, do not edit)  |

---

## Tips

1. **Start with Phase 1 separately.** The scaffold phase is the most error-prone
   because it involves `npm init`, dependency installation, and config files. Running
   Phase 1 in its own loop gives you a stable foundation before the remaining phases.

2. **Review after Phase 1.** Once Phase 1 completes, open the app (`npm start`),
   verify it works, and review the code structure before continuing.

3. **Use Sonnet for the loop.** Opus produces higher quality code but costs 5x more.
   For iterative work where mistakes are corrected in the next iteration, Sonnet's
   cost-efficiency is better. Switch to Opus for complex phases (3 and 4) if needed.

4. **Git is your safety net.** Every iteration commits. If something goes wrong,
   `git log` and `git revert` or `git reset` can undo damage.

5. **The prompt never changes.** The power of Ralph is that the same prompt + file
   state = incremental progress. Claude reads PROGRESS.md and existing files to know
   what to do next. You don't need to modify the prompt between runs.
