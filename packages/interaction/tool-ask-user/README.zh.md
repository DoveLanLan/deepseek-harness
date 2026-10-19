---
description: "基于 user-questions seam 的模型侧 ask_user_question 工具；供组合或排查交互式 agent（智能体）表面的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-ask-user

[English](README.md) | 中文

## 概述

`ask_user_question` 向用户请求确认、选择或缺失的信息。默认情况下，它会等待回答。设置 `mode: timed` 后，期限到达时模型可以继续独立工作，而问题仍可回答；`timeout: -1` 则无限期等待。可选开启的 `autoAnswerAfterTimeouts` 策略会在连续多个问题到期无人回答后，用每个问题的推荐选项作答。存活的子 agent 不能调用此工具。调用方需提供回答界面。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当模型需要用户决定时，将此插件与 `ctx.userQuestions` 组合。没有 answerer 时，阻塞式调用返回错误；有限时长的 timed 调用到期后返回 pending。

随附 preset 使用阻塞模式。要启用 timed 模式，请在当前 preset 的 `config.plugins` 列表中，将 `tool-ask-user` 条目设为 `mode: timed`：

```yaml
- id: tool-ask-user
  name: '@deepseek-ai/dsh-tool-ask-user'
  config:
    mode: timed
    timeout: 120
    autoAnswerAfterTimeouts: 3
```

以上片段是插件条目，不是顶层 `--patch` 条目。在 Web profile 中，请修改 `preset-standard` 的插件列表，或使用 Agent Preset 编辑器。`mode: legacy` 或省略配置会保留阻塞式 schema。条目中的 `timeout` 默认适用于每次 timed 调用；设为 `-1` 时会无限期等待，除非模型传入正数期限。模型传入的 `-1` 只适用于该次调用，包括其中的所有问题。

`autoAnswerAfterTimeouts` 会用用户并未给出的答案替代 pending 结果。同一 Session 的前 `N` 个问题可以到期无人回答；此后每次到期都用每个问题的推荐选项作答，而批次中若有问题没有提供选项，则仍返回 pending。该计数只在用户真正回答一个问题后结束——无论是窗口内回答还是之后的迟到回复。推荐选项是标签以 `(Recommended)` 或 `（推荐）` 结尾的第一项；没有标记时取第一个选项，因为 schema 要求模型把推荐项放在首位。该策略要求 `mode: timed` 与条目上有限的 `timeout`；缺少任一条件时加载即失败。策略只作用于本工具的 timed 调用：直接通过 seam 提问的调用方（例如计划评审）不会触及它。

### 何时调用该工具

发送一个或多个问题，每个问题的 `id` 在本次调用内必须唯一；回答会带回这些 id。推荐选项放在首位，并在标签末尾追加 `(Recommended)`。可选的单次调用 `timeout` 以秒为单位；如果没有回答就无法安全继续，请使用 `-1`。超时绝不表示批准。在 Web 卡片中，开始编辑或选择“慢慢回答”也会让该 Client 的等待持续到提交或取消。

```json
{
  "questions": [
    {
      "id": "cleanup",
      "question": "Proceed with the destructive cleanup?",
      "header": "Confirm",
      "options": [
        { "label": "Yes, delete them (Recommended)", "description": "Removes the three stale files." },
        { "label": "No, keep them", "description": "Aborts the cleanup." }
      ]
    }
  ]
}
```

### 模型得到什么

收到回答时，工具为每个问题返回一项。`selected` 保存选项标签；`custom` 可以补充多选答案，或替代单选选项。跳过的回答项具有空 `selected`，且没有 `custom`。

对于有限时长的 timed 调用，`{ "pending": true, "callId": "…" }` 表示前台等待结束时仍没有回答。问题仍可回答，模型可以继续独立工作。之后的回答以用户消息送达，由 `kind`、`tool` 和 `callId` 标识。Web 对话会配对展示问题与回答；其他消费方收到紧凑 JSON 文本。

```json
{ "answers": [{ "id": "cleanup", "selected": ["Yes, delete them (Recommended)"] }] }
```

当回退策略代替用户作答时，该批次会带有用户亲自回答时绝不会出现的标记：

```json
{
  "answers": [{ "id": "cleanup", "selected": ["Yes, delete them (Recommended)"] }],
  "autoAnswered": { "consecutiveTimeouts": 3, "timeoutSeconds": 120, "notice": "…" }
}
```

`notice` 说明用户没有回答、推荐选项被自动选中以便继续工作，且这不是用户的确认、批准或授权。

### 调用何时失败

Legacy 调用和 `timeout: -1` 调用会等待回答或取消；没有 answerer 接受时返回错误。有限时长的 timed 调用若没有 answerer，则在到期后返回 pending。取消调用，或调用方不是确切的存活运行时根时，也会返回错误。存活的子 agent 会以 `DELEGATED_CALLER` 被拒绝，必须在最终结果中包含尚未解决的决定。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

