// 上海时区日期工具（Q3 统一出口）
// 小程序本地时区可能跟随设备，记账/统计一律以 UTC+8 计算。
const pad = (value, length = 2) => String(value).padStart(length, "0");

// 返回上海时区的可读时间字符串 YYYY-MM-DD HH:mm
const nowShanghai = () => {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return now.getUTCFullYear() + "-" + pad(now.getUTCMonth() + 1) + "-" + pad(now.getUTCDate()) + " " + pad(now.getUTCHours()) + ":" + pad(now.getUTCMinutes());
};

// 返回上海时区当天日期 YYYY-MM-DD
const todayShanghai = () => nowShanghai().substring(0, 10);

module.exports = { padDatePart: pad, nowShanghai, todayShanghai };
