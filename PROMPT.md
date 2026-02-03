# PeriCode - Ralph Loop Build Prompt

You are building **PeriCode**, an Electron desktop app that wraps Claude Code into a
multi-agent command center. The full specification is in `PLAN.md` at the project root.

---

## Your Process Each Iteration

### Step 1: Assess Current State

Read these files to understand where you are:

1. `PROGRESS.md` - Your progress tracker (create it if missing)
2. `package.json` - What dependencies are installed
3. `PLAN.md` - The full specification (reference, don't modify)

Run these commands to check project health:

```
git log --oneline -10          # What was done recently
npm run build 2>&1 | tail -30  # Does it build?
npm test 2>&1 | tail -30       # Do tests pass?
```

### Step 2: Determine Next Task

Work through PLAN.md phases IN ORDER. Within each phase, follow the numbered
sub-steps sequentially. The phases are:

```
Phase 1: Foundation (Scaffold + Single Agent)
  1.1 Project Scaffolding
  1.2 Electron Shell
  1.3 Storage Layer
  1.4 Single Agent Integration
  1.5 Basic Chat UI
  1.6 Project Management

Phase 2: Multi-Agent & Worktrees
  2.1 Git Worktree Manager
  2.2 Agent Pool & Orchestration
  2.3 Multi-Thread UI
  2.4 Diff Review Workflow

Phase 3: Skills System
  3.1 Skill Definition Format
  3.2 Skills Engine
  3.3 Built-in Skills
  3.4 Skills UI
  3.5 Skill Invocation in Agent Threads

Phase 4: Automations & Scheduling
  4.1 Automation Scheduler
  4.2 Automation Execution
  4.3 Result Inbox (Triage Queue)
  4.4 Automation Editor UI
  4.5 Built-in Automation Templates

Phase 5: Command Center & Polish
  5.1 Command Palette
  5.2 Status Bar
  5.3 Settings & Preferences
  5.4 Keyboard Shortcuts
  5.5 Notification System
  5.6 Embedded Terminal
  5.7 Export & Reporting
```

Pick the FIRST incomplete sub-step. Do NOT skip ahead.

### Step 3: Implement

For the current sub-step:

1. Read PLAN.md section for that sub-step to get the full specification
2. Create or modify the files specified in the plan
3. Follow the project structure defined in PLAN.md Section 2
4. Use the exact tech stack specified (Electron Forge, Vite, React 19, TypeScript,
   Tailwind CSS 4, shadcn/ui, Zustand, better-sqlite3, simple-git, etc.)
5. Follow the IPC contracts defined in PLAN.md Section 7
6. Follow the database schema defined in PLAN.md Section 1.3
7. Write TypeScript with strict mode. No `any` types. Proper error handling.
8. Write unit tests for backend services using Vitest

### Step 4: Verify

After implementing:

1. Run `npm run build` - fix any compilation errors
2. Run `npm test` - fix any test failures
3. Run `npx tsc --noEmit` - fix any type errors
4. If the app should be launchable at this point, run `npm start` briefly to verify
   the window opens without crashing

Do NOT move on if the build is broken or tests are failing. Fix them first.

### Step 5: Update Progress

Update `PROGRESS.md` with:

```markdown
## Current Status
- **Phase**: [current phase number and name]
- **Sub-step**: [current sub-step number]
- **Status**: [completed / in-progress / blocked]
- **Last iteration**: [iteration number from system message]

## Completed
- [x] 1.1 Project Scaffolding
- [x] 1.2 Electron Shell
- [ ] 1.3 Storage Layer  <-- next
...

## Notes
[Any important context for the next iteration - blockers, decisions made,
 things to remember]
```

### Step 6: Commit

Commit your work with a descriptive message:

```
git add -A
git commit -m "phase X.Y: [description of what was implemented]"
```

---

## Rules

1. **One sub-step per iteration.** Do not try to implement multiple sub-steps.
   Each sub-step is a full iteration's worth of work. If a sub-step is very large,
   implement the core functionality and mark it as in-progress for the next iteration
   to finish.

2. **Never break the build.** Every commit must compile and pass tests. If you
   introduced a regression, fix it before committing.

3. **Read before writing.** Always read existing files before modifying them.
   Your previous iterations may have already done work. Do not overwrite or
   duplicate what already exists.

4. **Follow the plan exactly.** Use the file paths, interface names, component names,
   and architecture from PLAN.md. Do not rename things or reorganize the structure.

5. **Real implementations only.** No placeholder functions that return `TODO`.
   No stub components that render "Coming soon". Each file you create must have
   a working implementation, even if minimal.

6. **Test what you build.** Write Vitest unit tests for every service file in
   `electron/services/`. Write at least basic render tests for React components.

7. **Initialize properly.** For Phase 1.1 specifically:
   - Use `npx create-electron-app pericode-temp --template=vite-typescript` as reference,
     but set up the project directly in the current directory
   - Install all dependencies from the tech stack in PLAN.md
   - Configure Tailwind CSS 4, path aliases, and strict TypeScript
   - Initialize git with `git init && git add -A && git commit -m "initial scaffold"`

8. **Windows compatibility.** This project runs on Windows. Use path.join() for
   file paths. Use cross-platform scripts. No bash-only syntax in npm scripts.

---

## Completion

When ALL phases (1 through 5) are fully implemented, all tests pass, the app builds
and launches successfully, and PROGRESS.md shows every sub-step checked off:

<promise>PERICODE BUILD COMPLETE</promise>

Do NOT output this promise unless:
- Every sub-step in every phase is implemented (not stubbed)
- `npm run build` succeeds with zero errors
- `npm test` passes with zero failures
- The app window opens and renders the UI
- PROGRESS.md confirms all items checked

If you are unsure whether everything is done, do NOT output the promise.
Continue working. The next iteration will give you another chance.
