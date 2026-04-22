import { Navigate, Route, Routes } from "react-router-dom";
import HomePage from "./pages/HomePage";
import DataSourcePage from "./pages/DataSourcePage";
import TournamentPage from "./pages/TournamentPage";
import StatsPage from "./pages/StatsPage";
import GraphicsPage from "./pages/GraphicsPage";
import MatchStatsPage from "./pages/MatchStatsPage";
import ProgressHeader from "./pages/ProgressHeader";

export default function App() {
  return (
    <div className="app-shell">
      <ProgressHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/source" element={<DataSourcePage />} />
        <Route path="/tournaments" element={<TournamentPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/stats/:matchId" element={<MatchStatsPage />} />
        <Route path="/graphics" element={<GraphicsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
