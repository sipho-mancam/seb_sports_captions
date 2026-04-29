import { Navigate, Route, Routes, useMatch } from "react-router-dom";
import HomePage from "./pages/HomePage";
import DataSourcePage from "./pages/DataSourcePage";
import TournamentPage from "./pages/TournamentPage";
import StatsPage from "./pages/StatsPage";
import GraphicsPage from "./pages/GraphicsPage";
import MatchStatsPage from "./pages/MatchStatsPage";
import MatchDataTypePanel from "./pages/MatchDataTypePanel";
import MatchProfilePanel from "./pages/MatchProfilePanel";
import ProgressHeader from "./pages/ProgressHeader";

export default function App() {
  const isMatchStatsRoute = Boolean(useMatch("/stats/:matchId"));

  return (
    <div className={`app-shell ${isMatchStatsRoute ? "app-shell-match-route" : ""}`}>
      <ProgressHeader />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/source" element={<DataSourcePage />} />
        <Route path="/tournaments" element={<TournamentPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route
          path="/stats/:matchId"
          element={
            <div className="match-route-layout">
              <MatchDataTypePanel />
              <MatchStatsPage />
              <MatchProfilePanel />
            </div>
          }
        />
        <Route path="/graphics" element={<GraphicsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
