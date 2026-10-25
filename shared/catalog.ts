import type { DemoModule } from './demo';

// 明确列出模块，让 Bun 能打包懒加载入口；URL 只能选择这里登记的章节。
export const demoLoaders: Record<string, () => Promise<DemoModule>> = {
  day01: () => import('../days/day01/main'),
  day02: () => import('../days/day02/main'),
  day03: () => import('../days/day03/main'),
  day04: () => import('../days/day04/main'),
  day05: () => import('../days/day05/main'),
  day06: () => import('../days/day06/main'),
  day07: () => import('../days/day07/main'),
  day08: () => import('../days/day08/main'),
  day09: () => import('../days/day09/main'),
  day10: () => import('../days/day10/main'),
  'extra-perspective': () => import('../days/extra-perspective/main'),
  'extra-toon': () => import('../days/extra-toon/main'),
  'extra-webgpu': () => import('../days/extra-webgpu/main'),
  'extra-webgpu-optimized': () => import('../days/extra-webgpu-optimized/main'),
};

// 清单只读取元信息，不调用 run，也不请求模型；开发路由与静态构建共用。
export async function getDemoEntries() {
  const chapters = await Promise.all(
    Object.entries(demoLoaders).map(async ([chapter, load]) => {
      const { demos } = await load();
      return Object.entries(demos).map(([id, demo]) => ({
        chapter,
        id,
        title: demo.title,
        width: demo.width,
        height: demo.height,
        animated: !!demo.animated,
        path: `/embed/${chapter}/${id}/`,
      }));
    }),
  );
  return chapters.flat();
}
