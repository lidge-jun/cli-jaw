import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('manager-root');
if (!root) throw new Error('manager-root not found');

createRoot(root).render(<App />);

