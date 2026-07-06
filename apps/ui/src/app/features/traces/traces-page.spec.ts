import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FIXTURE_TRACE_LIST } from '../../core/api/fixtures';
import { TracesPage } from './traces-page';

describe('TracesPage', () => {
  let fixture: ComponentFixture<TracesPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TracesPage],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TracesPage);
    // Trigger the httpResource effect (issues the request); whenStable would
    // block until the request completes, so flush before awaiting it.
    fixture.detectChanges();
    await Promise.resolve();
  });

  it('renders rows from the list response', async () => {
    http.expectOne('/api/traces?limit=25').flush(FIXTURE_TRACE_LIST);
    await fixture.whenStable();

    const compiled = fixture.nativeElement as HTMLElement;
    const rows = compiled.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('order-service');
    expect(rows[0]?.textContent).toContain('ERROR');
  });

  it('requests a filtered url when toggling errors-only', async () => {
    http.expectOne('/api/traces?limit=25').flush(FIXTURE_TRACE_LIST);
    await fixture.whenStable();

    fixture.componentInstance.toggleErrors();
    fixture.detectChanges();
    await Promise.resolve();
    http.expectOne('/api/traces?limit=25&status=error').flush(FIXTURE_TRACE_LIST);
    await fixture.whenStable();
  });

  it('shows the error state when the API is down', async () => {
    http.expectOne('/api/traces?limit=25').error(new ProgressEvent('error'));
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('failed to load');
  });
});
