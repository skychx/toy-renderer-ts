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
};
