# PeriCode - Comprehensive Implementation Plan

## A Desktop Command Center Wrapping Claude Code with Codex-like Features

---

## 1. Vision & Architecture Overview

PeriCode is an Electron-based desktop application that wraps Claude Code (via the
`@anthropic-ai/claude-agent-sdk` TypeScript SDK) into a multi-agent command center.
It provides parallel agent workflows, git worktree isolation, reusable Skills,
scheduled Automations, and a unified project management UI.

### High-Level Architecture

```
+------------------------------------------------------------------+
|                     PeriCode Desktop App (Electron)               |
|                                                                   |
|  +--------------------+    +----------------------------------+   |
|  |   Renderer Process  |    |       Main Process               |   |
|  |   (React + Vite)    |    |                                  |   |
|  |                     |    |  +----------------------------+  |   |
|  |  - Command Center   |    |  | Agent Orchestrator         |  |   |
|  |  - Thread Manager   |<-->|  |  - Agent Pool              |  |   |
|  |  - Diff Viewer      |    |  |  - Worktree Manager        |  |   |
|  |  - Skill Editor     |    |  |  - Session Registry        |  |   |
|  |  - Automation Panel |    |  +----------------------------+  |   |
|  |  - Settings         |    |  +----------------------------+  |   |
|  |                     |    |  | Skills Engine              |  |   |
|  +--------------------+    |  |  - Loader / Registry        |  |   |
|                             |  |  - Implicit Matcher         |  |   |
|                             |  +----------------------------+  |   |
|                             |  +----------------------------+  |   |
|                             |  | Automation Scheduler       |  |   |
|                             |  |  - Cron / Event Triggers   |  |   |
|                             |  |  - Result Inbox            |  |   |
|                             |  +----------------------------+  |   |
|                             |  +----------------------------+  |   |
|                             |  | Storage Layer              |  |   |
|                             |  |  - SQLite (better-sqlite3)  |  |   |
|                             |  |  - Project configs          |  |   |
|                             |  +----------------------------+  |   |
|                             +----------------------------------+   |
+------------------------------------------------------------------+
         |                              |
         v                              v
  +---------------+         +------------------------+
  | Claude Agent  |         |  Git Worktrees         |
  | SDK (TS)      |         |  (isolated branches)   |
  | - query()     |         |                        |
  | - Client      |         |  worktree-1/ (agent-A) |
  | - Streaming   |         |  worktree-2/ (agent-B) |
  +---------------+         |  worktree-3/ (agent-C) |
                             +------------------------+
```

### Tech Stack

| Layer              | Technology                                       |
|--------------------|--------------------------------------------------|
| Desktop Shell      | Electron 34+ (with Electron Forge)               |
| Frontend           | React 19 + TypeScript 5.7                        |
| Build (Renderer)   | Vite 6                                           |
| State Management   | Zustand                                          |
| UI Components      | Tailwind CSS 4 + shadcn/ui + Radix               |
| Diff Rendering     | react-diff-viewer-continued or Monaco diff editor |
| Terminal Emulation  | xterm.js (for inline terminal views)              |
| Markdown Rendering | react-markdown + remark-gfm                      |
| Backend (Main)     | Electron Main Process (Node.js)                  |
| Claude Integration | @anthropic-ai/claude-agent-sdk                   |
| Database           | better-sqlite3 (via electron-rebuild)             |
| Git Operations     | simple-git (Node.js git wrapper)                 |
| Scheduling         | node-cron                                        |
| IPC                | Electron IPC (contextBridge + preload)            |
| Testing            | Vitest + Playwright (E2E)                        |
| Packaging          | Electron Forge (squirrel for Windows)            |

---

## 2. Project Structure

