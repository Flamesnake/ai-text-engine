# 运行时验收

静态校验与 walk 只能证明数据结构和近似可达性，不能证明玩家真的能完成交互。导出前至少实际操作一条完整真结局、一条错误结局和所有关键机制。

仓库的 `scripts/verify-integrated-mystery.mjs` 提供 happy-dom 模板。只验证状态逻辑时可直接实例化 `Game`；验证按钮刷新、推理板选择和谜题返回时必须挂载真实 `mountTextAdventure`。

## 先重放 walk 见证

构建后先验证 walker 给出的每条选择、推论与谜题动作能否由真实 `Game` 执行：

```powershell
npm run build
node scripts/verify-walk-witnesses.mjs "作品名"
```

随后用真实运行时 DOM 批量重放全部见证：

```powershell
node scripts/verify-dom-witnesses.mjs "作品名"
```

DOM 重放器会真实点击开始、场景选项、推理板 radio/checkbox、谜题输入框、提交与返回按钮，并在重渲染后重新查询元素；它也会重放 `failures.witnesses`，确认页面确实停在无结局、无普通选项、无可用推理或谜题行动的状态。发现失败见证时脚本以非零状态退出。若要确认主探索即使极低预算也能由目标搜索补齐结局见证，可临时给两个脚本追加 `1 25000`；此时 `failures.complete` 会是 `false`，不能用于证明没有软锁。脚本只输出简短统计，不打印剧情正文，避免 Agent 为每个结局重复生成和维护路线。

两层自动重放通过后，仍需人工或定制 happy-dom 路线检查至少一条真结局、一条错误结局及关键机制的文案提示、谜题可理解性、表现节奏和特殊界面状态；自动见证会使用正确答案，不会评价玩家能否公平推出答案。

## DOM 要点

1. 从开始界面点击 `[data-action="start"]`，按真实按钮推进并断言关键选项出现。
2. 谜题状态层使用 `Game.attemptPuzzle(puzzleId, answer)`；DOM 中填写 `[data-puzzle-answer]`、点击 `[data-action="attempt-puzzle"]`，成功后点击 `[data-action="back"]` 返回场景，让依赖 `#puzzle` 的选项重新渲染。
3. 推理板先选中 `input[name="deduction"][value="推论id"]`，再勾选所需 `[data-evidence]`，最后点击 `[data-action="confirm-deduction"]`；不要依赖默认选中的第一条推论。
4. DOM 重渲染后重新查询元素，不要继续使用旧引用。
5. 断言关系门槛、秘密、谜题产物和推论确实改变可见选项，而不只是状态对象中出现数值。
6. 实际抵达并断言结局标题。
