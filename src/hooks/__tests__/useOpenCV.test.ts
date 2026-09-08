import { describe, it, expect } from 'vitest';
import { unwrapCvModule } from '../useOpenCV';

/**
 * Vaktar mot hängningen som gjorde att appen fastnade för evigt på "Laddar
 * datorseende-motor" på telefonen: OpenCV.js-modulen har en `then` som löser upp
 * till sig själv, och matas den till en Promise-resolve blir det en oändlig
 * microtask-loop som fryser huvudtråden.
 */
describe('unwrapCvModule', () => {
  it('tar bort en self-refererande then så objektet inte längre är thenable', () => {
    const fakeModule: any = { Mat: function () {} };
    fakeModule.then = (fn: (m: unknown) => void) => {
      fn(fakeModule);
      return fakeModule;
    };

    const unwrapped = unwrapCvModule(fakeModule);

    expect(unwrapped).toBe(fakeModule);
    expect('then' in unwrapped).toBe(false);
  });

  it('går att lösa upp en Promise med utan att loopa', async () => {
    const fakeModule: any = { Mat: function () {} };
    fakeModule.then = (fn: (m: unknown) => void) => {
      fn(fakeModule);
      return fakeModule;
    };

    // Utan unwrap skulle det här await:et aldrig återvända.
    const resolved = await Promise.resolve(unwrapCvModule(fakeModule));
    expect(resolved).toBe(fakeModule);
  });

  it('lämnar moduler utan then orörda', () => {
    const mod = { Mat: function () {} };
    expect(unwrapCvModule(mod)).toBe(mod);
  });

  it('klarar null/undefined', () => {
    expect(unwrapCvModule(null)).toBe(null);
    expect(unwrapCvModule(undefined)).toBe(undefined);
  });
});
