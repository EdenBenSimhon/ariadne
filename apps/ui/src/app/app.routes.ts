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
    path: 'logs',
    loadComponent: () => import('./features/logs/logs-page').then((m) => m.LogsPage),
  },
  {
    path: 'flows',
    loadComponent: () => import('./features/flows/flows-page').then((m) => m.FlowsPage),
  },
  {
    path: 'insights',
    loadComponent: () =>
      import('./features/insights/insights-page').then((m) => m.InsightsPage),
  },
  {
    path: 'ask',
    loadComponent: () => import('./features/ask/ask-page').then((m) => m.AskPage),
  },
  {
    path: 'live',
    loadComponent: () => import('./features/live/live-page').then((m) => m.LivePage),
  },
  {
    path: 'topology',
    loadComponent: () =>
      import('./features/topology/topology-page').then((m) => m.TopologyPage),
  },
];
