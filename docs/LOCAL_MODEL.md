
## 连接本地模型 (LM Studio / Ollama)

皮皮虾支持任意 OpenAI 兼容端点。本地 LM Studio 已测试通过：

### 配置 (config/ppx.json)
```json
{
  "providers": [
    {
      "id": "lmstudio",
      "base_url": "http://127.0.0.1:1234/v1",
      "api_key": "lm-studio",
      "model": "gemma-4-e2b-uncensored-hauhaucs-aggressive-q8_k_p",
      "timeout_ms": 180000
    }
  ]
}
```

### 已验证能力
- ✅ 完整对话 (LLM 驱动, 带人格)
- ✅ 工具调用 (LLM 自主决定调 list_dir/read_file 等)
- ✅ 记忆持久化 (对话自动进 L0-L3)
- ✅ 自愈 (启动体检)

### 注意
- 配置文件必须是 **UTF-8 无 BOM** (去 BOM 已内置处理)
- api_key 本地服务填任意值即可
