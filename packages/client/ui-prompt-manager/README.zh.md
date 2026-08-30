# `@deepseek-ai/dsh-client-ui-prompt-manager`

[English](README.md) | 中文

DeepSeek Harness Web 客户端的可复用提示词库插件。把提示词存储在 `prompts` 这个 settings 命名空间下（通过 `dsh-settings-file` 落盘到 `settings.yaml`），在 Settings 侧边栏暴露一个 CRUD 页面，并在每个输入框旁边放一个"插入提示词"按钮。

## 功能

- **增删改查** — 新建、编辑、删除提示词，支持标题、正文、描述和标签。
- **搜索与标签筛选** — 全文本搜索（覆盖标题/正文/描述/标签），加上 "全部 / 标签 / 标签" 的药丸行。
- **变量插值** — 正文可写 `{{变量名}}` 占位符。编辑器会显示检测到的变量并预览渲染结果；选择器在插入前会让用户填写变量值。
- **一键插入输入框** — 输入框旁的多功能按钮打开选择器，通过 `inputActions.setDraft` 把渲染后的提示词写入草稿。

## 架构

按标准双端结构组织：

| 端 | 文件 | 职责 |
|---|---|---|
| Host（Node） | `src/index.ts` | 在 `ctx.settings` 上注册 `prompts` 命名空间。 |
| Client（浏览器） | `src/client/index.ts` | 装配 `PromptsSection`（Settings 页面）与 `PromptInsertButton`（输入框附件），共用一个 `PromptsStore`。 |

持久化是自动的：每个 CRUD 操作都会调用 `settingsScope.set(id, record)` / `settingsScope.unset(id)`，`dsh-settings-file` 会把它写回磁盘上的 `settings.yaml`。

## 集成

把包加到你的 profile 的 `cordis.yml` 并重新构建：

```yaml
- id: ui-prompt-manager
  name: '@deepseek-ai/dsh-client-ui-prompt-manager'
```

两个表面会自动启用：

- **Settings → Prompts** — Settings 侧边栏新条目。
- **输入框附件** — 每行输入框右侧的 "Prompts" 按钮。

插件通过 `ctx.slots.inject(...)` 声明两个槽，因此会在 `ui-settings` 与 `ui-conversation` 声明它们各自的槽之后加载。兄弟功能插件之间的应用顺序不受约束。

## 存储格式

`prompts` 命名空间段是一个以 kebab-case id 为键的 map：

```yaml
prompts:
  code-review:
    title: 代码评审
    description: 简洁的评审清单
    body: |
      评审以下 {{language}} 差异，关注：
      - 正确性
      - 错误处理
      - 测试覆盖
    tags: [review, lint]
    createdAt: 1718900000000
    updatedAt: 1718900123000
  summarize:
    title: 摘要
    body: 用 {{length}} 个要点摘要以下文本。
    description: ''
    tags: []
    createdAt: 1718900050000
    updatedAt: 1718900050000
```

## 变量插值

- 占位符形式为 `{{name}}`；名字前后允许空白。
- `collectVariables(body)` 按首次出现顺序返回不同的变量名。
- `interpolate(body, values)` 替换变量；缺失值渲染为空字符串，未知名字保留原样以便发现拼写错误。
- 选择器在任一必填变量为空时禁用 Insert 按钮。

## 本地开发

```sh
# 构建 bundle（产出 lib/client.js）
pnpm --filter @deepseek-ai/dsh-client-ui-prompt-manager bundle

# 运行 GUI 测试
pnpm run test:gui
```