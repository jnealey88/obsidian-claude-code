import { MarkdownPostProcessorContext, MarkdownRenderer } from 'obsidian';
import type ClaudeCodePlugin from '../main';
import { ChatMessage } from '../types';

interface InlineBlockState {
  sessionId?: string;
  messages: ChatMessage[];
}

export function registerInlineBlockProcessor(plugin: ClaudeCodePlugin): void {
  plugin.registerMarkdownCodeBlockProcessor(
    'claude-chat',
    async (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const processor = new InlineChatBlock(plugin, source, el, ctx);
      await processor.render();
    }
  );
}

class InlineChatBlock {
  private plugin: ClaudeCodePlugin;
  private source: string;
  private el: HTMLElement;
  private ctx: MarkdownPostProcessorContext;
  private state: InlineBlockState;
  private messagesEl: HTMLElement;
  private inputEl: HTMLInputElement;

  constructor(
    plugin: ClaudeCodePlugin,
    source: string,
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) {
    this.plugin = plugin;
    this.source = source;
    this.el = el;
    this.ctx = ctx;
    this.state = this.parseSource(source);
  }

  private parseSource(source: string): InlineBlockState {
    try {
      if (source.trim()) {
        const parsed = JSON.parse(source);
        return {
          messages: parsed.messages || [],
          sessionId: parsed.sessionId,
        };
      }
    } catch {
      // Not JSON, treat as initial prompt
      if (source.trim()) {
        return {
          messages: [
            {
              id: 'initial',
              role: 'user',
              content: source.trim(),
              timestamp: Date.now(),
            },
          ],
        };
      }
    }

    return { messages: [] };
  }

  async render(): Promise<void> {
    this.el.empty();
    this.el.addClass('claude-inline-chat');

    const header = this.el.createDiv('claude-inline-header');
    header.createSpan({ text: 'Claude Chat', cls: 'claude-inline-title' });

    this.messagesEl = this.el.createDiv('claude-inline-messages');
    this.renderMessages();

    this.createInputArea();

    // If there's an initial prompt without response, auto-send
    if (this.state.messages.length === 1 && this.state.messages[0].role === 'user' && !this.state.sessionId) {
      await this.sendInitialPrompt();
    }
  }

  private createInputArea(): void {
    const inputWrapper = this.el.createDiv('claude-inline-input-wrapper');

    this.inputEl = inputWrapper.createEl('input', {
      type: 'text',
      placeholder: 'Continue conversation...',
      cls: 'claude-inline-input',
    });

    this.inputEl.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        await this.sendMessage();
      }
    });

    const sendBtn = inputWrapper.createEl('button', {
      text: 'Send',
      cls: 'claude-btn claude-btn-small',
    });
    sendBtn.addEventListener('click', () => this.sendMessage());
  }

  private renderMessages(): void {
    this.messagesEl.empty();

    for (const msg of this.state.messages) {
      const msgEl = this.messagesEl.createDiv({
        cls: `claude-inline-message claude-inline-${msg.role}`,
      });

      const contentEl = msgEl.createDiv('claude-inline-content');
      MarkdownRenderer.render(this.plugin.app, msg.content, contentEl, this.ctx.sourcePath, this.plugin);
    }
  }

  private async sendInitialPrompt(): Promise<void> {
    const prompt = this.state.messages[0].content;
    await this.executeAndUpdate(prompt);
  }

  private async sendMessage(): Promise<void> {
    const prompt = this.inputEl.value.trim();
    if (!prompt) return;

    this.state.messages.push({
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
    });
    this.renderMessages();
    this.inputEl.value = '';

    await this.executeAndUpdate(prompt);
  }

  private async executeAndUpdate(prompt: string): Promise<void> {
    const loadingEl = this.messagesEl.createDiv('claude-inline-loading');
    loadingEl.textContent = 'Claude is thinking...';

    try {
      // Build context from current note
      const filePath = this.ctx.sourcePath;
      const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
      let contextPrompt = '';

      if (file) {
        const content = await this.plugin.app.vault.cachedRead(file as any);
        contextPrompt = `Current note (${filePath}):\n${content}\n\n`;
      }

      const result = await this.plugin.cliService.execute({
        prompt: contextPrompt + prompt,
        sessionId: this.state.sessionId,
      });

      if (result.sessionId) {
        this.state.sessionId = result.sessionId;
      }

      if (result.finalContent) {
        this.state.messages.push({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: result.finalContent,
          timestamp: Date.now(),
        });
      }

      await this.persistState();
    } catch (error) {
      this.state.messages.push({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${(error as Error).message}`,
        timestamp: Date.now(),
      });
    }

    loadingEl.remove();
    this.renderMessages();
  }

  private async persistState(): Promise<void> {
    const file = this.plugin.app.vault.getAbstractFileByPath(this.ctx.sourcePath);
    if (!file) return;

    const content = await this.plugin.app.vault.read(file as any);
    const newBlockContent = JSON.stringify(
      {
        sessionId: this.state.sessionId,
        messages: this.state.messages,
      },
      null,
      2
    );

    // Find and replace the code block
    const blockRegex = /```claude-chat\n[\s\S]*?\n```/;
    const newContent = content.replace(blockRegex, `\`\`\`claude-chat\n${newBlockContent}\n\`\`\``);

    await this.plugin.app.vault.modify(file as any, newContent);
  }
}
