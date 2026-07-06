import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', pathMatch: 'full', redirectTo: 'traces' },
  {
    path: 'traces',
    loadComponent: () => import('./features/traces/traces-page').then((m) => m.TracesPage),
  },
  {
    path: 'traces/:traceId',
    loadComponent: () =>
      import('./features/trace-detail/trace-detail-page').then((m) => m.TraceDetailPage),
  },
  {
    path: 'topology',
    loadComponent: () =>
      import('./features/topology/topology-page').then((m) => m.TopologyPage),
  },
];
