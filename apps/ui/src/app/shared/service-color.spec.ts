import { serviceColor } from './service-color';

describe('serviceColor', () => {
  it('is deterministic', () => {
    expect(serviceColor('order-service')).toBe(serviceColor('order-service'));
  });

  it('always resolves to one of the 8 palette variables', () => {
    for (const name of ['a', 'order-service', 'payment', 'x'.repeat(100), '']) {
      expect(serviceColor(name)).toMatch(/^var\(--svc-[0-7]\)$/);
    }
  });
});
