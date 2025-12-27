/**
 * 增强提示词工具函数
 * 使用Claude API来增强用户的提示词
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ProviderConfig } from '../types/provider';

/**
 * 增强提示词配置
 */
export interface EnhancePromptConfig {
  /** 是否启用增强提示词功能 */
  enabled: boolean;
  /** 增强提示词模板,使用 ${userInput} 作为占位符 */
  template: string;
  /** 指定的供应商ID，为空时使用当前激活供应商 */
  providerId?: string;
  /** 指定的模型，为空时使用供应商的默认模型 */
  specificModel?: string;
}

/**
 * 供应商数据缓存（从 Java 后端获取）
 */
let cachedProviders: ProviderConfig[] = [];

/**
 * 设置供应商数据缓存
 */
export function setProvidersCache(providers: ProviderConfig[]): void {
  cachedProviders = providers;
}

/**
 * 默认增强提示词模板
 */
export const DEFAULT_ENHANCE_TEMPLATE = `Generate an enhanced version of this prompt (reply with only the enhanced prompt - no conversation, explanations, lead-in, bullet points, placeholders, or surrounding quotes):

\${userInput}`;

/**
 * 获取增强提示词配置
 */
export function getEnhancePromptConfig(): EnhancePromptConfig {
  try {
    const stored = localStorage.getItem('enhance-prompt-config');
    if (stored) {
      const config = JSON.parse(stored);
      return {
        enabled: config.enabled !== undefined ? config.enabled : true,
        template: config.template || DEFAULT_ENHANCE_TEMPLATE,
        providerId: config.providerId,
        specificModel: config.specificModel,
      };
    }
  } catch (error) {
    console.error('[EnhancePrompt] Failed to load config:', error);
  }

  return {
    enabled: true,
    template: DEFAULT_ENHANCE_TEMPLATE,
  };
}

/**
 * 保存增强提示词配置
 */
export function saveEnhancePromptConfig(config: EnhancePromptConfig): void {
  try {
    localStorage.setItem('enhance-prompt-config', JSON.stringify(config));
  } catch (error) {
    console.error('[EnhancePrompt] Failed to save config:', error);
  }
}

/**
 * 使用Claude API增强提示词
 * @param userInput 用户输入的原始提示词
 * @returns 增强后的提示词
 */
export async function enhancePrompt(
  userInput: string
): Promise<string> {
  if (!userInput || !userInput.trim()) {
    throw new Error('Input prompt is empty');
  }

  const config = getEnhancePromptConfig();

  if (!config.enabled) {
    throw new Error('Enhance prompt feature is disabled');
  }

  // 根据配置获取 API 配置
  let apiKey = '';
  let baseUrl = '';
  let model = '';

  try {
    // 根据配置获取供应商
    if (config.providerId) {
      // 使用指定供应商
      const providersList = cachedProviders.length > 0 ? cachedProviders : [];
      if (providersList.length === 0) {
        const providersStr = localStorage.getItem('providers');
        if (providersStr) {
          try {
            const parsed = JSON.parse(providersStr);
            providersList.push(...parsed);
          } catch (error) {
            console.error('[EnhancePrompt] Failed to parse providers:', error);
          }
        }
      }

      const specificProvider = providersList.find((p: ProviderConfig) => p.id === config.providerId);
      if (specificProvider && specificProvider.settingsConfig && specificProvider.settingsConfig.env) {
        const env = specificProvider.settingsConfig.env;
        apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
        baseUrl = env.ANTHROPIC_BASE_URL || '';
        model = config.specificModel || '';
      }
    } else {
      // 使用当前激活供应商
      let activeProvider: ProviderConfig | undefined;
      if (cachedProviders.length > 0) {
        activeProvider = cachedProviders.find(p => p.isActive);
      }

      if (!activeProvider) {
        const providersStr = localStorage.getItem('providers');
        if (providersStr) {
          try {
            const providersList = JSON.parse(providersStr) as ProviderConfig[];
            activeProvider = providersList.find(p => p.isActive);
          } catch (error) {
            console.error('[EnhancePrompt] Failed to parse providers:', error);
          }
        }
      }

      if (activeProvider && activeProvider.settingsConfig && activeProvider.settingsConfig.env) {
        const env = activeProvider.settingsConfig.env;
        apiKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || '';
        baseUrl = env.ANTHROPIC_BASE_URL || '';
        model = config.specificModel || '';
      }
    }
  } catch (error) {
    console.error('[EnhancePrompt] Failed to load provider config:', error);
  }

  if (!apiKey) {
    throw new Error('API key not configured. Please configure it in settings.');
  }

  const finalBaseUrl = baseUrl || 'https://api.anthropic.com';
  const finalModel = model || 'claude-sonnet-4-5-20250929';

  // 替换模板中的占位符
  const prompt = config.template.replace(/\$\{userInput\}/g, userInput.trim());

  try {
    // 创建Anthropic客户端
    const client = new Anthropic({
      apiKey: apiKey,
      baseURL: finalBaseUrl,
      dangerouslyAllowBrowser: true, // 允许在浏览器环境中使用
    });

    // 调用API
    const response = await client.messages.create({
      model: finalModel,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });


    // 提取响应内容
    const content = response.content;
    if (Array.isArray(content) && content.length > 0) {
      const textBlock = content.find((block: any) => block.type === 'text');
      if (textBlock && 'text' in textBlock) {
        return textBlock.text.trim();
      }
    }

    // 如果找不到标准格式，尝试其他可能的格式
    if (typeof response === 'object' && response !== null) {
      // 尝试直接从 response 中提取文本
      if ('text' in response && typeof response.text === 'string') {
        return response.text.trim();
      }
      // 尝试从 completion 字段提取
      if ('completion' in response && typeof response.completion === 'string') {
        return response.completion.trim();
      }
    }

    console.error('[EnhancePrompt] Unexpected response format:', response);
    throw new Error('Invalid response from API');
  } catch (error: any) {
    console.error('[EnhancePrompt] API error:', error);

    // 检查是否是 HTML 响应（通常是反爬虫页面）
    if (error.message && (error.message.includes('<html>') || error.message.includes('<HTML>'))) {
      throw new Error('代理服务器返回了验证页面，无法直接调用API。请尝试：\n1. 使用官方 API 端点\n2. 联系代理服务商检查配置\n3. 或使用不同的代理服务');
    }

    if (error.status === 401) {
      throw new Error('API Key 无效，请检查供应商配置');
    } else if (error.status === 429) {
      throw new Error('请求频率超限，请稍后再试');
    } else if (error.status === 403) {
      throw new Error('访问被拒绝，代理服务器可能需要额外验证');
    } else if (error.message) {
      // 检查错误消息中是否包含 HTML 标签
      if (/<[a-z][\s\S]*>/i.test(error.message)) {
        throw new Error('代理服务器返回了网页而非API响应，请检查代理配置或使用官方端点');
      }
      throw new Error(error.message);
    } else {
      throw new Error('增强失败，请检查网络连接和代理配置');
    }
  }
}