```
PeriCode/
  .github/                     # CI/CD workflows
  assets/                      # App icons, splash screens
  electron/                    # Electron main process
    main.ts                    # Entry point
    preload.ts                 # Preload script (contextBridge)
    ipc/                       # IPC handler modules
      agents.ipc.ts            # Agent management IPC
      worktrees.ipc.ts         # Git worktree IPC
      skills.ipc.ts            # Skills management IPC
      automations.ipc.ts       # Automation scheduler IPC
      projects.ipc.ts          # Project management IPC
      settings.ipc.ts          # Settings IPC
    services/                  # Core backend services
      agent-orchestrator.ts    # Multi-agent pool & lifecycle
      worktree-manager.ts      # Git worktree create/destroy/sync
      session-registry.ts      # Session tracking & persistence
      skills-engine.ts         # Skill loading, matching, invocation
      automation-scheduler.ts  # Cron/event-based task runner
      storage.ts               # SQLite database layer
      git-service.ts           # Git operations wrapper
      project-manager.ts       # Project detection & config
    utils/
      logger.ts
      paths.ts                 # Platform-specific path resolution
  src/                         # Renderer process (React app)
    main.tsx                   # React entry
    App.tsx                    # Root component with routing
    components/
      layout/
        Sidebar.tsx            # Project list + navigation
        CommandBar.tsx         # Quick command palette (Cmd+K)
        StatusBar.tsx          # Active agents, resource usage
      agents/
        ThreadList.tsx         # List of agent threads per project
        ThreadView.tsx         # Single agent conversation view
        AgentCard.tsx          # Agent status card (running/done/error)
        NewAgentDialog.tsx     # Launch new agent dialog
        AgentToolActivity.tsx  # Real-time tool call visualization
      diff/
        DiffViewer.tsx         # Side-by-side or unified diff view
        DiffActions.tsx        # Accept/reject/edit controls
        FileTree.tsx           # Changed files tree
      skills/
        SkillBrowser.tsx       # Browse & search skills
        SkillEditor.tsx        # Create/edit skill definitions
        SkillInstaller.tsx     # Install from catalog/marketplace
      automations/
        AutomationList.tsx     # All configured automations
        AutomationEditor.tsx   # Create/edit automation rules
        AutomationInbox.tsx    # Results triage queue
        CronPicker.tsx         # Visual cron schedule builder
      terminal/
        EmbeddedTerminal.tsx   # xterm.js terminal component
      settings/
        SettingsPanel.tsx      # App-wide settings
        ProjectSettings.tsx    # Per-project configuration
      common/
        StreamingText.tsx      # Animated streaming text output
        LoadingSpinner.tsx
        ConfirmDialog.tsx
        Toast.tsx
    hooks/
      useAgent.ts              # Agent lifecycle hook
      useProject.ts            # Active project context
      useSkills.ts             # Skills loading hook
      useAutomations.ts        # Automation management hook
      useIPC.ts                # Generic IPC communication hook
      useStreaming.ts           # Streaming message hook
    stores/
      agentStore.ts            # Zustand store for agents
      projectStore.ts          # Zustand store for projects
      skillStore.ts            # Zustand store for skills
      automationStore.ts       # Zustand store for automations
      uiStore.ts               # UI state (sidebar, modals, theme)
    types/
      agent.ts                 # Agent, Thread, Message types
      project.ts               # Project types
      skill.ts                 # Skill definition types
      automation.ts            # Automation types
      ipc.ts                   # IPC channel type definitions
    lib/
      ipc-client.ts            # Type-safe IPC invoke wrapper
  skills/                      # Built-in skills (shipped with app)
    code-review/
      SKILL.md
    test-generator/
      SKILL.md
    refactor/
      SKILL.md
    documentation/
      SKILL.md
  forge.config.ts              # Electron Forge configuration
  vite.config.ts               # Vite configuration for renderer
  tsconfig.json                # Root TypeScript config
  tsconfig.main.json           # Electron main process config
  tsconfig.renderer.json       # Renderer process config
  package.json
  tailwind.config.ts
```

---

## 3. Implementation Phases

### Phase 1: Foundation (Scaffold + Single Agent)

**Goal**: Get a working Electron app that can send prompts to Claude Code
and stream responses in a chat-like UI.

#### 1.1 Project Scaffolding
- Initialize the project with `npm init`
- Set up Electron Forge with Vite + React + TypeScript template
- Configure TypeScript (strict mode, path aliases)
- Configure Tailwind CSS + shadcn/ui
- Set up ESLint + Prettier
- Set up Vitest for unit tests

