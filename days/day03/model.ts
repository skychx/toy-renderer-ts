import { Vec3 } from './math';

/**
 * 解析 .obj 格式的模型文件
 *
 * obj 是一种纯文本格式，一行描述一条数据，今天只关心两种：
 *   v 0.608654 -0.568839 -0.416318          一个顶点的 x、y、z 坐标
 *   f 1193/1240/1193 1180/1227/1180 ...      一个三角形面，每组数字的第一个是顶点的序号
 */
export class Model {
  verts: Vec3[] = []; // 所有的顶点
  faces: number[][] = []; // 所有的三角形，每个三角形存 3 个顶点的序号

  constructor(text: string) {
    for (const line of text.split('\n')) {
      const [type, ...values] = line.trim().split(/\s+/);

      if (type === 'v') {
        this.verts.push([Number(values[0]), Number(values[1]), Number(values[2])]);
      } else if (type === 'f') {
        // 每组数据的格式是「顶点序号/纹理坐标序号/法线序号」，今天只取第一个
        // obj 的序号是从 1 开始数的，所以要减 1
        this.faces.push(values.map(v => Number(v.split('/')[0]) - 1));
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
}

// 用 fetch 读取 obj 文件，然后解析成模型
export async function loadModel(url: string) {
  const text = await (await fetch(url)).text();
  return new Model(text);
}
