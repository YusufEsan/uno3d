import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { socket } from './net/socket';
import './ui/actions';
import './styles.css';

socket.connect();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
