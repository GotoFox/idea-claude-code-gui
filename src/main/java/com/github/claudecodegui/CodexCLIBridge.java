package com.github.claudecodegui;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.intellij.openapi.diagnostic.Logger;

import java.io.BufferedReader;
import java.io.File;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Codex CLI 桥接类
 * 直接调用用户本地安装的 Codex CLI，无需 Node.js SDK
 */
public class CodexCLIBridge {

    private static final Logger LOG = Logger.getInstance(CodexCLIBridge.class);
    private static final Gson gson = new Gson();

    // CLI 可执行文件路径
    private String codexExecutable = "codex";

    // 当前会话 ID（用于 resume）
    private String currentThreadId = null;

    // API Key
    private String apiKey = null;

    // 线程池
    private final ExecutorService executor = Executors.newCachedThreadPool();

    // 进程管理
    private final Map<String, Process> activeProcesses = new ConcurrentHashMap<>();
    private final Map<String, Boolean> interruptedChannels = new ConcurrentHashMap<>();

    /**
     * CLI 消息回调接口（与 CodexSDKBridge 保持一致）
     */
    public interface MessageCallback {
        void onMessage(String type, String content);
        void onError(String error);
        void onComplete(CLIResult result);
    }

    /**
     * CLI 响应结果（与 CodexSDKBridge.SDKResult 保持兼容）
     */
    public static class CLIResult {
        public boolean success;
        public String error;
        public int messageCount;
        public List<Object> messages;
        public String rawOutput;
        public String finalResult;
        public String threadId;
        public UsageInfo usage;

        public CLIResult() {
            this.messages = new ArrayList<>();
            this.messageCount = 0;
        }
    }

    /**
     * 项目信息
     */
    public static class ItemInfo {
        public String id;
        public String type;  // agent_message, command_execution, file_change, etc.
        public String text;
        public String command;
        public String status;
    }

    /**
     * 使用量信息
     */
    public static class UsageInfo {
        public int inputTokens;
        public int cachedInputTokens;
        public int outputTokens;
    }

    /**
     * CLI 环境信息
     */
    public static class CLIEnvironment {
        public boolean available;
        public String version;
        public String path;
        public String error;
    }

    /**
     * 启动一个新的 Codex channel（保持接口一致）
     */
    public JsonObject launchChannel(String channelId, String sessionId, String cwd) {
        JsonObject result = new JsonObject();
        result.addProperty("success", true);
        if (sessionId != null) {
            result.addProperty("sessionId", sessionId);
            currentThreadId = sessionId;
        }
        result.addProperty("channelId", channelId);
        result.addProperty("message", "Codex CLI channel ready");
        LOG.info("Codex CLI channel ready for: " + channelId);
        return result;
    }

