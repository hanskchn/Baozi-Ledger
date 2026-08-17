// 品牌资源清单（Phase 1）
// 当对应 PNG 资源落地到 miniprogram/images/brand/ 后，将 available 改为 true，
// 各页面即自动启用品牌 Logo 与插画；资源缺失时保持文字降级，不出现破图。
const brand = {
  available: true,
  logo: "/images/brand/bun-logo.png",
  emptyBills: "/images/brand/empty-bills.png",
  welcome: "/images/brand/welcome-guide.png",
  searchEmpty: "/images/brand/search-empty.png",
  importEmpty: "/images/brand/import-empty.png",
  importDone: "/images/brand/import-done.png",
  networkError: "/images/brand/network-error.png"
};

module.exports = brand;
