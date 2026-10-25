import { expect, test } from 'bun:test';
import type { Demo, DemoController } from '../shared/demo';

async function environment() {
  const document = Object.assign(new EventTarget(), { hidden: false, querySelector: () => null });
  const window = new EventTarget();
  const status = { textContent: '' };
  const stage = {
    dataset: {} as Record<string, string>,
    setAttribute() {},
    querySelector: () => status,
  };
  const canvas = Object.assign(new EventTarget(), {
    width: 0,
    height: 0,
    closest: (selector: string) => (selector === 'figure' ? null : stage),
    classList: { toggle() {} },
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 800, right: 800 }),
  });
  let visibility: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let disconnected = false;
  class Observer {
    constructor(callback: typeof visibility) {
      visibility = callback;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  }
  const result = await Bun.build({ entrypoints: ['shared/demo.ts'], target: 'browser' });
  const code = (await result.outputs[0].text()).replace(/^export\s*\{[^}]*\};?\s*$/m, '');
  const execute = new Function(
    'document',
    'window',
    'IntersectionObserver',
    'requestAnimationFrame',
    'innerWidth',
    'innerHeight',
    `${code}\nreturn mountDemo;`,
  );
  const mount = execute(
    document,
    window,
    Observer,
    (callback: () => void) => queueMicrotask(callback),
    1200,
    900,
  ) as typeof import('../shared/demo').mountDemo;
  return {
    document,
    window,
    stage,
    canvas: canvas as unknown as HTMLCanvasElement,
    mount,
    visible: (value: boolean) => visibility([{ isIntersecting: value }]),
    disconnected: () => disconnected,
  };
}

test('画布可见性、后台与往返缓存控制暂停，离开页面释放资源', async () => {
  const env = await environment();
  const states: boolean[] = [];
  let disposed = 0;
  let signal!: AbortSignal;
  const demo: Demo = {
    title: 'test',
    width: 800,
    height: 800,
    animated: true,
    run(canvas, context) {
      signal = context.signal;
      expect(context.isActive()).toBe(true);
      canvas.dispatchEvent(new Event('canvas-ready'));
      return { setActive: value => states.push(value), dispose: () => disposed++ };
    },
  };
  env.mount(demo, env.canvas);
  await new Promise(resolve => setTimeout(resolve));
  expect(env.stage.dataset.state).toBe('ready');
  expect(states.at(-1)).toBe(true);
  env.visible(false);
  expect(states.at(-1)).toBe(false);
  env.visible(true);
  expect(states.at(-1)).toBe(true);
  env.document.hidden = true;
  env.document.dispatchEvent(new Event('visibilitychange'));
  expect(states.at(-1)).toBe(false);
  env.document.hidden = false;
  env.document.dispatchEvent(new Event('visibilitychange'));
  expect(states.at(-1)).toBe(true);
  env.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  expect(states.at(-1)).toBe(false);
  expect(disposed).toBe(0);
  env.window.dispatchEvent(new Event('pageshow'));
  expect(states.at(-1)).toBe(true);
  env.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
  expect(disposed).toBe(1);
  expect(signal.aborted).toBe(true);
  expect(env.disconnected()).toBe(true);
  const count = states.length;
  env.window.dispatchEvent(new Event('pageshow'));
  expect(states.length).toBe(count);
});

test('异步初始化期间离开页面，完成后仍会销毁迟到的渲染器', async () => {
  const env = await environment();
  let finish!: (controller: DemoController) => void;
  let disposed = 0;
  const pending = env.mount(
    {
      title: 'test',
      width: 800,
      height: 800,
      run: () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    },
    env.canvas,
  );
  await new Promise(resolve => setTimeout(resolve));
  pending.dispose();
  finish({
    setActive() {
      throw new Error('已离开的页面不应重启');
    },
    dispose: () => disposed++,
  });
  await pending.ready;
  expect(disposed).toBe(1);
});
