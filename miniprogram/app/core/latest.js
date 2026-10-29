// 取消只是优化，序号才是正确性保证：旧请求成功/失败均不能覆盖新状态。
class LatestRequest {
  constructor() {
    this.sequence = 0;
  }
  begin() {
    this.sequence += 1;
    return this.sequence;
  }
  isCurrent(sequence) {
    return sequence === this.sequence;
  }
  invalidate() {
    this.sequence += 1;
  }
}
module.exports = { LatestRequest };
