# PeriCode Multi-Provider Agent System

## Objetivo

Implementar um sistema de provedores que permita usar diferentes LLMs através de dois providers:
1. **Claude CLI** - Provider atual, funcionalidade completa via CLI
2. **GitHub Copilot** - Via OAuth, acesso a modelos OpenAI, Claude e Gemini

## Arquitetura Proposta

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Zustand)                             │
│  - ThreadView, SettingsPanel                            │
│  - Provider selection UI                                │
│  - Copilot auth status                                  │
└──────────────────────┬──────────────────────────────────┘
                       │ IPC
┌──────────────────────▼──────────────────────────────────┐
│  Agent Orchestrator                                      │
│  - Seleciona provider baseado em settings               │
│  - Gerencia lifecycle dos agentes                       │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│  Provider Abstraction Layer (NOVO)                      │
│  - ProviderAdapter interface                            │
│  - Unified ToolCallMessage                              │
│  - Tool execution engine (para Copilot)                 │
└──────────────────────┬──────────────────────────────────┘
                       │
           ┌───────────┴───────────┐
           │                       │
    ┌──────▼──────┐         ┌──────▼──────┐
    │   Claude    │         │   Copilot   │
    │   Adapter   │         │   Adapter   │
    │  (CLI wrap) │         │ (OAuth+API) │
    └─────────────┘         └─────────────┘
```

## Interfaces Core

### 1. ProviderAdapter

```typescript
// electron/providers/types.ts

export type ProviderType = "claude" | "copilot";

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCallMessage {
  type: "text" | "tool_use" | "tool_result" | "cost" | "status" | "error";

  // Text content
  text?: string;
  isPartial?: boolean;

  // Tool use
  toolId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;

  // Tool result
  toolOutput?: string;

  // Cost tracking
  costUsd?: number;
  tokensIn?: number;
  tokensOut?: number;
  model?: string;

  // Status
  status?: "running" | "completed" | "failed";
  errorMessage?: string;
}

export interface AgentRunOptions {
  prompt: string;
  cwd: string;
  provider: ProviderConfig;
  tools: ToolDefinition[];
  systemPrompt?: string;
  conversationHistory?: ToolCallMessage[];
  permissionMode: "ask" | "acceptEdits" | "full";
}

export interface ProviderAdapter {
  name: string;

  // Check if provider is available/configured
  isAvailable(): Promise<boolean>;

  // Get available models for this provider
  getModels(): Promise<{ id: string; name: string; description?: string }[]>;

  // Run agent and stream responses
  runAgent(options: AgentRunOptions): AsyncGenerator<ToolCallMessage>;

  // Cancel running agent
  cancel(): void;
}
```

### 2. Tool Executor (para Copilot)

```typescript
// electron/providers/tool-executor.ts

