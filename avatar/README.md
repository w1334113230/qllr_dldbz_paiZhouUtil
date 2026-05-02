# Wiki 头像数据

由仓库根目录脚本 `scrape_wiki_avatars.py`（已 `.gitignore`，不随仓库分发）从 [旅人图鉴2](https://wiki.biligame.com/octopathsp/%E6%97%85%E4%BA%BA%E5%9B%BE%E9%89%B42) 抓取。

## 文件

| 文件 | 说明 |
|------|------|
| `wiki_avatars.json` | 完整 JSON（含 `byName`、`list`） |
| `wiki_avatars.min.json` | 一行压缩版，体积更小 |
| `wiki_avatar_names.txt` | 仅角色展示名，每行一个 |

## 与排轴工具对接（`char.avatar` 字段）

- `byName` 的键为 Wiki 列表中的**展示名**（与你在工具里填的「角色名」一致时可命中）。
- 每个角色：`avatar` 为 **https** 图片 URL，可直接赋给角色对象的 `avatar` 字段（与粘贴图片生成的 data URL 一样，用作 `background-image: url(...)`）。

示例（逻辑伪代码）：

```js
var row = wikiData.byName[charName.trim()];
if (row) char.avatar = row.avatar;
```

更新数据：在仓库根用虚拟环境执行脚本后，将新的 `wiki_avatars*.json` 提交即可。
