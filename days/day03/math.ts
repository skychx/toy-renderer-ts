/**
 * 迷你数学库
 *
 * 向量直接用数组表示，比如三维向量 [x, y, z]，后面几天会慢慢往这里加东西
 */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

// 向量相减 a - b
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

// 向量点乘
export function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// 向量叉乘
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// 向量的长度（模长）
export function length(v: Vec3) {
  return Math.sqrt(dot(v, v));
}

// 归一化：方向不变，长度变成 1
export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  return [v[0] / len, v[1] / len, v[2] / len];
}
