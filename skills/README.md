# Wiki 国服主动技能名

由仓库根目录 `scrape_wiki_active_skills.py` 按旅人图鉴角色列表抓取各角色详情页 `#chinese-active` 内的技能卡片（详见脚本头注释）。

生成后执行：

```bash
npm run wiki-skills-embed
```

将 `skills/wiki_active_skills_zh.min.json` 写入 `paiZhouUtil/wiki_active_skills_zh.embed.js`，供 `file://` 离线打开页面时使用。

| 文件 | 说明 |
|------|------|
| `wiki_active_skills_zh.json` | 完整结果（含 `byCharacter`、`warnings`） |
| `wiki_active_skills_zh.min.json` | 压缩版 |
| `wiki_active_skills_zh_flat.txt` | 全部技能名去重扁平列表 |

排轴工具内「角色名」须与 `byCharacter` 的键（Wiki 展示名）一致，方可联想该角色的主动技能。
