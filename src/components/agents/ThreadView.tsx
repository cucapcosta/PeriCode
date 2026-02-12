import React, { useEffect, useRef, useState, useCallback } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { useProjectStore } from "@/stores/projectStore";
import { useNotesStore } from "@/stores/notesStore";
import { ActivityIndicator } from "@/components/agents/ActivityIndicator";
import { ThreadNotesPanel } from "@/components/agents/ThreadNotesPanel";
import { DiffViewer } from "@/components/diff/DiffViewer";
import { ToolUseBlock } from "@/components/agents/ToolUseBlock";
import { ipc } from "@/lib/ipc-client";
import type { Skill, StreamingContentBlock, MessageContent, ImageAttachment } from "@/types/ipc";
import { estimateCost, getModelPricing } from "@/lib/model-pricing";

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatAbsoluteTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-1.5 right-1.5 px-2 py-1 rounded-md bg-background/80 border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-all focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
      title="Copy"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

export const ThreadView: React.FC = () => {
  const {
    activeThreadId,
    messages,
    streamingContent,
    threadCosts,
    errors,
    threads,
    sendMessage,
    cancelAgent,
  } = useAgentStore();
  const [input, setInput] = useState("");
  const [showDiff, setShowDiff] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSkills, setActiveSkills] = useState<Map<string, string[]>>(new Map());
  const [skillSuggestions, setSkillSuggestions] = useState<Skill[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [attachedImages, setAttachedImages] = useState<ImageAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [previewImage, setPreviewImage] = useState<ImageAttachment | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const userIsNearBottomRef = useRef(true);

  const { projects, activeProjectId } = useProjectStore();
  const activeProject = projects.find((p) => p.id === activeProjectId);

  // Slash commands definition
  const slashCommands = [
    { name: "code", description: "Open project in VSCode" },
    { name: "build", description: "Run project build command" },
    ...(import.meta.env.DEV ? [{ name: "rebuild", description: "Rebuild and restart PeriCode" }] : []),
    { name: "status", description: "Show git status" },
    { name: "add", description: "Stage all changes (git add .)" },
    { name: "commit", description: "Commit staged changes" },
    { name: "push", description: "Push to remote" },
    { name: "pull", description: "Pull from remote" },
    { name: "checkout", description: "Switch branch" },
    { name: "branch", description: "List branches" },
    ...(import.meta.env.DEV ? [{ name: "publish", description: "Publish release (version)" }] : []),
  ];
  const [buildOutput, setBuildOutput] = useState<{ success: boolean; output: string } | null>(null);
  const [gitOutput, setGitOutput] = useState<{ type: string; success: boolean; message: string } | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchInput, setBranchInput] = useState("");
  const [versionInput, setVersionInput] = useState("");
  const [commandSuggestions, setCommandSuggestions] = useState<typeof slashCommands>([]);
  const [showCommandSuggestions, setShowCommandSuggestions] = useState(false);

  const noteContent = useNotesStore((s) => activeThreadId ? s.notes.get(activeThreadId) : undefined);
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const threadMessages = activeThreadId
    ? messages.get(activeThreadId) || []
    : [];
  const streamingBlocks = activeThreadId
    ? streamingContent.get(activeThreadId) || []
    : [];
  const threadError = activeThreadId
    ? errors.get(activeThreadId) || null
    : null;
  const threadActiveSkills = activeThreadId
    ? activeSkills.get(activeThreadId) || []
    : [];
  const threadCostData = activeThreadId
    ? threadCosts.get(activeThreadId) || null
    : null;

  // Determine if the activity indicator should show
  const isRunning = activeThread?.status === "running";
  const showActivity =
    isRunning &&
    (streamingBlocks.length === 0 ||
      (streamingBlocks.length > 0 &&
        streamingBlocks[streamingBlocks.length - 1].type === "tool_use" &&
        streamingBlocks[streamingBlocks.length - 1].isComplete));

  const formatCost = (usd: number): string => {
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  };

  const formatTokens = (count: number): string => {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
  };

  const shortModelName = (modelId: string): string => {
    const m = modelId.match(/claude-(\w+)-([\d]+(?:-[\d]+)?)-\d{8}/);
    if (m) {
      const family = m[1];
      const version = m[2].replace("-", ".");
      return `${family}-${version}`;
    }
    return modelId.replace(/^claude-/, "");
  };

  // Load skills once
  useEffect(() => {
    ipc.invoke("skill:list").then(setSkills).catch(() => {});
  }, []);

  // Track if user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 80;
    userIsNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Smart auto-scroll: only scroll to bottom if user is already near bottom
  useEffect(() => {
    if (userIsNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadMessages, streamingBlocks]);

  // Detect $skill-name syntax and /command syntax in input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Detect /command at the start of input
    const slashMatch = val.match(/^\/(\S*)$/);
    if (slashMatch) {
      const query = slashMatch[1].toLowerCase();
      const matches = slashCommands.filter(
        (c) => c.name.toLowerCase().startsWith(query)
      );
      setCommandSuggestions(matches);
      setShowCommandSuggestions(matches.length > 0);
      setShowSuggestions(false);
      return;
    } else {
      setShowCommandSuggestions(false);
    }

    const dollarMatch = val.match(/\$(\S*)$/);
    if (dollarMatch) {
      const query = dollarMatch[1].toLowerCase();
      const matches = skills.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.name.toLowerCase().replace(/\s+/g, "-").includes(query)
      );
      setSkillSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const insertSkillReference = (skill: Skill) => {
    const slugName = skill.name.toLowerCase().replace(/\s+/g, "-");
    const newInput = input.replace(/\$\S*$/, `$${slugName} `);
    setInput(newInput);
    setShowSuggestions(false);

    if (activeThreadId) {
      setActiveSkills((prev) => {
        const updated = new Map(prev);
        const current = updated.get(activeThreadId) || [];
        if (!current.includes(skill.id)) {
          updated.set(activeThreadId, [...current, skill.id]);
        }
        return updated;
      });
    }

    inputRef.current?.focus();
  };

  const detachSkill = (skillId: string) => {
    if (!activeThreadId) return;
    setActiveSkills((prev) => {
      const updated = new Map(prev);
      const current = updated.get(activeThreadId) || [];
      updated.set(
        activeThreadId,
        current.filter((id) => id !== skillId)
      );
      return updated;
    });
  };

  const getSkillById = (id: string): Skill | undefined =>
    skills.find((s) => s.id === id);

  const executeCommand = async (command: string) => {
    switch (command) {
      case "code": {
        if (!activeProject?.path) return;
        try {
          await ipc.invoke("command:openVSCode", activeProject.path);
        } catch {
          // fallback: silently fail
        }
        break;
      }
      case "build": {
        if (!activeProject?.path) return;
        const buildCommand = activeProject.settings?.buildCommand;
        if (!buildCommand) {
          setBuildOutput({ success: false, output: "No build command configured. Set it in Project Settings." });
          return;
        }
        setBuildOutput({ success: true, output: `Running: ${buildCommand}...` });
        try {
          const result = await ipc.invoke("command:build", activeProject.path, buildCommand);
          setBuildOutput(result);
        } catch (err) {
          setBuildOutput({ success: false, output: `Build failed: ${err}` });
        }
        break;
      }
      case "rebuild": {
        if (!activeProject?.path) return;
        // Check if this is the PeriCode project
        const isPeriCode = activeProject.name.toLowerCase() === "pericode" ||
          activeProject.path.toLowerCase().includes("pericode");
        if (!isPeriCode) {
          setBuildOutput({ success: false, output: "/rebuild is only for PeriCode. Use /build for other projects." });
          return;
        }
        try {
          await ipc.invoke("command:rebuild", activeProject.path);
        } catch {
          // fallback: silently fail
        }
        break;
      }
      case "status": {
        if (!activeProjectId) return;
        setGitOutput({ type: "status", success: true, message: "Fetching git status..." });
        try {
          const status = await ipc.invoke("git:status", activeProjectId);
          if (!status) {
            setGitOutput({ type: "status", success: false, message: "Failed to get git status" });
            return;
          }
          const lines: string[] = [];
          lines.push(`Branch: ${status.current || "unknown"}`);
          if (status.ahead > 0) lines.push(`Ahead: ${status.ahead}`);
          if (status.behind > 0) lines.push(`Behind: ${status.behind}`);
          if (status.staged.length > 0) lines.push(`Staged (${status.staged.length}): ${status.staged.slice(0, 5).join(", ")}${status.staged.length > 5 ? "..." : ""}`);
          if (status.modified.length > 0) lines.push(`Modified (${status.modified.length}): ${status.modified.slice(0, 5).join(", ")}${status.modified.length > 5 ? "..." : ""}`);
          if (status.untracked.length > 0) lines.push(`Untracked (${status.untracked.length}): ${status.untracked.slice(0, 5).join(", ")}${status.untracked.length > 5 ? "..." : ""}`);
          if (status.staged.length === 0 && status.modified.length === 0 && status.untracked.length === 0) {
            lines.push("Working tree clean");
          }
          setGitOutput({ type: "status", success: true, message: lines.join("\n") });
        } catch (err) {
          setGitOutput({ type: "status", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "add": {
        if (!activeProjectId) return;
        setGitOutput({ type: "add", success: true, message: "Staging all changes..." });
        try {
          const result = await ipc.invoke("git:add", activeProjectId, ["."]);
          if (result.success) {
            setGitOutput({ type: "add", success: true, message: "All changes staged successfully" });
          } else {
            setGitOutput({ type: "add", success: false, message: result.error || "Failed to stage changes" });
          }
        } catch (err) {
          setGitOutput({ type: "add", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "commit": {
        if (!activeProjectId) return;
        // If no commit message, prompt for one
        if (!commitMessage.trim()) {
          setGitOutput({ type: "commit", success: false, message: "Enter a commit message below and run /commit again" });
          return;
        }
        setGitOutput({ type: "commit", success: true, message: "Committing..." });
        try {
          const result = await ipc.invoke("git:commit", activeProjectId, commitMessage.trim());
          if (result.success) {
            setGitOutput({ type: "commit", success: true, message: `Committed: ${result.hash || ""}` });
            setCommitMessage("");
          } else {
            setGitOutput({ type: "commit", success: false, message: result.error || "Commit failed" });
          }
        } catch (err) {
          setGitOutput({ type: "commit", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "push": {
        if (!activeProjectId) return;
        setGitOutput({ type: "push", success: true, message: "Pushing to remote..." });
        try {
          const result = await ipc.invoke("git:push", activeProjectId);
          if (result.success) {
            setGitOutput({ type: "push", success: true, message: "Pushed successfully" });
          } else {
            setGitOutput({ type: "push", success: false, message: result.error || "Push failed" });
          }
        } catch (err) {
          setGitOutput({ type: "push", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "pull": {
        if (!activeProjectId) return;
        setGitOutput({ type: "pull", success: true, message: "Pulling from remote..." });
        try {
          const result = await ipc.invoke("git:pull", activeProjectId);
          if (result.success) {
            setGitOutput({ type: "pull", success: true, message: result.summary || "Pulled successfully" });
          } else {
            setGitOutput({ type: "pull", success: false, message: result.error || "Pull failed" });
          }
        } catch (err) {
          setGitOutput({ type: "pull", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "checkout": {
        if (!activeProjectId) return;
        if (!branchInput.trim()) {
          // Show branch list first
          setGitOutput({ type: "checkout", success: true, message: "Loading branches..." });
          try {
            const result = await ipc.invoke("git:branch", activeProjectId, "list");
            if (result.success && result.branches) {
              const branchList = result.branches.map(b => b === result.current ? `* ${b}` : `  ${b}`).join("\n");
              setGitOutput({ type: "checkout", success: false, message: `Enter branch name to checkout:\n\n${branchList}` });
            } else {
              setGitOutput({ type: "checkout", success: false, message: result.error || "Failed to list branches" });
            }
          } catch (err) {
            setGitOutput({ type: "checkout", success: false, message: `Error: ${err}` });
          }
          return;
        }
        setGitOutput({ type: "checkout", success: true, message: `Switching to ${branchInput}...` });
        try {
          const result = await ipc.invoke("git:checkout", activeProjectId, branchInput.trim());
          if (result.success) {
            setGitOutput({ type: "checkout", success: true, message: `Switched to branch '${branchInput.trim()}'` });
            setBranchInput("");
          } else {
            setGitOutput({ type: "checkout", success: false, message: result.error || "Checkout failed" });
          }
        } catch (err) {
          setGitOutput({ type: "checkout", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "branch": {
        if (!activeProjectId) return;
        setGitOutput({ type: "branch", success: true, message: "Listing branches..." });
        try {
          const result = await ipc.invoke("git:branch", activeProjectId, "list");
          if (result.success && result.branches) {
            const branchList = result.branches.map(b => b === result.current ? `* ${b} (current)` : `  ${b}`).join("\n");
            setGitOutput({ type: "branch", success: true, message: `Branches:\n${branchList}` });
          } else {
            setGitOutput({ type: "branch", success: false, message: result.error || "Failed to list branches" });
          }
        } catch (err) {
          setGitOutput({ type: "branch", success: false, message: `Error: ${err}` });
        }
        break;
      }
      case "publish": {
        if (!activeProjectId) return;
        // If no version, prompt for one
        if (!versionInput.trim()) {
          setGitOutput({ type: "publish", success: false, message: "Enter the version to publish (e.g., 0.4, 0.4.1, 1.0.0):" });
          return;
        }
        setGitOutput({ type: "publish", success: true, message: `Publishing version ${versionInput}...\n\nThis will:\n1. Update package.json version\n2. Update Sidebar display version\n3. Stage and commit changes\n4. Push to remote\n5. Create and push version tag\n6. Trigger GitHub Actions release workflow` });
        try {
          const result = await ipc.invoke("git:publish", activeProjectId, versionInput.trim());
          if (result.success) {
            const stepsOutput = result.steps.map(s => `${s.success ? "✓" : "✗"} ${s.step}: ${s.message}`).join("\n");
            setGitOutput({ type: "publish", success: true, message: `Release v${versionInput.trim()} published!\n\n${stepsOutput}\n\n🚀 GitHub Actions will now build and create the release.` });
            setVersionInput("");
          } else {
            const stepsOutput = result.steps.map(s => `${s.success ? "✓" : "✗"} ${s.step}: ${s.message}`).join("\n");
            setGitOutput({ type: "publish", success: false, message: `${result.error}\n\n${stepsOutput}` });
          }
        } catch (err) {
          setGitOutput({ type: "publish", success: false, message: `Error: ${err}` });
        }
        break;
      }
    }
  };

  const selectCommand = (cmd: typeof slashCommands[number]) => {
    setInput(`/${cmd.name}`);
    setShowCommandSuggestions(false);
    inputRef.current?.focus();
  };

  const handleSend = async () => {
    if ((!input.trim() && attachedImages.length === 0) || !activeThreadId) return;
    const msg = input.trim() || (attachedImages.length > 0 ? "Analyze these images" : "");

    // Intercept slash commands
    const cmdMatch = msg.match(/^\/(\S+)$/);
    if (cmdMatch) {
      const cmdName = cmdMatch[1].toLowerCase();
      const validCmd = slashCommands.find((c) => c.name === cmdName);
      if (validCmd) {
        setInput("");
        setShowCommandSuggestions(false);
        await executeCommand(cmdName);
        return;
      }
    }

    const imagePaths = attachedImages.length > 0 ? attachedImages.map((img) => img.filePath) : undefined;
    setInput("");
    setAttachedImages([]);
    setShowSuggestions(false);
    setShowCommandSuggestions(false);
    // Force scroll to bottom when sending
    userIsNearBottomRef.current = true;
    await sendMessage(activeThreadId, msg, imagePaths);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") {
      setShowSuggestions(false);
      setShowCommandSuggestions(false);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    // Check if clipboard has image data
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));

    if (imageItem) {
      e.preventDefault();

      // Read the image blob directly from the clipboard in the renderer
      const blob = imageItem.getAsFile();
      if (!blob) return;

      // Convert blob to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        if (!base64Data) return;

        // Send the base64 data to main process to save as temp file
        const attachment = await ipc.invoke("image:saveFromBase64", base64Data, blob.type);
        if (attachment) {
          setAttachedImages((prev) => [...prev, attachment]);
        }
      };
      reader.readAsDataURL(blob);
    }
    // If no image, let the default paste behavior handle text
  };

  const handlePickImages = async () => {
    const images = await ipc.invoke("image:pick");
    if (images) {
      setAttachedImages((prev) => [...prev, ...images]);
    }
  };

  const removeAttachedImage = (index: number) => {
    setAttachedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const imageFiles = files.filter((f) =>
      /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(f.name)
    );

    for (const file of imageFiles) {
      // Read file content as base64 in renderer, then send to main to save
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        if (!base64Data) return;

        const attachment = await ipc.invoke("image:saveFromBase64", base64Data, file.type);
        if (attachment) {
          attachment.fileName = file.name;
          setAttachedImages((prev) => [...prev, attachment]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    for (const file of files) {
      // Read file content as base64 in renderer, then send to main to save
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        if (!base64Data) return;

        const attachment = await ipc.invoke("image:saveFromBase64", base64Data, file.type);
        if (attachment) {
          // Update fileName to use the original name
          attachment.fileName = file.name;
          setAttachedImages((prev) => [...prev, attachment]);
        }
      };
      reader.readAsDataURL(file);
    }

    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  const renderContentBlock = (block: MessageContent, i: number) => (
    <div key={i}>
      {block.type === "text" && (
        <div className="group relative">
          <p className="text-sm whitespace-pre-wrap">{block.text}</p>
          {block.text && block.text.length > 50 && (
            <CopyButton text={block.text} />
          )}
        </div>
      )}
      {block.type === "tool_use" && block.toolName && (
        <ToolUseBlock toolName={block.toolName} toolInput={block.toolInput} />
      )}
      {block.type === "tool_result" && (
        <div className="group relative text-xs mt-1 p-2 bg-background/50 rounded border border-border max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono">
            {block.toolOutput}
          </pre>
          {block.toolOutput && block.toolOutput.length > 20 && (
            <CopyButton text={block.toolOutput} />
          )}
        </div>
      )}
    </div>
  );

  const renderStreamingBlock = (block: StreamingContentBlock, i: number, isLast: boolean) => (
    <div key={block.id}>
      {block.type === "text" && (
        <div className="group relative">
          <p className="text-sm whitespace-pre-wrap">
            {block.text}
            {isLast && !block.isComplete && (
              <span className="animate-pulse">|</span>
            )}
          </p>
          {block.text && block.isComplete && block.text.length > 50 && (
            <CopyButton text={block.text} />
          )}
        </div>
      )}
      {block.type === "tool_use" && block.toolName && (
        <ToolUseBlock toolName={block.toolName} toolInput={block.toolInput} />
      )}
      {block.type === "tool_result" && (
        <div className="group relative text-xs mt-1 p-2 bg-background/50 rounded border border-border max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap font-mono">
            {block.toolOutput}
          </pre>
          {block.toolOutput && block.toolOutput.length > 20 && (
            <CopyButton text={block.toolOutput} />
          )}
        </div>
      )}
    </div>
  );

  if (!activeThreadId || !activeThread) {
    return (
      <div className="flex-1 flex items-center justify-center animate-fade-in">
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-foreground">
            Welcome to PeriCode
          </h2>
          <p className="mt-2 text-muted-foreground">
            Select a thread or create a new agent to get started
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Thread header */}
      <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-shrink-0 min-w-0">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            activeThread.status === "running"
              ? "bg-green-500 animate-pulse"
              : activeThread.status === "completed"
                ? "bg-blue-500"
                : activeThread.status === "failed"
                  ? "bg-red-500"
                  : "bg-yellow-500"
          }`}
        />
        <h2 className="text-sm font-semibold text-foreground truncate min-w-0 flex-1">
          {activeThread.title || "Untitled Thread"}
        </h2>

        {/* Active skills badges */}
        {threadActiveSkills.length > 0 && (
          <div className="flex items-center gap-1">
            {threadActiveSkills.map((skillId) => {
              const skill = getSkillById(skillId);
              if (!skill) return null;
              return (
                <span
                  key={skillId}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-medium"
                >
                  {skill.name}
                  <button
                    onClick={() => detachSkill(skillId)}
                    className="text-primary/60 hover:text-primary rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {activeThread.worktreePath && (
          <button
            onClick={() => setShowDiff(true)}
            className="flex-shrink-0 px-2.5 py-1 rounded-md border border-border text-xs font-medium text-foreground hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Diff
          </button>
        )}
        <button
          onClick={() => setShowNotes((v) => !v)}
          className={`flex-shrink-0 px-2.5 py-1 rounded-md border text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            showNotes
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border text-foreground hover:bg-accent"
          }`}
          title="Anotações privadas"
        >
          Notes
          {!showNotes && noteContent && noteContent.length > 0 && (
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary ml-1 -mt-1" />
          )}
        </button>
        <span className="flex-shrink-0 text-xs text-muted-foreground capitalize">
          {activeThread.status}
        </span>
      </div>

      {/* Thread Notes */}
      {showNotes && activeThreadId && (
        <div className="animate-slide-in-right">
          <ThreadNotesPanel threadId={activeThreadId} />
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-2 md:p-4 space-y-3 md:space-y-4"
      >
        {threadMessages.map((msg, msgIdx) => (
          <div
            key={msg.id}
            className={`flex animate-fade-in-up ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            style={{ animationDelay: `${Math.min(msgIdx * 30, 300)}ms` }}
          >
            <div
              className={`max-w-[95%] sm:max-w-[85%] md:max-w-[80%] lg:max-w-[75%] rounded-lg px-3 md:px-4 py-2 md:py-3 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {/* Image attachments */}
              {msg.imagePaths && msg.imagePaths.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {msg.imagePaths.map((imgPath, i) => (
                    <div key={i} className="rounded overflow-hidden border border-white/20 max-w-[120px]">
                      <div className="text-[9px] px-1 py-0.5 bg-black/20 truncate" title={imgPath}>
                        {imgPath.replace(/\\/g, "/").split("/").pop()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {msg.content.map((block: MessageContent, i: number) =>
                renderContentBlock(block, i)
              )}
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                {/* Timestamp */}
                <span
                  className="text-[10px] opacity-50 cursor-default"
                  title={formatAbsoluteTime(msg.createdAt)}
                >
                  {relativeTime(msg.createdAt)}
                </span>
                {/* Cost info for assistant messages */}
                {msg.role === "assistant" && (msg.costUsd !== null || msg.tokensIn !== null || msg.tokensOut !== null) && (
                  <span className="text-[10px] opacity-60 font-mono bg-black/10 px-1.5 py-0.5 rounded">
                    {msg.tokensIn !== null && msg.tokensOut !== null && (
                      <span className="text-blue-300">{formatTokens(msg.tokensIn)}in / {formatTokens(msg.tokensOut)}out</span>
                    )}
                    {msg.costUsd !== null && msg.costUsd > 0 && (
                      <span className="text-green-300">{msg.tokensIn !== null ? " · " : ""}{formatCost(msg.costUsd)}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming content blocks */}
        {streamingBlocks.length > 0 && (
          <div className="flex justify-start animate-fade-in">
            <div className="max-w-[95%] sm:max-w-[85%] md:max-w-[80%] lg:max-w-[75%] rounded-lg px-3 md:px-4 py-2 md:py-3 bg-muted text-foreground">
              {streamingBlocks.map((block, i) =>
                renderStreamingBlock(block, i, i === streamingBlocks.length - 1)
              )}
            </div>
          </div>
        )}

        {/* Activity indicator */}
        {showActivity && <ActivityIndicator />}

        {/* Error banner */}
        {threadError && activeThread?.status === "failed" && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 animate-fade-in-up">
            <p className="text-sm font-medium text-red-400">Agent Error</p>
            <p className="text-sm text-red-300/80 mt-1 whitespace-pre-wrap font-mono">
              {threadError}
            </p>
          </div>
        )}

        {/* Build output */}
        {buildOutput && (
          <div className={`rounded-lg border px-4 py-3 animate-fade-in-up ${
            buildOutput.success
              ? "border-green-500/30 bg-green-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-sm font-medium ${buildOutput.success ? "text-green-400" : "text-red-400"}`}>
                {buildOutput.success ? "Build Output" : "Build Failed"}
              </p>
              <button
                onClick={() => setBuildOutput(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
            <pre className={`text-xs whitespace-pre-wrap font-mono max-h-48 overflow-auto ${
              buildOutput.success ? "text-green-300/80" : "text-red-300/80"
            }`}>
              {buildOutput.output}
            </pre>
          </div>
        )}

        {/* Git command output */}
        {gitOutput && (
          <div className={`rounded-lg border px-4 py-3 animate-fade-in-up ${
            gitOutput.success
              ? "border-cyan-500/30 bg-cyan-500/10"
              : "border-red-500/30 bg-red-500/10"
          }`}>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-sm font-medium flex items-center gap-2 ${gitOutput.success ? "text-cyan-400" : "text-red-400"}`}>
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                git {gitOutput.type}
              </p>
              <button
                onClick={() => setGitOutput(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </button>
            </div>
            <pre className={`text-xs whitespace-pre-wrap font-mono max-h-48 overflow-auto ${
              gitOutput.success ? "text-cyan-300/80" : "text-red-300/80"
            }`}>
              {gitOutput.message}
            </pre>
            {/* Commit message input */}
            {gitOutput.type === "commit" && !gitOutput.success && gitOutput.message.includes("Enter a commit message") && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Commit message..."
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commitMessage.trim()) {
                      executeCommand("commit");
                    }
                  }}
                />
                <button
                  onClick={() => executeCommand("commit")}
                  disabled={!commitMessage.trim()}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  Commit
                </button>
              </div>
            )}
            {/* Branch checkout input */}
            {gitOutput.type === "checkout" && !gitOutput.success && gitOutput.message.includes("Enter branch name") && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={branchInput}
                  onChange={(e) => setBranchInput(e.target.value)}
                  placeholder="Branch name..."
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && branchInput.trim()) {
                      executeCommand("checkout");
                    }
                  }}
                />
                <button
                  onClick={() => executeCommand("checkout")}
                  disabled={!branchInput.trim()}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  Checkout
                </button>
              </div>
            )}
            {/* Version input for publish */}
            {gitOutput.type === "publish" && !gitOutput.success && gitOutput.message.includes("Enter the version") && (
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={versionInput}
                  onChange={(e) => setVersionInput(e.target.value)}
                  placeholder="Version (e.g., 0.4, 0.4.1, 1.0.0)..."
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && versionInput.trim()) {
                      executeCommand("publish");
                    }
                  }}
                />
                <button
                  onClick={() => executeCommand("publish")}
                  disabled={!versionInput.trim()}
                  className="px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  Publish
                </button>
              </div>
            )}
          </div>
        )}

        {/* Thread cost summary */}
        {threadCostData && (activeThread.status === "completed" || activeThread.status === "failed") && threadCostData.totalCostUsd > 0 && (
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 animate-fade-in-up">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-foreground">Usage Summary</span>
              <div className="flex items-center gap-2 text-xs font-mono font-semibold">
                <span className="text-foreground" title="CLI reported">
                  {formatCost(threadCostData.totalCostUsd)}
                </span>
                <span className="text-muted-foreground/50">|</span>
                <span className="text-blue-400" title="Calculated from pricing">
                  {formatCost(
                    Object.entries(threadCostData.modelUsage).reduce(
                      (sum, [model, u]) =>
                        sum + estimateCost(model, u.inputTokens, u.outputTokens, u.cacheCreationInputTokens, u.cacheReadInputTokens),
                      0
                    )
                  )}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
              <span className="font-mono">
                {formatTokens(threadCostData.totalTokensIn)} in
              </span>
              <span className="font-mono">
                {formatTokens(threadCostData.totalTokensOut)} out
              </span>
              <span className="ml-auto text-[9px] text-muted-foreground/50">CLI | <span className="text-blue-400/60">Calc</span></span>
            </div>
            {Object.keys(threadCostData.modelUsage).length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-2 mt-1">
                {Object.entries(threadCostData.modelUsage)
                  .sort(([, a], [, b]) => b.costUsd - a.costUsd)
                  .map(([model, usage]) => {
                    const cacheTokens = usage.cacheReadInputTokens + usage.cacheCreationInputTokens;
                    const pricing = getModelPricing(model);
                    const calcCost = estimateCost(
                      model,
                      usage.inputTokens,
                      usage.outputTokens,
                      usage.cacheCreationInputTokens,
                      usage.cacheReadInputTokens
                    );
                    return (
                      <div key={model} className="text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground font-medium">
                            {shortModelName(model)}
                          </span>
                          <div className="flex items-center gap-2 font-mono">
                            <span className="text-foreground">{formatCost(usage.costUsd)}</span>
                            <span className="text-muted-foreground/40">|</span>
                            <span className="text-blue-400">{formatCost(calcCost)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60 mt-0.5 ml-2">
                          <span>{formatTokens(usage.inputTokens)}in <span className="font-mono">${pricing.inputPerMTok}/M</span></span>
                          <span>{formatTokens(usage.outputTokens)}out <span className="font-mono">${pricing.outputPerMTok}/M</span></span>
                          {cacheTokens > 0 && (
                            <span>+{formatTokens(cacheTokens)}cache</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <div
        className={`p-3 border-t relative flex-shrink-0 transition-colors ${
          isDragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg z-10 pointer-events-none">
            <span className="text-sm font-medium text-primary">Drop images here</span>
          </div>
        )}

        {/* Command suggestions popup */}
        {showCommandSuggestions && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-auto animate-scale-in">
            {commandSuggestions.map((cmd) => (
              <button
                key={cmd.name}
                onClick={() => selectCommand(cmd)}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2"
              >
                <span className="font-mono font-medium text-primary">/{cmd.name}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {cmd.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Skill suggestions popup */}
        {showSuggestions && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-auto animate-scale-in">
            {skillSuggestions.map((skill) => (
              <button
                key={skill.id}
                onClick={() => insertSkillReference(skill)}
                className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-2"
              >
                <span className="font-medium">${skill.name.toLowerCase().replace(/\s+/g, "-")}</span>
                <span className="text-xs text-muted-foreground truncate">
                  {skill.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Attached images preview */}
        {attachedImages.length > 0 && (
          <div className="mb-3 p-2 bg-muted/30 rounded-lg border border-border animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                {attachedImages.length} image{attachedImages.length > 1 ? "s" : ""} attached
              </span>
              <button
                onClick={() => setAttachedImages([])}
                className="text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                Clear all
              </button>
            </div>
            <div className="flex flex-wrap gap-3">
              {attachedImages.map((img, i) => (
                <div
                  key={`${img.filePath}-${i}`}
                  className="group relative rounded-lg border border-border overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setPreviewImage(img)}
                  title={img.filePath}
                >
                  <img
                    src={img.base64Thumbnail}
                    alt={img.fileName}
                    className="w-24 h-24 object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                    <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-medium transition-opacity">
                      Preview
                    </span>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
                    <span className="text-[10px] text-white truncate block font-medium" title={img.fileName}>
                      {img.fileName}
                    </span>
                    <span className="text-[9px] text-white/70">
                      {formatFileSize(img.sizeBytes)}
                    </span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAttachedImage(i);
                    }}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/90 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                    title="Remove"
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml"
            multiple
            onChange={handleFileInputChange}
            className="hidden"
          />
          <button
            onClick={handlePickImages}
            className="flex-shrink-0 px-2 py-2 rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Attach images"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="5" cy="6" r="1.2" stroke="currentColor" strokeWidth="1"/>
              <path d="M1.5 11L5 8L8 10.5L11 7.5L14.5 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={attachedImages.length > 0 ? "Describe the images..." : "Send a message... (/ for commands, $ for skills, Ctrl+V to paste image)"}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-input bg-background px-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
          />
          {activeThread?.status === "running" ? (
            <button
              onClick={() => activeThreadId && cancelAgent(activeThreadId)}
              className="px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 transition-colors"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim() && attachedImages.length === 0}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          )}
        </div>
      </div>

      {showDiff && activeThread && (
        <DiffViewer
          thread={activeThread}
          onClose={() => setShowDiff(false)}
        />
      )}

      {/* Image preview modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={previewImage.base64Thumbnail}
              alt={previewImage.fileName}
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-4 rounded-b-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium">{previewImage.fileName}</p>
                  <p className="text-white/70 text-sm">{formatFileSize(previewImage.sizeBytes)}</p>
                </div>
                <button
                  onClick={() => setPreviewImage(null)}
                  className="px-4 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <button
              onClick={() => setPreviewImage(null)}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center transition-colors"
            >
              x
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
