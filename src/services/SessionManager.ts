import { TFile } from 'obsidian';
import type ClaudeCodePlugin from '../main';
import { ChatSession, ChatMessage } from '../types';

/**
 * Validates that a parsed object has the required ChatSession structure
 */
function isValidSession(obj: unknown): obj is ChatSession {
  if (!obj || typeof obj !== 'object') return false;

  const session = obj as Record<string, unknown>;

  // Check required fields
  if (typeof session.id !== 'string' || !session.id) return false;
  if (!Array.isArray(session.messages)) return false;
  if (typeof session.createdAt !== 'number') return false;
  if (typeof session.updatedAt !== 'number') return false;

  // Validate messages array (basic check)
  for (const msg of session.messages) {
    if (!msg || typeof msg !== 'object') return false;
    const message = msg as Record<string, unknown>;
    if (typeof message.id !== 'string') return false;
    if (message.role !== 'user' && message.role !== 'assistant') return false;
  }

  return true;
}

export class SessionManager {
  private plugin: ClaudeCodePlugin;
  private sessions: Map<string, ChatSession> = new Map();
  private activeSessionId: string | null = null;

  constructor(plugin: ClaudeCodePlugin) {
    this.plugin = plugin;
  }

  async initialize(): Promise<void> {
    await this.ensureStorageFolder();
    await this.loadSessions();
  }

  private async ensureStorageFolder(): Promise<void> {
    const { vault } = this.plugin.app;
    const folderPath = this.plugin.settings.sessionStoragePath;

    if (!(await vault.adapter.exists(folderPath))) {
      await vault.createFolder(folderPath);
    }
  }

  private async loadSessions(): Promise<void> {
    const { vault } = this.plugin.app;
    const folderPath = this.plugin.settings.sessionStoragePath;

    try {
      // Use adapter.list to get files even if folder was just created
      const exists = await vault.adapter.exists(folderPath);
      if (!exists) {
        console.log('[SessionManager] Session folder does not exist yet');
        return;
      }

      const listing = await vault.adapter.list(folderPath);
      for (const filePath of listing.files) {
        if (filePath.endsWith('.json')) {
          try {
            const content = await vault.adapter.read(filePath);
            const parsed = JSON.parse(content);

            // Validate session structure before using
            if (!isValidSession(parsed)) {
              console.warn('[SessionManager] Invalid session structure, skipping:', filePath);
              continue;
            }

            this.sessions.set(parsed.id, parsed);
            console.log('[SessionManager] Loaded session:', parsed.id);
          } catch (parseError) {
            console.error('[SessionManager] Failed to parse session file:', filePath, parseError);
          }
        }
      }
      console.log('[SessionManager] Loaded', this.sessions.size, 'sessions');
    } catch (e) {
      console.error('[SessionManager] Failed to load sessions:', e);
    }
  }

  createSession(name?: string): ChatSession {
    const id = this.generateId();
    const session: ChatSession = {
      id,
      name: name || `Chat ${new Date().toLocaleDateString()}`,
      messages: [],
      context: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.sessions.set(id, session);
    this.activeSessionId = id;
    return session;
  }

  getSession(id: string): ChatSession | undefined {
    return this.sessions.get(id);
  }

  getActiveSession(): ChatSession | null {
    if (!this.activeSessionId) return null;
    return this.sessions.get(this.activeSessionId) || null;
  }

  setActiveSession(id: string): void {
    this.activeSessionId = id;
  }

  addMessage(sessionId: string, message: ChatMessage): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.updatedAt = Date.now();

      if (this.plugin.settings.autoSaveSessions) {
        this.saveSession(session);
      }
    }
  }

  updateLastMessage(sessionId: string, content: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      lastMsg.content = content;
      lastMsg.isStreaming = true;
    }
  }

  finalizeLastMessage(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.messages.length > 0) {
      const lastMsg = session.messages[session.messages.length - 1];
      lastMsg.isStreaming = false;
      session.updatedAt = Date.now();

      if (this.plugin.settings.autoSaveSessions) {
        this.saveSession(session);
      }
    }
  }

  async saveSession(session: ChatSession): Promise<void> {
    const { vault } = this.plugin.app;
    const filePath = `${this.plugin.settings.sessionStoragePath}/${session.id}.json`;
    const content = JSON.stringify(session, null, 2);

    try {
      // Check if file exists using adapter
      const exists = await vault.adapter.exists(filePath);
      if (exists) {
        await vault.adapter.write(filePath, content);
      } else {
        await vault.create(filePath, content);
      }
    } catch (e) {
      console.error('Failed to save session:', e);
    }
  }

  async saveAllSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      await this.saveSession(session);
    }
  }

  getAllSessions(): ChatSession[] {
    return Array.from(this.sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteSession(id: string): Promise<void> {
    const { vault } = this.plugin.app;
    const filePath = `${this.plugin.settings.sessionStoragePath}/${id}.json`;

    this.sessions.delete(id);

    try {
      const file = vault.getAbstractFileByPath(filePath);
      if (file instanceof TFile) {
        await vault.delete(file);
      }
    } catch (e) {
      console.error('Failed to delete session file:', e);
    }
  }

  setClaudeSessionId(sessionId: string, claudeSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.claudeSessionId = claudeSessionId;
    }
  }

  private generateId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}
