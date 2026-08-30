# 集成步骤

本文档说明把 `ui-mcp-servers` 包接入到 dsh web monorepo 所需的全部步骤。
这个包拆成两半（一个 `settings.section` 的 UI 加一个宿主侧的
`mcp-servers-activator` 插件，后者桥接到 `@deepseek-ai/dsh-mcp-client`），
两个半包 + schema 类型一共需要在三处协调。步骤参照
`packages/client/ui-prompt-manager`，并额外加上 activator 的 bundle patch。

## 1. 复制包

两个新包落地：

```
<monorepo>/packages/client/ui-mcp-servers/        # 客户端 UI 半包
<monorepo>/packages/mcp/mcp-servers-activator/  # 宿主 activator
```

分别遵循 `@deepseek-ai/dsh-client-*`（UI）和 `@deepseek-ai/dsh-*`（host）
命名约定；客户端 / 宿主的 linter 会校验。

两边的 package 元数据 —— 名称、依赖、peerDependencies、
`dsh.client` 声明（不要 `dsh.host`）—— 必须严格对齐；activator
通过 workspace import 引用 client 包的 wire schema。

## 2. 验证 tsconfig 引用

**不需要任何聚合配置** —— `pnpm-workspace.yaml` 的 `packages/*/*` glob
会自动把两个目录纳入 workspace；`pnpm install` 一次性建立好链接。

`packages/client/ui-mcp-servers/tsconfig.json` 已声明好所有上游依赖。
`packages/mcp/mcp-servers-activator/tsconfig.json` 引用
`../client/ui-mcp-servers`（schema 类型）、`../../settings/settings`
（`settingsNamespace`）、`../../../vendor/cordis`（`Context`）、
`../../core/tools`（`tools` 注入提示）、`../../runtime-diagnostics/invariants`。

## 3. 加入客户端 / 宿主的聚合 tsconfig

新包必须分别在根 `tsconfig.client.json` 和 `tsconfig.host.json` 的
`references` 数组里登记，否则 `tsc -b` 不会编译它，
`lib/types/{index,invariant}.js` 永远不会生成，
后续的 `tsdown` 跑不起来（`UNRESOLVED_ENTRY Cannot resolve entry module lib/types/...`）。

`tsconfig.client.json` 的 `references`（按字母序插在 `ui-layout` 与
`ui-sidebar` 之间）：

```jsonc
{ "path": "./packages/client/ui-mcp-servers" },
```

`tsconfig.host.json` 的 `references`（靠近 `mcp-client`）：

```jsonc
{ "path": "./packages/mcp/mcp-servers-activator" },
```

## 4. 补丁文件

UI 进 `packages/bundle/web-app/cordis.patch.yml` 的 browser roster：

```yaml
- id: ui-mcp-servers
  name: '@deepseek-ai/dsh-client-ui-mcp-servers'
```

Activator 进 `packages/bundle/base/cordis.patch.yml`，在 `tools` 行之后：

```yaml
# Activator for the `mcp-servers` settings namespace owned by the
# browser Settings → MCP servers page (`@deepseek-ai/dsh-client-ui-mcp-servers`).
# Reads the section on startup and on every `settings/updated` emission;
# for each enabled entry, spawns a `@deepseek-ai/dsh-mcp-client` plugin
# in a child cordis context. Adding/removing/toggling/editing a
# server in the UI propagates live to the running mcp-client instances.
- id: mcp-servers-activator
  name: '@deepseek-ai/dsh-mcp-servers-activator'
```

行的顺序与加载无关 —— 两个目标槽都通过 `slots.inject` 进入，
loader 按声明的服务解析激活顺序，不看文件位置。

## 5. bundle 依赖

`packages/bundle/web-app/package.json` 的 `dependencies`：

```jsonc
{
  "dependencies": {
    // ... 已有条目 ...
    "@deepseek-ai/dsh-client-ui-mcp-servers": "workspace:^"
  }
}
```

`packages/bundle/base/package.json` 的 `dependencies`：

```jsonc
{
  "dependencies": {
    // ... 已有条目 ...
    "@deepseek-ai/dsh-mcp-servers-activator": "workspace:^"
  }
}
```

## 6. 可选：profile 级别覆盖

如果你有一个 profile 叠加层（`packages/bundle/<profile>/cordis.patch.yml`），
需要禁用插件，加：

```yaml
- id: ui-mcp-servers
  disabled: true
- id: mcp-servers-activator
  disabled: true
```

## 7. 构建并验证

`bundle` 脚本只跑 `tsdown`，**不**会先调 `tsc -b`。
但 `tsdown.config.ts` 的入口是 `lib/types/index.js` 与 `lib/types/invariant.js`
（tsc 产物），所以必须先编译、再 bundle：

