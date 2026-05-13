import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";
import { getAvailableTournaments } from "../services/tournamentService";

function notifyRequestError(message, fallbackMessage) {
  const resolvedMessage = message || fallbackMessage;
  window.alert(resolvedMessage);
  return resolvedMessage;
}

export default function TournamentPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [competitions, setCompetitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedCompetition, setSelectedCompetition] = useState(null);
  const { state, setTournament } = useAppFlow();

  const closeSeasonPopup = () => setSelectedCompetition(null);

  if (!state.selectedSport || !state.selectedSource) {
    return <Navigate to="/" replace />;
  }

  useEffect(() => {
    let mounted = true;

    async function loadCompetitions() {
      setLoading(true);
      setError("");
      try {
        const data = await getAvailableTournaments(state.selectedSport, state.selectedSource);
        if (mounted) {
          setCompetitions(data);
          if (state.selectedCompetitionId) {
            const previous = data.find(
              (item) => item.competitionId === state.selectedCompetitionId
            );
            setSelectedCompetition(previous || null);
          }
        }
      } catch (loadError) {
        if (mounted) {
          const message = notifyRequestError(loadError.message, "Failed to load competitions.");
          setError(message);
          setCompetitions([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadCompetitions();

    return () => {
      mounted = false;
    };
  }, [state.selectedSport, state.selectedSource, state.selectedCompetitionId]);

  const filteredCompetitions = useMemo(
    () =>
      competitions.filter((item) => {
        const term = search.trim().toLowerCase();
        return (
          item.name.toLowerCase().includes(term) ||
          (item.seasonName || "").toLowerCase().includes(term)
        );
      }),
    [competitions, search]
  );

  return (
    <section className="panel">
      <h2>3. Search and Select Competition</h2>
      <p className="subtitle">
        {state.selectedSport} via {state.selectedSource}
      </p>

      <input
        className="search-input"
        type="search"
        placeholder="Search competitions..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      {loading ? <p className="loading">Loading competitions...</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="list-wrap">
        {!loading && !error && filteredCompetitions.length ? (
          filteredCompetitions.map((competition) => (
            <button
              type="button"
              key={`${competition.competitionId}-${competition.seasonName}`}
              className={`list-item ${
                selectedCompetition?.competitionId === competition.competitionId ? "selected" : ""
              }`}
              onClick={() => setSelectedCompetition(competition)}
            >
              <strong>{competition.name}</strong>
              <span className="item-meta">{competition.seasonName}</span>
            </button>
          ))
        ) : null}

        {!loading && !error && !filteredCompetitions.length ? (
          <p className="empty-state">No competitions found for that search.</p>
        ) : null}
      </div>

      {selectedCompetition ? (
        <div className="modal-overlay" onClick={closeSeasonPopup}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Select Season</h3>
              <button
                type="button"
                className="modal-close"
                onClick={closeSeasonPopup}
                aria-label="Close season selection"
              >
                x
              </button>
            </div>
            <p className="subtitle modal-subtitle">Competition: {selectedCompetition.name}</p>
            <div className="source-list">
              {selectedCompetition.seasons.length ? (
                selectedCompetition.seasons.map((season) => (
                  <button
                    type="button"
                    key={season.seasonId}
                    className={`source-button ${
                      state.selectedSeasonId === season.seasonId ? "selected" : ""
                    }`}
                    onClick={() => {
                      setTournament({
                        tournament: selectedCompetition.name,
                        competitionId: selectedCompetition.competitionId,
                        seasonId: season.seasonId,
                        seasonName: season.name,
                      });
                      navigate("/stats");
                    }}
                  >
                    {season.name}
                  </button>
                ))
              ) : (
                <p className="empty-state">No seasons available for this competition.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
