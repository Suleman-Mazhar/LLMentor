import { ChatOllama } from '@langchain/ollama';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

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

export interface ToolDefinition {
    name: string;
    description: string;
    parameters: any;
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

    public async chatWithTools(
        messages: ChatMessage[],
        systemPrompt: string,
        tools: ToolDefinition[]
    ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
        if (!this.llm) {
            throw new Error('LLM not initialized');
        }

        const allMessages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            ...messages
        ];

        const langChainMessages = this.convertToLangChainMessages(allMessages);

        // Convert tool definitions to LangChain format
        const langChainTools = tools.map(t => {
            const schemaObj: any = {};
            if (t.parameters.properties) {
                for (const [key, value] of Object.entries(t.parameters.properties)) {
                    const prop = value as any;
                    if (prop.type === 'string') {
                        schemaObj[key] = prop.enum
                            ? z.enum(prop.enum).optional().describe(prop.description || '')
                            : z.string().optional().describe(prop.description || '');
                    } else if (prop.type === 'number') {
                        schemaObj[key] = z.number().optional().describe(prop.description || '');
                    } else if (prop.type === 'array') {
                        schemaObj[key] = z.array(z.number()).optional().describe(prop.description || '');
                    }
                }
            }

            return tool(
                async (input) => JSON.stringify(input),
                {
                    name: t.name,
                    description: t.description,
                    schema: z.object(schemaObj)
                }
            );
        });

        try {
            const llmWithTools = this.llm.bindTools(langChainTools);
            const response = await llmWithTools.invoke(langChainMessages);

            const toolCalls: ToolCall[] = [];
            if (response.tool_calls && response.tool_calls.length > 0) {
                for (const tc of response.tool_calls) {
                    toolCalls.push({
                        id: tc.id || `call_${Date.now()}`,
                        name: tc.name,
                        args: tc.args
                    });
                }
            }

            return {
                content: response.content as string,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined
            };
        } catch (error) {
            console.error('LLM Tool Error:', error);
            throw error;
        }
    }
}