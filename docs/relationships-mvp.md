# 人物关系—记忆—秘密 MVP

## 目标

支持“玩家怎样对待角色”影响其愿意透露的信息，并让这种变化具备叙事原因，而不只是一个无来源的好感度数值。

首个闭环：玩家保护女仆 → 信任提高并留下“替她隐瞒”记忆 → 信任门槛解锁坦白 → 坦白揭示秘密并发放新证据。

## 模型

```ts
interface Character {
  id: string
  name: string
  description: string
  relations?: Record<string, { label: string; initial?: number; min?: number; max?: number }>
  secrets?: Record<string, { id: string; title: string; description: string }>
}
```

运行状态保存 `relations`、`memories`、`revealedSecrets`。效果支持关系增减、记录记忆和揭示秘密。

条件沿用现有 DSL：

- `var: "#relation:maid:trust", op: "gte", value: 2`
- `var: "#memory", op: "eq", value: "protected_maid"`
- `var: "#secret", op: "eq", value: "maid:hidden_corridor"`

## 约束

- 关系维度必须先在 Character 中定义；
- 关系值受定义的 min/max 限制；
- 记忆是作品级稳定 ID，表达关系变化的叙事原因；
- 秘密必须属于已定义角色，揭示时使用 `角色ID:秘密ID`；
- 关系变化应至少影响一个条件、秘密、证据或结局，否则校验器给出警告/问题。

## 暂不包含

- NPC 自主行动和日程；
- 动态自然语言对话；
- 角色之间的关系网络；
- 情绪衰减或人格模拟；
- 多人同时参与同一关系事件。
