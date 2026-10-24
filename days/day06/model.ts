import { Vec2, Vec3, normalize } from './math';

/**
 * 解析 .obj 格式的模型文件
 *
 * obj 是一种纯文本格式，一行描述一条数据，现在我们关心四种：
 *   v  0.608654 -0.568839 -0.416318         一个顶点的 x、y、z 坐标
 *   vt 0.532 0.923 0.000                    一个纹理坐标 u、v（第三个数用不到）
 *   vn 0.001 0.482 -0.876                   一个法线向量
 *   f  1193/1240/1193 1180/1227/1180 ...     一个三角形面，每组数字依次是顶点、纹理坐标、法线的序号
 */
export class Model {
  verts: Vec3[] = []; // 所有的顶点
  texcoords: Vec2[] = []; // 所有的纹理坐标
  normals: Vec3[] = []; // 所有的法线
  faces: number[][] = []; // 所有的三角形，每个三角形存 3 个顶点的序号
  faceTexcoords: number[][] = []; // 每个三角形 3 个顶点对应的纹理坐标的序号
  faceNormals: number[][] = []; // 每个三角形 3 个顶点对应的法线的序号

  constructor(text: string) {
    for (const line of text.split('\n')) {
      const [type, ...values] = line.trim().split(/\s+/);

      if (type === 'v') {
        this.verts.push([Number(values[0]), Number(values[1]), Number(values[2])]);
      } else if (type === 'vt') {
        this.texcoords.push([Number(values[0]), Number(values[1])]);
      } else if (type === 'vn') {
        // 文件里的法线不一定是单位向量，这里统一做一下归一化
        this.normals.push(normalize([Number(values[0]), Number(values[1]), Number(values[2])]));
      } else if (type === 'f') {
        // 每组数据的格式是「顶点序号/纹理坐标序号/法线序号」
        // obj 的序号是从 1 开始数的，所以要减 1
        const indices = values.map(v => v.split('/').map(n => Number(n) - 1));
        this.faces.push(indices.map(i => i[0]));
        this.faceTexcoords.push(indices.map(i => i[1]));
        this.faceNormals.push(indices.map(i => i[2]));
      }
    }
  }

  // 三角形的个数
  nfaces() {
    return this.faces.length;
  }

  // 第 i 个三角形，返回 3 个顶点的序号
  face(i: number) {
    return this.faces[i];
  }

  // 第 i 个顶点
  vert(i: number) {
    return this.verts[i];
  }

  // 第 iface 个三角形的第 nthvert 个顶点的纹理坐标
  uv(iface: number, nthvert: number) {
    return this.texcoords[this.faceTexcoords[iface][nthvert]];
  }

  // 第 iface 个三角形的第 nthvert 个顶点的法线
  normal(iface: number, nthvert: number) {
    return this.normals[this.faceNormals[iface][nthvert]];
  }
}

// 用 fetch 读取 obj 文件，然后解析成模型
export async function loadModel(url: string) {
  const text = await (await fetch(url)).text();
  return new Model(text);
}
