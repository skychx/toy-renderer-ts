import { expect, test } from 'bun:test';
import type { DemoModule } from '../shared/demo';

test.each(['extra-webgpu', 'extra-webgpu-optimized'])(
  '%s 的 CPU/GPU 可分别启动，清理后不再发送消息',
  async chapter => {
    const build = await Bun.build({ entrypoints: [`days/${chapter}/main.ts`], target: 'browser' });
    expect(build.success).toBe(true);
    const code = (await build.outputs[0].text()).replace(/^export\s*\{[^}]*\};?\s*$/m, '');
    const workers: FakeWorker[] = [];
    class FakeWorker {
      messages: { active?: boolean; uniforms?: unknown; canvas?: unknown }[] = [];
      terminated = false;
      constructor(public url: string) {
        workers.push(this);
      }
      postMessage(message: object) {
        expect(this.terminated).toBe(false);
        this.messages.push(message);
      }
      terminate() {
        this.terminated = true;
      }
    }
    class Canvas extends EventTarget {
      width = 800;
      height = 800;
      style = { touchAction: '' };
      transferControlToOffscreen() {
        return {};
      }
      setPointerCapture() {}
      hasPointerCapture() {
        return false;
      }
    }
    const execute = new Function('Worker', 'navigator', `${code}\nreturn { demos };`);
    const { demos } = execute(FakeWorker, { gpu: undefined }) as DemoModule;
    expect(workers.length).toBe(0);
    const context = {
      signal: new AbortController().signal,
      isActive: () => false,
      onFPS() {},
      onProgress() {},
    };
    const cpuCanvas = new Canvas();
    const cpu = await demos.software.run(cpuCanvas as unknown as HTMLCanvasElement, context);
    expect(workers.length).toBe(1);
    expect(workers[0].url).toBe(`/${chapter}/software.js`);
    expect(workers[0].messages[0].active).toBe(false);
    cpu!.setActive(true);
    expect(workers[0].messages.at(-1)?.active).toBe(true);
    cpu!.setActive(false);
    expect(workers[0].messages.at(-1)?.active).toBe(false);
    cpu!.dispose();
    cpu!.dispose();
    const messages = workers[0].messages.length;
    cpu!.setActive(true);
    expect(workers[0].terminated).toBe(true);
    expect(workers[0].messages.length).toBe(messages);
    // 同一章中绑定的画布共用相机；已经清理的画布不会再接收联动消息。
    const secondCanvas = new Canvas();
    const second = await demos.software.run(secondCanvas as unknown as HTMLCanvasElement, context);
    const third = await demos.software.run(new Canvas() as unknown as HTMLCanvasElement, context);
    const originalUniforms = workers[1].messages[0].uniforms;
    secondCanvas.dispatchEvent(
      Object.assign(new Event('pointerdown'), { button: 0, pointerId: 1, clientX: 0, clientY: 0 }),
    );
    secondCanvas.dispatchEvent(
      Object.assign(new Event('pointermove'), { pointerId: 1, clientX: 50, clientY: 0 }),
    );
    secondCanvas.dispatchEvent(new Event('pointerup'));
    expect(workers[1].messages.at(-1)?.uniforms).not.toEqual(originalUniforms);
    expect(workers[1].messages.at(-1)?.uniforms).toEqual(workers[2].messages.at(-1)?.uniforms);
    expect(workers[0].messages.length).toBe(messages);
    second!.dispose();
    third!.dispose();
    // WebGPU 不可用时应给出明确错误，也不应意外启动第二个 CPU Worker。
    await expect(
      demos.webgpu.run(new Canvas() as unknown as HTMLCanvasElement, context),
    ).rejects.toThrow('WebGPU');
    expect(workers.length).toBe(3);
  },
);
