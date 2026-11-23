# GlotFrame Skills

GlotFrame 官方 Claude Code 插件市场。当前提供 `image-translate`（图片翻译）。

## 安装

```bash
/plugin marketplace add Kinagant/skills
/plugin install image-translate@glotframe
```

安装后在 Claude Code 里直接说“翻译这张图：C:\path\shot.png”，或使用斜杠命令 `/image-translate:image-translate`。

需要 GlotFrame API Key：<https://app.glotframe.com/ApiKeys>（首次创建送 25 次）。

## 目录结构

```
.claude-plugin/marketplace.json                 市场清单（name 必须是 glotframe）
plugins/image-translate/
  .claude-plugin/plugin.json                    插件清单（name/version）
  skills/image-translate/SKILL.md               技能说明
  skills/image-translate/scripts/translate.mjs  调用脚本
```

## 版本规则

- 版本同时出现在三处，必须一致：`marketplace.json` 的 `plugins[].version`、`plugin.json` 的 `version`、`SKILL.md` 的 `metadata.version`。
- 任何内容改动都要 bump 版本，否则已安装的用户不会收到更新。
- `SKILL.md` 的 frontmatter 只使用 Claude Code 支持的字段；自定义版本信息放在 `metadata.version`。

## 发布

这个目录同时是站点的静态镜像（`https://app.glotframe.com/skills/`）和 GitHub 仓库的内容源。发布时把整个目录同步到 `Kinagant/skills` 仓库根目录，提交并推送：

```bash
git clone https://github.com/Kinagant/skills.git ..\skills-publish
robocopy "Member\wwwroot\skills" "..\skills-publish" /MIR /XD .git
cd ..\skills-publish && git add -A && git commit -m "image-translate 0.3.0" && git push
```

发布前用 `claude plugin validate .` 校验（需要安装 Claude Code）。

## 约定

- 不要把 API Key、内部地址写进本目录。
- 结果图默认保留 7 天。
