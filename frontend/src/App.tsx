import './App.css';
import CameraMode from './components/CameraMode.tsx';
import ViewerMode from './components/ViewerMode.tsx';

export default function App() {
  const isViewer = new URLSearchParams(window.location.search).get('mode') === 'viewer';
  return isViewer ? <ViewerMode /> : <CameraMode />;
}
