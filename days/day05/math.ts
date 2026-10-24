/**
 * 迷你数学库
 *
 * 向量直接用数组表示，比如三维向量 [x, y, z]，后面几天会慢慢往这里加东西
 */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

// 矩阵用二维数组表示，m[i][j] 是第 i 行、第 j 列的元素，和我们在纸上写的顺序一样
export type Mat = number[][];

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
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
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

// n × n 的单位矩阵：对角线上是 1，其他位置都是 0
export function identity(n: number): Mat {
  const m: Mat = [];
  for (let i = 0; i < n; i++) {
    m.push(new Array(n).fill(0));
    m[i][i] = 1;
  }
  return m;
}

// 矩阵乘法 a × b
export function matMul(a: Mat, b: Mat): Mat {
  const result: Mat = [];
  for (let i = 0; i < a.length; i++) {
    result.push([]);
    for (let j = 0; j < b[0].length; j++) {
      // 结果的第 i 行第 j 列 = a 的第 i 行和 b 的第 j 列逐个相乘再相加
      let sum = 0;
      for (let k = 0; k < b.length; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i].push(sum);
    }
  }
  return result;
}

// 矩阵乘向量 m × v（向量看作一个列向量），传进来几维的向量，就返回几维的向量
export function matVec<T extends number[]>(m: Mat, v: T): T {
  const result: number[] = [];
  for (let i = 0; i < m.length; i++) {
    let sum = 0;
    for (let j = 0; j < v.length; j++) {
      sum += m[i][j] * v[j];
    }
    result.push(sum);
  }
  return result as T;
}
