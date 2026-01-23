import { ItemView, WorkspaceLeaf, MarkdownRenderer, setIcon } from 'obsidian';
import type ClaudeCodePlugin from '../main';
import { ChatMessage, ClaudeStreamMessage, getToolInfo } from '../types';

// Track active tool calls for UI state
interface ActiveToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  startTime: number;
  element: HTMLElement;
}

export const VIEW_TYPE_CHAT_PANEL = 'claude-chat-panel';

export class ChatPanelView extends ItemView {
  private plugin: ClaudeCodePlugin;
  private mainContentEl: HTMLElement;
  private historyPanelEl: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLButtonElement;
  private abortBtn: HTMLButtonElement;
  private skillSelectEl: HTMLSelectElement;
  private msgCountEl: HTMLElement;
  private currentSessionId: string | null = null;
  private selectedSkill: string = '';
  private currentResponseEl: HTMLElement | null = null;
  private accumulatedContent: string = '';
  private showingHistory: boolean = false;
  private includeFileContext: boolean = true;
  private includeWebContext: boolean = true;
  private activeToolCalls: Map<string, ActiveToolCall> = new Map();

  constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_CHAT_PANEL;
  }

  getDisplayText(): string {
    return 'AI CLI Chat';
  }

  getIcon(): string {
    return 'message-circle';
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('claude-chat-container');

    this.createHeader(container);
    this.historyPanelEl = container.createDiv('claude-history-panel claude-hidden');
    this.mainContentEl = container.createDiv('claude-main-content');
    this.createSkillBar(this.mainContentEl);
    this.messagesEl = this.mainContentEl.createDiv('claude-messages');
    this.createInputArea(this.mainContentEl);
    this.setupEventListeners();
    this.initializeSession();
    await Promise.resolve(); // Satisfy async requirement
  }

  private createHeader(container: HTMLElement): void {
    const header = container.createDiv('claude-chat-header');

    const leftControls = header.createDiv('claude-header-left');
    const historyBtn = leftControls.createEl('button', {
      cls: 'claude-btn claude-btn-icon',
      attr: { 'aria-label': 'Chat history' },
    });
    setIcon(historyBtn, 'menu');
    historyBtn.addEventListener('click', () => this.toggleHistory());

    leftControls.createEl('span', { text: 'AI CLI Chat', cls: 'claude-header-title' });

    // Message count indicator
    this.msgCountEl = leftControls.createEl('span', { cls: 'claude-msg-count' });

    const controls = header.createDiv('claude-header-controls');
    const newBtn = controls.createEl('button', {
      text: 'New',
      cls: 'claude-btn claude-btn-secondary claude-btn-small',
    });
    newBtn.addEventListener('click', () => this.startNewSession());
  }

  private updateMessageCount(): void {
    const session = this.plugin.sessionManager.getSession(this.currentSessionId!);
    if (session && this.msgCountEl) {
      const count = session.messages.length;
      // Show warning color when conversation is getting long
      const isLong = count > 20;
      const isVeryLong = count > 40;
      this.msgCountEl.textContent = `${count} msgs`;
      this.msgCountEl.toggleClass('warning', isLong && !isVeryLong);
      this.msgCountEl.toggleClass('danger', isVeryLong);
      this.msgCountEl.title = isVeryLong
        ? 'Conversation is very long - consider starting a new chat'
        : isLong
          ? 'Conversation is getting long'
          : '';
    }
  }

  private toggleHistory(): void {
    this.showingHistory = !this.showingHistory;
    if (this.showingHistory) {
      this.historyPanelEl.removeClass('claude-hidden');
      this.mainContentEl.addClass('claude-hidden');
      this.renderHistoryPanel();
    } else {
      this.historyPanelEl.addClass('claude-hidden');
      this.mainContentEl.removeClass('claude-hidden');
    }
  }

  private renderHistoryPanel(): void {
    this.historyPanelEl.empty();

    const header = this.historyPanelEl.createDiv('claude-history-header');
    header.createEl('span', { text: 'Chat history', cls: 'claude-history-title' });

    const listEl = this.historyPanelEl.createDiv('claude-history-list');
    const sessions = this.plugin.sessionManager.getAllSessions();

    if (sessions.length === 0) {
      listEl.createDiv({ text: 'No previous chats.', cls: 'claude-history-empty' });
      return;
    }

    // Sort by most recent first
    sessions.sort((a, b) => b.createdAt - a.createdAt);

    sessions.forEach((session) => {
      const itemEl = listEl.createDiv({
        cls: `claude-history-item ${session.id === this.currentSessionId ? 'active' : ''}`,
      });

      const infoEl = itemEl.createDiv('claude-history-info');

      // Get first user message as preview
      const firstUserMsg = session.messages.find((m) => m.role === 'user');
      const preview = firstUserMsg?.content?.substring(0, 50) || 'New chat';

      infoEl.createDiv({ text: preview + (preview.length >= 50 ? '...' : ''), cls: 'claude-history-preview' });

      const date = new Date(session.createdAt);
      const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      infoEl.createDiv({ text: `${dateStr} · ${session.messages.length} msgs`, cls: 'claude-history-meta' });

      // Click to load
      itemEl.addEventListener('click', () => {
        this.loadSession(session.id);
        this.toggleHistory();
      });

      // Delete button
      const deleteBtn = itemEl.createEl('button', {
        cls: 'claude-history-delete',
        attr: { 'aria-label': 'Delete chat' },
      });
      setIcon(deleteBtn, 'x');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.deleteSession(session.id);
      });
    });
  }

  private async deleteSession(sessionId: string): Promise<void> {
    await this.plugin.sessionManager.deleteSession(sessionId);
    if (sessionId === this.currentSessionId) {
      this.startNewSession();
    }
    this.renderHistoryPanel();
  }

  private createSkillBar(container: HTMLElement): void {
    const skillBar = container.createDiv('claude-skill-bar');

    const label = skillBar.createSpan({ cls: 'claude-skill-label' });
    label.textContent = 'Mode:';

    this.skillSelectEl = skillBar.createEl('select', {
      cls: 'claude-skill-select',
    });

    const availableSkills = this.plugin.skillLoader.getSkills();
    availableSkills.forEach((skill) => {
      const option = this.skillSelectEl.createEl('option', {
        text: `${skill.icon} ${skill.name}`,
        value: skill.id,
      });
      option.title = skill.description;
    });

    this.skillSelectEl.addEventListener('change', () => {
      this.selectedSkill = this.skillSelectEl.value;
      this.updateSkillHint();
    });

    // Skill description hint
    const hint = skillBar.createDiv('claude-skill-hint');
    hint.id = 'skill-hint';
    this.updateSkillHint();
  }

  private updateSkillHint(): void {
    const hint = this.contentEl.querySelector('#skill-hint') as HTMLElement;
    if (hint) {
      const availableSkills = this.plugin.skillLoader.getSkills();
      const skill = availableSkills.find((s) => s.id === this.selectedSkill);
      hint.textContent = skill?.description || '';
    }
  }

  private createInputArea(container: HTMLElement): void {
    const inputWrapper = container.createDiv('claude-input-wrapper');

    const contextBar = inputWrapper.createDiv('claude-context-bar');
    this.createContextToggle(contextBar);

    this.inputEl = inputWrapper.createEl('textarea', {
      placeholder: 'Ask anything...',
      cls: 'claude-input',
    });
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void this.sendMessage();
      }
    });

    const btnContainer = inputWrapper.createDiv('claude-btn-container');

    this.sendBtn = btnContainer.createEl('button', {
      text: 'Send',
      cls: 'claude-btn claude-btn-primary',
    });
    this.sendBtn.addEventListener('click', () => void this.sendMessage());

    this.abortBtn = btnContainer.createEl('button', {
      text: 'Stop',
      cls: 'claude-btn claude-btn-danger claude-hidden',
    });
    this.abortBtn.addEventListener('click', () => this.abortRequest());
  }

  private setupEventListeners(): void {
    this.plugin.cliService.on('message', (msg) => {
      this.handleStreamMessage(msg as ClaudeStreamMessage);
    });

    this.plugin.cliService.on('partial', (content) => {
      this.updateStreamingMessage(content as string);
    });
  }

  private initializeSession(): void {
    // Session manager is already initialized in main.ts
    let session = this.plugin.sessionManager.getActiveSession();
    if (!session) {
      // Try to load the most recent session
      const allSessions = this.plugin.sessionManager.getAllSessions();
      if (allSessions.length > 0) {
        session = allSessions[0]; // Already sorted by updatedAt descending
        this.plugin.sessionManager.setActiveSession(session.id);
      } else {
        session = this.plugin.sessionManager.createSession();
      }
    }
    this.currentSessionId = session.id;
    this.renderMessages(session.messages);
    this.updateMessageCount();
  }

  async sendMessage(): Promise<void> {
    const rawPrompt = this.inputEl.value.trim();
    if (!rawPrompt) return;

    // If agent is already running, queue input to send as follow-up when done
    if (this.plugin.cliService.isRunning()) {
      const queued = this.plugin.cliService.queueInput(rawPrompt);
      if (queued) {
        // Show the user's input in the chat (it will be sent after current execution)
        const userMessage: ChatMessage = {
          id: this.generateId(),
          role: 'user',
          content: rawPrompt,
          timestamp: Date.now(),
        };
        this.plugin.sessionManager.addMessage(this.currentSessionId!, userMessage);
        this.appendMessage(userMessage);
        this.inputEl.value = '';
        this.updateMessageCount();
        // Show indicator that message is queued
        this.appendQueuedIndicator();
      }
      return;
    }

    // Get skill content if selected
    let prompt = rawPrompt;
    let skillSystemPrompt: string | undefined;
    if (this.selectedSkill) {
      const skillContent = this.plugin.skillLoader.getSkillContent(this.selectedSkill);
      if (skillContent) {
        skillSystemPrompt = skillContent;
      }
      // Also prepend the skill command for visibility
      prompt = `/${this.selectedSkill} ${rawPrompt}`;
    }

    const userMessage: ChatMessage = {
      id: this.generateId(),
      role: 'user',
      content: rawPrompt, // Show original message to user
      timestamp: Date.now(),
    };
    this.plugin.sessionManager.addMessage(this.currentSessionId!, userMessage);
    this.appendMessage(userMessage);

    this.inputEl.value = '';
    this.setLoadingState(true);

    // Reset response tracking
    this.currentResponseEl = null;
    this.accumulatedContent = '';

    // Show thinking indicator while waiting for response
    this.appendThinking();

    try {
      // Build lightweight context - just vault awareness, not file contents
      // Claude will use Read/Grep/Glob tools to access content on-demand
      let contextPrompt = '';

      // Add vault awareness (lightweight - just paths and structure)
      if (this.includeFileContext) {
        contextPrompt = this.plugin.contextProvider.getVaultAwareness(true);
      }

      // Add web context only if explicitly requested (this one does send content)
      if (this.includeWebContext) {
        const webContext = await this.plugin.contextProvider.getWebViewerContext();
        if (webContext) {
          contextPrompt += `\n\n--- Web Page Context ---\n${webContext.content}\n--- End Web Page ---\n\n`;
        }
      }

      const session = this.plugin.sessionManager.getSession(this.currentSessionId!);

      console.debug('[Claude Plugin] Executing with lightweight context, file awareness:', this.includeFileContext, 'web context:', this.includeWebContext, 'skill:', this.selectedSkill || 'none');
      const result = await this.plugin.cliService.execute({
        prompt: contextPrompt + prompt,
        sessionId: session?.claudeSessionId,
        appendSystemPrompt: skillSystemPrompt,
      });
      console.debug('[Claude Plugin] Execution result:', result.success, result.finalContent?.substring(0, 50));

      if (result.sessionId) {
        this.plugin.sessionManager.setClaudeSessionId(this.currentSessionId!, result.sessionId);
      }

      // Save the final assistant message to session
      if (this.accumulatedContent) {
        const assistantMessage: ChatMessage = {
          id: this.generateId(),
          role: 'assistant',
          content: this.accumulatedContent,
          timestamp: Date.now(),
        };
        this.plugin.sessionManager.addMessage(this.currentSessionId!, assistantMessage);
      }

      this.finalizeStreamingMessage();
      this.updateMessageCount();
    } catch (error) {
      this.showError((error as Error).message);
    } finally {
      this.setLoadingState(false);

      // Check for queued input and send it as a follow-up
      const queuedInput = this.plugin.cliService.getAndClearQueuedInput();
      if (queuedInput) {
        this.removeQueuedIndicator();
        // Small delay to let UI update, then send the queued message
        setTimeout(() => {
          this.inputEl.value = queuedInput;
          void this.sendMessage();
        }, 100);
      }
    }
  }

  private handleStreamMessage(msg: ClaudeStreamMessage): void {
    // Handle thinking content - show collapsible thinking block
    if (msg.type === 'thinking' && msg.content) {
      this.removeThinking();
      const content = typeof msg.content === 'string' ? msg.content : '';
      this.appendThinkingContent(content);
      // Finalize any current response before thinking
      this.finalizeCurrentResponse();
    }

    // Handle assistant text content - create new response element
    if (msg.type === 'assistant' && msg.content) {
      this.removeThinking();
      const content = typeof msg.content === 'string' ? msg.content : '';
      // Create response element if doesn't exist
      if (!this.currentResponseEl) {
        this.createResponseElement();
      }
      this.accumulatedContent = content;
    }

    // Show tool calls
    if (msg.type === 'tool_use' && this.plugin.settings.showToolCalls) {
      this.removeThinking();
      // Finalize current response before showing tool call
      this.finalizeCurrentResponse();
      this.appendToolCall(msg.name || 'unknown', msg.input || {}, msg.id);
      // Show thinking indicator after tool call
      this.appendThinking();
    }

    // Handle tool result - update the tool call UI
    if (msg.type === 'tool_result') {
      this.handleToolResult(msg);
    }

    // Remove thinking on final result
    if (msg.type === 'result') {
      this.removeThinking();
      // Clear any remaining active tool calls
      this.activeToolCalls.clear();
    }
  }

  private createResponseElement(): void {
    this.currentResponseEl = this.messagesEl.createDiv({
      cls: 'claude-message claude-message-assistant streaming',
    });
    this.currentResponseEl.createDiv('claude-message-content');

    // Add copy button
    const copyBtn = this.currentResponseEl.createEl('button', {
      cls: 'claude-copy-btn',
      attr: { 'aria-label': 'Copy to clipboard' },
    });
    setIcon(copyBtn, 'copy');
    copyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.accumulatedContent).then(() => {
        setIcon(copyBtn, 'check');
        setTimeout(() => {
          setIcon(copyBtn, 'copy');
        }, 2000);
      });
    });

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private finalizeCurrentResponse(): void {
    if (this.currentResponseEl) {
      this.currentResponseEl.removeClass('streaming');
      this.currentResponseEl = null;
    }
  }

  private updateStreamingMessage(content: string): void {
    // Create response element if it doesn't exist
    if (!this.currentResponseEl) {
      this.removeThinking();
      this.createResponseElement();
    }

    const contentEl = this.currentResponseEl?.querySelector('.claude-message-content') as HTMLElement;
    if (contentEl) {
      contentEl.empty();
      void MarkdownRenderer.render(this.plugin.app, content, contentEl, '', this);
      this.accumulatedContent = content;
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private finalizeStreamingMessage(): void {
    this.finalizeCurrentResponse();
    // Also clean up any remaining streaming elements
    const streamingEl = this.messagesEl.querySelector('.claude-message.streaming');
    if (streamingEl) {
      streamingEl.removeClass('streaming');
    }
  }

  private appendMessage(message: ChatMessage): void {
    const msgEl = this.messagesEl.createDiv({
      cls: `claude-message claude-message-${message.role} ${message.isStreaming ? 'streaming' : ''}`,
    });

    const contentEl = msgEl.createDiv('claude-message-content');

    if (message.content) {
      void MarkdownRenderer.render(this.plugin.app, message.content, contentEl, '', this);
    }

    // Add copy button for assistant messages
    if (message.role === 'assistant') {
      const copyBtn = msgEl.createEl('button', {
        cls: 'claude-copy-btn',
        attr: { 'aria-label': 'Copy to clipboard' },
      });
      setIcon(copyBtn, 'copy');
      copyBtn.addEventListener('click', () => {
        const content = message.content || '';
        void navigator.clipboard.writeText(content).then(() => {
          setIcon(copyBtn, 'check');
          setTimeout(() => {
            setIcon(copyBtn, 'copy');
          }, 2000);
        });
      });
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private appendToolCall(name: string, input: Record<string, unknown>, id?: string): void {
    const toolInfo = getToolInfo(name);
    const toolEl = this.messagesEl.createDiv('claude-tool-call');
    toolEl.addClass(`claude-tool-${toolInfo.category}`);

    // Add a unique ID for tracking
    const toolId = id || `tool-${Date.now()}`;
    toolEl.dataset.toolId = toolId;

    // Icon with category color
    const iconEl = toolEl.createSpan({ cls: 'claude-tool-icon' });
    iconEl.textContent = toolInfo.icon;
    iconEl.style.setProperty('--tool-color', toolInfo.color);

    // Spinner for in-progress state
    const spinnerEl = toolEl.createSpan({ cls: 'claude-tool-spinner' });
    setIcon(spinnerEl, 'loader');

    const detailsEl = toolEl.createEl('details', { cls: 'claude-tool-details' });
    const summaryEl = detailsEl.createEl('summary');

    // Tool name badge
    const nameBadge = summaryEl.createSpan({ cls: 'claude-tool-name-badge' });
    nameBadge.textContent = name;
    nameBadge.style.setProperty('--tool-color', toolInfo.color);

    // Summary text
    const summaryText = summaryEl.createSpan({ cls: 'claude-tool-summary-text' });
    summaryText.textContent = this.getToolSummary(name, input);

    // Input details
    const inputEl = detailsEl.createEl('pre', { cls: 'claude-tool-input' });
    inputEl.textContent = JSON.stringify(input, null, 2);

    // For Edit operations, add diff placeholder
    if (name === 'Edit' && input.old_string && input.new_string) {
      const diffEl = detailsEl.createDiv('claude-tool-diff');
      this.renderDiff(diffEl, input.old_string as string, input.new_string as string);
    }

    // Track active tool call
    this.activeToolCalls.set(toolId, {
      id: toolId,
      name,
      input,
      startTime: Date.now(),
      element: toolEl,
    });

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private handleToolResult(msg: ClaudeStreamMessage): void {
    const toolId = msg.id;
    if (!toolId) return;

    const activeCall = this.activeToolCalls.get(toolId);
    if (activeCall) {
      const toolEl = activeCall.element;

      // Remove spinner, add completion state
      toolEl.removeClass('claude-tool-running');
      toolEl.addClass(msg.is_error ? 'claude-tool-error' : 'claude-tool-complete');

      // Remove spinner
      const spinner = toolEl.querySelector('.claude-tool-spinner');
      if (spinner) spinner.remove();

      // Add duration badge
      const duration = Date.now() - activeCall.startTime;
      const durationEl = toolEl.createSpan({ cls: 'claude-tool-duration' });
      durationEl.textContent = duration > 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;

      // Add result indicator
      const resultIndicator = toolEl.createSpan({ cls: 'claude-tool-result-indicator' });
      resultIndicator.textContent = msg.is_error ? '✗' : '✓';

      // If there's output and it's an error, show it
      if (msg.is_error && msg.output) {
        const detailsEl = toolEl.querySelector('.claude-tool-details');
        if (detailsEl) {
          const errorEl = detailsEl.createDiv('claude-tool-error-output');
          errorEl.textContent = typeof msg.output === 'string' ? msg.output : JSON.stringify(msg.output);
        }
      }

      this.activeToolCalls.delete(toolId);
    }
  }

  private renderDiff(container: HTMLElement, oldStr: string, newStr: string): void {
    container.empty();

    const header = container.createDiv('claude-diff-header');
    header.createSpan({ text: 'Changes', cls: 'claude-diff-title' });

    const diffContent = container.createDiv('claude-diff-content');

    // Simple line-by-line diff
    const oldLines = oldStr.split('\n');
    const newLines = newStr.split('\n');

    // Show removed lines
    if (oldLines.length > 0 && oldStr.trim()) {
      const removedBlock = diffContent.createDiv('claude-diff-removed');
      removedBlock.createSpan({ text: '−', cls: 'claude-diff-marker' });
      const codeEl = removedBlock.createEl('code');
      codeEl.textContent = oldStr;
    }

    // Show added lines
    if (newLines.length > 0 && newStr.trim()) {
      const addedBlock = diffContent.createDiv('claude-diff-added');
      addedBlock.createSpan({ text: '+', cls: 'claude-diff-marker' });
      const codeEl = addedBlock.createEl('code');
      codeEl.textContent = newStr;
    }
  }

  private getToolSummary(name: string, input: Record<string, unknown>): string {
    const filePath = input.file_path as string;
    const fileName = filePath?.split('/').pop() || 'file';

    switch (name) {
      case 'Read':
        return fileName;
      case 'Edit':
        return fileName;
      case 'Write':
        return fileName;
      case 'Glob': {
        const pattern = typeof input.pattern === 'string' ? input.pattern : '*';
        return pattern;
      }
      case 'Grep':
        return `"${(input.pattern as string)?.substring(0, 30) || '...'}"`;
      case 'Bash': {
        const cmd = (input.command as string) || '';
        return cmd.substring(0, 50) + (cmd.length > 50 ? '...' : '');
      }
      case 'WebFetch':
        try {
          const url = new URL(input.url as string);
          return url.hostname;
        } catch {
          return 'URL';
        }
      case 'WebSearch':
        return `"${(input.query as string)?.substring(0, 30) || '...'}"`;
      case 'Task':
        return (input.description as string)?.substring(0, 40) || 'subtask';
      case 'TodoWrite': {
        const todos = input.todos as Array<{ content: string }>;
        return todos ? `${todos.length} items` : 'todos';
      }
      default:
        return '';
    }
  }

  private appendThinking(): HTMLElement {
    const thinkingEl = this.messagesEl.createDiv('claude-thinking');
    thinkingEl.createSpan({ text: '🧠', cls: 'claude-thinking-icon' });
    thinkingEl.createSpan({ text: 'Thinking...', cls: 'claude-thinking-text' });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return thinkingEl;
  }

  private appendThinkingContent(content: string): void {
    const thinkingEl = this.messagesEl.createDiv('claude-thinking-block');

    const detailsEl = thinkingEl.createEl('details', { cls: 'claude-thinking-details' });
    const summaryEl = detailsEl.createEl('summary', { cls: 'claude-thinking-summary' });

    // Compact: icon + truncated preview
    summaryEl.createSpan({ text: '🧠', cls: 'claude-thinking-icon' });
    const firstLine = content.split('\n')[0].substring(0, 50);
    summaryEl.createSpan({ text: firstLine + (content.length > 50 ? '...' : ''), cls: 'claude-thinking-preview' });

    const contentEl = detailsEl.createDiv('claude-thinking-content');
    contentEl.textContent = content;

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private removeThinking(): void {
    const thinkingEl = this.messagesEl.querySelector('.claude-thinking');
    if (thinkingEl) {
      thinkingEl.remove();
    }
  }

  private appendQueuedIndicator(): void {
    const queuedEl = this.messagesEl.createDiv('claude-queued-indicator');
    queuedEl.createSpan({ text: '⏳', cls: 'claude-queued-icon' });
    queuedEl.createSpan({ text: 'Queued - will send when current task completes', cls: 'claude-queued-text' });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private removeQueuedIndicator(): void {
    const queuedEl = this.messagesEl.querySelector('.claude-queued-indicator');
    if (queuedEl) {
      queuedEl.remove();
    }
  }

  private renderMessages(messages: ChatMessage[]): void {
    this.messagesEl.empty();
    messages.forEach((msg) => this.appendMessage(msg));
  }

  private setLoadingState(loading: boolean): void {
    // Keep input enabled so user can type and send mid-execution
    // Only disable the skill selector during execution
    this.skillSelectEl.disabled = loading;

    if (loading) {
      // Change send button to indicate it will send input to running agent
      this.sendBtn.textContent = 'Reply';
      this.sendBtn.removeClass('claude-btn-primary');
      this.sendBtn.addClass('claude-btn-secondary');
      this.abortBtn.removeClass('claude-hidden');
      this.inputEl.placeholder = 'Type to respond...';
    } else {
      this.sendBtn.textContent = 'Send';
      this.sendBtn.addClass('claude-btn-primary');
      this.sendBtn.removeClass('claude-btn-secondary');
      this.abortBtn.addClass('claude-hidden');
      this.inputEl.placeholder = 'Ask anything...';
    }
  }

  private abortRequest(): void {
    this.plugin.cliService.abort();
    this.setLoadingState(false);
  }

  private showError(message: string): void {
    const errorEl = this.messagesEl.createDiv('claude-error');

    // Check for context limit errors
    const isContextError =
      message.includes('context') ||
      message.includes('token') ||
      message.includes('too long') ||
      message.includes('max_tokens') ||
      message.includes('length_exceeded');

    if (isContextError) {
      const contentDiv = errorEl.createDiv({ cls: 'claude-error-content' });
      contentDiv.createEl('strong', { text: 'Context limit reached' });
      contentDiv.createEl('p', { text: 'The conversation has grown too long. Start a new chat to continue.' });
      const newChatBtn = errorEl.createEl('button', {
        text: 'Start new chat',
        cls: 'claude-btn claude-btn-secondary claude-btn-small',
      });
      newChatBtn.addEventListener('click', () => {
        this.startNewSession();
        errorEl.remove();
      });
    } else {
      errorEl.textContent = `Error: ${message}`;
    }

    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private startNewSession(): void {
    const session = this.plugin.sessionManager.createSession();
    this.currentSessionId = session.id;
    this.messagesEl.empty();
    this.updateMessageCount();
  }

  private loadSession(sessionId: string): void {
    const session = this.plugin.sessionManager.getSession(sessionId);
    if (session) {
      this.currentSessionId = sessionId;
      this.plugin.sessionManager.setActiveSession(sessionId);
      this.renderMessages(session.messages);
      this.updateMessageCount();
    }
  }

  private createContextToggle(container: HTMLElement): void {
    const toggleWrapper = container.createDiv('claude-context-toggle');

    // File context toggle
    const fileToggleBtn = toggleWrapper.createEl('button', {
      cls: `claude-context-btn ${this.includeFileContext ? 'active' : ''}`,
      attr: { 'aria-label': 'Toggle file context' },
    });

    // Web context toggle
    const webToggleBtn = toggleWrapper.createEl('button', {
      cls: `claude-context-btn ${this.includeWebContext ? 'active' : ''}`,
      attr: { 'aria-label': 'Toggle web context' },
    });

    const updateFileToggle = () => {
      const activeFile = this.plugin.app.workspace.getActiveFile();
      fileToggleBtn.empty();
      fileToggleBtn.createSpan({ text: '📄', cls: 'claude-context-icon' });

      if (this.includeFileContext && activeFile) {
        fileToggleBtn.createSpan({ text: activeFile.basename, cls: 'claude-context-name' });
      } else {
        fileToggleBtn.createSpan({ text: 'No page', cls: 'claude-context-name claude-context-off' });
      }
      fileToggleBtn.toggleClass('active', this.includeFileContext);
    };

    const updateWebToggle = async () => {
      const webContext = await this.plugin.contextProvider.getWebViewerContext();
      webToggleBtn.empty();
      webToggleBtn.createSpan({ text: '🌐', cls: 'claude-context-icon' });

      if (this.includeWebContext && webContext) {
        const displayTitle = webContext.title && webContext.title.length > 20
          ? webContext.title.substring(0, 20) + '...'
          : webContext.title || 'Web page';
        webToggleBtn.createSpan({ text: displayTitle, cls: 'claude-context-name' });
      } else {
        webToggleBtn.createSpan({ text: 'No web', cls: 'claude-context-name claude-context-off' });
      }
      webToggleBtn.toggleClass('active', this.includeWebContext);
    };

    fileToggleBtn.addEventListener('click', () => {
      this.includeFileContext = !this.includeFileContext;
      updateFileToggle();
    });

    webToggleBtn.addEventListener('click', () => {
      this.includeWebContext = !this.includeWebContext;
      void updateWebToggle();
    });

    // Update toggles when workspace changes
    this.registerEvent(
      this.plugin.app.workspace.on('active-leaf-change', () => {
        updateFileToggle();
        void updateWebToggle();
      })
    );

    updateFileToggle();
    void updateWebToggle();
  }

  setInitialPrompt(prompt: string): void {
    this.inputEl.value = prompt;
    this.inputEl.focus();
  }

  private generateId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  async onClose(): Promise<void> {
    this.plugin.cliService.removeAllListeners();
    await Promise.resolve(); // Satisfy async requirement
  }
}
