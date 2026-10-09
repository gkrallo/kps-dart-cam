import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { UpdateBanner } from './components/UpdateBanner';
import { BUILD_VERSION } from './buildInfo';
import './index.css';

// För tools/check.mjs och reload.mjs, som läser versionen över CDP. Alltid
// satt, inte bara med ?debug: det är just när fliken körs utan ?debug som
// man vill kunna se att det är fel bygge också.
(window as unknown as { __buildVersion: string }).__buildVersion = BUILD_VERSION;

// UpdateBanner ligger bredvid App, inte inuti, så att samma rad gäller även
// för fjärrskärmen (?remote) när den får en egen rotkomponent.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
);
