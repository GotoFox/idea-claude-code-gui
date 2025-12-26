# Codex CLI 使用指南

## 前提条件

### 1. 安装 Codex CLI

Codex CLI 需要在本地安装才能使用。请根据你的操作系统选择安装方式：

**macOS/Linux (Homebrew):**
```bash
brew install --cask codex
```

**或使用 npm 全局安装:**
```bash
npm i -g @openai/codex
```

**验证安装:**
```bash
codex --version
```

### 2. 认证配置

Codex CLI 支持两种认证方式：

#### 方式 1：ChatGPT 账号认证（推荐）

1. 在终端运行 `codex` 进入交互模式
2. 按照提示使用 ChatGPT Plus/Pro/Business/Enterprise 账号登录
3. 认证信息会自动保存在 `~/.codex/` 目录

#### 方式 2：API Key 认证

如果你有 OpenAI API Key，可以在插件中配置（即将支持）。

---

## 使用步骤

### 步骤 1: 打开插件工具窗口

在 IDEA 中打开 **Claude Code** 工具窗口（通常在右侧边栏）。

### 步骤 2: 切换到 Codex 提供商

在聊天输入框的底部工具栏，找到 **提供商选择器**（Provider Select）：

1. 点击当前提供商（默认是 "Claude Code"）
2. 在弹出的下拉菜单中选择 **"Codex Cli"**
3. 提供商图标应该会切换为 OpenAI 图标

### 步骤 3: 选择 Codex 模型

切换提供商后，模型选择器会自动显示 Codex 可用的模型：

- **gpt-5.1-codex** - 针对 Codex 优化的默认模型
- **gpt-5.1-codex-mini** - 更快、更便宜，但性能略低
- **gpt-5.1** - 通用强大推理模型

### 步骤 4: 开始对话

选择模型后，就可以像使用 Claude 一样开始对话了！

---

## 功能说明

### 支持的功能

✅ **流式输出** - 实时显示 Codex 的响应
✅ **会话恢复** - 自动恢复上一次会话
✅ **文件编辑** - 支持文件创建、修改、删除
✅ **命令执行** - 支持在工作目录执行命令
✅ **工作目录** - 自动使用项目根目录

### 暂不支持的功能

❌ **附件上传** - Codex CLI 暂不支持图片附件（未来可能支持）
❌ **历史消息查询** - Codex CLI 不支持获取历史会话消息

---

## 配置选项

### 自定义 Codex CLI 路径

如果 Codex CLI 没有安装在标准路径，可以手动配置（即将支持）：

**Settings → Tools → Claude Code → Codex CLI Path**

默认路径检测顺序：
1. 用户配置的路径
2. PATH 环境变量 (`which codex`)
3. 常见安装位置：
   - macOS: `/usr/local/bin/codex`, `/opt/homebrew/bin/codex`
   - Linux: `~/.local/bin/codex`
   - Windows: `%APPDATA%\npm\codex.cmd`

---

## 故障排查

### 问题 1: "Codex CLI not found"

**原因**: Codex CLI 未安装或不在 PATH 中

**解决**:
```bash
# 检查是否已安装
which codex

# 如果未安装，使用 Homebrew 或 npm 安装
brew install --cask codex
# 或
npm i -g @openai/codex
```

### 问题 2: "Authentication failed"

**原因**: 未完成认证或认证过期

**解决**:
```bash
# 重新认证
codex

# 如果使用 API Key，设置环境变量（暂不支持）
export CODEX_API_KEY=your-api-key
```

### 问题 3: 消息发送失败

**原因**: 可能是网络问题、API 配额限制或 CLI 版本问题

**解决**:
1. 检查网络连接
2. 确认 ChatGPT Plus/Pro 订阅状态
3. 更新 Codex CLI 到最新版本：
   ```bash
   brew upgrade codex
   # 或
   npm update -g @openai/codex
   ```

### 问题 4: 提供商切换后没有反应

**解决**:
1. 确保已重新构建前端（`npm run build` in webview 目录）
2. 关闭并重新打开工具窗口
3. 重启 IDEA

---

## CLI 命令详解

插件在后台执行的实际命令（仅供参考）：

```bash
# 基本消息发送
codex exec --json --full-auto --skip-git-repo-check "你的消息"

# 指定模型
codex exec --json --full-auto --model gpt-5.1-codex "你的消息"

# 会话恢复
codex exec --json --full-auto resume --last "继续之前的对话"
```

**参数说明**:
- `--json`: 输出 JSON Lines 格式（用于解析）
- `--full-auto`: 自动模式，允许文件编辑
- `--skip-git-repo-check`: 跳过 Git 仓库检查
- `--model`: 指定使用的模型
- `resume --last`: 恢复最近的会话

---

## 性能对比

| 维度 | Claude Code | Codex CLI |
|------|-------------|-----------|
| 响应速度 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 代码生成 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 长上下文 | ⭐⭐⭐⭐⭐ (200K) | ⭐⭐⭐⭐ (128K) |
| 数学推理 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 文件操作 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 常见问题 (FAQ)

**Q: Codex CLI 和 Claude Code 可以同时使用吗？**

A: 可以！你可以随时在两者之间切换，每个提供商维护独立的会话。

**Q: Codex CLI 会话数据存储在哪里？**

A: 会话数据由 Codex CLI 管理，存储在 `~/.codex/` 目录。

**Q: 如何查看 Codex CLI 的日志？**

A: 插件会在 IDEA 的日志中记录 Codex CLI 的 stderr 输出。查看 **Help → Show Log in Finder/Explorer**。

**Q: 支持哪些 Codex 模型？**

A: 目前支持：
- `gpt-5.1-codex`（推荐）
- `gpt-5.1-codex-mini`
- `gpt-5.1`

**Q: Codex CLI 的使用是否收费？**

A: Codex CLI 需要 ChatGPT Plus/Pro/Business/Enterprise 订阅，或使用 OpenAI API Key（按量计费）。

---

## 反馈与支持

如果遇到问题或有建议，请：
1. 查看 IDEA 日志：**Help → Show Log in Finder/Explorer**
2. 提交 Issue：[GitHub Issues](https://github.com/your-repo/issues)
3. 查看 Codex CLI 官方文档：https://developers.openai.com/codex/cli

---

## 更新日志

### v0.1.2 (Current)
- ✅ 将 Codex Node SDK 迁移到 Codex CLI
- ✅ 启用 Codex 提供商选择
- ✅ 支持 JSON Lines 流式输出解析
- ✅ 支持会话自动恢复
- ✅ 移除 Node.js 依赖（仅针对 Codex）

### 即将推出
- 🔜 Codex API Key 配置界面
- 🔜 Codex CLI 路径自定义设置
- 🔜 使用量统计（Token 消耗）
