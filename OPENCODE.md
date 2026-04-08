# OpenCode 配置说明

本文档只说明 freecode 中 OpenCode Zen / Go 的接入与配置方式。

## 配置目标

- OpenCode 作为独立 provider 使用
- Zen 与 Go 由 freecode 自动分流
- Zen 只动态载入免费模型
- 其他 Zen 模型与 Go 补充模型由使用者手动配置

## 环境变量

最小配置：

```bash
export CLAUDE_CODE_USE_OPENCODE=1
export OPENCODE_API_KEY="你的 key"
```

可选覆盖：

```bash
export OPENCODE_BASE_URL="https://opencode.ai/zen/v1"
export OPENCODE_GO_BASE_URL="https://opencode.ai/zen/go/v1"
export ANTHROPIC_MODEL="opencode-go/kimi-k2.5"
```

说明：

- `CLAUDE_CODE_USE_OPENCODE=1` 用于切换到 OpenCode provider
- `OPENCODE_API_KEY` 是 OpenCode 认证凭证
- `OPENCODE_BASE_URL` 用于覆盖 Zen 端点
- `OPENCODE_GO_BASE_URL` 用于覆盖 Go 端点
- `ANTHROPIC_MODEL` 可直接指定默认模型

你也可以不在 shell 里 `export`，而是把这些值写进 `freecode.json` 的 `env` 字段。

## 配置文件放在哪里

freecode 现在有两类配置：

1. freecode 自己的全局个性化配置覆盖层

- 文件位置：安装目录下的 `freecode.json`
- 安装脚本默认目录下通常是 `~/free-code/freecode.json`
- 这个文件只应该放会影响 freecode 行为的个性化配置
- 例如 `env`、模型相关偏好等
- 不应该承接 `projects`、history、统计计数、缓存一类运行态数据

2. Claude Code 兼容的 settings 配置层

- `~/.claude/settings.json`
- `.claude/settings.json`
- `.claude/settings.local.json`

这些 settings 文件仍然参与正常 merge，适合放模型偏好、OpenCode 模型补充列表和项目级默认配置。

## 推荐的配置分工

- `freecode.json`：freecode 专用的全局个性化配置覆盖，不放运行态杂项
- `~/.claude/settings.json`：Claude Code 兼容的共享全局 settings 基底
- `.claude/settings.json`：项目共享的 OpenCode 默认模型或团队约定
- `.claude/settings.local.json`：当前项目下你的个人覆盖

推荐做法：

- 在 `freecode.json.env` 中放 provider 开关、API Key、默认 provider 路由变量
- 在 `freecode.json` 或 settings 文件中放真正的行为配置，例如 `model`、`opencodeModels`

这样可以在复用 Claude Code settings 基底的前提下，把 freecode 的个性化配置独立出来。

## `freecode.json` 示例

如果你希望 freecode 启动时自动启用 OpenCode，可以直接写：

```json
{
  "env": {
    "CLAUDE_CODE_USE_OPENCODE": "1",
    "OPENCODE_API_KEY": "你的 key",
    "ANTHROPIC_MODEL": "opencode-go/kimi-k2.5"
  }
}
```

可选地继续补上：

```json
{
  "env": {
    "CLAUDE_CODE_USE_OPENCODE": "1",
    "OPENCODE_API_KEY": "你的 key",
    "OPENCODE_BASE_URL": "https://opencode.ai/zen/v1",
    "OPENCODE_GO_BASE_URL": "https://opencode.ai/zen/go/v1",
    "ANTHROPIC_MODEL": "opencode-go/kimi-k2.5"
  }
}
```

这部分会在启动时被注入到 `process.env`，和 shell 里 `export` 的效果一致。

如果你愿意，也可以把 `model`、`opencodeModels` 一并放进 `freecode.json`，因为它本质上就是 freecode 的全局用户配置覆盖层。

## 路由规则

freecode 会根据模型自动选择 OpenCode 的协议与端点：

- `claude-*` 走 Zen 的 `/messages`
- `gpt-*` 和 `*codex*` 走 Zen 的 `/responses`
- `opencode-go/...` 前缀强制走 Go
- 手动配置的模型可显式指定 `protocol`

`protocol` 支持：

- `anthropic`
- `responses`
- `oa-compat`

## 模型目录行为

### Zen

Zen 只会动态载入免费模型：

- 通常是带 `-free` 后缀的模型
- 或官方文档明确标记为免费的模型

其他 Zen 模型不会自动加入选择器，需要手动写入配置。

### Go

Go 使用内置模型目录作为基础：

- 内置模型可直接使用
- 你也可以手动追加私有模型或新增模型

## `opencodeModels` 配置格式

你可以在 settings 中补充模型目录：

```json
{
  "opencodeModels": {
    "zen": [
      "glm-5.1",
      {
        "id": "my-private-zen-model",
        "name": "My Private Zen Model",
        "protocol": "oa-compat"
      }
    ],
    "go": [
      "my-go-model",
      {
        "id": "my-private-go-model",
        "name": "My Private Go Model",
        "protocol": "anthropic"
      }
    ]
  }
}
```

字段说明：

- `id`：实际模型 ID
- `name`：在模型选择器中的展示名，可选
- `description`：补充说明，可选
- `protocol`：请求协议，可选

## 默认使用 OpenCode Go 模型

如果你希望 freecode 打开后默认使用 OpenCode Go 模型，推荐这样配：

```bash
export CLAUDE_CODE_USE_OPENCODE=1
export OPENCODE_API_KEY="你的 key"
```

然后你可以二选一：

方式一，放在 `freecode.json`：

```json
{
  "env": {
    "CLAUDE_CODE_USE_OPENCODE": "1",
    "OPENCODE_API_KEY": "你的 key"
  },
  "model": "opencode-go/kimi-k2.5"
}
```

方式二，放在 `~/.claude/settings.json` 或 `.claude/settings.local.json` 中写：

```json
{
  "model": "opencode-go/kimi-k2.5"
}
```

如果你只想对当前项目生效，优先使用 `.claude/settings.local.json`。

如果你已经在 `freecode.json.env` 里设置了 `ANTHROPIC_MODEL`，也可以不再在 settings 里重复写默认模型。

## 常见示例

### 示例 1：全局默认走 Go

`~/.claude/settings.json`

```json
{
  "model": "opencode-go/kimi-k2.5"
}
```

### 示例 2：项目里补充私有 Zen 模型

`.claude/settings.json`

```json
{
  "opencodeModels": {
    "zen": [
      {
        "id": "my-private-zen-model",
        "name": "My Private Zen Model",
        "protocol": "responses"
      }
    ]
  }
}
```

### 示例 3：当前项目个人覆盖

`.claude/settings.local.json`

```json
{
  "model": "opencode-go/glm-5.1",
  "opencodeModels": {
    "go": [
      {
        "id": "my-private-go-model",
        "protocol": "anthropic"
      }
    ]
  }
}
```

## 验证方法

启动前先配置环境变量：

```bash
export CLAUDE_CODE_USE_OPENCODE=1
export OPENCODE_API_KEY="你的 key"
```

然后运行：

```bash
bun run dev
```

或者构建后运行：

```bash
./cli
```

验证点：

- 模型选择器中能看到 Zen 免费模型
- 模型选择器中能看到你手动补充的 Zen / Go 模型
- 指定 `opencode-go/...` 模型时，请求会走 Go
- `claude-*` 与 `gpt-*` 模型会按协议自动走 Zen
