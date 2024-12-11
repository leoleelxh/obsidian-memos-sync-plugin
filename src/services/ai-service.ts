import { AIModelType } from '../models/settings';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// 定义 Gemini 模型类型
export interface GeminiModel {
    name: string;
    displayName: string;
    description: string;
    inputTypes: string[];
    outputTypes: string[];
}

// 预定义的 Gemini 模型列表
export const GEMINI_MODELS: GeminiModel[] = [
    {
        name: 'gemini-1.5-flash',
        displayName: 'Gemini 1.5 Flash',
        description: '在各种任务中提供快速、多样化的性能',
        inputTypes: ['音频', '图片', '视频', '文本'],
        outputTypes: ['文本']
    },
    {
        name: 'gemini-1.5-flash-8b',
        displayName: 'Gemini 1.5 Flash-8B',
        description: '量大且智能程度较低的任务',
        inputTypes: ['音频', '图片', '视频', '文本'],
        outputTypes: ['文本']
    },
    {
        name: 'gemini-1.5-pro',
        displayName: 'Gemini 1.5 Pro',
        description: '需要更多智能的复杂推理任务',
        inputTypes: ['音频', '图片', '视频', '文本'],
        outputTypes: ['文本']
    },
    {
        name: 'gemini-1.0-pro',
        displayName: 'Gemini 1.0 Pro (将于 2025 年 2 月 15 日弃用)',
        description: '自然语言任务、多轮文本和代码聊天以及代码生成',
        inputTypes: ['文本'],
        outputTypes: ['文本']
    }
];

// AI 服务接口
export interface AIService {
    generateSummary(content: string, language: string): Promise<string>;
    generateTags(content: string): Promise<string[]>;
    generateWeeklyDigest(contents: string[]): Promise<string>;
}

// AI 服务工厂
export function createAIService(modelType: AIModelType, apiKey: string, modelName: string): AIService {
    switch (modelType) {
        case 'openai':
            return new OpenAIService(apiKey, modelName);
        case 'gemini':
            return new GeminiService(apiKey, modelName);
        case 'claude':
            return new ClaudeService(apiKey, modelName);
        case 'ollama':
            return new OllamaService(apiKey, modelName);
        default:
            throw new Error(`Unsupported AI model type: ${modelType}`);
    }
}

// Gemini 服务实现
class GeminiService implements AIService {
    private genAI: GoogleGenerativeAI;
    private model: GenerativeModel;

    constructor(private apiKey: string, private modelName: string) {
        this.genAI = new GoogleGenerativeAI(apiKey);
        this.model = this.genAI.getGenerativeModel({ model: modelName });
    }

    async generateSummary(content: string, language: string): Promise<string> {
        try {
            const prompt = `请用${language}语言简洁地总结以下内容（100字以内）：\n\n${content}`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('生成摘要失败:', error);
            return '';
        }
    }

    async generateTags(content: string): Promise<string[]> {
        try {
            const prompt = `请为以下内容生成3-5个相关标签（不要带#号，直接返回英文标签，用逗号分隔）：\n\n${content}`;
            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const tags = response.text().split(',').map((tag: string) => tag.trim());
            return tags.filter((tag: string) => tag.length > 0);
        } catch (error) {
            console.error('生成标签失败:', error);
            return [];
        }
    }

    async generateWeeklyDigest(contents: string[]): Promise<string> {
        try {
            const combinedContent = contents.join('\n---\n');
            const prompt = `请以markdown格式总结以下内容，生成一份温暖、积极且富有洞察力的周报。要求：
1. 用简练但生动的语言描述本周的主要活动和思考
2. 找出内容中的规律和见解
3. 突出重要的成就和进展
4. 指出可能的改进方向
5. 保持积极向上的基调，但也要客观

格式要求：
- 使用markdown格式
- 适当使用emoji增加可读性
- 分点列举，层次分明
- 语言要有温度，像在和朋友分享

内容：
${combinedContent}`;

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            console.error('生成周报失败:', error);
            return '';
        }
    }
}

// OpenAI 服务实现
class OpenAIService implements AIService {
    constructor(private apiKey: string, private modelName: string) {}

    async generateSummary(content: string, language: string): Promise<string> {
        return '';
    }

    async generateTags(content: string): Promise<string[]> {
        return [];
    }

    async generateWeeklyDigest(contents: string[]): Promise<string> {
        return '';
    }
}

// Claude 服务实现
class ClaudeService implements AIService {
    constructor(private apiKey: string, private modelName: string) {}

    async generateSummary(content: string, language: string): Promise<string> {
        return '';
    }

    async generateTags(content: string): Promise<string[]> {
        return [];
    }

    async generateWeeklyDigest(contents: string[]): Promise<string> {
        return '';
    }
}

// Ollama 服务实现
class OllamaService implements AIService {
    constructor(private apiKey: string, private modelName: string) {}

    async generateSummary(content: string, language: string): Promise<string> {
        return '';
    }

    async generateTags(content: string): Promise<string[]> {
        return [];
    }

    async generateWeeklyDigest(contents: string[]): Promise<string> {
        return '';
    }
}

// 创建一个空的 AI 服务实现
export function createDummyAIService(): AIService {
    return {
        generateSummary: async () => '',
        generateTags: async () => [],
        generateWeeklyDigest: async () => ''
    };
} 