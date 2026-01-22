// NDJSON message types from Claude CLI stream-json output
export type ClaudeMessageType =
  | 'system'
  | 'assistant'
  | 'user'
  | 'tool_use'
  | 'tool_result'
  | 'thinking'
  | 'error'
  | 'result';

export interface ClaudeStreamMessage {
  type: ClaudeMessageType;
  id?: string;
  role?: 'assistant' | 'user';
  content?: string | ClaudeContentBlock[];
  name?: string;
  input?: Record<string, unknown>;
  output?: string;
  tool_use_id?: string;
  is_error?: boolean;
  subtype?: 'partial' | 'complete' | 'init' | 'success';
  session_id?: string;
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ClaudeCliOptions {
  prompt: string;
  allowedTools?: string[];
  addDirs?: string[];
  sessionId?: string;
  maxTurns?: number;
  systemPrompt?: string;
  appendSystemPrompt?: string;
}

export interface ClaudeExecutionResult {
  success: boolean;
  sessionId?: string;
  messages: ClaudeStreamMessage[];
  finalContent?: string;
  error?: string;
}

// Enhanced tool tracking
export type ToolCategory = 'read' | 'write' | 'search' | 'execute' | 'web' | 'agent';

export interface ToolInfo {
  name: string;
  category: ToolCategory;
  icon: string;
  color: string;
  description: string;
}

export const TOOL_REGISTRY: Record<string, ToolInfo> = {
  Read: { name: 'Read', category: 'read', icon: '📖', color: '#4CAF50', description: 'Reading file' },
  Edit: { name: 'Edit', category: 'write', icon: '✏️', color: '#FF9800', description: 'Editing file' },
  Write: { name: 'Write', category: 'write', icon: '📝', color: '#FF9800', description: 'Writing file' },
  Glob: { name: 'Glob', category: 'search', icon: '🔍', color: '#2196F3', description: 'Finding files' },
  Grep: { name: 'Grep', category: 'search', icon: '🔎', color: '#2196F3', description: 'Searching content' },
  Bash: { name: 'Bash', category: 'execute', icon: '💻', color: '#9C27B0', description: 'Running command' },
  WebFetch: { name: 'WebFetch', category: 'web', icon: '🌐', color: '#00BCD4', description: 'Fetching URL' },
  WebSearch: { name: 'WebSearch', category: 'web', icon: '🔍', color: '#00BCD4', description: 'Searching web' },
  Task: { name: 'Task', category: 'agent', icon: '🤖', color: '#E91E63', description: 'Running agent' },
  TodoWrite: { name: 'TodoWrite', category: 'write', icon: '✅', color: '#8BC34A', description: 'Managing todos' },
  AskUserQuestion: { name: 'AskUserQuestion', category: 'agent', icon: '❓', color: '#FFC107', description: 'Asking question' },
};

export function getToolInfo(name: string): ToolInfo {
  return TOOL_REGISTRY[name] || {
    name,
    category: 'execute',
    icon: '⚙️',
    color: '#757575',
    description: 'Running tool',
  };
}
