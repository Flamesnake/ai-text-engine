# 受控富文本与条件揭示

只在文字的呈现本身参与叙事时读取本页。普通段落继续使用 `text`，不要为了“显得高级”给每句话加样式。

## 数据格式

`segments` 位于文本块内。块的 `text` 仍必填，是纯文本回退与非视觉阅读的完整语义；片段不能包含 HTML 或 CSS。

```jsonc
{
  "type": "para",
  "text": "病历写着：凌晨三点。",
  "segments": [
    { "text": "病历写着：" },
    {
      "text": "凌晨三点",
      "style": "redacted",
      "revealWhen": { "op": "eq", "var": "#evidence", "value": "e_真实时间" }
    },
    { "text": "。血迹未干。", "style": "blood" }
  ]
}
```

每个片段：`{ text, style?, revealWhen? }`。`revealWhen` 使用与选项相同的 Condition；证据、推论、谜题或变量引用会被 `story_validate` 检查。

## 样式语义

| style | 适合表达 |
|---|---|
| `emphasis` | 玩家必须注意的短语 |
| `italic` | 内心、引文、轻微语气变化 |
| `blood` | 血写文字或危险峰值；只用于短句 |
| `whisper` | 耳语、远处声音、弱信号 |
| `redacted` | 被涂黑的档案事实 |
| `glitch` | 数字媒介故障与待恢复文本 |
| `corrupt` | 损坏文件或记忆污染 |
| `terminal` | 命令、日志、机器输出 |
| `handwritten` | 手记、批注、私人痕迹 |
| `broadcast` | 电视字幕、新闻插播、信号色块 |

当 `redacted`、`glitch`、`corrupt` 带 `revealWhen` 时，条件满足前只显示确定性占位符，真实文本不会进入 DOM；满足后恢复可读原文。其他样式也可以带条件，未满足时显示省略占位。

## 创作约束与 Token 效率

- 先写完整纯文本回退，再只拆出需要演出的短片段；不要逐字建 segment。
- 同一段通常 2–5 个片段足够；长正文不要持续 blood/glitch/corrupt。
- 关键事实的乱码必须有游戏内恢复条件，不能要求玩家猜随机字符。
- 样式是叙事语义，不是主题皮肤。全局媒介感优先用 presentation，一次配置即可。
- `story_evaluate` 会统计片段数量、条件片段和样式使用；它不要求作品必须使用富文本。
