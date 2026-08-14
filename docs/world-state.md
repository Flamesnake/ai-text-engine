# 世界状态与阶段

`world` 与 `phase` 是两条正交、受控的叙事状态轴：前者适合表世界/里世界、现实/梦境，后者适合白天/夜晚、正常/警报、供电/断电。它们不是任意样式开关，而是剧情逻辑、表现和验收共享的单一真相源。

## 数据契约

状态轴定义在 `Story.meta`，每个状态只写相对作品基础配置的差异：

```jsonc
{
  "world": {
    "initial": "surface",
    "states": {
      "surface": { "label": "表世界", "theme": "paper" },
      "other": {
        "label": "里世界",
        "theme": "cyber",
        "presentation": { "shell": "cinematic", "typography": "mono" },
        "soundscape": { "name": "void", "intensity": "strong" }
      }
    }
  },
  "phase": {
    "initial": "day",
    "states": {
      "day": { "label": "白天" },
      "night": { "label": "夜晚", "soundscape": { "name": "wind" } }
    }
  }
}
```

`theme` 可用内置主题名或完整自定义主题；`presentation` 只需写覆盖项；`soundscape` 可写受控声景或 `"silence"`。

## 切换与条件

状态切换只能来自结构化效果：

```jsonc
{
  "label": "穿过镜面",
  "target": "mirror_hall",
  "effects": { "world": "other", "phase": "night" }
}
```

进入节点时切换可写在 `onEnter`。状态相关行动必须用正常条件表达：

```jsonc
{
  "label": "阅读只在夜里出现的讣告",
  "target": "hidden_obituary",
  "when": { "op": "eq", "var": "#phase", "value": "night" }
}
```

正文支持 `{#world}` 与 `{#phase}` 插值。不要用普通 flag 复制同一个含义，也不要用 CSS 隐藏决定证据或结局的行动。

## 表现优先级

视觉配方按“作品基础 → world → phase → 当前节点”合并。主题按“作品基础 → world → phase”取最后一次声明。持续声景先从访问历史恢复，再由 world、phase 覆盖；当前节点的显式 `soundscape` 拥有最高优先级。状态改变时运行时执行一次固定淡入过渡，`prefers-reduced-motion: reduce` 下关闭动画。

## 校验与成本

- schema 拒绝未知字段；validate 检查初始状态、切换目标和条件引用是否存在；
- 存档保存两个状态 id，旧存档迁移为配置的初始状态；
- walk 把 world/phase 纳入状态键，因此能证明状态门控结局，但无意义地频繁往返仍会扩大状态空间；
- `story_evaluate` 报告状态数量、切换次数、门控选择和状态声景，并提示定义了多个状态却从未切换；
- 把通用外观放在状态定义中，不要复制到每个节点。这既保持风格一致，也减少 MCP 输入和 Agent token 消耗。

## 创作建议

只有状态变化同时改变信息、行动、气氛或推理含义时才建立新状态。优先设计一到两个清晰状态轴，每条轴保持少量语义稳定的 id。视觉变化应帮助玩家理解“世界已经不同”，而不是代替正文与可操作线索。
