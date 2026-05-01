import { useEffect, useMemo, useState } from "react";
import { useAppFlow } from "../context/AppFlowContext";
import PageCreationOverlay from "./PageCreationOverlay";
import { getRugbyVizDataTypes } from "../services/graphicsService";

function notifyRequestError(message, fallbackMessage) {
  const resolvedMessage = message || fallbackMessage;
  window.alert(resolvedMessage);
  return resolvedMessage;
}

export default function MatchDataTypePanel() {
  const { state, setDataType, addCreatedPage } = useAppFlow();
  const [dataTypes, setDataTypes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadDataTypes() {
      setLoading(true);
      setError("");

      try {
        const payload = await getRugbyVizDataTypes();
        if (!mounted) {
          return;
        }

        setDataTypes((Array.isArray(payload.items) ? payload.items : []).filter((item) => item?.dataType));
      } catch (loadError) {
        if (mounted) {
          setDataTypes([]);
          const message = notifyRequestError(loadError.message, "Failed to load data types.");
          setError(message);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDataTypes();

    return () => {
      mounted = false;
    };
  }, []);

  const selectedDataTypeName = state.selectedDataType?.dataType || "";
  const selectedDataTypeKey = state.selectedDataType
    ? `${state.selectedDataType.dataType}::${state.selectedDataType.type || ""}`
    : "";
  const groupedDataTypes = useMemo(() => {
    const groups = new Map();

    dataTypes.forEach((item) => {
      if (!groups.has(item.dataType)) {
        groups.set(item.dataType, []);
      }

      groups.get(item.dataType).push(item);
    });

    return Array.from(groups.entries()).map(([dataType, items]) => ({
      dataType,
      items,
    }));
  }, [dataTypes]);
  const canCreatePage = Boolean(state.selectedDataType && state.activeProfile);
  const subtitle = useMemo(() => {
    if (state.selectedTournament && state.statsSearchValue) {
      return `${state.selectedTournament} | ${state.statsSearchValue}`;
    }

    return state.selectedTournament || "Select a data type to continue.";
  }, [state.selectedTournament, state.statsSearchValue]);
  const onSelectDataTypeGroup = (group) => {
    if (!group?.items?.length) {
      setDataType(null);
      return;
    }

    const existingSelection =
      group.items.find(
        (item) =>
          item.dataType === state.selectedDataType?.dataType &&
          (item.type || "") === (state.selectedDataType?.type || "")
      ) || null;

    setDataType(existingSelection || group.items[0]);
  };

  const onSelectVariant = (group, selectedKey) => {
    const nextItem =
      group.items.find((item) => `${item.dataType}::${item.type || ""}` === selectedKey) || null;

    setDataType(nextItem);
  };

  const onCreatePage = () => {
    if (!state.activeProfile || !state.selectedDataType) {
      return;
    }

    setIsOverlayOpen(true);
  };

  const onConfirmPageCreation = async ({
    createdPage,
    createdPages,
    selectedCoverage,
    selectedData,
    selectedFieldPaths,
    selectedRound,
    selectedStat,
    template,
    fieldValues,
  }) => {
    const titleSegments = [state.selectedDataType.dataType];

    if (state.selectedDataType.type) {
      titleSegments.push(state.selectedDataType.type);
    }

    if (selectedCoverage) {
      titleSegments.push(selectedCoverage);
    }

    if (selectedRound) {
      titleSegments.push(`Round ${selectedRound}`);
    }

    if (selectedStat) {
      titleSegments.push(selectedStat);
    }

    const pageResults = Array.isArray(createdPages) && createdPages.length
      ? createdPages
      : [{ createdPage, fieldValues, selectedData }];

    pageResults.forEach((pageResult, index) => {
      if (!pageResult?.createdPage) {
        return;
      }

      addCreatedPage({
        id: `${Date.now()}-${state.selectedDataType.dataType}-${index + 1}`,
        title:
          pageResult.createdPage.name ||
          pageResult.pageTitle ||
          `${titleSegments.join(" | ")} | ${template.templateName || template.name}`,
        profileName: state.activeProfile.name,
        createdAt: new Date().toISOString(),
        pageUri: pageResult.createdPage.uri,
        selectedCoverage,
        selectedData: pageResult.selectedData || selectedData,
        selectedFieldPaths,
        selectedRound,
        selectedStat,
        templateName: template.templateName || template.name,
        templateMapping: template.mapping,
        fieldValues: pageResult.fieldValues || fieldValues,
      });
    });
  };

  return (
    <aside className="match-data-type-panel">
      <div className="match-data-type-panel__header">
        <h2>Data Types</h2>
        <p>{subtitle}</p>
      </div>

      <button
        type="button"
        className="match-data-type-panel__create"
        disabled={!canCreatePage}
        onClick={onCreatePage}
      >
        Create a Page
      </button>

      {!state.activeProfile ? (
        <p className="match-data-type-panel__message match-data-type-panel__message--warning">
          Create or activate a profile before creating a page.
        </p>
      ) : null}

      {loading ? <p className="match-data-type-panel__message">Loading data types...</p> : null}
      {error ? <p className="match-data-type-panel__message match-data-type-panel__message--error">{error}</p> : null}

      {!loading && !error ? (
        <div className="match-data-type-panel__list">
          {groupedDataTypes.length ? (
            groupedDataTypes.map((group) => {
              const isSelectedGroup = selectedDataTypeName === group.dataType;
              const hasMultipleTypes = group.items.length > 1;

              return (
                <div key={group.dataType} className="match-data-type-panel__group">
                  <button
                    type="button"
                    className={`match-data-type-panel__item ${isSelectedGroup ? "selected" : ""}`}
                    onClick={() => onSelectDataTypeGroup(group)}
                  >
                    <span>{group.dataType}</span>
                    {hasMultipleTypes ? (
                      <span className="match-data-type-panel__item-meta">{group.items.length} types</span>
                    ) : null}
                  </button>

                  {isSelectedGroup && hasMultipleTypes ? (
                    <label className="match-data-type-panel__variant-picker">
                      <span>Select type</span>
                      <select
                        value={selectedDataTypeKey}
                        onChange={(event) => onSelectVariant(group, event.target.value)}
                      >
                        {group.items.map((item, index) => {
                          const optionKey = `${item.dataType}::${item.type || ""}`;
                          const optionLabel = item.type || `Type ${index + 1}`;

                          return (
                            <option key={optionKey} value={optionKey}>
                              {optionLabel}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="match-data-type-panel__message">No data types available.</p>
          )}
        </div>
      ) : null}

      {isOverlayOpen ? (
        <PageCreationOverlay
          selectedDataType={state.selectedDataType}
          onClose={() => setIsOverlayOpen(false)}
          onConfirm={onConfirmPageCreation}
        />
      ) : null}
    </aside>
  );
}