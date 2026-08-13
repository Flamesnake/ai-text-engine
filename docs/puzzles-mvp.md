# 密码谜题 MVP

## 目标

提供无需联网、可确定验证、可被 Agent 可靠创作的轻量解谜闭环：玩家从剧情内信息获得答案，输入密码，错误时保留现场并得到反馈，需要时逐步查看提示，解开后触发效果并解锁新内容。

## 模型

```ts
interface Puzzle {
  id: string
  title: string
  prompt: string
  kind: 'code'
  solution: string
  caseSensitive?: boolean
  hints?: string[]
  requires?: Condition
  onSolved?: Effects
}
```

## 运行时接口

- `Game.availablePuzzles()`：返回当前前置条件满足且尚未解决的谜题；
- `Game.attemptPuzzle(id, answer)`：提交答案，返回结构化结果；
- `Game.revealPuzzleHint(id)`：顺序揭示一条提示；
- `GameState.solvedPuzzles`：保存已解谜题；
- `GameState.puzzleAttempts`：保存各谜题错误尝试次数；
- `GameState.puzzleHints`：保存各谜题已揭示提示数量；
- 条件 `{ op: 'eq', var: '#puzzle', value: id }` 检查谜题是否解决。

答案默认去除首尾空白并忽略大小写；`caseSensitive: true` 时保留大小写区别。成功效果只执行一次，重复提交保持幂等。

## 创作约束

- 答案必须能从游戏内信息合理获得，不能依赖作者脑内知识；
- 提示按从轻到重排列，最后一条可以接近答案但不应无意义重复谜面；
- 关键谜题应有退出或回去搜证的路径，不能把玩家永久锁死；
- 谜题解决后必须影响证据、场景、关系或结局，不能成为孤立装饰。

## 暂不包含

- 拖拽、排序、连线等复杂控件；
- 自由文本语义判断；
- 模糊答案或多答案评分；
- 限时与实时小游戏；
- 失败即永久锁定。
