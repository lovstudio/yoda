# dsh-runtime-bar

把 Yoda 的底部运行时状态栏搬到 DSH。装上之后，输入框下方会多一条状态带：会话目录、运行状态、后台任务数、工作区会话数。

条目的排布、顺序和插槽规则来自 `@yoda/runtime-bar` —— Yoda 自己的底部栏渲染的是同一个组件，所以同一个条目在两个宿主里不会跑到不同的位置。

## 安装

```bash
dsh plugin add ./packages/dsh-runtime-bar
```

## 给其它插件扩展

激活时本插件提供 `ctx.yodaRuntimeBar` 服务，任何插件都可以往这条带子里塞自己的条目：

```ts
export const inject = ['yodaRuntimeBar'];

export function apply(ctx) {
  ctx.effect(() =>
    ctx.yodaRuntimeBar.register({
      id: 'my-entry',
      slot: 'session', // 'lead' 左侧 | 'session' 会话组 | 'tray' 右侧托盘
      order: 20, // 同一插槽内的读序，缺省按注册顺序
      Component: MyEntry,
    })
  );
}
```

条目组件不收 props：会话事实由带子解析一次，通过 React context 下发。返回 `null` 就是不占位——状态栏里一个空座位读起来等于"没什么可报的"。

## 构建

```bash
pnpm install --ignore-workspace
pnpm build
```

产物：`lib/index.js`（宿主半边，ESM node）、`lib/client.js`（官方 profile 通道，bundle id = 包名）、`lib/client-registry.js`（插件注册表通道，bundle id = manifest id）。