#### 1.2 Electron Shell
- Create `electron/main.ts` with BrowserWindow creation
- Create `electron/preload.ts` with contextBridge exposing IPC channels
- Define the IPC channel type contract in `src/types/ipc.ts`
- Create `src/lib/ipc-client.ts` as type-safe wrapper around `window.electronAPI`
- Set up hot-reload for development (Vite HMR for renderer, electron-reload for main)

#### 1.3 Storage Layer
- Set up `better-sqlite3` in main process
- Create database schema:
  ```sql
  -- Projects
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_opened_at DATETIME,
    settings JSON DEFAULT '{}'
  );

  -- Agent threads
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT,
    status TEXT CHECK(status IN ('running','paused','completed','failed')) DEFAULT 'running',
    session_id TEXT,           -- Claude Code session ID
    worktree_path TEXT,        -- Path to git worktree
    worktree_branch TEXT,      -- Branch name in worktree
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Messages within threads
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES threads(id),
    role TEXT CHECK(role IN ('user','assistant','system','tool_use','tool_result')),
    content JSON NOT NULL,     -- Structured content blocks
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Skills
  CREATE TABLE skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    scope TEXT CHECK(scope IN ('system','user','project')) DEFAULT 'user',
    path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Automations
  CREATE TABLE automations (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    skill_ids JSON DEFAULT '[]',
    schedule TEXT,              -- Cron expression
    trigger_type TEXT CHECK(trigger_type IN ('cron','file_change','git_event','manual')),
    trigger_config JSON DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    last_run_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Automation run results
  CREATE TABLE automation_runs (
    id TEXT PRIMARY KEY,
    automation_id TEXT NOT NULL REFERENCES automations(id),
    status TEXT CHECK(status IN ('running','completed','failed','archived')),
    result JSON,
    read INTEGER DEFAULT 0,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME
  );
  ```

#### 1.4 Single Agent Integration
- Install `@anthropic-ai/claude-agent-sdk`
- Create `agent-orchestrator.ts`:
  - `launchAgent(projectPath, prompt, options)` -> spawns a Claude Agent SDK query
  - Stream messages back via IPC to renderer
  - Track agent status (running/completed/failed)
  - Handle session creation and session ID storage
- Create `session-registry.ts`:
  - Map thread IDs to Claude session IDs
  - Support resume/fork via session ID

#### 1.5 Basic Chat UI
- Build `Sidebar.tsx` with project list
- Build `ThreadList.tsx` showing threads for selected project
- Build `ThreadView.tsx`:
  - Message list with user/assistant messages
  - Streaming text display for in-progress responses
  - Tool call visualization (collapsible blocks showing tool name + input/output)
  - Input bar at the bottom for sending new prompts
- Build `NewAgentDialog.tsx` for creating threads with initial prompt
- Build `AgentCard.tsx` showing agent status, model, cost

#### 1.6 Project Management
- Build `project-manager.ts`:
  - Open folder dialog to add projects
  - Detect git repos, read existing CLAUDE.md/AGENTS.md
  - Track recently opened projects
- Build `ProjectSettings.tsx` for per-project config (model, allowed tools, system prompt)

---

### Phase 2: Multi-Agent & Worktrees

**Goal**: Run multiple agents in parallel on isolated git worktrees
with a unified view.

#### 2.1 Git Worktree Manager
- Create `worktree-manager.ts` using `simple-git`:
  ```typescript
  interface WorktreeManager {
    create(repoPath: string, branchName: string): Promise<WorktreeInfo>;
    destroy(worktreePath: string): Promise<void>;
    list(repoPath: string): Promise<WorktreeInfo[]>;
    getDiff(worktreePath: string): Promise<FileDiff[]>;
    syncBack(worktreePath: string, targetBranch: string): Promise<void>;
    getStatus(worktreePath: string): Promise<GitStatus>;
  }
  ```
