import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { UpdateBanner } from './components/UpdateBanner';
import './index.css';

// UpdateBanner ligger bredvid App, inte inuti, så att samma rad gäller även
// för fjärrskärmen (?remote) när den får en egen rotkomponent.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
);