export interface ToolExecutor {
  execute(
    toolName: string,
    toolInput: Record<string, unknown>,
    cwd: string,
    permissionMode: "ask" | "acceptEdits" | "full"
  ): Promise<{
    output: string;
    requiresPermission: boolean;
  }>;
}
```

## Modelos Disponíveis

### Claude (via CLI)
| ID | Nome | Descrição |
|----|------|-----------|
| claude-opus-4-5-20251101 | Opus 4.5 | Most capable, complex tasks |
| claude-sonnet-4-5-20250929 | Sonnet 4.5 | Balanced performance |
| claude-haiku-4-5-20251001 | Haiku 4.5 | Fast, lightweight |

### GitHub Copilot (via OAuth)

#### OpenAI Models
| ID | Nome | Descrição |
|----|------|-----------|
| gpt-5.2 | GPT-5.2 | Latest GPT model |
| gpt-5.1-codex | GPT-5.1 Codex | Optimized for code |
| gpt-4o | GPT-4o | Multimodal flagship |
| gpt-4o-mini | GPT-4o Mini | Fast and affordable |
| o1 | o1 | Reasoning model |
| o1-mini | o1 Mini | Fast reasoning |

#### Claude Models (via Copilot)
| ID | Nome | Descrição |
|----|------|-----------|
| claude-sonnet-4.5 | Claude Sonnet 4.5 | Balanced |
| claude-opus-4.5 | Claude Opus 4.5 | Most capable |
| claude-haiku-4.5 | Claude Haiku 4.5 | Fast |

#### Google Models
| ID | Nome | Descrição |
|----|------|-----------|
| gemini-2.5-pro | Gemini 2.5 Pro | Google's latest |

## Fases de Implementação

### Fase 1: Abstração do Claude CLI (Refactor)

1. Criar `electron/providers/types.ts` com interfaces
2. Criar `electron/providers/claude-adapter.ts` que wrapa o `claude-cli.ts` existente
3. Criar `electron/providers/provider-registry.ts` para gerenciar adapters
4. Atualizar `agent-orchestrator.ts` para usar o adapter pattern
5. **Validação**: Comportamento 100% igual ao atual

### Fase 2: Tool Executor Próprio

Necessário para o Copilot (que não tem tools built-in como o Claude CLI).

1. Criar `electron/providers/tools/` com implementação de cada tool:
   - `read.ts` - Ler arquivos
   - `write.ts` - Escrever arquivos
   - `edit.ts` - Editar arquivos (search/replace)
   - `bash.ts` - Executar comandos
   - `glob.ts` - Buscar arquivos por pattern
   - `grep.ts` - Buscar conteúdo em arquivos
2. Criar `electron/providers/tool-executor.ts` que orquestra os tools
3. Implementar sistema de permissões (ask mode via IPC)

### Fase 3: GitHub Copilot Adapter

1. Implementar OAuth Device Flow para autenticação GitHub
2. Criar `electron/providers/copilot-adapter.ts`
3. Usar endpoint compatível com OpenAI/Anthropic
4. Implementar tool calling loop (request → tool_use → execute → tool_result → continue)
5. Armazenar tokens de forma segura (electron-store ou similar)
6. Implementar refresh automático de token

### Fase 4: UI de Configuração

1. Adicionar seção "Providers" em Settings
2. Status do Claude CLI (path, versão)
3. Botão "Connect to GitHub Copilot"
4. Status de autenticação do Copilot
5. Seleção de provider padrão
6. Seleção de modelo por provider

## Arquivos a Criar/Modificar

### Novos Arquivos

```
electron/providers/
├── types.ts                 # Interfaces unificadas
├── provider-registry.ts     # Registro de providers
├── claude-adapter.ts        # Wrapper do Claude CLI
├── copilot-adapter.ts       # GitHub Copilot adapter
├── copilot-auth.ts          # OAuth Device Flow
├── tool-executor.ts         # Executor de ferramentas
└── tools/
    ├── index.ts             # Export de todos os tools
    ├── read.ts              # Read file tool
    ├── write.ts             # Write file tool
    ├── edit.ts              # Edit file tool
    ├── bash.ts              # Bash command tool
    ├── glob.ts              # Glob pattern tool
    └── grep.ts              # Grep search tool
```

### Arquivos a Modificar

```
electron/services/agent-orchestrator.ts  # Usar provider adapter
electron/services/storage.ts             # Adicionar provider settings
electron/preload.ts                      # Novos IPC channels
src/types/ipc.ts                         # Tipos de provider
src/components/settings/SettingsPanel.tsx # UI de provider
electron/ipc/settings.ipc.ts             # Handlers de auth
```

## Settings Schema

```typescript
interface AppSettings {
  // ... existing fields ...

  // Provider settings
  defaultProvider: "claude" | "copilot";

  providers: {
    claude: {
      enabled: boolean;
      cliPath?: string;
      defaultModel: string;  // "sonnet" | "opus" | "haiku"
    };
    copilot: {
      enabled: boolean;
      authenticated: boolean;
      accessToken?: string;  // Encrypted
      refreshToken?: string; // Encrypted
      tokenExpiry?: number;
      defaultModel: string;  // "gpt-5.2" | "gpt-4o" | "claude-sonnet-4.5" | etc
    };
  };
}
```

## GitHub Copilot OAuth Flow

```typescript
// electron/providers/copilot-auth.ts

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

async function initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  // 1. Request device code from GitHub
  const response = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "copilot"
    })
  });
  return response.json();
}