- Auto-create worktree when launching a new agent thread
- Auto-cleanup worktree when thread is archived/deleted
- Branch naming convention: `pericode/<thread-id>/<short-description>`

#### 2.2 Agent Pool & Orchestration
- Extend `agent-orchestrator.ts` to manage concurrent agents:
  ```typescript
  interface AgentOrchestrator {
    launch(config: AgentLaunchConfig): Promise<AgentHandle>;
    pause(threadId: string): Promise<void>;
    resume(threadId: string): Promise<void>;
    cancel(threadId: string): Promise<void>;
    getRunning(): AgentHandle[];
    setMaxConcurrent(n: number): void;
    onEvent(event: AgentEvent, handler: EventHandler): void;
  }
  ```
- Configurable concurrency limit (default: 3 parallel agents)
- Queue system: if limit reached, new agents wait in queue
- Budget tracking: aggregate cost across all agents, with per-project caps
- Resource monitoring: track token usage, API costs in real-time

#### 2.3 Multi-Thread UI
- Update `Sidebar.tsx` to show agent count badges per project
- Update `ThreadList.tsx`:
  - Color-coded status indicators (green=running, blue=completed, red=failed)
  - Quick actions (pause, resume, cancel)
  - Drag to reorder
- Add split-view mode: view two threads side-by-side
- Add "All Agents" dashboard view showing all running agents across projects

#### 2.4 Diff Review Workflow
- Build `DiffViewer.tsx`:
  - Side-by-side and unified diff modes
  - Syntax highlighting per language
  - File tree of all changed files with +/- line counts
  - Per-file and per-hunk accept/reject controls
- Build `DiffActions.tsx`:
  - "Accept All" - merge all changes from worktree to main branch
  - "Accept File" - cherry-pick individual file changes
  - "Reject" - discard changes
  - "Edit" - open file in external editor or inline Monaco editor
  - "Request Changes" - send feedback to the agent for revision
- Integration with `worktree-manager.syncBack()` for applying accepted changes

---

### Phase 3: Skills System

**Goal**: Implement reusable, shareable skill bundles that customize
agent behavior.

#### 3.1 Skill Definition Format
- Define `SKILL.md` format (compatible with Codex convention for familiarity):
  ```markdown
  ---
  name: Code Review Expert
  description: >
    Performs thorough code review focusing on security, performance,
    and maintainability. Trigger when user asks for code review or
    PR review.
  model: sonnet
  tools:
    - Read
    - Grep
    - Glob
  max_budget_usd: 0.50
  ---

  ## Instructions

  You are a senior code reviewer. For each file:
  1. Check for security vulnerabilities (OWASP Top 10)
  2. Identify performance issues
  3. Suggest maintainability improvements
  4. Verify error handling completeness

  ## Output Format

  Provide a structured review with severity levels:
  - CRITICAL: Must fix before merge
  - WARNING: Should fix, but not blocking
  - INFO: Suggestions for improvement
  ```

#### 3.2 Skills Engine
- Create `skills-engine.ts`:
  ```typescript
  interface SkillsEngine {
    loadAll(): Promise<Skill[]>;                     // Load from all scopes
    resolve(name: string): Skill | undefined;        // Find by name
    match(prompt: string): Skill[];                  // Implicit matching
    invoke(skill: Skill, context: AgentContext): SkillConfig;  // Build agent config
    create(definition: SkillDefinition): Promise<Skill>;
    update(id: string, definition: SkillDefinition): Promise<Skill>;
    delete(id: string): Promise<void>;
    export(id: string): Promise<Buffer>;             // Export as .zip
    import(archive: Buffer): Promise<Skill>;         // Import from .zip
  }
  ```
- Skill scope resolution order: project > user > system
- Implicit matching: use keyword/semantic matching on skill descriptions
  against user prompts to suggest relevant skills
- Skill invocation: prepend skill instructions to agent system prompt,
  attach skill-specific tools, apply skill-defined constraints

