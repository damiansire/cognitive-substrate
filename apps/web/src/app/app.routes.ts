import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home').then((m) => m.Home) },
  { path: 'inbox', loadComponent: () => import('./features/inbox/inbox').then((m) => m.Inbox) },
  { path: 'board', loadComponent: () => import('./features/board/board').then((m) => m.Board) },
  {
    path: 'session',
    loadComponent: () => import('./features/session/session').then((m) => m.Session),
  },
  {
    path: 'project',
    loadComponent: () => import('./features/project/project').then((m) => m.Project),
  },
  {
    path: 'departments',
    loadComponent: () => import('./features/departments/departments').then((m) => m.Departments),
  },
  {
    path: 'portfolio',
    loadComponent: () => import('./features/portfolio/portfolio').then((m) => m.Portfolio),
  },
  {
    path: 'artifacts',
    loadComponent: () => import('./features/artifacts/artifacts').then((m) => m.Artifacts),
  },
  {
    path: 'environment',
    loadComponent: () => import('./features/environment/environment').then((m) => m.Environment),
  },
  {
    path: 'learning',
    loadComponent: () => import('./features/learning/learning').then((m) => m.Learning),
  },
];