```sh
# 先编译两个新包（顺带把所有 client / host 包都编译一遍）
pnpm exec tsc -b tsconfig.client.json
pnpm exec tsc -b tsconfig.host.json

# 然后跑 tsdown 把 lib/types/*.js bundle 成 lib/{index,invariant}.js
pnpm --filter @deepseek-ai/dsh-client-ui-mcp-servers bundle
pnpm --filter @deepseek-ai/dsh-mcp-servers-activator bundle

# 想要一步到位：
pnpm run build:lib:client
pnpm run build:lib:host
```

## 8. 烟雾测试

1. 启动 `dsh web`。
2. 打开 Settings → MCP servers → 点 "New MCP server" → 填 id（kebab-case，
   如 `github`）、显示名、transport `streamable-http`、URL
   `https://api.githubcopilot.com/mcp/`、header `Authorization: Bearer <PAT>`。
   保存。
3. 开新会话。让 agent "列出我的 GitHub repos" —— Network 标签里
   应该出现 `mcp__github__*` 工具调用。
4. 点行上的绿色 "Connected" 徽章 —— 状态块：成功 `pending → connected`、
   连接失败 `failed` 携带错误消息。
5. 在行上点禁用。徽章翻成 "Disabled"，activator 在下次 reconcile
   时拆掉 fiber。
6. 退出 `dsh web`。查看 `~/.dsh/settings.yaml` —— `mcp-servers:` 段包含
   刚保存的条目及其 `status` 字段。

## 包的内部结构说明

- `packages/client/ui-mcp-servers/src/schema.ts` 拥有 wire schema
  （`McpServerRecord`、`McpServerStatus`），activator 通过 workspace
  import 引用为类型。schema 的 `McpServerStatus` 由 activator 写入，
  UI 只读不写。
- `packages/client/ui-mcp-servers/src/index.ts`（host 半包）在
  `ctx.settings` 上注册 `mcp-servers` 命名空间。浏览器侧
  `src/client/store.ts` 提供 `McpServersStore`（基于绑定 scope 的 CRUD），
  供 section 消费。
- `packages/client/ui-mcp-servers/src/client/McpServersSection.tsx`
  渲染设置页（列出记录、切换 enabled、编辑、删除）。
- `packages/client/ui-mcp-servers/src/client/McpServerEditor.tsx`
  是创建/编辑 modal（id、name、transport、command/url/headers、enabled、
  description）。
- `packages/client/ui-mcp-servers/src/client/McpServerRow.tsx`
  是列表行 UI：transport 徽章、命令/URL 摘要、状态徽章、
  enable/disable、编辑、删除按钮。
- `packages/mcp/mcp-servers-activator/src/index.ts` 是宿主 activator：
  订阅 `settings/updated`、为每个 enabled 条目 spawn
  `@deepseek-ai/dsh-mcp-client` 实例、在每次生命周期转换时写回 `status`。

## 已知实现取舍（部署后请复查）

1. **`fiber.await()` 失败语义**：cordis 在内部捕获 apply 错误并
   把它们存到 `fiber._error`；`fiber.await()` 随后 **抛出**（不是
   reject Thenable）。activator 的 `fiber.then(onFulfilled, onRejected)`
   因此错误落到 `onRejected` 槽，不是 `onFulfilled`。activator 在
   `onFulfilled` 里也分支检查 `fiber._error` 作为防御性兜底。
2. **`recordsEqual` 剥掉 `status` 字段**：对一个 server 的配置修改
   （比如改 `command`）会触发 respawn（剥掉 status 后 recordsEqual
   不等）。纯 status 写入（activator 自己的反馈）则不会（剥掉 status
   后 recordsEqual 相等）。这就打破了"activator 自己写 status 又
   被自己更新触发重新 spawn"的循环。
3. **`ctx.settings.update` JSON round-trip workaround**：dsh-settings
   会冻结 resolved 值（`deepFreeze`），让读在用户编辑和组件渲染之间
   保持不可变。但 schemastery 校验时会迭代 `ownKeys`，冻结值上的
   metadata 就泄漏进 schema 检查，把 union 给拒了（"expected ...
   but got ..."）。`JSON.parse(JSON.stringify(config))` 剥掉这些 metadata，
   wire 数据完全保留。等 schemastery 支持"跳过 frozen 输入"（或
   dsh-settings 给只读消费者返回非冻结的 resolved value），这个
   round-trip 就可以拿掉。
4. **Status 持久化权衡**：`status` 在 settings doc 里，会落盘。
   用户下次启动会看到"上次成功连接于 14:02"，activator 重新连上后
   自动刷新。我们认为这比"传输层独立维护一份内存态"更简单，是可接受的
   默认。
5. **失败 respawn 循环**：一个总是连不上的 server 会在每次 reconcile
   时被 respawn。`status` 字段在 `failed` 和 `pending` 之间反复，错误文本
   跨循环保留（最近一次的值）。我们认为这是合理的默认 —— 暂时性失败
   会在下次重试中自动变成持续失败，无需手工干预。

