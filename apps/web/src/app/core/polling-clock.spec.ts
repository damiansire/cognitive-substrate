import { TestBed } from '@angular/core/testing';
import { PollingClock } from './polling-clock';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  emit(): void {
    this.onmessage?.(new MessageEvent('message'));
  }
}

function wait(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('PollingClock', () => {
  let originalEventSource: typeof EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    originalEventSource = globalThis.EventSource;
    (globalThis as unknown as { EventSource: typeof EventSource }).EventSource =
      FakeEventSource as unknown as typeof EventSource;
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('does not open an EventSource with no active project', async () => {
    TestBed.inject(PollingClock);
    await wait();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('opens an EventSource for the active project and bumps tick on message', async () => {
    const clock = TestBed.inject(PollingClock);
    clock.setActiveProject('demo');
    await wait();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toContain('/api/workspaces/demo/events');

    const before = clock.tick();
    FakeEventSource.instances[0].emit();
    expect(clock.tick()).toBe(before + 1);
  });

  it('closes the previous connection when the active project changes', async () => {
    const clock = TestBed.inject(PollingClock);
    clock.setActiveProject('alpha');
    await wait();
    const first = FakeEventSource.instances[0];

    clock.setActiveProject('beta');
    await wait();

    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1].url).toContain('/api/workspaces/beta/events');
  });

  it('the 3s interval keeps bumping tick independently of SSE', async () => {
    const clock = TestBed.inject(PollingClock);
    const before = clock.tick();
    await wait(3100);
    expect(clock.tick()).toBeGreaterThan(before);
  });
});
