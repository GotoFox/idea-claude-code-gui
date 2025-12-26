# Codex CLI 直连架构方案

## 1. 背景与动机

### 1.1 当前架构问题

当前实现使用 `@openai/codex-sdk` TypeScript SDK：

```
Frontend → Java Plugin → Node.js (ai-bridge) → @openai/codex-sdk → OpenAI API
```

**问题**：
- `@openai/codex-sdk` 包体积较大
- 需要维护额外的 Node.js 依赖
- 与 Codex CLI 功能不完全一致

### 1.2 新架构目标

直接调用用户本地安装的 Codex CLI：

```
Frontend → Java Plugin → Codex CLI (exec --json) → OpenAI API
```

**优势**：
- 零额外依赖（用户已安装 Codex CLI）
- 包体积显著减小
- 与 Codex CLI 功能完全一致
- 用户可自行升级 CLI 版本

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (React)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ ProviderSelect  │  │  ModelSelect    │  │  ChatInputBox       │  │
│  │ (codex)         │  │  (gpt-5.1-*)    │  │  (message input)    │  │
│  └────────┬────────┘  └────────┬────────┘  └──────────┬──────────┘  │
│           │                    │                      │             │
│           └────────────────────┴──────────────────────┘             │
│                                │                                    │
│                      postMessage('send_message')                    │
└────────────────────────────────┼────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       Java IDE Plugin                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐  │
│  │ ClaudeSession   │  │ SettingsHandler │  │ HandlerContext      │  │
│  │ (provider=codex)│  │ (config)        │  │ (bridges)           │  │
│  └────────┬────────┘  └─────────────────┘  └─────────────────────┘  │
│           │                                                         │
│           ▼                                                         │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    CodexCLIBridge (NEW)                     │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │    │
│  │  │ CLI Executor │  │ JSON Parser  │  │ Session Manager  │   │    │
│  │  │ (Process)    │  │ (Streaming)  │  │ (Thread State)   │   │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │    │
│  └────────┬─────────────────┬────────────────────┬─────────────┘    │
└───────────┼─────────────────┼────────────────────┼──────────────────┘
            │                 │                    │
            ▼                 ▼                    ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Codex CLI (用户本地安装)                        │
│                                                                   │
│  codex exec --json --full-auto "<task>"                           │
│  codex exec --json resume --last "<task>"                         │
│                                                                   │
│  环境变量: CODEX_API_KEY                                           │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 CodexCLIBridge (替换 CodexSDKBridge)

新的 Java 桥接类，直接调用 Codex CLI：

```java
public class CodexCLIBridge {

    // CLI 可执行文件路径
    private String codexExecutable = "codex";

    // 当前会话 ID（用于 resume）
    private String currentThreadId = null;

    // 消息回调接口（复用现有）
    public interface MessageCallback {
        void onMessage(String type, String content);
        void onError(String error);
        void onComplete(CLIResult result);
        void onThreadStarted(String threadId);
        void onItemStarted(ItemInfo item);
        void onItemCompleted(ItemInfo item);
        void onTurnCompleted(UsageInfo usage);
    }

    // CLI 执行结果
    public static class CLIResult {
        public boolean success;
        public String error;
        public String threadId;
        public String finalMessage;
        public List<ItemInfo> items;
        public UsageInfo usage;
    }

    // 项目信息
    public static class ItemInfo {
        public String id;
        public String type;  // agent_message, command_execution, file_change, etc.
        public String text;
        public String command;
        public String status;
    }

    // 使用量信息
    public static class UsageInfo {
        public int inputTokens;
        public int cachedInputTokens;
        public int outputTokens;
    }
}
```

#### 2.2.2 CLI 命令构建器

```java
public class CodexCommandBuilder {

    private String task;
    private String workingDirectory;
    private String model;
    private String apiKey;
    private boolean fullAuto = true;
    private boolean skipGitCheck = true;
    private String sandbox = null;  // null, "read-only", "danger-full-access"
    private String resumeId = null;
    private boolean resumeLast = false;

    public String[] build() {
        List<String> args = new ArrayList<>();
        args.add(codexExecutable);
        args.add("exec");
        args.add("--json");  // JSON Lines 流式输出

        if (fullAuto) {
            args.add("--full-auto");
        }

        if (skipGitCheck) {
            args.add("--skip-git-repo-check");
        }

        if (sandbox != null) {
            args.add("--sandbox");
            args.add(sandbox);
        }

        if (model != null) {
            args.add("--model");
            args.add(model);
        }

        // 恢复会话
        if (resumeLast) {
            args.add("resume");
            args.add("--last");
        } else if (resumeId != null) {
            args.add("resume");
            args.add(resumeId);
        }

        // 任务内容
        args.add(task);

        return args.toArray(new String[0]);
    }
}
```