#### 3.3 Built-in Skills (Ship with App)
- `code-review` - Thorough code review with severity levels
- `test-generator` - Generate unit/integration tests for a module
- `refactor` - Structured refactoring with before/after validation
- `documentation` - Generate/update documentation from code
- `migration` - Database/API migration assistant
- `debug` - Systematic debugging with hypothesis testing

#### 3.4 Skills UI
- Build `SkillBrowser.tsx`:
  - Grid/list view of available skills
  - Filter by scope (system/user/project)
  - Search by name/description
  - Preview skill definition
- Build `SkillEditor.tsx`:
  - Monaco editor for SKILL.md editing
  - YAML frontmatter form editor
  - Preview rendered instructions
  - Test skill against sample prompts
- Build `SkillInstaller.tsx`:
  - Import skills from local .zip files
  - Import from Git repository URL
  - Future: community skill marketplace

#### 3.5 Skill Invocation in Agent Threads
- Add skill selector to `NewAgentDialog.tsx`
- Add `$skill-name` syntax detection in chat input
- Show active skills badge in thread header
- Allow attaching/detaching skills mid-conversation

---

### Phase 4: Automations & Scheduling

**Goal**: Enable background agent tasks that run on schedules or
in response to events.

#### 4.1 Automation Scheduler
- Create `automation-scheduler.ts`:
  ```typescript
  interface AutomationScheduler {
    register(automation: Automation): void;
    unregister(automationId: string): void;
    trigger(automationId: string): Promise<AutomationRun>;
    getScheduled(): ScheduledTask[];
    getHistory(automationId: string): AutomationRun[];
    pause(automationId: string): void;
    resume(automationId: string): void;
  }
  ```
- Cron-based scheduling via `node-cron`
- Event-based triggers:
  - `file_change` - Watch files/directories via `chokidar`
  - `git_event` - Monitor for new commits, branch changes, PR updates
  - `manual` - On-demand execution only

#### 4.2 Automation Execution
- Each automation run:
  1. Creates a fresh git worktree (for git projects)
  2. Loads associated skills
  3. Launches a Claude agent with the automation prompt
  4. Captures full conversation and results
  5. Stores results in `automation_runs` table
  6. Notifies user via system tray notification
  7. Auto-archives if no actionable output
- Sandbox policy configuration:
  - `read-only` - Agent can only read files
  - `workspace-write` - Agent can write in worktree only
  - `full` - No restrictions (requires explicit user opt-in)

#### 4.3 Result Inbox (Triage Queue)
- Build `AutomationInbox.tsx`:
  - List of automation run results, newest first
  - Unread/read status with badge counts
  - Filter by: automation name, status, project, date range
  - Bulk actions: archive all, mark all read
- Each result entry shows:
  - Automation name and trigger reason
  - Summary of agent output
  - Diff of any file changes
  - Accept/reject/edit actions for changes
  - Full conversation log (expandable)

#### 4.4 Automation Editor UI
- Build `AutomationEditor.tsx`:
  - Name and description fields
  - Prompt template editor with variable interpolation
    (e.g., `{{branch}}`, `{{changed_files}}`, `{{author}}`)
  - Skill attachment selector
  - Trigger configuration:
    - Cron: visual cron builder (`CronPicker.tsx`)
    - File change: file/directory path + glob pattern
    - Git event: event type selector
  - Sandbox policy selector
  - Budget limit per run
  - Enable/disable toggle
- Build `AutomationList.tsx`:
  - All automations for current project
  - Status indicators (enabled, next run time, last result)
  - Quick enable/disable toggle

#### 4.5 Built-in Automation Templates
- `daily-triage` - Review open issues and summarize priorities
- `ci-failure-analyzer` - On CI failure, analyze and suggest fixes
- `recent-code-review` - Review commits from the past day
- `dependency-updater` - Check for outdated dependencies weekly
- `test-coverage-monitor` - Run tests and report coverage changes

---

### Phase 5: Command Center & Polish

**Goal**: Bring everything together into a polished, cohesive
experience with power-user features.