    /**
     * 发送消息到 Codex CLI（流式响应）
     */
    public CompletableFuture<CLIResult> sendMessage(
        String channelId,
        String message,
        String sessionId,
        String cwd,
        List<ClaudeSession.Attachment> attachments,
        String permissionMode,
        String model,
        MessageCallback callback
    ) {
        return CompletableFuture.supplyAsync(() -> {
            LOG.info("[CodexCLIBridge] sendMessage() called - channelId=" + channelId + ", message=" + message);
            CLIResult result = new CLIResult();
            StringBuilder assistantContent = new StringBuilder();
            StringBuilder rawOutput = new StringBuilder();

            try {
                // 构建命令
                List<String> command = buildCommand(message, sessionId, model, permissionMode);
                LOG.info("[CodexCLIBridge] Executing Codex CLI: " + String.join(" ", command));

                ProcessBuilder pb = new ProcessBuilder(command);

                // 设置工作目录
                if (cwd != null && !cwd.isEmpty() && !"undefined".equals(cwd) && !"null".equals(cwd)) {
                    File workDir = new File(cwd);
                    if (workDir.exists() && workDir.isDirectory()) {
                        pb.directory(workDir);
                        LOG.info("Working directory: " + workDir.getAbsolutePath());
                    }
                }

                // 设置环境变量
                Map<String, String> env = pb.environment();
                if (apiKey != null && !apiKey.isEmpty()) {
                    env.put("CODEX_API_KEY", apiKey);
                    LOG.info("API Key configured via CODEX_API_KEY");
                }

                // 合并 stderr 到 stdout
                pb.redirectErrorStream(false);

                Process process = pb.start();
                activeProcesses.put(channelId, process);

                try {
                    // 异步读取 stderr（进度信息）
                    Thread stderrThread = new Thread(() -> readStderr(process, channelId));
                    stderrThread.setDaemon(true);
                    stderrThread.start();

                    // 同步读取 stdout（JSON Lines）
                    try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {

                        String line;
                        while ((line = reader.readLine()) != null) {
                            rawOutput.append(line).append("\n");

                            if (line.trim().isEmpty()) continue;

                            try {
                                JsonObject event = gson.fromJson(line, JsonObject.class);
                                String type = event.get("type").getAsString();

                                switch (type) {
                                    case "thread.started":
                                        String threadId = event.get("thread_id").getAsString();
                                        currentThreadId = threadId;
                                        result.threadId = threadId;
                                        callback.onMessage("session_id", threadId);
                                        LOG.info("Thread started: " + threadId);
                                        break;

                                    case "turn.started":
                                        callback.onMessage("message_start", "");
                                        break;

                                    case "item.started":
                                        JsonObject itemStarted = event.getAsJsonObject("item");
                                        String itemType = itemStarted.get("type").getAsString();
                                        LOG.info("Item started: " + itemType);
                                        break;

                                    case "item.completed":
                                        JsonObject item = event.getAsJsonObject("item");
                                        String completedType = item.get("type").getAsString();

                                        if ("agent_message".equals(completedType)) {
                                            String text = item.get("text").getAsString();
                                            assistantContent.append(text);
                                            callback.onMessage("content", text);
                                            LOG.info("Agent message received: " + text.substring(0, Math.min(50, text.length())) + "...");
                                        }
                                        break;

                                    case "turn.completed":
                                        if (event.has("usage")) {
                                            JsonObject usage = event.getAsJsonObject("usage");
                                            result.usage = new UsageInfo();
                                            result.usage.inputTokens = usage.has("input_tokens") ? usage.get("input_tokens").getAsInt() : 0;
                                            result.usage.cachedInputTokens = usage.has("cached_input_tokens") ? usage.get("cached_input_tokens").getAsInt() : 0;
                                            result.usage.outputTokens = usage.has("output_tokens") ? usage.get("output_tokens").getAsInt() : 0;
                                            LOG.info("Token usage: " + result.usage.inputTokens + " in, " + result.usage.outputTokens + " out");
                                        }
                                        callback.onMessage("message_end", "");
                                        break;

                                    case "turn.failed":
                                    case "error":
                                        String errorMsg = event.has("message") ? event.get("message").getAsString() : "Unknown error";
                                        result.error = errorMsg;
                                        callback.onError(errorMsg);
                                        LOG.error("Codex CLI error: " + errorMsg);
                                        break;
                                }
                            } catch (Exception e) {
                                // 可能是非 JSON 输出（例如 stderr 泄露），记录但继续
                                LOG.warn("Failed to parse JSON line: " + line, e);
                            }
                        }
                    }

                    int exitCode = process.waitFor();
                    boolean wasInterrupted = interruptedChannels.getOrDefault(channelId, false);

                    result.finalResult = assistantContent.toString();
                    result.rawOutput = rawOutput.toString();
                    result.messageCount = 1;  // 简化处理

                    if (wasInterrupted) {
                        result.success = false;
                        result.error = "User interrupted";
                        LOG.info("Process interrupted by user");
                    } else {
                        result.success = (exitCode == 0);
                        if (!result.success && result.error == null) {
                            result.error = "Codex CLI exited with code: " + exitCode;
                        }
                    }

                    callback.onComplete(result);

                } finally {
                    activeProcesses.remove(channelId);
                    interruptedChannels.remove(channelId);
                }

            } catch (Exception e) {
                LOG.error("[CodexCLIBridge] Codex CLI execution failed: " + e.getMessage(), e);
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

    /**
     * 构建 Codex CLI 命令
     */
    private List<String> buildCommand(String task, String sessionId, String model, String permissionMode) {
        List<String> args = new ArrayList<>();
        args.add(codexExecutable);
        args.add("exec");
        args.add("--json");  // JSON Lines 流式输出

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
        if (sessionId != null && !sessionId.isEmpty() && !"undefined".equals(sessionId) && !"null".equals(sessionId)) {
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

    /**
     * 异步读取 stderr（进度信息）
     */
    private void readStderr(Process process, String channelId) {
        try (BufferedReader reader = new BufferedReader(
            new InputStreamReader(process.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                LOG.info("[Codex stderr] " + line);
            }
        } catch (Exception e) {
            LOG.warn("Error reading stderr for channel " + channelId, e);
        }
    }

    /**
     * 中断 channel
     */
    public void interruptChannel(String channelId) {
        Process process = activeProcesses.get(channelId);
        if (process != null && process.isAlive()) {
            LOG.info("Interrupting channel: " + channelId);
            interruptedChannels.put(channelId, true);
            process.destroy();
            try {
                Thread.sleep(1000);
                if (process.isAlive()) {
                    process.destroyForcibly();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * 清理所有活动的子进程
     */
    public void cleanupAllProcesses() {
        LOG.info("Cleaning up all Codex CLI processes");
        for (Process process : activeProcesses.values()) {
            if (process.isAlive()) {
                process.destroy();
            }
        }
        activeProcesses.clear();
        interruptedChannels.clear();
    }

    /**
     * 获取当前活动进程数量
     */
    public int getActiveProcessCount() {
        return activeProcesses.size();
    }

    /**
     * 检查 CLI 环境
     */
    public CLIEnvironment checkEnvironment() {
        CLIEnvironment env = new CLIEnvironment();

        try {
            ProcessBuilder pb = new ProcessBuilder(codexExecutable, "--version");
            Process process = pb.start();

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)
            );
            String version = reader.readLine();

            int exitCode = process.waitFor();

            if (exitCode == 0 && version != null) {
                env.available = true;
                env.version = version.trim();
                env.path = codexExecutable;
                LOG.info("Codex CLI detected: " + version);
            } else {
                env.available = false;
                env.error = "Codex CLI not found or not executable";
                LOG.warn("Codex CLI check failed: exit code " + exitCode);
            }
        } catch (Exception e) {
            env.available = false;
            env.error = e.getMessage();
            LOG.error("Codex CLI environment check failed", e);
        }

        return env;
    }

    /**
     * 自动检测 Codex CLI 路径
     */
    public String detectCodexPath() {
        // 1. 用户配置的路径
        if (codexExecutable != null && !codexExecutable.equals("codex")) {
            if (isExecutable(codexExecutable)) {
                return codexExecutable;
            }
        }

        // 2. PATH 环境变量
        try {
            ProcessBuilder pb = new ProcessBuilder("which", "codex");
            Process process = pb.start();
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8)
            );
            String path = reader.readLine();
            if (path != null && !path.isEmpty() && isExecutable(path.trim())) {
                return path.trim();
            }
        } catch (Exception e) {
            LOG.debug("'which codex' failed: " + e.getMessage());
        }

        // 3. 常见安装位置
        String[] commonPaths = {
            "/usr/local/bin/codex",
            "/opt/homebrew/bin/codex",
            System.getProperty("user.home") + "/.local/bin/codex",
            // Windows
            System.getenv("APPDATA") + "\\npm\\codex.cmd",
            System.getenv("PROGRAMFILES") + "\\Codex\\codex.exe"
        };

        for (String path : commonPaths) {
            if (path != null && isExecutable(path)) {
                return path;
            }
        }

        return null;
    }

    /**
     * 检查文件是否可执行
     */
    private boolean isExecutable(String path) {
        try {
            File file = new File(path);
            return file.exists() && file.canExecute();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 获取会话历史消息（Codex 不支持此功能，返回空列表）
     */
    public List<JsonObject> getSessionMessages(String sessionId, String cwd) {
        LOG.info("getSessionMessages not supported by Codex CLI");
        return new ArrayList<>();
    }

    // Getters and Setters

    public void setCodexExecutable(String path) {
        this.codexExecutable = path;
        LOG.info("Codex executable set to: " + path);
    }

    public String getCodexExecutable() {
        return this.codexExecutable;
    }

    public String getCurrentThreadId() {
        return currentThreadId;
    }

    public void setApiKey(String apiKey) {
        this.apiKey = apiKey;
        LOG.info("API Key configured");
    }

    public String getApiKey() {
        return this.apiKey;
    }
}
