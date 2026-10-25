import { demoLoaders } from '../shared/catalog';
import { mountDemo } from '../shared/demo';

const canvas = document.querySelector<HTMLCanvasElement>('#demo')!;
const stage = canvas.closest<HTMLElement>('.canvas-stage')!;

try {
  const parts = location.pathname.split('/').filter(Boolean);
  const chapter = parts[1];
  const id = parts[2];
  if (parts.length !== 3 || !Object.hasOwn(demoLoaders, chapter)) {
    throw new Error('没有找到这个章节的演示。');
  }
  const { demos } = await demoLoaders[chapter]();
  if (!Object.hasOwn(demos, id)) throw new Error('没有找到这个演示。');
  const demo = demos[id];
  document.title = demo.title;
  document.querySelector<HTMLElement>('.fps')!.hidden = !demo.animated;
  await mountDemo(demo, canvas).ready;
} catch (error) {
  stage.dataset.state = 'error';
  stage.setAttribute('aria-busy', 'false');
  stage.querySelector('.canvas-status')!.textContent =
    error instanceof Error ? error.message : '演示加载失败，请刷新重试。';
}
