export interface ClaudeCodePluginSettings {
  // CLI Configuration
  claudePath: string;
  defaultAllowedTools: string[];
  maxTurns: number;

  // Skills Configuration
  skillsFolder: string;

  // Context Settings
  includeCurrentNote: boolean;
  maxContextFiles: number;
  maxContextLength: number;
  excludeFolders: string[];

  // UI Preferences
  showToolCalls: boolean;
  streamResponses: boolean;
  defaultPanelPosition: 'left' | 'right';

  // Session Management
  autoSaveSessions: boolean;
  sessionStoragePath: string;
  maxSessionHistory: number;
}

export const DEFAULT_SETTINGS: ClaudeCodePluginSettings = {
  claudePath: 'claude', // Will be auto-detected on first run
  defaultAllowedTools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'AskUserQuestion'],
  maxTurns: 25,
  skillsFolder: '.claude/skills',
  includeCurrentNote: true,
  maxContextFiles: 10,
  maxContextLength: 50000,
  excludeFolders: ['.claude-sessions', 'node_modules'],
  showToolCalls: true,
  streamResponses: true,
  defaultPanelPosition: 'right',
  autoSaveSessions: true,
  sessionStoragePath: '.claude-sessions',
  maxSessionHistory: 50
};