#### 5.1 Command Palette (Cmd+K / Ctrl+K)
- Build `CommandBar.tsx`:
  - Fuzzy search across: projects, threads, skills, automations, actions
  - Recent items
  - Quick actions:
    - "New Agent" - launch agent in current project
    - "Open Project" - open a project folder
    - "Run Skill" - invoke a skill directly
    - "Trigger Automation" - manually run an automation
    - "Search Threads" - full-text search across all conversations

#### 5.2 Status Bar
- Build `StatusBar.tsx`:
  - Running agent count with activity indicators
  - Total session cost (current + cumulative)
  - Token usage meters
  - API key status
  - Automation next-run countdown

#### 5.3 Settings & Preferences
- Build `SettingsPanel.tsx`:
  - **General**: Theme (light/dark/system), default model, API key management
  - **Agents**: Default tools, max concurrent agents, default budget limits,
    permission mode, sandbox configuration
  - **Skills**: Skill directories, skill scope preferences
  - **Automations**: Global enable/disable, notification preferences,
    default sandbox policy
  - **Appearance**: Font size, interaction style (terse/detailed),
    diff viewer preferences
  - **Advanced**: Claude CLI path override, custom MCP servers,
    proxy configuration, log level

#### 5.4 Keyboard Shortcuts
- Define comprehensive keyboard shortcut system:
  | Shortcut         | Action                    |
  |------------------|---------------------------|
  | Cmd+K            | Open command palette       |
  | Cmd+N            | New agent thread           |
  | Cmd+1..9         | Switch between threads     |
  | Cmd+Enter        | Send message               |
  | Cmd+Shift+D      | Toggle diff viewer         |
  | Cmd+,            | Open settings              |
  | Cmd+B            | Toggle sidebar             |
  | Cmd+Shift+A      | Show all agents dashboard  |
  | Escape           | Cancel current agent       |

#### 5.5 Notification System
- System tray integration:
  - Agent completion notifications
  - Automation result notifications
  - Error/failure alerts
- In-app toast notifications for non-critical events
- Notification center with history

#### 5.6 Embedded Terminal
- Build `EmbeddedTerminal.tsx` using xterm.js:
  - View agent's bash command execution in real-time
  - Optional manual terminal for the project directory
  - Terminal per worktree

#### 5.7 Export & Reporting
- Export thread conversation as Markdown
- Export diff as patch file
- Export automation run history as CSV
- Project-level cost report with breakdown by thread/agent

---

## 4. Cross-Cutting Concerns

### 4.1 Security
- API keys stored in OS keychain (electron-keytar or safeStorage)
- Never log or display API keys in UI
- Sandbox enforcement for automation agents
- `can_use_tool` callback for permission control
- Content Security Policy in Electron
- No remote code execution in renderer

### 4.2 Error Handling
- Global error boundary in React
- Agent crash recovery: detect failed agents, offer retry
- Network error handling with retry logic
- Graceful degradation when Claude Code CLI is not available
- Worktree cleanup on app crash (recover orphaned worktrees on startup)

### 4.3 Performance
- Lazy-load heavy components (Monaco editor, terminal)
- Virtual scrolling for long message lists
- Database queries with proper indexing
- Debounced file watchers for automation triggers
- Agent output buffering to prevent UI flooding

### 4.4 Logging & Observability
- Structured logging via electron-log
- Log levels: debug, info, warn, error
- Separate log files for: app, agents, automations
- Log rotation (keep last 7 days)

### 4.5 Updates
- Auto-update via Electron Forge / electron-updater
- Check for updates on app launch
- Show changelog on update

---

## 5. Data Flow Examples

### Launching a New Agent

```
User clicks "New Agent" -> NewAgentDialog
  |
  v
User enters prompt, selects skills, picks model -> Submit
  |
  v
Renderer: ipc.invoke('agent:launch', { projectId, prompt, skillIds, model })
  |
  v
Main Process: AgentOrchestrator.launch()
  |-> WorktreeManager.create()         // Create isolated worktree
  |-> SkillsEngine.resolve(skillIds)   // Load skill configs
  |-> Storage.createThread()           // Persist thread record
  |-> ClaudeAgentSDK.query({           // Start Claude agent
  |     prompt: skillPrompt + userPrompt,
  |     options: {
  |       cwd: worktreePath,
  |       allowedTools: [...skillTools],
  |       permissionMode: "acceptEdits",
  |       includePartialMessages: true
  |     }
  |   })
  |-> Stream messages back via IPC:
       ipc.send('agent:message', { threadId, message })
  |
  v
Renderer: ThreadView updates in real-time with streaming text,
          tool calls, and results
```