可观察行为已在[使用本包](#use-this-package)中说明；本节解释工具定义及其与 seam 的关系。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 默认阻塞式工具定义与模式选择 |
| [`src/timed.ts`](src/timed.ts) | 显式启用的计时工具定义与结果渲染 |

### 消费方角色

插件只注册一个工具定义。Legacy 模式调用 `ask()`；timed 模式对正数期限调用 `askTimed()`，对 `-1` 调用 `ask()`。两者都向 `ctx.userQuestions` 传递调用方 agent 和轮次信号。Timed 请求在 `wait` 中包含工具调用 id，Client 因此可以重新打开对应卡片。投影从记录的工具 schema 的 `timeout` 字段识别 timed 原生调用，即使某次调用省略该参数也一样。

### 结果渲染

`render` 输出把结构化值经 `JSON.stringify` 投影为单个文本块，因此模型侧结果是紧凑 JSON，而非更丰富的内容块词汇。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从工具表面逐步进入 seam 约定及其 answerer waterfall。

- [用户交互子系统参考](../../../docs/subsystems/user-questions.zh.md)——此工具背后的服务约定、问题词汇与 answerer waterfall。
- [工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-ask-user)——生成的 `ask_user_question` schema。
- [user-questions 包](../user-questions/README.zh.md)——本工具消费的 seam。
- [交互组映射](../README.zh.md)——相邻的审批与命令表面。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到的内容

随附 preset 会公开原有的阻塞式 [`ask_user_question` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-ask-user)。自定义 Cordis 行设置 `mode: timed` 后，会切换到包含问题 id、提示语、标题、选项、多选标志、`timeout` 与待处理结果的异步 schema；模型只会看到被选中的定义。启用 `autoAnswerAfterTimeouts` 的行还会声明 `autoAnswered` 结果字段，并告知模型：无人回答时推荐选项可能被自动选中。

#### Token 影响

工具可见时，每个请求都会产生固定的 schema token 开销。

#### KV Cache 影响

只要定义和可见性保持不变，前缀即可稳定复用。插件生命周期变化或作用域限制可能会使从此 schema 起的缓存复用失效。

### 工具调用历史与结果

#### 模型看到的内容

assistant 工具调用保留问题。等待期间收到的回答会在下一步显示为紧凑的 `{"answers":[{"id":"<id>","selected":["<label>"],"custom":"<text>"}]}` JSON；未使用的 `custom` 会省略。计时到期的调用返回 `{"pending":true,"callId":"<pending-call-id>","message":"<instruction>"}`；启用回退策略时，到期调用改为返回带前述 `autoAnswered` 标记的答案批次。之后的回答以用户消息送达，包含 `kind: "answer_to_pending_question"`、`tool: "ask_user_question"`、调用 id、原问题和答案。提交之前的 UI 活动不属于模型上下文。

#### Token 影响

参数和回答 JSON 是依数据而定的保留 token；等待用户时不会产生 token 开销。

#### KV Cache 影响

仅追加；新出现的可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明该工具何时不合适。它们是当前包约束，不是 UI 积压事项。

- **Legacy 工具不会报告 pending**：它只返回回答或错误。原生 legacy 调用不进入 `userQuestions` 投影；中断的调用不能接受迟到回答。
- **推荐回退随 Host 进程结束**：未回答计数与 latch 属于 Host 内存而非 Session 状态，因此重启后该 Session 需要重新经历前 `N` 次到期，策略才会再次作答。
- **部分问题永远不会代替用户作答**：批次中若有问题没有提供选项，则保持 pending 结果；带 intent 的问题完全不经过到期策略，因此到期的计划评审仍保持 pending。
- **中断的 PTC 等待可能丢失问题**：若 `run_code` 进程在 `ask_user_question` 子调用记录 `tool/ptc-dispatch` 结果前结束，投影无法重建该子调用以接受迟到回答。
- **运行时中归属于其他 agent 的 subagent 不能向用户提问**：`ask_user_question` 会以 `DELEGATED_CALLER` 拒绝归属于另一个 agent 的存活子级；该子级必须在最终结果中包含尚未解决的问题或决定。持久谱系不能决定这一边界，因此带有谱系的会话恢复为运行时根后可以正常提问。
- **Native 回答渲染为 JSON 文本**：规范值仍为结构化数据，但模型侧结果使用紧凑 JSON，而非更丰富的内容块词汇。
- **Web transcript 不标注自动作答**：Client 从投影读取已记录答案，投影保留答案批次但不含 `autoAnswered` 标记；只有模型能看到用户并未作答。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

[`userQuestions` 投影](../user-questions/src/projection.ts)读取记录的工具 schema，而不是调用参数：timed 调用可以省略 `timeout`，timed `-1` 调用也仍使用 timed schema。改变投影折叠语义时必须提高 `stateVersion`，让持久化缓存从日志重新折叠。

</details>
