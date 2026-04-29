import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";
import { fetchGraphicsData, sendToMseServer } from "../services/graphicsService";

export default function GraphicsPage() {
  const { state, setLoadedGraphics, setMseResponse } = useAppFlow();
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const hasRequiredSelection = useMemo(
    () =>
      Boolean(
        state.selectedSport &&
          state.selectedSource &&
          state.selectedTournament &&
          state.selectedStatsType &&
          state.statsSearchValue
      ),
    [state]
  );

  useEffect(() => {
    if (!hasRequiredSelection) {
      return;
    }

    let mounted = true;

    async function loadGraphics() {
      try {
        setLoading(true);
        setError("");
        const response = await fetchGraphicsData({
          sport: state.selectedSport,
          source: state.selectedSource,
          tournament: state.selectedTournament,
          competitionId: state.selectedCompetitionId,
          seasonId: state.selectedSeasonId,
          statsType: state.selectedStatsType,
          statsQuery: state.statsSearchValue,
        });

        if (mounted) {
          setLoadedGraphics(response.graphics);
        }
      } catch (loadError) {
        if (mounted) {
          setError(loadError.message || "Failed to load graphics.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadGraphics();

    return () => {
      mounted = false;
    };
  }, [
    hasRequiredSelection,
    setLoadedGraphics,
    state.selectedSport,
    state.selectedSource,
    state.selectedTournament,
    state.selectedStatsType,
    state.statsSearchValue,
  ]);

  if (!hasRequiredSelection) {
    return <Navigate to="/" replace />;
  }

  const onSendToMse = async () => {
    try {
      setSending(true);
      setMseResponse(null);
      const response = await sendToMseServer({
        sport: state.selectedSport,
        tournament: state.selectedTournament,
        competitionId: state.selectedCompetitionId,
        seasonId: state.selectedSeasonId,
        seasonName: state.selectedSeasonName,
        source: state.selectedSource,
        statsType: state.selectedStatsType,
        statsQuery: state.statsSearchValue,
        graphics: state.loadedGraphics,
      }, state.activeProfile?.mseUrl);
      setMseResponse(response);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel">
      <h2>5. Available Graphics</h2>
      <p className="subtitle">
        {state.selectedSport} | {state.selectedTournament}
        {state.selectedSeasonName ? ` (${state.selectedSeasonName})` : ""} | {state.selectedStatsType}
      </p>

      {loading ? <p className="loading">Loading graphics data...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {!loading && !error ? (
        <div className="graphics-grid">
          {state.loadedGraphics.map((graphic) => (
            <article className="graphic-card" key={graphic.id}>
              <h3>{graphic.name}</h3>
              <p>{graphic.description}</p>
              <span>{graphic.type}</span>
            </article>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="action-button"
        onClick={onSendToMse}
        disabled={!state.loadedGraphics.length || sending}
      >
        {sending ? "Sending to MSE..." : "Send Graphics to MSE Server"}
      </button>

      {state.mseResponse ? (
        <div className={`mse-status ${state.mseResponse.ok ? "ok" : "fail"}`}>
          <strong>{state.mseResponse.ok ? "MSE delivery successful" : "MSE delivery failed"}</strong>
          <p>Endpoint: {state.mseResponse.endpoint}</p>
          {!state.mseResponse.ok ? <p>{state.mseResponse.fallback}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