### Automation Trigger Flow

```
node-cron fires scheduled job
  |
  v
AutomationScheduler.trigger(automationId)
  |-> Storage.getAutomation(id)
  |-> WorktreeManager.create()
  |-> SkillsEngine.resolve(automation.skillIds)
  |-> AgentOrchestrator.launch({
  |     prompt: interpolate(automation.prompt, context),
  |     cwd: worktreePath,
  |     sandbox: automation.sandboxPolicy
  |   })
  |-> Wait for agent completion
  |-> Storage.createAutomationRun({ result, diff })
  |-> NotificationService.notify("Automation completed")
  |-> If no actionable output: auto-archive
  |
  v
User sees unread badge on Automation Inbox
  -> Reviews result, accepts/rejects changes
```

---

## 6. Database Schema Diagram

```
projects 1--* threads 1--* messages
projects 1--* automations 1--* automation_runs
skills (standalone, referenced by threads & automations via JSON arrays)
```

---

## 7. IPC Channel Contracts

```typescript
// Type-safe IPC channels
interface IPCChannels {
  // Projects
  'project:list': () => Project[];
  'project:add': (path: string) => Project;
  'project:remove': (id: string) => void;
  'project:getSettings': (id: string) => ProjectSettings;
  'project:updateSettings': (id: string, settings: Partial<ProjectSettings>) => void;

  // Agents
  'agent:launch': (config: AgentLaunchConfig) => ThreadInfo;
  'agent:pause': (threadId: string) => void;
  'agent:resume': (threadId: string) => void;
  'agent:cancel': (threadId: string) => void;
  'agent:sendMessage': (threadId: string, message: string) => void;
  'agent:getRunning': () => ThreadInfo[];

  // Threads
  'thread:list': (projectId: string) => ThreadInfo[];
  'thread:get': (threadId: string) => ThreadDetail;
  'thread:getMessages': (threadId: string) => Message[];
  'thread:delete': (threadId: string) => void;
  'thread:fork': (threadId: string) => ThreadInfo;

  // Diff / Worktrees
  'worktree:getDiff': (threadId: string) => FileDiff[];
  'worktree:acceptAll': (threadId: string) => void;
  'worktree:acceptFile': (threadId: string, filePath: string) => void;
  'worktree:reject': (threadId: string) => void;
  'worktree:openInEditor': (threadId: string, filePath: string) => void;

  // Skills
  'skill:list': () => Skill[];
  'skill:get': (id: string) => SkillDetail;
  'skill:create': (definition: SkillDefinition) => Skill;
  'skill:update': (id: string, definition: SkillDefinition) => Skill;
  'skill:delete': (id: string) => void;
  'skill:export': (id: string) => { path: string };
  'skill:import': (archivePath: string) => Skill;

  // Automations
  'automation:list': (projectId: string) => Automation[];
  'automation:create': (config: AutomationConfig) => Automation;
  'automation:update': (id: string, config: Partial<AutomationConfig>) => Automation;
  'automation:delete': (id: string) => void;
  'automation:trigger': (id: string) => AutomationRun;
  'automation:toggleEnabled': (id: string) => void;
  'automation:getHistory': (id: string) => AutomationRun[];
  'automation:getInbox': (filters?: InboxFilters) => AutomationRun[];
  'automation:markRead': (runId: string) => void;
  'automation:archiveRun': (runId: string) => void;

  // Settings
  'settings:get': () => AppSettings;
  'settings:update': (settings: Partial<AppSettings>) => void;
  'settings:getApiKeyStatus': () => { valid: boolean; provider: string };
}

// IPC Events (main -> renderer, streaming)
interface IPCEvents {
  'agent:message': (threadId: string, message: StreamMessage) => void;
  'agent:status': (threadId: string, status: AgentStatus) => void;
  'agent:error': (threadId: string, error: ErrorInfo) => void;
  'agent:cost': (threadId: string, cost: CostUpdate) => void;
  'automation:completed': (run: AutomationRun) => void;
  'notification': (notification: AppNotification) => void;
}
```

