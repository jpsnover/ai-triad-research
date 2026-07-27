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
import './styles.css';

// Public share link (t/1790): a fully logged-out visitor to `/share/pov/:id`
// gets the slim read-only POV view — NOT the main app. Rendering App() here would
// run its feature-flag refresh (getFlags → session-recovering bridge helper) and
// mount MainApp/loadAll (auth + `/ws`), all of which would mint a session and
// violate the no-session invariant (TL, t/1787#2). Branch before App renders.
const isPublicShare = window.location.pathname.startsWith('/share/pov/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPublicShare ? <PublicPovView /> : <App />}
  </StrictMode>,
);
