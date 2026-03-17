# PeriCode

Uma ferramenta periquitante para desenvolvimento com Claude.

PeriCode is a multi-agent command center that wraps the Claude Code CLI in a Tauri desktop application, providing a visual interface for managing AI-assisted development workflows.

## Features

- **Multi-thread conversations** - Run multiple Claude agents simultaneously
- **Project management** - Organize work across different codebases
- **Git integration** - Built-in git commands (`/status`, `/commit`, `/push`, `/pull`, `/checkout`, `/branch`, `/publish`)
- **Skill system** - Import and use custom skills from local files or Git repositories
- **Image support** - Paste or drag-and-drop images into conversations
- **Cost tracking** - Monitor token usage and costs per conversation
- **Diff viewer** - Review code changes with GitHub-style unified diffs
- **Worktree isolation** - Run agents in isolated git worktrees

## Screenshots

<!-- Add screenshots here -->

## Requirements

- **Claude CLI** - Must be installed and authenticated
  ```bash
  # Install Claude CLI
  npm install -g @anthropic-ai/claude-code

  # Authenticate
  claude auth
  ```

## Installation

### Windows

**Option 1: NSIS Installer (recommended)**
1. Download `PeriCode_X.X.X_x64-setup.exe` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Run the installer
3. Launch PeriCode from Start Menu

**Option 2: MSI Installer**
1. Download `PeriCode_X.X.X_x64_en-US.msi` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Run the `.msi` installer
3. Launch PeriCode from Start Menu

---

### macOS

> macOS builds are not currently available via CI. See [Building from Source](#building-from-source) below.

---

### Linux

#### Debian / Ubuntu
```bash
# Download the .deb package
wget https://github.com/cucapcosta/pericode/releases/download/vX.X.X/pericode_X.X.X_amd64.deb

# Install
sudo dpkg -i pericode_X.X.X_amd64.deb

# Fix dependencies if needed
sudo apt-get install -f
```

#### Fedora / RHEL / CentOS
```bash
# Download the .rpm package
wget https://github.com/cucapcosta/pericode/releases/download/vX.X.X/pericode-X.X.X-1.x86_64.rpm

# Install
sudo rpm -i pericode-X.X.X-1.x86_64.rpm
# or with dnf
sudo dnf install pericode-X.X.X-1.x86_64.rpm
```

#### AppImage (any distro)
```bash
# Download the AppImage
wget https://github.com/cucapcosta/pericode/releases/download/vX.X.X/PeriCode_X.X.X_amd64.AppImage

# Make executable and run
chmod +x PeriCode_X.X.X_amd64.AppImage
./PeriCode_X.X.X_amd64.AppImage
```

#### Arch Linux
```bash
# Option 1: Use the AppImage (see above)

# Option 2: Build from source (see below)
```

---

## Building from Source

### Prerequisites
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Git
- **Linux only:** system libraries for Tauri
  ```bash
  # Debian/Ubuntu
  sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev libsoup-3.0-dev
  ```

### Steps

```bash
# Clone the repository
git clone https://github.com/cucapcosta/pericode.git
cd pericode

# Install dependencies
pnpm install

# Run in development mode
pnpm tauri dev

# Build for production
pnpm tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

### Build commands

| Command | Description |
|---------|-------------|
| `pnpm tauri dev` | Start in development mode with hot reload |
| `pnpm build` | Type-check TypeScript and build frontend |
| `pnpm tauri build` | Build distributable desktop bundles |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint TypeScript |
| `pnpm version:sync X.X.X` | Sync version across all manifests |
| `pnpm release X.X.X` | Bump version, commit, and tag for release |

---

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

- **Paste**: Ctrl+V to paste from clipboard
- **Drag & Drop**: Drag images into the chat
- **Pick**: Click the image button to select files

---

## Configuration

### Project Settings

Each project can have custom settings:
- **Model**: Default Claude model to use
- **Build Command**: Command for `/build` (e.g., `npm run build`)
- **System Prompt**: Custom instructions for the agent
- **Allowed Tools**: Restrict which tools the agent can use

### Application Settings

Access via the settings icon in the sidebar:
- Theme (light/dark/system)
- Default model
- Permission mode
- Log level

---

## Development

### Project Structure

```
pericode/
├── src-tauri/          # Tauri backend (Rust)
│   ├── src/
│   │   ├── commands/  # IPC command handlers
│   │   ├── services/  # Business logic
│   │   ├── db/        # SQLite database layer
│   │   └── utils/     # Utilities
│   └── tauri.conf.json
├── src/                # Frontend (React)
│   ├── components/    # UI components
│   ├── stores/        # Zustand state
│   ├── hooks/         # React hooks
│   └── lib/           # IPC client, utilities
├── scripts/            # Release & version scripts
└── .github/workflows/  # CI/CD
```

### Architecture

```
React UI → IPC (Tauri invoke) → Rust Backend → Services → Claude CLI
```

- **Frontend**: React + TypeScript + Tailwind CSS + Zustand
- **Backend**: Tauri 2.0 + Rust + SQLite (rusqlite)
- **CLI Integration**: Spawns Claude via portable-pty

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Claude](https://claude.ai) by Anthropic
- [Tauri](https://tauri.app)
- [React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