### 2.3 JSON Lines 流式解析

Codex CLI `--json` 模式输出 JSON Lines 格式：

```jsonl
{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}
{"type":"turn.started"}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"bash -lc ls","status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_3","type":"agent_message","text":"分析完成。"}}
{"type":"turn.completed","usage":{"input_tokens":24763,"cached_input_tokens":24448,"output_tokens":122}}
```

#### 事件类型映射

| CLI 事件 | 回调方法 | 说明 |
|---------|---------|------|
| `thread.started` | `onThreadStarted(threadId)` | 会话创建，保存 threadId |
| `turn.started` | - | 新回合开始 |
| `item.started` | `onItemStarted(item)` | 项目开始（命令、文件修改等） |
| `item.completed` | `onItemCompleted(item)` | 项目完成，如 `agent_message` 则调用 `onMessage` |
| `turn.completed` | `onTurnCompleted(usage)` | 回合完成，包含 token 使用量 |
| `turn.failed` | `onError(error)` | 回合失败 |
| `error` | `onError(error)` | 错误事件 |

### 2.4 进程管理

```java
public CompletableFuture<CLIResult> sendMessage(
    String task,
    String threadId,
    String cwd,
    String model,
    String apiKey,
    MessageCallback callback
) {
    return CompletableFuture.supplyAsync(() -> {
        ProcessBuilder pb = new ProcessBuilder(
            buildCommand(task, threadId, model)
        );

        // 设置工作目录
        if (cwd != null) {
            pb.directory(new File(cwd));
        }

        // 设置环境变量（API Key）
        Map<String, String> env = pb.environment();
        if (apiKey != null) {
            env.put("CODEX_API_KEY", apiKey);
        }

        // 合并 stderr 到 stdout（进度信息在 stderr）
        pb.redirectErrorStream(false);

        Process process = pb.start();

        // 解析 stdout (JSON Lines)
        BufferedReader stdout = new BufferedReader(
            new InputStreamReader(process.getInputStream())
        );

        // 解析 stderr (进度信息，可选显示)
        BufferedReader stderr = new BufferedReader(
            new InputStreamReader(process.getErrorStream())
        );

        // 异步读取 stderr（进度日志）
        readStderrAsync(stderr);

        // 同步读取 stdout（JSON 事件）
        return parseJsonLines(stdout, callback);
    }, executor);
}
```

---

## 3. 接口变更

### 3.1 保持兼容的接口

以下接口保持不变，确保前端无需修改：

```java
// MessageCallback 接口保持兼容
public interface MessageCallback {
    void onMessage(String type, String content);
    void onError(String error);
    void onComplete(Result result);  // Result 结构略有调整
}

// 发送消息的签名保持兼容
public CompletableFuture<?> sendMessage(
    String channelId,
    String message,
    String sessionId,
    String cwd,
    List<Attachment> attachments,
    String permissionMode,
    String model,
    MessageCallback callback
);
```

### 3.2 新增接口

```java
// 设置 Codex CLI 路径
public void setCodexExecutable(String path);

// 获取当前会话 ID
public String getCurrentThreadId();

// 检查 CLI 环境
public CLIEnvironment checkEnvironment();

public static class CLIEnvironment {
    public boolean available;      // CLI 是否可用
    public String version;         // CLI 版本
    public String path;            // CLI 路径
    public boolean authenticated;  // 是否已认证
    public String error;           // 错误信息
}
```

### 3.3 移除的接口

```java
// 移除 Node.js 相关
// - setNodeExecutable()
// - ai-bridge 相关的所有代码
```

---

## 4. 配置与认证

### 4.1 CLI 路径检测

```java
public String detectCodexPath() {
    // 1. 用户配置的路径
    if (customPath != null && isExecutable(customPath)) {
        return customPath;
    }

    // 2. PATH 环境变量
    String pathResult = executeCommand("which", "codex");
    if (pathResult != null) {
        return pathResult.trim();
    }

    // 3. 常见安装位置
    String[] commonPaths = {
        "/usr/local/bin/codex",
        "/opt/homebrew/bin/codex",
        System.getProperty("user.home") + "/.local/bin/codex",
        // Windows
        System.getenv("APPDATA") + "\\npm\\codex.cmd"
    };

    for (String path : commonPaths) {
        if (isExecutable(path)) {
            return path;
        }
    }

    return null;
}
```

### 4.2 认证方式

Codex CLI 支持两种认证方式：

1. **ChatGPT 账号认证**（推荐）
   - 用户运行 `codex` 进入交互模式完成认证
   - 认证信息存储在 `~/.codex/`

