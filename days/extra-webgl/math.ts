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

// 向量相加 a + b
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

// 向量数乘 v × k
export function scale(v: Vec3, k: number): Vec3 {
  return [v[0] * k, v[1] * k, v[2] * k];
}

// 用重心坐标插值：values 是三角形三个顶点上的值，bar 是重心坐标
export function interpolate<T extends number[]>(values: T[], bar: Vec3): T {
  return values[0].map(
    (_, i) => values[0][i] * bar[0] + values[1][i] * bar[1] + values[2][i] * bar[2],
  ) as T;
}

// 矩阵转置：第 i 行第 j 列的元素，换到第 j 行第 i 列
export function transpose(m: Mat): Mat {
  return m[0].map((_, j) => m.map(row => row[j]));
}

// 逆矩阵：用高斯-约旦消元法求，适用于任意 n × n 的可逆矩阵
export function inverse(m: Mat): Mat {
  const n = m.length;
  // 在 m 的右边拼上一个单位矩阵：[m | I]
  const a = m.map((row, i) => [...row, ...identity(n)[i]]);

  for (let col = 0; col < n; col++) {
    // 在这一列里找绝对值最大的元素当主元，换到对角线上（能减小误差）
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }
    [a[col], a[pivot]] = [a[pivot], a[col]];

    // 把主元所在的行除以主元，让主元变成 1
    const p = a[col][col];
    a[col] = a[col].map(x => x / p);

    // 把这一列的其他元素都消成 0
    for (let row = 0; row < n; row++) {
      if (row !== col) {
        const k = a[row][col];
        a[row] = a[row].map((x, j) => x - k * a[col][j]);
      }
    }
  }

  // 左边变成了单位矩阵，右边就是逆矩阵
  return a.map(row => row.slice(n));
}

// 用 4x4 矩阵变换一个向量：向量的 w 是 0，平移对它不起作用
export function transformDirection(m: Mat, v: Vec3): Vec3 {
  const [x, y, z] = matVec(m, [v[0], v[1], v[2], 0] as Vec4);
  return [x, y, z];
}
