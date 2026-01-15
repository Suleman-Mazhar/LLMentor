import { ChatOllama } from '@langchain/ollama';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';

export type LLMProvider = 'ollama' | 'anthropic' | 'openai';

export interface LLMConfig {
    provider: LLMProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    name: string;
    args: any;
}

export interface TargetedSection {
    understood: boolean;
    concept: string;
    startLine: number;
    endLine: number;
    explanation: string;
}

export class LLMService {
    private config: LLMConfig;
    private llm: ChatOllama | ChatAnthropic | ChatOpenAI | null = null;

    constructor(config: LLMConfig) {
        this.config = config;
        this.initializeLLM();
    }

    private initializeLLM() {
        switch (this.config.provider) {
            case 'ollama':
                this.llm = new ChatOllama({
                    model: this.config.model,
                    baseUrl: this.config.baseUrl || 'http://localhost:11434',
                });
                break;

            case 'anthropic':
                if (!this.config.apiKey) {
                    throw new Error('Anthropic API key is required');
                }
                this.llm = new ChatAnthropic({
                    model: this.config.model,
                    apiKey: this.config.apiKey,
                });
                break;

            case 'openai':
                if (!this.config.apiKey) {
                    throw new Error('OpenAI API key is required');
                }
                this.llm = new ChatOpenAI({
                    model: this.config.model,
                    apiKey: this.config.apiKey,
                });
                break;

            default:
                throw new Error(`Unknown provider: ${this.config.provider}`);
        }
    }

    public updateConfig(config: LLMConfig) {
        this.config = config;
        this.initializeLLM();
    }

    public getConfig(): LLMConfig {
        return this.config;
    }

    private convertToLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
        return messages.map((msg) => {
            switch (msg.role) {
                case 'system':
                    return new SystemMessage(msg.content);
                case 'user':
                    return new HumanMessage(msg.content);
                case 'assistant':
                    if (msg.toolCalls && msg.toolCalls.length > 0) {
                        return new AIMessage({
                            content: msg.content,
                            tool_calls: msg.toolCalls.map(tc => ({
                                id: tc.id,
                                name: tc.name,
                                args: tc.args
                            }))
                        });
                    }
                    return new AIMessage(msg.content);
                case 'tool':
                    return new ToolMessage({
                        content: msg.content,
                        tool_call_id: msg.toolCallId || ''
                    });
                default:
                    return new HumanMessage(msg.content);
            }
        });
    }

    public async chat(messages: ChatMessage[], systemPrompt?: string): Promise<string> {
        if (!this.llm) {
            throw new Error('LLM not initialized');
        }

        const allMessages: ChatMessage[] = [];

        if (systemPrompt) {
            allMessages.push({ role: 'system', content: systemPrompt });
        }

        allMessages.push(...messages);

        const langChainMessages = this.convertToLangChainMessages(allMessages);

        try {
            const response = await this.llm.invoke(langChainMessages);
            return response.content as string;
        } catch (error) {
            console.error('LLM Error:', error);
            throw error;
        }
    }

    public async *chatStream(messages: ChatMessage[], systemPrompt?: string): AsyncGenerator<string> {
        if (!this.llm) {
            throw new Error('LLM not initialized');
        }

        const allMessages: ChatMessage[] = [];

        if (systemPrompt) {
            allMessages.push({ role: 'system', content: systemPrompt });
        }

        allMessages.push(...messages);

        const langChainMessages = this.convertToLangChainMessages(allMessages);

        try {
            const stream = await this.llm.stream(langChainMessages);
            for await (const chunk of stream) {
                if (chunk.content) {
                    yield chunk.content as string;
                }
            }
        } catch (error) {
            console.error('LLM Stream Error:', error);
            throw error;
        }
    }

    public async identifyTargetedSection(
        code: string,
        question: string,
        fileName: string
    ): Promise<TargetedSection | null> {
        if (!this.llm) {
            throw new Error('LLM not initialized');
        }

        const prompt = `You are a code analyzer. A student is asking about a specific part of their code.

Here's the code with line numbers:
File: ${fileName}

${code.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n')}

Student's question: "${question}"

Analyze the question and identify which lines of code the student is asking about.

You MUST respond with ONLY a JSON object in this exact format, no other text:
{
    "understood": true,
    "concept": "brief name of the concept (e.g., 'for loop', 'dictionary', 'function call')",
    "startLine": <number>,
    "endLine": <number>,
    "explanation": "one sentence explaining what this section does"
}

If the question is not about a specific part of the code, or you can't identify relevant lines, respond with:
{
    "understood": false,
    "concept": "",
    "startLine": 0,
    "endLine": 0,
    "explanation": ""
}

Rules:
- startLine and endLine should be actual line numbers from the code
- Include all related lines (e.g., if asking about a loop, include the entire loop body)
- For multi-line constructs, include the full construct
- Be inclusive rather than exclusive when determining line ranges

Respond with ONLY the JSON object:`;

        try {
            const response = await this.llm.invoke([new HumanMessage(prompt)]);
            const content = response.content as string;
            
            // Extract JSON from the response
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return parsed as TargetedSection;
            }
            
            return null;
        } catch (error) {
            console.error('Error identifying targeted section:', error);
            return null;
        }
    }
}