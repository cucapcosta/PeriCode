> **[Versão em Português](README.md)**

# PeriCode

Multi-agent command center for AI-powered development.

PeriCode is a desktop application that wraps the Claude Code CLI in a full visual interface, letting you manage multiple AI agents simultaneously across different projects.

## About

PeriCode turns the Claude Code CLI into a visual AI-assisted development environment. Instead of managing individual terminal sessions, you get a centralized control panel with multiple threads, projects, and integrated tools.

## Features

- **Multi-thread** - Run multiple Claude agents simultaneously in independent threads
- **Project management** - Organize work across different codebases
- **Built-in Git** - Native git commands: `/status`, `/commit`, `/push`, `/pull`, `/checkout`, `/branch`, `/publish`
- **Skill system** - Reusable prompts with `$skill-name` syntax, import from Git repositories
- **Image support** - Paste (Ctrl+V), drag-and-drop, and file picker
- **Cost tracking** - Monitor tokens and costs per conversation
- **Diff viewer** - GitHub-style unified diffs for reviewing changes
- **Worktree isolation** - Run agents in isolated git worktrees
- **Automations** - Scheduled tasks with cron, file watch, and git events
- **Built-in terminal** - Integrated xterm.js terminal
- **Multi-provider** - Support for Claude and GitHub Copilot
- **Command palette** - Cmd+K / Ctrl+K for quick navigation
- **Dashboard** - Monitor all active agents

## Screenshots

<!-- TODO: Add screenshots -->

## Requirements

- **Claude CLI** installed and authenticated
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude auth
  ```

## Installation

### Windows

**NSIS Installer (recommended):**
1. Download `PeriCode_X.X.X_x64-setup.exe` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Run the installer
3. Launch PeriCode from Start Menu

**MSI Installer:**
1. Download `PeriCode_X.X.X_x64_en-US.msi` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Run the `.msi`

### Linux

**Debian / Ubuntu:**
```bash
sudo dpkg -i pericode_X.X.X_amd64.deb
sudo apt-get install -f  # fix dependencies if needed
```

**Fedora / RHEL:**
```bash
sudo rpm -i pericode-X.X.X-1.x86_64.rpm
```

**AppImage (any distro):**
```bash
chmod +x PeriCode_X.X.X_amd64.AppImage
./PeriCode_X.X.X_amd64.AppImage
```

### macOS

> macOS builds are not available via CI. See [Build from Source](#build-from-source).

## Build from Source

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Git
- **Linux:** system libraries for Tauri
  ```bash
  # Debian/Ubuntu
  sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev libsoup-3.0-dev
  ```

### Steps

```bash
git clone https://github.com/cucapcosta/pericode.git
cd pericode
pnpm install

# Development mode (with hot reload)
pnpm tauri dev

# Production build
pnpm tauri build
```

Built binaries will be in `src-tauri/target/release/bundle/`.

## Usage

### Getting Started

1. Launch PeriCode
2. Click "Add Project" in the sidebar
3. Select a folder containing your code
4. Create a new thread to start a conversation with Claude

### Slash Commands

Type `/` in the chat input to see available commands:

| Command | Description |
|---------|-------------|
| `/code` | Open project in VS Code |
| `/build` | Run project build command |
| `/rebuild` | Rebuild and restart PeriCode |
| `/status` | Show git status |
| `/add` | Stage all changes |
| `/commit` | Commit staged changes |
| `/push` | Push to remote |
| `/pull` | Pull from remote |
| `/checkout` | Switch branch |
| `/branch` | List branches |
| `/publish` | Publish a new release |

### Skills

Reference skills in your messages using `$skill-name` syntax. Skills are reusable prompts that can be:
- Imported from Git repositories
- Created locally in the Skills tab
- Shared across projects

### Images

- **Paste:** Ctrl+V to paste from clipboard
- **Drag & Drop:** Drag images into the chat
- **Pick:** Click the image button to select files

### Automations

Configure automatic tasks:
- **Cron:** Schedule executions with cron expressions
- **File Watch:** React to file changes
- **Git Events:** Trigger actions on git events

## Configuration

### Project Settings

Each project can have custom settings:
- **Model:** Default Claude model
- **Build Command:** Command for `/build` (e.g., `npm run build`)
- **System Prompt:** Custom instructions for the agent
- **Allowed Tools:** Restrict available tools

### Application Settings

Access via the settings icon in the sidebar:
- Theme (light/dark/system)
- Default model
- Permission mode
- Log level

## Architecture

```
React UI → IPC (Tauri invoke) → Rust Backend → Services → Claude CLI
```

- **Frontend:** React 19 + TypeScript + Tailwind CSS + Zustand
- **Backend:** Tauri 2.0 + Rust + SQLite (rusqlite)
- **CLI:** Claude integration via portable-pty

## Project Structure

```
pericode/
├── src/                    # Frontend (React)
│   ├── components/         # UI components
│   ├── stores/             # Zustand state
│   ├── hooks/              # React hooks
│   └── lib/                # IPC client, utilities
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── commands/       # IPC command handlers
│   │   ├── services/       # Business logic
│   │   ├── db/             # SQLite database layer
│   │   └── utils/          # Utilities
│   └── tauri.conf.json
├── scripts/                # Release & version scripts
└── .github/workflows/      # CI/CD
```

## Development Commands

| Command | Description |
|---------|-------------|
| `pnpm tauri dev` | Development mode with hot reload |
| `pnpm build` | Type-check TypeScript and build frontend |
| `pnpm tauri build` | Build distributable binaries |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint TypeScript |
| `pnpm version:sync X.X.X` | Sync version across all manifests |
| `pnpm release X.X.X` | Bump version, commit, and prepare release |

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Claude](https://claude.ai) by Anthropic
- [Tauri](https://tauri.app)
- [React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
