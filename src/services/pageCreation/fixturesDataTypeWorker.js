export class FixturesDataTypeWorker {
  isDataType(selectedDataType) {
    const combinedLabel = `${selectedDataType?.dataType || ""} ${selectedDataType?.type || ""}`.toLowerCase();
    return combinedLabel.includes("fixture");
  }

  buildSelectionPayload(selectedData, selectedFixtureDayKeys, selectedFixtureIds) {
    if (!selectedData) {
      return null;
    }

    const selectedDayKeySet = new Set(selectedFixtureDayKeys || []);
    const selectedFixtureIdSet = new Set(selectedFixtureIds || []);

    const fixtureDays = (selectedData.fixtureDays || [])
      .filter((dayGroup) => selectedDayKeySet.has(dayGroup.dayKey))
      .map((dayGroup) => ({
        ...dayGroup,
        fixtures: dayGroup.fixtures.filter((fixture) => selectedFixtureIdSet.has(fixture.id)),
      }))
      .filter((dayGroup) => dayGroup.fixtures.length);

    if (!fixtureDays.length) {
      return null;
    }

    return {
      competition: selectedData.competition ?? null,
      season: selectedData.season ?? null,
      userTimeZone: selectedData.userTimeZone ?? null,
      fixtureDays,
      fixtures: fixtureDays.flatMap((dayGroup) => dayGroup.fixtures),
    };
  }
}
