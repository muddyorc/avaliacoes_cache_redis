import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ProvedorTema } from './tema/ContextoTema.jsx';
import './styles/global.css';

createRoot(document.getElementById('raiz')).render(
  <StrictMode>
    <ProvedorTema>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ProvedorTema>
  </StrictMode>,
);
