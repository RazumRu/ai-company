import { ChatMessage } from '@langchain/core/messages';

export class ReasoningMessage extends ChatMessage {
  constructor(content: string) {
    super(content, 'reasoning');
  }
}
