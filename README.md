# 歧路旅人：大陆的霸者 排轴工具

> 本项目仅供交流学习与个人使用，未经作者授权，严禁任何形式的商业盈利行为。

用于录入角色、回合行动、收益效果并可视化排轴的前端小工具。  
项目为纯前端页面，无后端依赖，数据保存在浏览器本地并支持导入/导出。

## 快速使用
https://w1334113230.github.io/qllr_dldbz_paiZhouUtil/paiZhouUtil/index.html

## 项目结构

- `paiZhouUtil/index.html`：页面结构
- `paiZhouUtil/styles.css`：样式
- `paiZhouUtil/app.js`：交互逻辑、状态管理、持久化
- `paiZhouUtil/vendor/`：离线打包的二维码生成（`qrcode`）与识别（`jsQR`），不依赖外网 CDN
- `avatar/`：Wiki 角色展示名与头像 URL 数据（见 `avatar/README.md`）；抓取脚本在仓库根 `scrape_wiki_avatars.py`（已 `.gitignore`）
- `data/`：可选数据目录（我放了示例队伍）
- `docs/screenshots/`：README 截图目录

## 核心功能

- 8 格队伍面板（前卫/后卫）与头像、备注、角色扩展信息录入
- 回合行动录入（详细/简洁模式切换）
- 效果条目投放到主动/被动/必杀/支炎兽区
- 收益区与额外收益自动汇总
- 按回合高亮展示
- 回合图标与角色卡拖拽交换
- 回合数量动态增减（含删除最后回合二次确认）
- 本地持久化 + JSON 导入导出（导出文件名跟随队伍名）

## 运行方式

### 方式一：直接打开（可完全离线）

将 **`paiZhouUtil/` 整个文件夹** 放到本机任意位置（需包含与 `index.html` 同级的 `styles.css`、`app.js` 以及 **`vendor/`** 子目录），双击 **`index.html`** 即可使用：不依赖外网 CDN，导出二维码、从图片识别导入分享均在本地完成。

若分发压缩包，请勿只打包单个 HTML 文件，否则会丢失样式、脚本与二维码库。

### 方式二：本地静态服务

在仓库根目录执行：

```bash
python3 -m http.server 8080
```

然后访问：`http://localhost:8080/paiZhouUtil/index.html`

### 重新打包 vendor（可选）

若缺少 `paiZhouUtil/vendor/*.bundle.js` 或需升级版本，在**仓库根目录**执行：

```bash
npm install
npm run vendor
```

### 更新 Wiki 头像表（可选）

头像数据在 `avatar/wiki_avatars.json`（由爬虫生成）。爬虫脚本 `scrape_wiki_avatars.py` 已加入 `.gitignore`，需在本机执行：

```bash
python3 -m venv .venv
.venv/bin/pip install requests beautifulsoup4
.venv/bin/python scrape_wiki_avatars.py
```

生成后可将 `avatar/` 下 JSON 与 `wiki_avatar_names.txt` 提交入库。详见 `avatar/README.md`。

## 操作步骤（建议流程）

1. 在顶部填写 `队伍名` 和 `备注`（点右侧铅笔图标编辑）。
2. 点击队伍头像位，进入 `角色录入`，填写角色名、头像、备注与可选扩展装备/技能信息。
3. 点击 `被` 图标录入被动与装备效果（效果条目）。
4. 点击某个回合图标录入回合行动：
   - 可切换 `详细 / 简洁` 录入模式（全局生效）
   - 填写技能、支炎兽、追击、底力/切换状态等信息
5. 在收益区确认效果累计、上限与额外收益统计。
6. 使用底部 `按回合展示` 过滤查看某一回合生效角色与提示信息。
7. 通过 `导出数据` 保存 JSON；需要时点击 `导入数据`，在弹窗中按优先级使用 JSON 文件、分享链接/分享码或二维码截图恢复（可同时准备多项，优先采用 JSON）。

## 截图说明

### 1) 主界面

![主界面总览](docs/screenshots/01-overview.png)

### 2) 角色录入

![角色录入弹窗](docs/screenshots/02-character-modal.png)

### 3) 回合录入（详细）

![回合录入详细模式](docs/screenshots/03-turn-modal-detailed.png)

### 4) 回合录入（简洁）

![回合录入简洁模式](docs/screenshots/04-turn-modal-simple.png)

### 5) 按回合展示与提示

![按回合展示与常显提示](docs/screenshots/05-turn-filter-and-tooltip.png)

### 6) 动态回合增删

![动态回合增删](docs/screenshots/06-dynamic-turn-add-remove.png)

## 数据说明

- 本地存储键：`paiZhouUtilData.v1`
- 主要持久化内容：
  - 队伍数据（角色、头像、被动、回合行动）
  - 队伍名、备注
  - 回合总数
  - 回合录入视图模式（详细/简洁）
  - 收益格上限

## 注意事项

- 删除最后回合会清空该回合所有角色行动，请确认后执行。
- 如需版本迭代，建议每次调整后先导出 JSON 备份。 

