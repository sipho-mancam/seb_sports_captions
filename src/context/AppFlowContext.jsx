import { createContext, useContext, useMemo, useState } from "react";

const AppFlowContext = createContext(null);

const initialState = {
  selectedSport: null,
  selectedSource: null,
  selectedTournament: null,
  selectedCompetitionId: null,
  selectedSeasonId: null,
  selectedSeasonName: null,
  selectedStatsType: null,
  statsSearchValue: "",
  loadedGraphics: [],
  mseResponse: null,
};

export function AppFlowProvider({ children }) {
  const [state, setState] = useState(initialState);

  const api = useMemo(
    () => ({
      state,
      setSport: (sport) =>
        setState((prev) => ({
          ...prev,
          selectedSport: sport,
          selectedSource: null,
          selectedTournament: null,
          selectedCompetitionId: null,
          selectedSeasonId: null,
          selectedSeasonName: null,
          selectedStatsType: null,
          statsSearchValue: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setSource: (source) =>
        setState((prev) => ({
          ...prev,
          selectedSource: source,
          selectedTournament: null,
          selectedCompetitionId: null,
          selectedSeasonId: null,
          selectedSeasonName: null,
          selectedStatsType: null,
          statsSearchValue: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setTournament: ({ tournament, competitionId, seasonId, seasonName }) =>
        setState((prev) => ({
          ...prev,
          selectedTournament: tournament,
          selectedCompetitionId: competitionId,
          selectedSeasonId: seasonId,
          selectedSeasonName: seasonName,
          selectedStatsType: null,
          statsSearchValue: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setStatsSelection: (statsType, searchValue) =>
        setState((prev) => ({
          ...prev,
          selectedStatsType: statsType,
          statsSearchValue: searchValue,
          loadedGraphics: [],
          mseResponse: null,
        })),
      setLoadedGraphics: (graphics) =>
        setState((prev) => ({ ...prev, loadedGraphics: graphics })),
      setMseResponse: (response) =>
        setState((prev) => ({ ...prev, mseResponse: response })),
      resetFlow: () => setState(initialState),
    }),
    [state]
  );

  return <AppFlowContext.Provider value={api}>{children}</AppFlowContext.Provider>;
}

export function useAppFlow() {
  const value = useContext(AppFlowContext);
  if (!value) {
    throw new Error("useAppFlow must be used inside AppFlowProvider");
  }
  return value;
}
