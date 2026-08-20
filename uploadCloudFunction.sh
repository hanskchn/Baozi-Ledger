#!/bin/bash
# 自动上传云函数到微信云开发
# 用法：./uploadCloudFunction.sh [环境ID]
#   环境 ID 默认为 app.js 中的 cloud1-d1gq4g6a7c2911b56
# 依赖：/Applications/wechatwebdevtools.app/Contents/MacOS/cli（已安装）
# 注意：需要先在微信开发者工具中登录授权

set -e

ENV_ID="${1:-cloud1-d1gq4g6a7c2911b56}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="/Applications/wechatwebdevtools.app/Contents/MacOS/cli"

echo "================================"
echo " 家庭记账本 · 云函数上传"
echo "================================"
echo "环境 ID: $ENV_ID"
echo "项目路径: $PROJECT_DIR"
echo ""

# 1. 检查 IDE 是否已安装
if [ ! -x "$CLI" ]; then
  echo "❌ 找不到微信开发者工具 CLI：$CLI"
  echo "   请先安装微信开发者工具：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html"
  exit 1
fi

# 2. 检查登录状态
echo "▶ 检查 IDE 登录状态..."
LOGIN_STATUS=$("$CLI" islogin 2>&1 || true)
if echo "$LOGIN_STATUS" | grep -qi "not.*login\|未登录\|false"; then
  echo "❌ IDE 未登录。请先在微信开发者工具中扫码登录。"
  echo "   登录后再运行此脚本。"
  exit 1
fi
echo "✓ 已登录"
echo ""

# 3. 列出待部署函数
FUNCTIONS=("ledgerFunctions" "accountingFunctions" "resetTestData")
echo "▶ 准备部署的云函数："
for fn in "${FUNCTIONS[@]}"; do
  if [ -d "$PROJECT_DIR/cloudfunctions/$fn" ]; then
    echo "  ✓ $fn"
  else
    echo "  ⚠ $fn 不存在（跳过）"
  fi
done
echo ""

# 4. 部署
echo "▶ 开始部署（按依赖顺序：ledgerFunctions → accountingFunctions → resetTestData）..."
for fn in "${FUNCTIONS[@]}"; do
  if [ ! -d "$PROJECT_DIR/cloudfunctions/$fn" ]; then
    continue
  fi
  echo ""
  echo "--- 部署 $fn ---"
  "$CLI" cloud functions deploy \
    --env "$ENV_ID" \
    --names "$fn" \
    --remote-npm-install \
    --project "$PROJECT_DIR" 2>&1
  echo "✓ $fn 部署完成"
done

echo ""
echo "================================"
echo "✓ 全部云函数部署完成"
echo "================================"
echo ""
echo "下一步："
echo "1. 在云开发控制台创建 11 个集合（详见 PHASE_8_DEPLOY.md §1）"
echo "2. 配置 13 条索引（详见 PHASE_8_DEPLOY.md §2）"
echo "3. 微信开发者工具「上传」小程序代码"
echo ""
