import styles from './style.module.less';
import { useTranslation } from 'react-i18next';
import { useState, useEffect } from 'react';
import { getEnhancePromptConfig, saveEnhancePromptConfig, DEFAULT_ENHANCE_TEMPLATE, setProvidersCache } from '../../../utils/enhancePrompt';
import type { ProviderConfig } from '../../../types/provider';

const EnhancePromptSection = () => {
  const { t } = useTranslation();

  // 增强提示词配置
  const [enhanceEnabled, setEnhanceEnabled] = useState(false);
  const [enhanceTemplate, setEnhanceTemplate] = useState(DEFAULT_ENHANCE_TEMPLATE);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [specificModel, setSpecificModel] = useState('');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // 从供应商配置中提取可用模型列表
  const extractModelsFromProvider = (provider: ProviderConfig): string[] => {
    if (provider.settingsConfig && provider.settingsConfig.env) {
      const env = provider.settingsConfig.env as Record<string, any>;
      const models = [
        env.ANTHROPIC_MODEL,
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
        env.ANTHROPIC_DEFAULT_SONNET_MODEL,
        env.ANTHROPIC_DEFAULT_OPUS_MODEL,
        env.OPENAI_MODEL,
        env.GEMINI_MODEL
      ].filter(Boolean);
      return [...new Set(models)];
    }
    return [];
  };

  // 加载供应商列表
  useEffect(() => {
    const updateProvidersHandler = (jsonStr: string) => {
      try {
        const providersList: ProviderConfig[] = JSON.parse(jsonStr);
        setProviders(providersList);
        setProvidersCache(providersList);

        // 如果使用当前供应商，更新模型列表
        if (!selectedProviderId) {
          const activeProvider = providersList.find(p => p.isActive);
          if (activeProvider) {
            setAvailableModels([]);
            setAvailableModels(extractModelsFromProvider(activeProvider));
          }
        }
      } catch (error) {
        console.error('[EnhancePromptSection] Failed to parse providers:', error);
      }
    };

    (window as any).updateProviders = updateProvidersHandler;

    try {
      const storedProviders = localStorage.getItem('providers');
      if (storedProviders) {
        const providersList = JSON.parse(storedProviders) as ProviderConfig[];
        setProviders(providersList);

        if (!selectedProviderId) {
          const activeProvider = providersList.find(p => p.isActive);
          if (activeProvider) {
            setAvailableModels(extractModelsFromProvider(activeProvider));
          }
        }
      }
    } catch (error) {
      console.error('[EnhancePromptSection] Failed to load providers:', error);
    }

    if ((window as any).sendToJava) {
      (window as any).sendToJava('get_providers:');
    }

    return () => {
      if ((window as any).updateProviders === updateProvidersHandler) {
        delete (window as any).updateProviders;
      }
    };
  }, [selectedProviderId]);

  // 加载增强提示词配置
  useEffect(() => {
    const config = getEnhancePromptConfig();
    setEnhanceEnabled(config.enabled);
    setEnhanceTemplate(config.template || DEFAULT_ENHANCE_TEMPLATE);
    setSelectedProviderId(config.providerId || '');
    setSpecificModel(config.specificModel || '');
  }, []);

  // 当 providers 或 selectedProviderId 变化时更新模型列表
  useEffect(() => {
    if (providers.length === 0) return;

    if (selectedProviderId) {
      const selectedProvider = providers.find(p => p.id === selectedProviderId);
      if (selectedProvider) {
        setAvailableModels(extractModelsFromProvider(selectedProvider));
      }
    } else {
      const activeProvider = providers.find(p => p.isActive);
      if (activeProvider) {
        setAvailableModels(extractModelsFromProvider(activeProvider));
      }
    }
  }, [providers, selectedProviderId]);

  // 保存增强提示词启用状态
  const handleEnhanceEnabledChange = (enabled: boolean) => {
    setEnhanceEnabled(enabled);
    const config = getEnhancePromptConfig();
    saveEnhancePromptConfig({
      ...config,
      enabled,
      providerId: selectedProviderId,
      specificModel
    });
  };

  // 保存增强提示词模板
  const handleEnhanceTemplateChange = (template: string) => {
    setEnhanceTemplate(template);
    const config = getEnhancePromptConfig();
    saveEnhancePromptConfig({
      ...config,
      template,
      providerId: selectedProviderId,
      specificModel
    });
  };

  // 保存选中的供应商
  const handleProviderIdChange = (providerId: string) => {
    setSelectedProviderId(providerId);
    setAvailableModels([]);

    if (providerId) {
      const selectedProvider = providers.find(p => p.id === providerId);
      if (selectedProvider) {
        setAvailableModels(extractModelsFromProvider(selectedProvider));
      }
    } else {
      const activeProvider = providers.find(p => p.isActive);
      if (activeProvider) {
        setAvailableModels(extractModelsFromProvider(activeProvider));
      }
    }

    setSpecificModel('');
    const config = getEnhancePromptConfig();
    saveEnhancePromptConfig({
      ...config,
      providerId,
      specificModel: ''
    });
  };

  // 保存指定模型
  const handleSpecificModelChange = (model: string) => {
    setSpecificModel(model);
    const config = getEnhancePromptConfig();
    saveEnhancePromptConfig({
      ...config,
      providerId: selectedProviderId,
      specificModel: model
    });
  };

  return (
    <div className={styles.configSection}>
      <h3 className={styles.sectionTitle}>{t('settings.enhancePrompt.title')}</h3>
      <p className={styles.sectionDesc}>{t('settings.enhancePrompt.description')}</p>

      {/* 启用开关 */}
      <div className={styles.enhanceEnableWrapper}>
        <div className={styles.fieldHeader}>
          <span className="codicon codicon-sparkle" />
          <span className={styles.fieldLabel}>{t('settings.enhancePrompt.enable')}</span>
        </div>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={enhanceEnabled}
            onChange={(e) => handleEnhanceEnabledChange(e.target.checked)}
          />
          <span>{t('settings.enhancePrompt.enableDesc')}</span>
        </label>
      </div>

      {/* 供应商和模型配置 */}
      {enhanceEnabled && (
        <div className={styles.providerModelSection}>
          <div className={styles.fieldHeader}>
            <span className="codicon codicon-plug" />
            <span className={styles.fieldLabel}>{t('settings.enhancePrompt.providerAndModel')}</span>
          </div>

          {/* 供应商选择 */}
          <div className={styles.optionGroup}>
            <div className={styles.optionLabel}>
              {t('settings.enhancePrompt.providerMode')}
            </div>
            <select
              className={styles.selectInput}
              value={selectedProviderId}
              onChange={(e) => handleProviderIdChange(e.target.value)}
            >
              <option value="">{t('settings.enhancePrompt.useCurrentProvider')}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </div>

          {/* 模型选择 */}
          <div className={styles.optionGroup}>
            <div className={styles.optionLabel}>
              {t('settings.enhancePrompt.modelMode')}
            </div>
            <select
              className={styles.selectInput}
              value={availableModels.includes(specificModel) ? specificModel : (specificModel ? 'custom' : '')}
              onChange={(e) => {
                const value = e.target.value;
                if (value === 'custom') {
                  handleSpecificModelChange('custom-placeholder');
                } else {
                  handleSpecificModelChange(value);
                }
              }}
            >
              {!selectedProviderId && <option value="">{t('settings.enhancePrompt.useCurrentModel')}</option>}
              {availableModels.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="custom">{t('settings.enhancePrompt.customModel')}</option>
            </select>
            {specificModel && !availableModels.includes(specificModel) && specificModel !== '' && (
              <input
                type="text"
                className={styles.textInput}
                placeholder={t('settings.enhancePrompt.modelPlaceholder')}
                value={specificModel === 'custom-placeholder' ? '' : specificModel}
                onChange={(e) => handleSpecificModelChange(e.target.value)}
              />
            )}
          </div>
        </div>
      )}

      {/* 模板配置 */}
      {enhanceEnabled && (
        <div className={styles.templateSection}>
          <div className={styles.fieldHeader}>
            <span className="codicon codicon-edit" />
            <span className={styles.fieldLabel}>{t('settings.enhancePrompt.template')}</span>
          </div>
          <textarea
            className={styles.templateTextarea}
            placeholder={t('settings.enhancePrompt.templatePlaceholder')}
            value={enhanceTemplate}
            onChange={(e) => handleEnhanceTemplateChange(e.target.value)}
            rows={8}
          />
          <small className={styles.formHint}>
            <span className="codicon codicon-info" />
            <span>{t('settings.enhancePrompt.templateHint')}</span>
          </small>
        </div>
      )}
    </div>
  );
};

export default EnhancePromptSection;
