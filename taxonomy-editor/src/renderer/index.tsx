// Copyright (c) 2026 Jeffrey Snover. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/600.css';
import '@fontsource-variable/jetbrains-mono';
import { App } from './App';
import { PublicPovView } from './components/PublicPovView';
import { PublicOpEdView } from './components/PublicOpEdView';
import './styles.css';
import './responsive.css';
import './Tooltip.css';
import './components/shared/ContextMenu.css';
import './components/shared/DialogOverlay.css';

// Public share link (t/1790, t/2728): a fully logged-out visitor to `/share/pov/:id`
// or `/share/oped/:shareId` gets the slim read-only view — NOT the main app.
// Rendering App() here would run its feature-flag refresh (getFlags → session-
// recovering bridge helper) and mount MainApp/loadAll (auth + `/ws`), all of which
// would mint a session and violate the no-session invariant (TL, t/1787#2). Branch
// before App renders.
const path = window.location.pathname;
const publicView = path.startsWith('/share/pov/')
  ? <PublicPovView />
  : path.startsWith('/share/oped/')
    ? <PublicOpEdView />
    : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {publicView ?? <App />}
  </StrictMode>,
);
