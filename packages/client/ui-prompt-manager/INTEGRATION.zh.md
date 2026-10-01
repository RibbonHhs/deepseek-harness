# 集成步骤

本文档说明把 `ui-prompt-manager` 包接入到 dsh web monorepo 所需的全部步骤。
包的代码参考了 `packages/client/ui-settings-models` 模板，集成步骤也照搬
该包的做法。

## 1. 复制包

把 `ui-prompt-manager/` 整个目录复制到 `<monorepo>/packages/client/ui-prompt-manager/`。

包名遵循 `@deepseek-ai/dsh-client-*` 命名约定（客户端包检查器会校验）。

## 2. 验证 tsconfig 引用

**不需要任何聚合配置** —— `pnpm-workspace.yaml` 的 `packages/*/*` glob
会自动把 `packages/client/ui-prompt-manager/` 纳入 workspace；
`pnpm install` 会一次性建立好链接。

包自带的 `tsconfig.json` 已声明好所有上游 workspace 依赖（`runtime`、
`ui-settings`、`ui-conversation`、`ui-slots`、`ui-primitives`、
`locale`、`runtime-diagnostics/invariants`、以及 `api/remotes`
的 `tsconfig.client.json` 子引用）。复制包后这一步就是完成的。

> 如果你新增了上游依赖，需要在 `tsconfig.json` 的 `references`
> 数组里同步加上对应的 `path`，然后运行 `pnpm install`。

## 3. 加入客户端聚合 tsconfig

新包必须在根 `tsconfig.client.json` 的 `references` 数组里登记，
否则 `tsc -b tsconfig.client.json` 不会编译它，
`lib/types/{index,invariant}.js` 就永远不会生成，
后续的 `tsdown` 跑不起来（`UNRESOLVED_ENTRY Cannot resolve entry module lib/types/...`）。

在 `tsconfig.client.json` 的 `references` 块里加一行
（按字母序插在 `ui-plan` 与 `ui-settings-plugins` 之间）：

```jsonc
{ "path": "./packages/client/ui-prompt-manager" },
```

## 4. 补丁文件

打开 `packages/bundle/web-app/cordis.patch.yml`，在「browser plugin roster」
`insert:` 块中（紧跟现有 `ui-settings-*` 和 `ui-conversation` 行之后）加入：

```yaml
- id: ui-prompt-manager
  name: '@deepseek-ai/dsh-client-ui-prompt-manager'
```

行的顺序与加载无关 —— 两个目标槽都通过 `slots.inject` 进入，
loader 按声明的服务解析激活顺序，不看文件位置。

## 5. bundle 依赖

打开 `packages/bundle/web-app/package.json`，加入 workspace 依赖：

```jsonc
{
  "dependencies": {
    // ... 已有条目 ...
    "@deepseek-ai/dsh-client-ui-prompt-manager": "workspace:^"
  }
}
```

## 6. 可选：profile 级别覆盖

如果你有一个 profile 叠加层（`packages/bundle/<profile>/cordis.patch.yml`），
需要禁用插件，加：

```yaml
- id: ui-prompt-manager
  disabled: true
```

## 7. 构建并验证

`bundle` 脚本只跑 `tsdown`，**不**会先调 `tsc -b`。
而 `tsdown.config.ts` 的入口是 `lib/types/index.js` 与 `lib/types/invariant.js`
（tsc 产物），所以必须先编译、再 bundle：

```sh
# 先跑 tsc 把 src/ 编译到 lib/types/
pnpm exec tsc -b tsconfig.client.json

# 然后跑 tsdown 把 lib/types/*.js bundle 成 lib/{index,invariant,client}.js
pnpm --filter @deepseek-ai/dsh-client-ui-prompt-manager bundle

# 想要一步到位（顺带把所有 client 包都构建一遍）：
pnpm run build:lib:client

# 运行 GUI 测试（组件 specs）。
pnpm run test:gui
```

插件要求挂载了 `dsh-settings-file`（或其它可写的 `ctx.settings` 提供方）。
官方 `dsh-web-app` bundle 已经通过 `dsh-base` 把它带进来了，无需额外接线。

## 7. 烟雾测试

1. 启动 `dsh web`（或任何包含该 bundle 的部署）。
2. 打开 Settings → Prompts。新建一条标题为 `Test`、正文为 `Hello {{name}}`、
   标签为 `demo` 的提示词。
3. 打开任意会话。点击输入框右侧新出现的 "Prompts" 按钮。选择 `Test`，
   在 `{{name}}` 字段填入 `Ada`，点击 "Insert into composer"。
4. 输入框草稿变成 `Hello Ada`。发送验证。
5. 退出 `dsh web`。查看 `~/.dsh/settings.yaml` —— `prompts:` 段应当包含
   你刚保存的记录。

## 包的内部结构说明

- `src/schema.ts` 拥有 wire schema 和 `interpolate` / `collectVariables`
  helper；两者都是纯函数并有单元测试覆盖。
- `src/index.ts`（host 端）在 `ctx.settings` 上注册 `prompts` 命名空间。
  除了注册外没有运行时工作，其余逻辑都在 client 端。
- `src/client/store.ts` 拥有对绑定 scope 的 CRUD，并暴露
  过滤/标签/渲染等组件会调用的查询方法。
- `src/client/PromptsSection.tsx` 是 Settings 页面；它使用
  `settings.section` 槽，直接依赖 `PromptsStore`。
- `src/client/PromptInsertButton.tsx` 是输入框附件；它使用
  `conversation.input.right` 槽和标准 props 中的 `inputActions`。
- `src/client/PromptPickerPopover.tsx` 是附件点开后弹出的下拉；
  `PromptEditor.tsx` 是新建/编辑对话框。

## 已知实现取舍（部署后请复查）

1. **`inputActions` 的传递路径**：组件签名里我们通过 `useSnapshot` 拿到
   store snapshot；`inputActions` 由 ui-renderer 通过 `session-scope` 槽
   的标准 props 自动注入。如果运行时报 "inputActions is undefined"，
   说明 framework 未自动把 standard kit 接到自定义注册的 entry，
   此时需要在 `apply` 里显式声明 `inject: ['input']` 并直接读
   `ctx.get('input')`，或者把按钮重新注册到 `session-maybe` 槽。
2. **`useSnapshot` 的兜底**：`PromptsSection` 与 `PromptInsertButton`
   都用 `as unknown as` 转换 `useSnapshot` —— 生产打包时 ui-renderer 会
   从 `hooks.snapshot` 编译出一个同名 selector hook。如果 hook 缺失，
   渲染会读 `controller.store.getSnapshot()` 直接退化为一次性快照
   （不响应变更），便于定位问题。