---

## 8. Implementation Order & Dependencies

```
Phase 1 (Foundation)
  1.1 Scaffold ─────────────────────┐
  1.2 Electron Shell ───────────────┤
  1.3 Storage Layer ────────────────┤
  1.4 Single Agent ─────────────────┤ (depends on 1.1-1.3)
  1.5 Basic Chat UI ────────────────┤ (depends on 1.2, 1.4)
  1.6 Project Management ──────────-┘ (depends on 1.3, 1.5)

Phase 2 (Multi-Agent)
  2.1 Worktree Manager ────────────┐ (depends on 1.6)
  2.2 Agent Pool ──────────────────┤ (depends on 1.4, 2.1)
  2.3 Multi-Thread UI ─────────────┤ (depends on 1.5, 2.2)
  2.4 Diff Review ─────────────────┘ (depends on 2.1, 2.3)

Phase 3 (Skills)
  3.1 Skill Format ────────────────┐
  3.2 Skills Engine ───────────────┤ (depends on 3.1)
  3.3 Built-in Skills ─────────────┤ (depends on 3.1)
  3.4 Skills UI ───────────────────┤ (depends on 3.2, 1.5)
  3.5 Skill Invocation ────────────┘ (depends on 3.2, 2.2)

Phase 4 (Automations)
  4.1 Scheduler ───────────────────┐ (depends on 2.2)
  4.2 Execution Engine ────────────┤ (depends on 4.1, 2.1, 3.2)
  4.3 Result Inbox ────────────────┤ (depends on 4.2)
  4.4 Automation Editor UI ────────┤ (depends on 4.1, 4.3)
  4.5 Built-in Templates ─────────┘ (depends on 4.1, 3.3)

Phase 5 (Polish)
  5.1 Command Palette ─────────────┐
  5.2 Status Bar ──────────────────┤
  5.3 Settings ────────────────────┤ (all depend on Phase 1-4)
  5.4 Keyboard Shortcuts ──────────┤
  5.5 Notifications ───────────────┤
  5.6 Embedded Terminal ───────────┤
  5.7 Export & Reporting ──────────┘
```

---

## 9. Key Technical Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| **Electron** over Tauri | Better Node.js ecosystem compatibility for Claude Agent SDK (TypeScript), mature IPC, easier native module support (better-sqlite3) |
| **Vite** over Webpack | Faster builds, better DX, native ESM support |
| **Zustand** over Redux | Simpler API, less boilerplate, good TypeScript support, sufficient for this app's state complexity |
| **better-sqlite3** over electron-store | Relational data (threads, messages, runs) benefits from SQL; faster for bulk reads |
| **simple-git** over nodegit | Lighter dependency, wraps system git (more reliable), sufficient API surface |
| **shadcn/ui** over Material UI | Unstyled composable components, Tailwind-native, smaller bundle, full control over design |
| **Claude Agent SDK** over raw CLI subprocess | Typed messages, streaming support, session management, custom tools, hooks - avoids reimplementing protocol parsing |

---

## 10. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Claude Agent SDK breaking changes | Pin SDK version, write adapter layer, test on upgrade |
| Git worktree conflicts/corruption | Always use fresh worktrees, cleanup on crash recovery, test edge cases |
| Runaway agent costs | Enforce `max_budget_usd` per agent/automation, aggregate budget tracking, configurable alerts |
| Electron security (renderer compromise) | Strict CSP, contextBridge isolation, no `nodeIntegration`, validate all IPC inputs |
| Large conversation memory | Rely on Claude Code's built-in context compaction, implement message pagination in UI |
| File watcher performance (automations) | Debounce events, limit watched paths, use efficient watchers (chokidar) |
