export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  isError?: boolean;
  duration?: number;
}

export interface ChatSession {
  id: string;
  name: string;
  claudeSessionId?: string;
  messages: ChatMessage[];
  context: ContextReference[];
  createdAt: number;
  updatedAt: number;
  notePath?: string;
}

export interface ContextReference {
  type: 'file' | 'selection' | 'search' | 'webpage';
  path?: string;
  content: string;
  title?: string;
  url?: string;
}
