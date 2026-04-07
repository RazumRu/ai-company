export interface SystemAgentDefinition {
  id: string;
  name: string;
  description: string;
  tools: string[];
  defaultModel: string | null;
  instructions: string;
  contentHash: string;
  templateId: string;
}
