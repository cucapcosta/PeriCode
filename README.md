> **[English version](README.en.md)**

# PeriCode

Command center multi-agente para desenvolvimento com IA.

PeriCode é uma aplicação desktop que envolve o Claude Code CLI em uma interface visual completa, permitindo gerenciar múltiplos agentes de IA simultaneamente em diferentes projetos.

## Sobre

PeriCode transforma o Claude Code CLI em um ambiente visual de desenvolvimento assistido por IA. Em vez de gerenciar sessões de terminal individualmente, você tem um painel de controle centralizado com múltiplas threads, projetos e ferramentas integradas.

## Features

- **Multi-thread** - Execute múltiplos agentes Claude simultaneamente em threads independentes
- **Gerenciamento de projetos** - Organize trabalho em diferentes codebases
- **Git integrado** - Comandos git nativos: `/status`, `/commit`, `/push`, `/pull`, `/checkout`, `/branch`, `/publish`
- **Sistema de skills** - Prompts reutilizáveis com sintaxe `$skill-name`, importação de repositórios Git
- **Suporte a imagens** - Paste (Ctrl+V), drag-and-drop e file picker
- **Rastreamento de custos** - Monitore tokens e custos por conversa
- **Diff viewer** - Diffs unificados estilo GitHub para revisar mudanças
- **Worktree isolation** - Execute agentes em worktrees git isolados
- **Automações** - Tarefas agendadas com cron, file watch e git events
- **Terminal embutido** - Terminal xterm.js integrado na aplicação
- **Multi-provider** - Suporte a Claude e GitHub Copilot
- **Command palette** - Cmd+K / Ctrl+K para navegação rápida
- **Dashboard** - Monitoramento de todos os agentes ativos

## Screenshots

<!-- TODO: Adicionar screenshots -->

## Requisitos

- **Claude CLI** instalado e autenticado
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude auth
  ```

## Instalação

### Windows

**NSIS Installer (recomendado):**
1. Baixe `PeriCode_X.X.X_x64-setup.exe` em [Releases](https://github.com/cucapcosta/pericode/releases)
2. Execute o instalador
3. Abra o PeriCode pelo Menu Iniciar

**MSI Installer:**
1. Baixe `PeriCode_X.X.X_x64_en-US.msi` em [Releases](https://github.com/cucapcosta/pericode/releases)
2. Execute o `.msi`

### Linux

**Debian / Ubuntu:**
```bash
sudo dpkg -i pericode_X.X.X_amd64.deb
sudo apt-get install -f  # corrigir dependências se necessário
```

**Fedora / RHEL:**
```bash
sudo rpm -i pericode-X.X.X-1.x86_64.rpm
```

**AppImage (qualquer distro):**
```bash
chmod +x PeriCode_X.X.X_amd64.AppImage
./PeriCode_X.X.X_amd64.AppImage
```

### macOS

> Builds para macOS não estão disponíveis via CI. Veja [Build from Source](#build-from-source).

## Build from Source

### Pré-requisitos
- [Rust](https://rustup.rs/) (stable)
- Node.js 20+
- [pnpm](https://pnpm.io/) 9+
- Git
- **Linux:** bibliotecas de sistema para Tauri
  ```bash
  # Debian/Ubuntu
  sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libgtk-3-dev libsoup-3.0-dev
  ```

### Passos

```bash
git clone https://github.com/cucapcosta/pericode.git
cd pericode
pnpm install

# Modo desenvolvimento (com hot reload)
pnpm tauri dev

# Build de produção
pnpm tauri build
```

Os binários serão gerados em `src-tauri/target/release/bundle/`.

## Uso

### Primeiros passos

1. Abra o PeriCode
2. Clique em "Add Project" na sidebar
3. Selecione a pasta do seu código
4. Crie uma nova thread para conversar com o Claude

### Slash Commands

Digite `/` no input para ver os comandos disponíveis:

| Comando | Descrição |
|---------|-----------|
| `/code` | Abrir projeto no VS Code |
| `/build` | Executar comando de build |
| `/rebuild` | Rebuild e reiniciar o PeriCode |
| `/status` | Mostrar git status |
| `/add` | Stage todas as mudanças |
| `/commit` | Commit das mudanças staged |
| `/push` | Push para o remote |
| `/pull` | Pull do remote |
| `/checkout` | Trocar de branch |
| `/branch` | Listar branches |
| `/publish` | Publicar uma nova release |

### Skills

Referencie skills nas mensagens usando a sintaxe `$skill-name`. Skills são prompts reutilizáveis que podem ser:
- Importados de repositórios Git
- Criados localmente na aba Skills
- Compartilhados entre projetos

### Imagens

- **Paste:** Ctrl+V para colar da área de transferência
- **Drag & Drop:** Arraste imagens para o chat
- **Pick:** Clique no botão de imagem para selecionar arquivos

### Automações

Configure tarefas automáticas:
- **Cron:** Agende execuções com expressões cron
- **File Watch:** Reaja a mudanças em arquivos
- **Git Events:** Dispare ações em eventos git

## Configuração

### Settings do Projeto

Cada projeto pode ter configurações próprias:
- **Model:** Modelo Claude padrão
- **Build Command:** Comando para `/build` (ex: `npm run build`)
- **System Prompt:** Instruções customizadas para o agente
- **Allowed Tools:** Restringir ferramentas disponíveis

### Settings da Aplicação

Acesse pelo ícone de configurações na sidebar:
- Tema (light/dark/system)
- Modelo padrão
- Modo de permissão
- Nível de log

## Arquitetura

```
React UI → IPC (Tauri invoke) → Rust Backend → Services → Claude CLI
```

- **Frontend:** React 19 + TypeScript + Tailwind CSS + Zustand
- **Backend:** Tauri 2.0 + Rust + SQLite (rusqlite)
- **CLI:** Integração com Claude via portable-pty

## Estrutura do Projeto

```
pericode/
├── src/                    # Frontend (React)
│   ├── components/         # Componentes UI
│   ├── stores/             # Estado com Zustand
│   ├── hooks/              # React hooks
│   └── lib/                # IPC client, utilitários
├── src-tauri/              # Backend (Rust)
│   ├── src/
│   │   ├── commands/       # Handlers de comandos IPC
│   │   ├── services/       # Lógica de negócio
│   │   ├── db/             # Camada de banco SQLite
│   │   └── utils/          # Utilitários
│   └── tauri.conf.json
├── scripts/                # Scripts de release e versão
└── .github/workflows/      # CI/CD
```

## Comandos de Desenvolvimento

| Comando | Descrição |
|---------|-----------|
| `pnpm tauri dev` | Modo desenvolvimento com hot reload |
| `pnpm build` | Type-check TypeScript e build do frontend |
| `pnpm tauri build` | Build dos binários distribuíveis |
| `pnpm test` | Rodar testes |
| `pnpm lint` | Lint do TypeScript |
| `pnpm version:sync X.X.X` | Sincronizar versão em todos os manifestos |
| `pnpm release X.X.X` | Bump de versão, commit e preparar release |

## Contribuição

1. Fork o repositório
2. Crie uma branch para a feature (`git checkout -b feature/nova-feature`)
3. Commit suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

## Licença

MIT License - veja [LICENSE](LICENSE) para detalhes.

## Agradecimentos

- [Claude](https://claude.ai) por Anthropic
- [Tauri](https://tauri.app)
- [React](https://react.dev)
- [Tailwind CSS](https://tailwindcss.com)
