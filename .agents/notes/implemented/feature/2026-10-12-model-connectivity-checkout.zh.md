# Agent Note: 在模型页测试已配置的模型

Status: implemented

[English](2026-10-12-model-connectivity-checkout.md) | 中文

## 问题

模型页在声明 provider 时已经能探测端点目录（`llm.discoverModels`），但配置完成之后人们真正要问的问题没人回答：这条路由和这个模型，用我存进去的 key 到底能不能跑通？此前唯一的办法是开一轮对话、看它失败——既消耗一次会话，报错位置又离出问题的那一行很远。这类本可被一次连通性检查拦下的问题（key 被吊销、base URL 少一段路径、订阅里没有这个模型、adapter 与 API 不匹配），只能等到消息已经落盘之后才在对话中途暴露。

## 决策

`LlmRuntime.testModel(provider, model, signal)` 通过拥有该路由的 adapter 发一次极小请求——单条用户消息要求回 `pong`，输出上限 64 token——因此端点、凭据、协议、推理方言和模型门禁全部按该路由自身的配置走一遍。它不写任何持久状态，也不需要 agent 或会话。所有结果都是返回值（`{ ok: true }` 或 `{ ok: false, message }`）：未知路由、缺凭据、上游拒绝都以数据形式交给调用方，界面渲染结果而不是捕获异常。`@Remote('testModel')` 把它暴露为 `llm/testModel`；`LlmTestModelResult` 放在包的 `./types` 子路径上，因为 Remote 边界类型必须从公开的非 root 子路径导出。

模型页只在**路由已保存**的模型行上渲染该控件：静止时是拔插头图标，请求进行中是 loading 圆环，并有一行状态说明模型名、实测往返耗时或宿主给出的诊断。仍是草稿的路由不提供控件（尚无 adapter 认领），没有模型 id 的行保持禁用并把原因写进 title。文案与页面其余部分一样归字典所有；耗时在调用两侧实测，而不是由宿主上报，这样结果类型里不掺展示事实。

## 备选方案

**复用 `llm.discoverModels`。** 探测回答的是"端点对外声明了什么"，不是"这个模型能不能应答"：它用一次性凭据询问草稿，既不证明存下来的 key 可用，也不验证生成是否成功。

**持续上报健康状态。** 后台轮询需要设定节奏、会在无人要求的情况下花钱，还会给一条根本没配对的路由标上绿点。

**把检查放在客户端。** 浏览器没有 provider 凭据，也不说任何 adapter 协议；在那里重建请求构造只会与真实对话路径逐渐分叉。

**保存时顺带测试。** 把检查塞进无关的写入会把成本算到那次写入上，而且一个暂时确实不可达的 provider 会因此挡住自己的配置。

## 影响

配置一个模型现在有了便宜而明确的答案，代价是每次点击一次很小请求。因为检查走的是已注册的 adapter，订阅里没有的模型会原样上报上游的拒绝信息，而不是从列表里被隐藏；往返耗时也顺带成了该路由的粗略延迟信号。控件只出现在路由已保存的地方，因此首次配置 provider 仍依赖探测加上第一轮对话。

## 测试

`packages/llm/llm/tests/model-test.spec.ts` 钉住八个结果：检查发出的请求（单条用户消息、64 token 上限、调用方 signal）、error 结束、aborted 结束、没有 finish 就结束的流、adapter 抛错、未注册路由，以及 Remote 的两条路径。`packages/client/ui-settings-models/tests/model-connectivity.client.spec.tsx` 钉住已结算检查的状态文案与实测耗时、请求进行中的图标切换、被拒绝的检查、无诊断的拒绝、载体调用以 Error 与非 Error 两种形式失败、未保存路由不提供控件，以及 operations 映射。`pnpm run test:gui` 与 `pnpm run verify-client-ui-i18n` 覆盖组装后的页面。