async function pollForToken(deviceCode: string, interval: number): Promise<string> {
  // 2. Poll until user authorizes
  while (true) {
    await sleep(interval * 1000);
    const response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code"
      })
    });
    const data = await response.json();
    if (data.access_token) return data.access_token;
    if (data.error === "authorization_pending") continue;
    throw new Error(data.error_description);
  }
}
```

## IPC Channels Novos

```typescript
// Adicionar em src/types/ipc.ts

interface IPCInvokeChannels {
  // ... existing ...

  // Provider
  "provider:list": { args: []; return: { id: string; name: string; available: boolean }[] };
  "provider:getModels": { args: [provider: string]; return: { id: string; name: string }[] };

  // Copilot Auth
  "copilot:startAuth": { args: []; return: { userCode: string; verificationUri: string } };
  "copilot:checkAuth": { args: []; return: { authenticated: boolean; username?: string } };
  "copilot:logout": { args: []; return: void };
}
```

---

## Ralph Loop Prompt

```
Implemente o sistema de múltiplos provedores para o PeriCode seguindo o plano em docs/PROVIDER_SYSTEM_PLAN.md.

## Contexto do Projeto
- Electron app (React frontend + Node.js backend)
- Atualmente usa Claude CLI via spawn (`electron/services/claude-cli.ts`)
- Estado em Zustand stores no frontend, SQLite no backend
- IPC via preload.ts com channel whitelist

## Providers a Implementar
1. **Claude** - Wrapper do CLI existente (já funciona)
2. **GitHub Copilot** - OAuth + API, acesso a GPT-5.2, GPT-4o, Claude, Gemini

## Ordem de Implementação

### 1. Criar interfaces base
Crie `electron/providers/types.ts` com:
- ProviderType = "claude" | "copilot"
- ProviderConfig
- ToolDefinition
- ToolCallMessage (unifica formato de eventos)
- AgentRunOptions
- ProviderAdapter interface

### 2. Criar Claude Adapter
Crie `electron/providers/claude-adapter.ts` que:
- Implementa ProviderAdapter
- Wrapa o spawnClaude existente de `claude-cli.ts`
- Converte CliEvent para ToolCallMessage
- getModels() retorna opus/sonnet/haiku
- Mantém comportamento idêntico ao atual

### 3. Criar Provider Registry
Crie `electron/providers/provider-registry.ts` que:
- Registra adapters disponíveis (claude, copilot)
- getAdapter(name) retorna adapter
- listProviders() retorna lista com status de disponibilidade

### 4. Refatorar Agent Orchestrator
Modifique `electron/services/agent-orchestrator.ts` para:
- Obter provider das settings ou do request
- Usar provider registry para obter adapter
- Chamar adapter.runAgent() ao invés de spawnClaude diretamente
- Manter toda lógica de estado, custos, IPC

### 5. Implementar Tool Executor
Crie `electron/providers/tools/` com implementações:

**read.ts:**
- Ler arquivo com fs.readFileSync
- Suportar offset/limit para arquivos grandes
- Retornar conteúdo com números de linha

**write.ts:**
- Escrever arquivo com fs.writeFileSync
- Criar diretórios se necessário

**edit.ts:**
- Buscar old_string no arquivo
- Substituir por new_string
- Suportar replace_all flag

**bash.ts:**
- spawn com timeout (2 min default)
- Capturar stdout/stderr
- Retornar exit code

**glob.ts:**
- Usar fast-glob para pattern matching
- Retornar lista de arquivos

**grep.ts:**
- Buscar pattern em arquivos
- Suportar regex
- Retornar matches com contexto

Crie `electron/providers/tool-executor.ts` que:
- Mapeia toolName para implementação
- Executa tool e retorna resultado
- Implementa permissionMode:
  - "full": executa direto
  - "acceptEdits": executa direto para leitura, pede confirmação para escrita
  - "ask": sempre pede confirmação via IPC

