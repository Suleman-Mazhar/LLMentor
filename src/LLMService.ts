import { ChatOllama } from '@langchain/ollama';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, AIMessage, SystemMessage, BaseMessage } from '@langchain/core/messages';

export type LLMProvider = 'ollama' | 'anthropic' | 'openai';

export interface LLMConfig {
    provider: LLMProvider;
    model: string;
    apiKey?: string;        // For paid APIs
    baseUrl?: string;       // For Ollama (default: http://localhost:11434)
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
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
                    return new AIMessage(msg.content);
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

        // Add system prompt if provided
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

    // Streaming version for better UX
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
}