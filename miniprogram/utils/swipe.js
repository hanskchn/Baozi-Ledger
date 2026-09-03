// 左滑删除手势公共计算（Q3）
// bills 与首页共用同一套位移换算与方向判定，避免两处 75 行逐行重复。
const SWIPE_TOLERANCE_PX = 6;
const SWIPE_LIMIT_RPX = 220;

const resolveSwipeDirection = (deltaX, deltaY, previousDirection) => {
  if (previousDirection) return previousDirection;
  if (Math.abs(deltaX) < SWIPE_TOLERANCE_PX && Math.abs(deltaY) < SWIPE_TOLERANCE_PX) return null;
  return Math.abs(deltaY) > Math.abs(deltaX) ? "vertical" : "horizontal";
};

// 手指位移 → 滑动偏移 rpx（0 ~ -220，超出部分带阻尼回弹）
const swipeOffsetRpx = (baseX, deltaX, rpxRatio) => {
  let offsetRpx = baseX + deltaX * rpxRatio;
  if (offsetRpx > 0) offsetRpx = offsetRpx * 0.2;
  if (offsetRpx < -SWIPE_LIMIT_RPX) offsetRpx = -SWIPE_LIMIT_RPX + (offsetRpx + SWIPE_LIMIT_RPX) * 0.2;
  return Math.round(offsetRpx);
};

module.exports = { resolveSwipeDirection, swipeOffsetRpx };
