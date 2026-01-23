import { ClaudeStreamMessage } from '../types';

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  tool_use_id?: string;
}

interface RawStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: {
    content?: ContentBlock[];
  };
  result?: string;
  name?: string;
  input?: Record<string, unknown>;
  output?: string;
  content?: ContentBlock[];
  tool_name?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export class MessageParser {
  // Track active tool calls to match results
  private activeToolCalls: Map<string, { name: string; input: Record<string, unknown> }> = new Map();

  parseLine(line: string): ClaudeStreamMessage[] | null {
    const trimmed = line.trim();
    if (!trimmed) return null;

    try {
      const raw = JSON.parse(trimmed) as RawStreamMessage;
      console.debug('[MessageParser] Raw message:', raw.type, raw.subtype || '');
      return this.normalizeMessage(raw);
    } catch {
      return null;
    }
  }

  private normalizeMessage(raw: RawStreamMessage): ClaudeStreamMessage[] {
    const messages: ClaudeStreamMessage[] = [];

    const baseMsg: ClaudeStreamMessage = {
      type: raw.type as ClaudeStreamMessage['type'],
      session_id: raw.session_id,
    };

    // Handle assistant messages with nested content (may contain thinking, text, AND tool_use)
    if (raw.type === 'assistant' && raw.message?.content) {
      for (const block of raw.message.content) {
        if (block.type === 'thinking' && block.thinking) {
          messages.push({
            type: 'thinking',
            session_id: raw.session_id,
            content: block.thinking,
          });
        } else if (block.type === 'text' && block.text) {
          messages.push({
            ...baseMsg,
            content: block.text,
            role: 'assistant',
          });
        } else if (block.type === 'tool_use') {
          // Track tool call for result matching
          if (block.id && block.name) {
            this.activeToolCalls.set(block.id, { name: block.name, input: block.input || {} });
          }
          messages.push({
            type: 'tool_use',
            id: block.id,
            session_id: raw.session_id,
            name: block.name,
            input: block.input,
          });
        }
      }
      // If no messages extracted, still return base message
      if (messages.length === 0) {
        messages.push(baseMsg);
      }
      return messages;
    }

    // Handle user messages with tool results
    if (raw.type === 'user' && raw.message?.content) {
      for (const block of raw.message.content) {
        if (block.type === 'tool_result' && block.tool_use_id) {
          const toolCall = this.activeToolCalls.get(block.tool_use_id);
          messages.push({
            type: 'tool_result',
            id: block.tool_use_id,
            session_id: raw.session_id,
            name: toolCall?.name,
            input: toolCall?.input,
            output: block.content,
            is_error: raw.is_error,
          });
          // Clean up tracked tool call
          this.activeToolCalls.delete(block.tool_use_id);
        }
      }
      if (messages.length > 0) {
        return messages;
      }
    }

    // Handle result messages
    if (raw.type === 'result' && raw.result) {
      baseMsg.content = raw.result;
    }

    // Handle system init messages
    if (raw.type === 'system' && raw.subtype === 'init') {
      baseMsg.subtype = 'init';
    }

    // Handle standalone tool use
    if (raw.type === 'tool_use') {
      baseMsg.name = raw.name || raw.tool_name;
      baseMsg.input = raw.input;
    }

    messages.push(baseMsg);
    return messages;
  }

  // Reset state for new execution
  reset(): void {
    this.activeToolCalls.clear();
  }
}
