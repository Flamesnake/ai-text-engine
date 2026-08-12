# 证据—推论 MVP

## 目标

让 Agent 能将推理体验创作为结构化游戏，而不是用任意旗标模拟全部逻辑。首个垂直切片必须支持：

1. 玩家探索场景并获得证据；
2. 玩家在线索板选择一个待证明推论；
3. 玩家从已获得证据中提交组合；
4. 正确组合确认推论，错误组合不改变状态；
5. 推论解锁新的场景选项或结局；
6. 校验器和路径探索能理解这条链；
7. Agent 可通过幂等 MCP 工具创建、覆盖和删除证据与推论。

## 领域概念

- **Document**：玩家拿到并阅读的内容载体，例如信件或守则。
- **Evidence**：可用于支持推论的材料，例如证词、物件或观察结果。
- **Deduction**：玩家使用已获得证据确认的命题。

获得 Document 不等于获得 Evidence，获得 Evidence 也不等于已经形成 Deduction。作品可在同一场景同时发放文档与证据。

## 数据接口

```ts
interface Evidence {
  id: string
  title: string
  description: string
  kind?: 'document' | 'object' | 'testimony' | 'observation'
  source?: string
}

interface Deduction {
  id: string
  statement: string
  description?: string
  requires: {
    all?: string[]
    anyOf?: string[][]
  }
  onConfirmed?: Effects
}
```

`requires.all` 中的证据必须全部选择。`requires.anyOf` 的每一组必须至少选择一条。两者同时存在时必须同时满足。

## 运行时接口

- `Effects.gainEvidence` 发放证据；
- `Game.confirmDeduction(id, selectedEvidenceIds)` 验证组合；
- `GameState.evidence` 保存已获得证据；
- `GameState.deductions` 保存已确认推论；
- 条件 `{ op: 'eq', var: '#evidence', value: id }` 检查证据；
- 条件 `{ op: 'eq', var: '#deduction', value: id }` 检查推论。

推论首次确认时应用 `onConfirmed`，重复提交必须幂等。未获得证据不能用于提交。

## 校验与探索

校验器拒绝不存在的证据引用和无证据要求的推论。路径探索把线索板视为场景外动作，同时探索暂不确认和当前可确认的推论状态。

推论组合可能指数增长，因此每个场景默认最多探索 64 种推论状态；截断时必须返回警告，不能把近似结果伪装成完整证明。

## 本阶段不包含

- 自由文本语义判题；
- 人物关系模拟；
- 密码、排序等其他谜题控件；
- 自动生成谜面或提示；
- 在线模型依赖。

## 验收案例

管家声称停电时一直在厨房。玩家获得“停在 22:10 的厨房时钟”和“管家 22:20 才回厨房的女仆证词”，在线索板组合两条证据，确认“不在场证明不成立”，从而解锁揭穿管家的真相结局。
