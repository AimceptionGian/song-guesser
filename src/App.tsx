import { Routes, Route } from 'react-router-dom';
import LobbyScreen from './screens/LobbyScreen';
import GameScreen from './screens/GameScreen';
import ResultScreen from './screens/ResultScreen';
import FinalScreen from './screens/FinalScreen';
import AmbientBackground from './components/AmbientBackground';

export default function App() {
  return (
    <>
      <AmbientBackground />
      <Routes>
        <Route path="/" element={<LobbyScreen />} />
        <Route path="/game/:gameCode" element={<GameScreen />} />
        <Route path="/result" element={<ResultScreen />} />
        <Route path="/final" element={<FinalScreen />} />
      </Routes>
    </>
  );
}
