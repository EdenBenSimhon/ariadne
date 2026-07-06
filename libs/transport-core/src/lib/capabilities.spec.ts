import { assertCapabilities } from './capabilities';
import { CapabilityError } from './errors';

describe('assertCapabilities', () => {
  it('passes when required capabilities are native or emulated', () => {
    expect(() =>
      assertCapabilities(
        { pubsub: true, reqreply: true },
        { pubsub: 'native', reqreply: 'emulated' },
        'kafka'
      )
    ).not.toThrow();
  });

  it('throws an actionable CapabilityError at wiring time for missing capabilities', () => {
    expect(() =>
      assertCapabilities({ reqreply: true }, { pubsub: 'native', reqreply: 'none' }, 'fake')
    ).toThrow(CapabilityError);
    expect(() =>
      assertCapabilities({ reqreply: true }, { pubsub: 'native', reqreply: 'none' }, 'fake')
    ).toThrow(/'fake' does not support required capabilities: reqreply/);
  });

  it('ignores capabilities that are not required', () => {
    expect(() =>
      assertCapabilities({}, { pubsub: 'none', reqreply: 'none' }, 'fake')
    ).not.toThrow();
  });
});
