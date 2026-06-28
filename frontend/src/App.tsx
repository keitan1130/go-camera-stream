import './App.css';
import CameraMode from './components/CameraMode.tsx';
import ViewerMode from './components/ViewerMode.tsx';
import SetupMode from './components/SetupMode.tsx';

export default function App() {
  const mode = new URLSearchParams(window.location.search).get('mode');

  if (mode === 'viewer') {
    return <ViewerMode />;
  }

  if (mode === 'camera') {
    return <CameraMode />;
  }

  return <SetupMode />;
}