2. **API Key 认证**
   - 通过环境变量 `CODEX_API_KEY` 传递
   - 用户在插件设置中配置

```java
// 检查认证状态
public boolean isAuthenticated() {
    // 尝试执行简单命令检查认证
    String[] cmd = {codexExecutable, "exec", "--json", "echo test"};
    ProcessBuilder pb = new ProcessBuilder(cmd);
    Process p = pb.start();

    // 读取输出判断是否认证
    // 如果出现 "thread.started" 事件则已认证
    // 如果出现认证错误则未认证
    return checkAuthFromOutput(p);
}
```

---

## 5. 实现步骤

### Phase 1: 核心桥接 (优先级: 高)

1. **创建 `CodexCLIBridge.java`**
   - CLI 命令构建
   - 进程管理
   - JSON Lines 解析
   - 流式回调

2. **修改 `ClaudeSession.java`**
   - 切换 `codexSDKBridge` → `codexCLIBridge`
   - 调整消息发送逻辑

### Phase 2: 配置管理 (优先级: 中)

3. **修改 `SettingsHandler.java`**
   - 添加 Codex CLI 路径设置
   - 添加 API Key 设置
   - 移除 Node.js 路径设置（针对 Codex）

4. **更新前端设置界面**
   - Codex CLI 路径输入
   - 环境检测状态显示

### Phase 3: 清理 (优先级: 低)

5. **移除 SDK 相关代码**
   - 删除 `ai-bridge/services/codex/`
   - 从 `channel-manager.js` 移除 codex 相关
   - 从 `package.json` 移除 `@openai/codex-sdk`

6. **删除 `CodexSDKBridge.java`**

---

## 6. 代码示例

### 6.1 CodexCLIBridge 核心实现

```java
package com.github.claudecodegui;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.io.*;
import java.util.*;
import java.util.concurrent.*;

public class CodexCLIBridge {
    private static final Logger LOG = Logger.getInstance(CodexCLIBridge.class);
    private static final Gson gson = new Gson();

    private String codexExecutable = "codex";
    private String currentThreadId = null;
    private final ExecutorService executor = Executors.newCachedThreadPool();

    public CompletableFuture<CLIResult> sendMessage(
        String channelId,
        String message,
        String sessionId,
        String cwd,
        List<Object> attachments,
        String permissionMode,
        String model,
        MessageCallback callback
    ) {
        return CompletableFuture.supplyAsync(() -> {
            CLIResult result = new CLIResult();

            try {
                // 构建命令
                List<String> command = buildCommand(message, sessionId, model, permissionMode);
                LOG.info("Executing Codex CLI: " + String.join(" ", command));

                ProcessBuilder pb = new ProcessBuilder(command);
                if (cwd != null) {
                    pb.directory(new File(cwd));
                }

                // 设置 API Key 环境变量（如果有）
                String apiKey = getApiKey();
                if (apiKey != null) {
                    pb.environment().put("CODEX_API_KEY", apiKey);
                }

                Process process = pb.start();

                // 异步读取 stderr（进度信息）
                readStderrAsync(process.getErrorStream());

                // 同步读取 stdout（JSON Lines）
                try (BufferedReader reader = new BufferedReader(
                    new InputStreamReader(process.getInputStream())
                )) {
                    String line;
                    StringBuilder finalMessage = new StringBuilder();

                    while ((line = reader.readLine()) != null) {
                        if (line.trim().isEmpty()) continue;

                        try {
                            JsonObject event = gson.fromJson(line, JsonObject.class);
                            String type = event.get("type").getAsString();

                            switch (type) {
                                case "thread.started":
                                    String threadId = event.get("thread_id").getAsString();
                                    currentThreadId = threadId;
                                    result.threadId = threadId;
                                    if (callback != null) {
                                        callback.onMessage("thread_started", threadId);
                                    }
                                    break;

                                case "item.completed":
                                    JsonObject item = event.getAsJsonObject("item");
                                    String itemType = item.get("type").getAsString();

                                    if ("agent_message".equals(itemType)) {
                                        String text = item.get("text").getAsString();
                                        finalMessage.append(text);
                                        if (callback != null) {
                                            callback.onMessage("content", text);
                                        }
                                    }
                                    break;

                                case "turn.completed":
                                    if (callback != null) {
                                        callback.onMessage("message_end", "");
                                    }
                                    break;

                                case "turn.failed":
                                case "error":
                                    String error = event.has("message")
                                        ? event.get("message").getAsString()
                                        : "Unknown error";
                                    result.error = error;
                                    if (callback != null) {
                                        callback.onError(error);
                                    }
                                    break;
                            }
                        } catch (Exception e) {
                            LOG.warn("Failed to parse JSON line: " + line, e);
                        }
                    }

                    result.finalMessage = finalMessage.toString();
                }

                int exitCode = process.waitFor();
                result.success = (exitCode == 0);

                if (callback != null) {
                    callback.onComplete(result);
                }

            } catch (Exception e) {
                LOG.error("Codex CLI execution failed", e);
                result.success = false;
                result.error = e.getMessage();
                if (callback != null) {
                    callback.onError(e.getMessage());
                    callback.onComplete(result);
                }
            }

            return result;
        }, executor);
    }

    private List<String> buildCommand(String task, String sessionId, String model, String permissionMode) {
        List<String> args = new ArrayList<>();
        args.add(codexExecutable);
        args.add("exec");
        args.add("--json");

        // 权限模式
        if ("full-auto".equals(permissionMode) || permissionMode == null) {
            args.add("--full-auto");
        }

        args.add("--skip-git-repo-check");

        // 模型
        if (model != null && !model.isEmpty()) {
            args.add("--model");
            args.add(model);
        }

        // 恢复会话
        if (sessionId != null && !sessionId.isEmpty()) {
            args.add("resume");
            args.add(sessionId);
        } else if (currentThreadId != null) {
            // 自动恢复上一个会话
            args.add("resume");
            args.add("--last");
        }

        // 任务
        args.add(task);

        return args;
    }

    private void readStderrAsync(InputStream stderr) {
        executor.submit(() -> {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stderr))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    LOG.info("[Codex stderr] " + line);
                }
            } catch (IOException e) {
                LOG.warn("Error reading stderr", e);
            }
        });
    }

    public CLIEnvironment checkEnvironment() {
        CLIEnvironment env = new CLIEnvironment();

        try {
            ProcessBuilder pb = new ProcessBuilder(codexExecutable, "--version");
            Process process = pb.start();

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            );
            String version = reader.readLine();

            int exitCode = process.waitFor();

            if (exitCode == 0 && version != null) {
                env.available = true;
                env.version = version.trim();
                env.path = codexExecutable;
            } else {
                env.available = false;
                env.error = "Codex CLI not found or not executable";
            }
        } catch (Exception e) {
            env.available = false;
            env.error = e.getMessage();
        }

        return env;
    }

    // Getters/Setters
    public void setCodexExecutable(String path) {
        this.codexExecutable = path;
    }

    public String getCurrentThreadId() {
        return currentThreadId;
    }

    // Inner classes
    public interface MessageCallback {
        void onMessage(String type, String content);
        void onError(String error);
        void onComplete(CLIResult result);
    }

    public static class CLIResult {
        public boolean success;
        public String error;
        public String threadId;
        public String finalMessage;
    }

    public static class CLIEnvironment {
        public boolean available;
        public String version;
        public String path;
        public String error;
    }
}
```

