import { spawn, ChildProcess } from 'child_process';
import { FileSystemAdapter } from 'obsidian';
import type ClaudeCodePlugin from '../main';
import { ClaudeCliOptions, ClaudeStreamMessage, ClaudeExecutionResult } from '../types';
import { MessageParser } from './MessageParser';

type EventCallback = (data: ClaudeStreamMessage | string) => void;

export class ClaudeCliService {
  private plugin: ClaudeCodePlugin;
  private activeProcess: ChildProcess | null = null;
  private parser: MessageParser;
  private listeners: Map<string, EventCallback[]> = new Map();
  private queuedInput: string | null = null;

  constructor(plugin: ClaudeCodePlugin) {
    this.plugin = plugin;
    this.parser = new MessageParser();
  }

  on(event: string, callback: EventCallback): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  off(event: string, callback?: EventCallback): void {
    if (!callback) {
      this.listeners.delete(event);
    } else {
      const callbacks = this.listeners.get(event);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) callbacks.splice(index, 1);
      }
    }
  }

  private emit(event: string, data: ClaudeStreamMessage | string): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => cb(data));
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  async execute(options: ClaudeCliOptions): Promise<ClaudeExecutionResult> {
    const args = this.buildArgs(options);
    const messages: ClaudeStreamMessage[] = [];
    let sessionId: string | undefined;
    let finalContent = '';

    return new Promise((resolve, reject) => {
      const claudePath = this.plugin.settings.claudePath;
      let vaultPath = '';

      // Get vault path
      if (this.plugin.app.vault.adapter instanceof FileSystemAdapter) {
        vaultPath = this.plugin.app.vault.adapter.getBasePath();
      }

      console.log('[Claude Plugin] Spawning:', claudePath, args);

      // Spawn without shell to prevent prompt content being interpreted as commands
      this.activeProcess = spawn(claudePath, args, {
        cwd: vaultPath || undefined,
        env: {
          ...process.env,
          PATH: `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}`,
          // Disable interactive mode
          CI: 'true',
          TERM: 'dumb',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Close stdin to signal no more input - required for CLI to start processing
      // Mid-run replies are handled by queueing and resuming the session
      this.activeProcess.stdin?.end();

      let buffer = '';

      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        console.log('[Claude Plugin] Process timeout - killing');
        if (this.activeProcess) {
          this.activeProcess.kill('SIGTERM');
        }
      }, 120000); // 2 minute timeout

      // Process stdout data as it comes in
      this.activeProcess.stdout?.on('data', (data: Buffer) => {
        buffer += data.toString();

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const parsedMessages = this.parser.parseLine(line);
            if (parsedMessages) {
              for (const parsed of parsedMessages) {
                const preview = typeof parsed.content === 'string' ? parsed.content.substring(0, 50) : '';
                console.log('[Claude Plugin] Parsed message:', parsed.type, parsed.name || '', preview);
                messages.push(parsed);

                // Extract session ID if present
                if (parsed.session_id) {
                  sessionId = parsed.session_id;
                }

                // Emit for real-time UI updates
                this.emit('message', parsed);

                // Handle assistant content
                if (parsed.type === 'assistant' && parsed.content) {
                  const content = typeof parsed.content === 'string' ? parsed.content : '';
                  finalContent = content;
                  this.emit('partial', content);
                }

                // Handle result content (final response)
                if (parsed.type === 'result' && parsed.content) {
                  const content = typeof parsed.content === 'string' ? parsed.content : '';
                  finalContent = content;
                  this.emit('partial', content);
                }
              }
            }
          } catch (e) {
            console.error('[Claude Plugin] Failed to parse:', e, line);
          }
        }
      });

      // Handle stderr for errors
      let stderrData = '';
      this.activeProcess.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString();
        console.log('[Claude Plugin] stderr:', data.toString());
      });

      this.activeProcess.on('close', (code) => {
        clearTimeout(timeout);
        console.log('[Claude Plugin] Process closed with code:', code);
        this.activeProcess = null;

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const parsedMessages = this.parser.parseLine(buffer);
            if (parsedMessages) {
              for (const parsed of parsedMessages) {
                messages.push(parsed);
                if (parsed.type === 'result' && parsed.content) {
                  finalContent = typeof parsed.content === 'string' ? parsed.content : '';
                  this.emit('partial', finalContent);
                }
              }
            }
          } catch (e) {
            console.error('[Claude Plugin] Failed to parse final buffer:', e);
          }
        }

        if (code === 0 || finalContent) {
          resolve({
            success: true,
            sessionId,
            messages,
            finalContent,
          });
        } else {
          resolve({
            success: false,
            messages,
            error: stderrData || `Process exited with code ${code}`,
          });
        }
      });

      this.activeProcess.on('error', (err) => {
        clearTimeout(timeout);
        console.error('[Claude Plugin] Process error:', err);
        this.activeProcess = null;
        reject(err);
      });
    });
  }

  private buildArgs(options: ClaudeCliOptions): string[] {
    // --verbose is required when using stream-json output format
    const args: string[] = ['-p', options.prompt, '--output-format', 'stream-json', '--verbose'];

    // Add allowed tools
    const tools = options.allowedTools || this.plugin.settings.defaultAllowedTools;
    if (tools.length > 0) {
      args.push('--allowedTools', tools.join(','));
    }

    // Add directories
    if (options.addDirs && options.addDirs.length > 0) {
      options.addDirs.forEach((dir) => {
        args.push('--add-dir', dir);
      });
    }

    // Resume session if provided
    if (options.sessionId) {
      args.push('--resume', options.sessionId);
    }

    // Max turns
    const maxTurns = options.maxTurns || this.plugin.settings.maxTurns;
    args.push('--max-turns', maxTurns.toString());

    // System prompt handling
    if (options.appendSystemPrompt) {
      args.push('--append-system-prompt', options.appendSystemPrompt);
    } else if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt);
    }

    return args;
  }

  abort(): void {
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }
  }

  isRunning(): boolean {
    return this.activeProcess !== null;
  }

  /**
   * Queue input to be sent as a follow-up when current execution completes.
   * Since stdin is closed after spawning, we can't pipe directly to the process.
   * Instead, we queue the message and the UI handles resuming the session.
   */
  queueInput(input: string): boolean {
    if (this.isRunning()) {
      console.log('[Claude Plugin] Queueing input for follow-up:', input.substring(0, 50));
      this.queuedInput = input;
      return true;
    }
    console.log('[Claude Plugin] Cannot queue input - no active process');
    return false;
  }

  /**
   * Get and clear any queued input (called after execution completes)
   */
  getAndClearQueuedInput(): string | null {
    const input = this.queuedInput;
    this.queuedInput = null;
    return input;
  }

  /**
   * Check if there's queued input waiting
   */
  hasQueuedInput(): boolean {
    return this.queuedInput !== null;
  }
}
