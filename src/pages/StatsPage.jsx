import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppFlow } from "../context/AppFlowContext";
import { fetchRugbyMatchesByDate } from "../services/graphicsService";

const statsOptions = ["Match Stats", "Season Stats", "Historical Stats"];

function getPrompt(statsType) {
  switch (statsType) {
    case "Match Stats":
      return "Search for a specific match (e.g. Team A vs Team B)";
    case "Season Stats":
      return "Search by season (e.g. 2025/26)";
    case "Historical Stats":
      return "Search by timeframe (e.g. last 5 years)";
    default:
      return "Select a stats type first";
  }
}

export default function StatsPage() {
  const navigate = useNavigate();
  const { state, setStatsSelection, setSelectedMatchId } = useAppFlow();
  const [statsType, setStatsType] = useState(state.selectedStatsType || "");
  const [query, setQuery] = useState(state.statsSearchValue || "");
  const [selectedDate, setSelectedDate] = useState("");
  const [matches, setMatches] = useState([]);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchError, setMatchError] = useState("");

  if (!state.selectedSport || !state.selectedSource || !state.selectedTournament) {
    return <Navigate to="/" replace />;
  }

  const isRugbyApiMatchStats = useMemo(
    () =>
      state.selectedSport === "Rugby" &&
      state.selectedSource === "API" &&
      statsType === "Match Stats",
    [state.selectedSport, state.selectedSource, statsType]
  );

  useEffect(() => {
    if (!isRugbyApiMatchStats || !selectedDate) {
      return;
    }

    let mounted = true;

    async function loadMatches() {
      setLoadingMatches(true);
      setMatchError("");
      try {
        const response = await fetchRugbyMatchesByDate(
          selectedDate,
          state.selectedCompetitionId,
          state.selectedSeasonId
        );
        if (mounted) {
          setMatches(response);
        }
      } catch (error) {
        if (mounted) {
          setMatches([]);
          setMatchError(error.message || "Failed to load matches.");
        }
      } finally {
        if (mounted) {
          setLoadingMatches(false);
        }
      }
    }

    loadMatches();

    return () => {
      mounted = false;
    };
  }, [isRugbyApiMatchStats, selectedDate, state.selectedCompetitionId, state.selectedSeasonId]);

  useEffect(() => {
    if (!isRugbyApiMatchStats) {
      setSelectedDate("");
      setMatches([]);
      setMatchError("");
    }
  }, [isRugbyApiMatchStats]);

  const canContinue = Boolean(statsType && query.trim());

  return (
    <section className="panel">
      <h2>4. Select Stats Scope</h2>
      <p className="subtitle">
        Tournament: {state.selectedTournament}
        {state.selectedSeasonName ? ` | Season: ${state.selectedSeasonName}` : ""}
      </p>

      <div className="source-list">
        {statsOptions.map((option) => (
          <button
            type="button"
            key={option}
            className={`source-button ${statsType === option ? "selected" : ""}`}
            onClick={() => setStatsType(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {isRugbyApiMatchStats ? (
        <>
          <label className="subtitle" htmlFor="match-date-input">
            Match Date
          </label>
          <input
            id="match-date-input"
            className="search-input"
            type="date"
            value={selectedDate}
            onChange={(event) => {
              setSelectedDate(event.target.value);
              setQuery("");
            }}
          />

          {loadingMatches ? <p className="loading">Loading matches...</p> : null}
          {matchError ? <p className="error">{matchError}</p> : null}

          {selectedDate && !loadingMatches && !matchError ? (
            <div className="list-wrap">
              {matches.length ? (
                matches.map((match) => (
                  <button
                    type="button"
                    key={match.id}
                    className={`list-item ${query === match.label ? "selected" : ""}`}
                    onClick={() => {
                      setQuery(match.label);
                      setSelectedMatchId(match.id);
                      setStatsSelection(statsType, match.label);
                      navigate(`/stats/${match.id}`);
                    }}
                  >
                    <span className="match-listing">
                      <span className="team-chip" aria-label="Home team">
                        <span className="team-chip-badge">H</span>
                        <span>{match.homeTeam}</span>
                      </span>
                      <span className="match-listing-divider">vs</span>
                      <span className="team-chip" aria-label="Away team">
                        <span className="team-chip-badge team-chip-badge-away">A</span>
                        <span>{match.awayTeam}</span>
                      </span>
                    </span>
                    <small className="item-meta">{match.venueName}</small>
                  </button>
                ))
              ) : (
                <p className="empty-state">No matches found for this date.</p>
              )}
            </div>
          ) : null}
        </>
      ) : (
        <input
          className="search-input"
          type="text"
          placeholder={getPrompt(statsType)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!statsType}
        />
      )}

      <button
        type="button"
        className="action-button"
        disabled={!canContinue}
        onClick={() => {
          setStatsSelection(statsType, query);
          navigate("/graphics");
        }}
      >
        Load Available Graphics
      </button>
    </section>
  );
}
