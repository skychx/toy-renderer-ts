import type { DemoModule } from './demo';

// 明确列出模块，让 Bun 能打包懒加载入口；URL 只能选择这里登记的章节。
export const demoLoaders: Record<string, () => Promise<DemoModule>> = {
  day08: () => import('../days/day08/main'),
};