### 6. Criar Copilot Auth
Crie `electron/providers/copilot-auth.ts` com:
- initiateDeviceFlow() - retorna user_code e verification_uri
- pollForToken(deviceCode) - poll até usuário autorizar
- refreshToken() - renovar token expirado
- getStoredToken() - ler token do storage
- clearToken() - logout

### 7. Criar Copilot Adapter
Crie `electron/providers/copilot-adapter.ts` que:
- Implementa ProviderAdapter
- isAvailable() verifica se tem token válido
- getModels() retorna lista de modelos disponíveis:
  - gpt-5.2, gpt-5.1-codex, gpt-4o, gpt-4o-mini, o1, o1-mini
  - claude-sonnet-4.5, claude-opus-4.5, claude-haiku-4.5
  - gemini-2.5-pro
- runAgent() implementa loop de tool calling:
  1. Envia request para API com tools definidos
  2. Se receber tool_use, executa via tool-executor
  3. Envia tool_result de volta
  4. Repete até stop_reason != "tool_use"
- Usa streaming SSE para respostas

### 8. Atualizar Storage/Settings
Modifique `electron/services/storage.ts`:
- Adicionar defaultProvider em AppSettings
- Adicionar providers object com config de cada um
- Métodos para salvar/ler tokens de forma segura

### 9. Adicionar IPC handlers
Crie/modifique handlers para:
- "provider:list" - lista providers disponíveis
- "provider:getModels" - modelos de um provider
- "copilot:startAuth" - inicia OAuth flow
- "copilot:checkAuth" - verifica status
- "copilot:logout" - remove tokens

Adicione channels em preload.ts whitelist.

### 10. Criar UI de Providers
Modifique `src/components/settings/SettingsPanel.tsx`:
- Nova seção "Providers"
- Radio para selecionar provider padrão
- Status do Claude CLI (disponível/não disponível)
- Botão "Connect to GitHub" para Copilot
- Ao clicar, mostrar user_code e link para github.com/login/device
- Mostrar status: "Connected as @username" ou "Not connected"
- Dropdown para selecionar modelo padrão de cada provider

## Regras Importantes

1. SEMPRE rodar `npm run build` após mudanças para verificar tipos
2. Manter backward compatibility - Claude CLI deve funcionar igual
3. Não quebrar IPC channels existentes
4. Usar async generators para streaming
5. Tratar erros gracefully - mostrar mensagem útil ao usuário
6. Tokens devem ser tratados com cuidado (não logar, armazenar seguro)

## Arquivos de Referência
- `electron/services/claude-cli.ts` - Implementação atual do spawn
- `electron/services/agent-orchestrator.ts` - Orquestração de agentes
- `src/stores/agentStore.ts` - Estado do frontend
- `electron/preload.ts` - Whitelist de IPC channels

## Validação
Após cada fase:
1. `npm run build` deve passar
2. Testar que Claude CLI continua funcionando
3. Testar que streaming funciona no UI
4. Para Copilot: testar auth flow e chat básico
```

---

## Estimativa de Complexidade

| Fase | Descrição | Complexidade | Estimativa |
|------|-----------|--------------|------------|
| 1 | Interfaces base | Baixa | 1h |
| 2 | Claude Adapter | Média | 2h |
| 3 | Provider Registry | Baixa | 1h |
| 4 | Refatorar Orchestrator | Alta | 3h |
| 5 | Tool Executor | Alta | 5h |
| 6 | Copilot Auth | Média | 2h |
| 7 | Copilot Adapter | Alta | 4h |
| 8 | Storage/Settings | Média | 2h |
| 9 | IPC handlers | Baixa | 1h |
| 10 | UI | Média | 3h |

**Total estimado: 24 horas**

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Tool executor não ter paridade com Claude CLI | Média | Alto | Testar extensivamente cada tool, comparar outputs |
| Copilot auth expirar durante uso | Alta | Médio | Refresh automático, UI de re-auth clara |
| Rate limiting do Copilot API | Média | Médio | Implementar retry com backoff, mostrar erro amigável |
| Streaming parcial quebrar UI | Baixa | Alto | Buffer e flush apenas linhas completas de JSON |
| Modelo não disponível no Copilot | Baixa | Baixo | Verificar disponibilidade antes de selecionar |
