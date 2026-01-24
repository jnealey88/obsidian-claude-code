import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ClaudeCodePluginSettings, DEFAULT_SETTINGS } from './types';
import { ChatPanelView, VIEW_TYPE_CHAT_PANEL } from './views/ChatPanelView';
import { registerInlineBlockProcessor } from './views/InlineBlockProcessor';
import { ClaudeCodeSettingsTab } from './settings/SettingsTab';
import { ClaudeCliService } from './services/ClaudeCliService';
import { ContextProviderService } from './services/ContextProviderService';
import { SessionManager } from './services/SessionManager';
import { SkillLoaderService } from './services/SkillLoaderService';

export default class ClaudeCodePlugin extends Plugin {
  settings: ClaudeCodePluginSettings;
  cliService: ClaudeCliService;
  contextProvider: ContextProviderService;
  sessionManager: SessionManager;
  skillLoader: SkillLoaderService;

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.cliService = new ClaudeCliService(this);
    this.contextProvider = new ContextProviderService(this);
    this.sessionManager = new SessionManager(this);
    this.skillLoader = new SkillLoaderService(this);

    await this.sessionManager.initialize();
    this.skillLoader.loadSkills();

    // Register side panel view
    this.registerView(VIEW_TYPE_CHAT_PANEL, (leaf) => new ChatPanelView(leaf, this));

    // Register inline code block processor
    registerInlineBlockProcessor(this);

    // Add ribbon icon
    this.addRibbonIcon('message-circle', 'Open chat', () => {
      void this.activateChatPanel();
    });

    // Add commands
    this.addCommand({
      id: 'open-claude-chat',
      name: 'Open chat panel',
      callback: () => void this.activateChatPanel(),
    });

    this.addCommand({
      id: 'ask-claude-about-selection',
      name: 'Ask about selection',
      editorCallback: (editor) => {
        const selection = editor.getSelection();
        if (selection) {
          void this.activateChatPanel(selection);
        }
      },
    });

    // Confluence sync commands
    this.addCommand({
      id: 'confluence-push',
      name: 'Push current note to Confluence',
      callback: () => {
        void this.activateChatPanel('/confluence push');
      },
    });

    this.addCommand({
      id: 'confluence-pull',
      name: 'Pull current note from Confluence',
      callback: () => {
        void this.activateChatPanel('/confluence pull');
      },
    });

    this.addCommand({
      id: 'confluence-status',
      name: 'Check sync status',
      callback: () => {
        void this.activateChatPanel('/confluence status');
      },
    });

    this.addCommand({
      id: 'confluence-list',
      name: 'List synced files',
      callback: () => {
        void this.activateChatPanel('/confluence list');
      },
    });

    // Add settings tab
    this.addSettingTab(new ClaudeCodeSettingsTab(this.app, this));

    // Open chat panel in right sidebar on startup
    this.app.workspace.onLayoutReady(() => {
      void this.activateChatPanel();
    });
  }

  onunload(): void {
    void this.sessionManager.saveAllSessions();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateChatPanel(initialPrompt?: string) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHAT_PANEL)[0];

    if (!leaf) {
      const position = this.settings.defaultPanelPosition;
      leaf =
        position === 'left'
          ? (workspace.getLeftLeaf(false) as WorkspaceLeaf)
          : (workspace.getRightLeaf(false) as WorkspaceLeaf);
      await leaf.setViewState({
        type: VIEW_TYPE_CHAT_PANEL,
        active: true,
      });
    }

    void workspace.revealLeaf(leaf);

    if (initialPrompt) {
      const view = leaf.view as ChatPanelView;
      view.setInitialPrompt(initialPrompt);
    }
  }
}
