# PeriCode

Uma ferramenta periquitante para desenvolvimento com Claude.

PeriCode is a multi-agent command center that wraps the Claude Code CLI in an Electron desktop application, providing a visual interface for managing AI-assisted development workflows.

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

**Option 1: Installer (recommended)**
1. Download `pericode-X.X.X-win32-x64-Setup.exe` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Run the installer
3. Launch PeriCode from Start Menu

**Option 2: Portable**
1. Download `pericode-X.X.X-win32-x64.zip` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Extract to desired location
3. Run `pericode.exe`

---

### macOS

**Intel (x64)**
1. Download `pericode-X.X.X-darwin-x64.dmg` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Open the `.dmg` file
3. Drag PeriCode to Applications folder
4. Launch from Applications

**Apple Silicon (arm64)**
1. Download `pericode-X.X.X-darwin-arm64.dmg` from [Releases](https://github.com/cucapcosta/pericode/releases)
2. Open the `.dmg` file
3. Drag PeriCode to Applications folder
4. Launch from Applications

> Note: On first launch, you may need to right-click and select "Open" to bypass Gatekeeper.

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
wget https://github.com/cucapcosta/pericode/releases/download/vX.X.X/pericode-X.X.X.x86_64.rpm

# Install
sudo rpm -i pericode-X.X.X.x86_64.rpm
# or with dnf
sudo dnf install pericode-X.X.X.x86_64.rpm
```

#### Arch Linux

**Option 1: Extract from zip**
```bash
# Download and extract
wget https://github.com/cucapcosta/pericode/releases/download/vX.X.X/pericode-X.X.X-linux-x64.zip
unzip pericode-X.X.X-linux-x64.zip -d ~/.local/share/pericode

# Create symlink
mkdir -p ~/.local/bin
ln -s ~/.local/share/pericode/pericode ~/.local/bin/pericode

# Make sure ~/.local/bin is in your PATH
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

**Option 2: PKGBUILD (build from source)**
```bash
# Clone the repo
git clone https://github.com/cucapcosta/pericode.git
cd pericode/arch

# Build and install
makepkg -si
```

**Option 3: PKGBUILD-bin (prebuilt binary)**
```bash
# Clone the repo
git clone https://github.com/cucapcosta/pericode.git
cd pericode/arch

# Use the binary PKGBUILD
cp PKGBUILD-bin PKGBUILD

# Update pkgver to match the release version
# Edit PKGBUILD and change pkgver=X.X.X

# Build and install
makepkg -si
```

#### Other distributions (generic)
```bash
# Download the zip
wget https://github.com/cucapcosta/pericode/releases/download/vX.X.X/pericode-X.X.X-linux-x64.zip

# Extract
sudo unzip pericode-X.X.X-linux-x64.zip -d /opt/pericode

# Create launcher
sudo ln -s /opt/pericode/pericode /usr/local/bin/pericode

# Create desktop entry (optional)
cat > ~/.local/share/applications/pericode.desktop << EOF
[Desktop Entry]
Name=PeriCode
Comment=Multi-agent command center for Claude Code
Exec=/opt/pericode/pericode %U
Icon=pericode
Type=Application
Categories=Development;IDE;
Terminal=false
EOF
```

---

## Building from Source

### Prerequisites
- Node.js 18+
- npm 9+
- Git

### Steps

```bash
# Clone the repository
git clone https://github.com/cucapcosta/pericode.git
cd pericode

# Install dependencies
npm install

# Run in development mode
npm start

# Build for production
npm run make
```

The built application will be in the `out/` directory.

### Build commands

| Command | Description |
|---------|-------------|
| `npm start` | Start in development mode with hot reload |
| `npm run build` | Type-check TypeScript |
| `npm run package` | Package the app (no installer) |
| `npm run make` | Create distributable installers |

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
├── electron/           # Main process (Node.js)
│   ├── ipc/           # IPC handlers
│   ├── services/      # Business logic
│   └── utils/         # Utilities
├── src/               # Renderer process (React)
│   ├── components/    # UI components
│   ├── stores/        # Zustand state
│   └── lib/           # Utilities
├── arch/              # Arch Linux packaging
└── .github/workflows/ # CI/CD
```

### Architecture

```
React UI → IPC (preload.ts) → Main Process → Services → Claude CLI
```

- **Frontend**: React + TypeScript + Tailwind CSS + Zustand
- **Backend**: Electron + Node.js + SQLite
- **CLI Integration**: Spawns `claude -p` with `--output-format stream-json`

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
- [Electron](https://electronjs.org)
- [React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