---

## 7. 对比分析

### 7.1 架构对比

| 维度 | SDK 方案 (当前) | CLI 方案 (新) |
|------|----------------|---------------|
| 依赖 | @openai/codex-sdk + Node.js | 用户本地 Codex CLI |
| 包体积 | 较大 (SDK + 依赖) | 极小 (仅 Java 代码) |
| 维护 | 需跟踪 SDK 版本 | 用户自行升级 CLI |
| 功能一致性 | 可能滞后于 CLI | 完全一致 |
| 部署复杂度 | 高 (需 Node.js 环境) | 低 (仅需 CLI 安装) |

### 7.2 功能对比

| 功能 | SDK 方案 | CLI 方案 |
|------|---------|---------|
| 流式输出 | SDK 事件 | JSON Lines |
| 会话恢复 | threadId | resume --last / session_id |
| 文件编辑 | SDK 配置 | --full-auto |
| 网络访问 | SDK 配置 | --sandbox danger-full-access |
| 认证 | apiKey 参数 | CODEX_API_KEY 环境变量或 CLI 认证 |

---

## 8. 风险与缓解

### 8.1 风险分析

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 用户未安装 CLI | 无法使用 Codex | 检测并提示安装指引 |
| CLI 版本不兼容 | 解析失败 | 版本检查 + 最低版本要求 |
| 认证失败 | 无法调用 API | 检测认证状态并引导 |
| JSON 格式变更 | 解析异常 | 宽松解析 + 错误恢复 |

### 8.2 最低版本要求

建议要求 Codex CLI >= 0.23.0（修复了安全漏洞的版本）

---

## 9. 参考资料

- [Codex CLI 官方文档](https://developers.openai.com/codex/cli)
- [Codex CLI 命令行参考](https://developers.openai.com/codex/cli/reference/)
- [GitHub - openai/codex](https://github.com/openai/codex)
