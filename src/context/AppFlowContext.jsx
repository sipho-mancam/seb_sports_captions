import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AppFlowContext = createContext(null);
const STORAGE_KEY = "sports-captions-app-flow";

const initialState = {
  selectedSport: null,
  selectedSource: null,
  selectedDataType: null,
  activeProfile: null,
  selectedTournament: null,
  selectedCompetitionId: null,
  selectedSeasonId: null,
  selectedSeasonName: null,
  selectedMatchId: null,
  selectedStatsType: null,
  statsSearchValue: "",
  selectedElementCollectionUri: "",
  createdPages: [],
  loadedGraphics: [],
  mseResponse: null,
};

function getInitialState() {
  if (typeof window === "undefined") {
    return initialState;
  }

  try {
    const storedValue = window.localStorage.getItem(STORAGE_KEY);
    if (!storedValue) {
      return initialState;
    }

    const parsedValue = JSON.parse(storedValue);
    return {
      ...initialState,
      ...(parsedValue && typeof parsedValue === "object" ? parsedValue : {}),
      mseResponse: null,
    };
  } catch {
    return initialState;
  }
}

export function AppFlowProvider({ children }) {
  const [state, setState] = useState(getInitialState);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const setActiveProfile = useCallback(
    (profile) =>
      setState((prev) => ({
        ...prev,
        activeProfile: profile,
      })),
    []
  );

  const api = useMemo(
    () => ({
      state,
      setSport: (sport) =>
        setState((prev) => ({
          ...prev,
          selectedSport: sport,
          selectedSource: null,
          selectedDataType: null,
          selectedTournament: null,
          selectedCompetitionId: null,
          selectedSeasonId: null,
          selectedSeasonName: null,
          selectedMatchId: null,
          selectedStatsType: null,
          statsSearchValue: "",
          selectedElementCollectionUri: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setSource: (source) =>
        setState((prev) => ({
          ...prev,
          selectedSource: source,
          selectedDataType: null,
          selectedTournament: null,
          selectedCompetitionId: null,
          selectedSeasonId: null,
          selectedSeasonName: null,
          selectedMatchId: null,
          selectedStatsType: null,
          statsSearchValue: "",
          selectedElementCollectionUri: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setDataType: (dataType) =>
        setState((prev) => ({
          ...prev,
          selectedDataType: dataType,
        })),
      setActiveProfile,
      addCreatedPage: (page) =>
        setState((prev) => ({
          ...prev,
          createdPages: [page, ...prev.createdPages],
        })),

      setTournament: ({ tournament, competitionId, seasonId, seasonName }) =>
        setState((prev) => ({
          ...prev,
          selectedTournament: tournament,
          selectedCompetitionId: competitionId,
          selectedSeasonId: seasonId,
          selectedSeasonName: seasonName,
          selectedMatchId: null,
          selectedStatsType: null,
          statsSearchValue: "",
          selectedElementCollectionUri: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setSelectedMatchId: (matchId) =>
        setState((prev) => ({
          ...prev,
          selectedMatchId: matchId,
        })),
      setStatsSelection: (statsType, searchValue) =>
        setState((prev) => ({
          ...prev,
          selectedStatsType: statsType,
          statsSearchValue: searchValue,
          selectedDataType: null,
          selectedMatchId: statsType === "Match Stats" ? prev.selectedMatchId : null,
          selectedElementCollectionUri: "",
          loadedGraphics: [],
          mseResponse: null,
        })),
      setSelectedElementCollectionUri: (selectedElementCollectionUri) =>
        setState((prev) => ({
          ...prev,
          selectedElementCollectionUri: selectedElementCollectionUri || "",
        })),
      setLoadedGraphics: (graphics) =>
        setState((prev) => ({ ...prev, loadedGraphics: graphics })),
      setMseResponse: (response) =>
        setState((prev) => ({ ...prev, mseResponse: response })),
      resetFlow: () => setState(initialState),
    }),
    [setActiveProfile, state]
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
