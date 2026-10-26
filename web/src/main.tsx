import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import './styles/versus.css';
import './styles/call.css';
import './styles/drawing.css';
import './styles/calendar.css';
import './styles/learn.css';
import './styles/games/giraffe.css';
import './styles/games/family-quiz.css';
import './styles/games/pairs.css';
import './styles/games/four-in-a-row.css';
import './styles/games/dots-boxes.css';
import './styles/games/snakes-ladders.css';
import './styles/games/bonsai.css';
import './styles/games/sushi.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
