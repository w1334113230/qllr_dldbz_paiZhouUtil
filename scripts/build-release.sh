#!/usr/bin/env bash
# 生成分发用 zip：仅含运行所需文件 + 使用说明.txt（不含爬虫、git、node 等）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d)"
OUT_NAME="大陆的霸者排轴工具-${STAMP}-release.zip"
TMP="$(mktemp -d)"
PKG="$TMP/大陆的霸者排轴工具"

mkdir -p "$PKG/paiZhouUtil/vendor" "$PKG/avatar" "$PKG/skills"

cp paiZhouUtil/index.html paiZhouUtil/app.js paiZhouUtil/styles.css paiZhouUtil/wiki_avatars.embed.js paiZhouUtil/wiki_active_skills_zh.embed.js "$PKG/paiZhouUtil/"
cp -R paiZhouUtil/vendor/*.js "$PKG/paiZhouUtil/vendor/" 2>/dev/null || {
  echo "错误: paiZhouUtil/vendor 下缺少 qrcode.bundle.js / jsqr.bundle.js，请在仓库根执行 npm install && npm run vendor" >&2
  exit 1
}

cp avatar/wiki_avatars.min.json "$PKG/avatar/"
cp skills/wiki_active_skills_zh.min.json "$PKG/skills/"

# 可选：附带仓库内示例队伍 JSON（体积大，默认不包含）
if [[ "${INCLUDE_DATA_SAMPLES:-}" == "1" ]]; then
  mkdir -p "$PKG/data"
  shopt -s nullglob
  for f in data/*.json; do cp "$f" "$PKG/data/"; done
fi

cat > "$PKG/使用说明.txt" << 'EOF'
================================================================================
  大陆的霸者 · 排轴工具（离线版使用说明）
================================================================================

【怎么打开】
  1. 解压本压缩包，得到文件夹「大陆的霸者排轴工具」。
  2. 打开里面的子文件夹「paiZhouUtil」。
  3. 双击「index.html」，用 Chrome、Edge 或 Safari 打开即可使用。

【重要】
  · 请保留解压后的完整文件夹，不要只复制「paiZhouUtil」到外面单独使用。
    需要与「paiZhouUtil」同级存在「avatar」「skills」文件夹，程序才能匹配 Wiki 头像与主动技能候选。
  · 若只拷贝一个 index.html，会缺少样式、脚本和二维码功能，无法正常使用。

【数据保存在哪】
  · 队伍数据保存在当前浏览器的本地存储中。
  · 换电脑或清浏览器数据前，请用页面上的「导出数据」备份 JSON。

【联网说明】
  · 录入、排轴、导出 JSON 可完全离线。
  · 仅在使用「导出二维码 / 从二维码图导入」时需本机已自带 vendor 脚本（已随包附带）。
  · 角色 Wiki 头像为外链图片，显示头像时可能需要联网加载图片。

================================================================================
EOF

( cd "$TMP" && zip -r -q "$ROOT/$OUT_NAME" "大陆的霸者排轴工具" )
rm -rf "$TMP"

echo "已生成: $ROOT/$OUT_NAME"
ls -lh "$ROOT/$OUT_NAME"
