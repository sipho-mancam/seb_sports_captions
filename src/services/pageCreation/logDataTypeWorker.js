export class LogDataTypeWorker {
  constructor(utils) {
    this.utils = utils;
    this.columnHeaderLabels = {
      bonus: "BP",
      difference: "Diff",
      drawn: "D",
      lost: "L",
      played: "PLD",
      points: "PTS",
      won: "W",
    };
  }

  isManifest(manifest) {
    return Boolean(this.utils.isRecord(manifest) && this.utils.isRecord(manifest.standings_list));
  }

  getValueByAliases(source, aliases = []) {
    for (const alias of aliases) {
      const value = this.utils.getNestedValue(source, alias);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }

    return "";
  }

  getRows(group) {
    const rowCandidates = [
      group?.standings,
      group?.standingsList,
      group?.rows,
      group?.items,
      group?.entries,
      group?.teams,
      group?.table?.rows,
      group?.pool?.standings,
    ];

    return rowCandidates.find((candidate) => Array.isArray(candidate) && candidate.some((entry) => this.utils.isRecord(entry))) || [];
  }

  isFlatRow(entry) {
    return Boolean(
      this.utils.isRecord(entry) &&
        (this.utils.isRecord(entry.team) || entry.team_name || entry.teamName) &&
        (entry.position !== undefined || entry.points !== undefined || entry.played !== undefined)
    );
  }

  normalizeValue(value) {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  getTeamId(entry) {
    return this.normalizeValue(this.getValueByAliases(entry, ["team.id", "teamId", "team_id", "id"]));
  }

  getPoolName(group, index) {
    return this.normalizeValue(
      this.getValueByAliases(group, ["pool_name", "poolName", "name", "title", "label", "groupName", "pool.name"]) ||
        `Pool ${index + 1}`
    );
  }

  getPools(selectedData) {
    const groups = Array.isArray(selectedData?.groups) ? selectedData.groups : [];

    if (!groups.length) {
      return [];
    }

    if (groups.every((group) => this.isFlatRow(group))) {
      const poolMap = new Map();

      groups.forEach((entry, index) => {
        const poolName = this.getPoolName(entry, index);

        if (!poolMap.has(poolName)) {
          poolMap.set(poolName, {
            poolName,
            source: entry,
            rows: [],
          });
        }

        const pool = poolMap.get(poolName);
        const teamId = this.getTeamId(entry);

        if (!teamId || !pool.rows.some((row) => this.getTeamId(row) === teamId)) {
          pool.rows.push(entry);
        }
      });

      return Array.from(poolMap.values()).map((pool) => ({
        ...pool,
        rows: pool.rows
          .slice()
          .sort(
            (left, right) =>
              Number(this.getValueByAliases(left, ["position", "rank", "pos"]) || Number.MAX_SAFE_INTEGER) -
              Number(this.getValueByAliases(right, ["position", "rank", "pos"]) || Number.MAX_SAFE_INTEGER)
          ),
      }));
    }

    return groups.map((group, index) => ({
      poolName: this.getPoolName(group, index),
      rows: this.getRows(group),
      source: group,
    }));
  }

  getPoolNumber(group, row, index) {
    const poolValue =
      this.getValueByAliases(row, ["pool_number", "poolNumber", "pool.number"]) ||
      this.getValueByAliases(group, ["pool_number", "poolNumber", "number", "pool.number", "pool.code"]);

    if (poolValue) {
      return this.normalizeValue(poolValue);
    }

    const poolName = this.getPoolName(group, index);
    const suffix = poolName.match(/([A-Z0-9]+)$/i)?.[1];
    return suffix || poolName;
  }

  getManifestSectionItemKeys(section) {
    if (!this.utils.isRecord(section)) {
      return [];
    }

    if (Array.isArray(section.list_item)) {
      return section.list_item;
    }

    if (Array.isArray(section.item)) {
      return section.item;
    }

    return [];
  }

  getItemValue(itemKey, row) {
    if (typeof itemKey === "string" && itemKey.startsWith("#img:")) {
      const teamImageName = this.getValueByAliases(row, ["team.name", "team_name", "teamName", "name"]);
      return this.utils.buildImageManifestPayload(itemKey, {
        teamName: this.normalizeValue(teamImageName),
      });
    }

    return row[itemKey] ?? "";
  }

  buildManifestSectionData(section, preferredValue, fallbackAliases = [], source = null) {
    const itemKeys = this.getManifestSectionItemKeys(section);

    return {
      data: itemKeys.reduce((result, itemKey, index) => {
        if (source) {
          result[itemKey] = this.normalizeValue(this.getValueByAliases(source, [itemKey, ...fallbackAliases]));
          return result;
        }

        result[itemKey] = index === 0 ? this.normalizeValue(preferredValue) : "";
        return result;
      }, {}),
      item: itemKeys,
    };
  }

  buildColumnHeaders(manifest) {
    const headerKeys = this.getManifestSectionItemKeys(manifest?.column_headers);

    return {
      data: headerKeys.reduce((result, itemKey) => {
        result[itemKey] = this.columnHeaderLabels[itemKey] || this.utils.humanizeLabel(itemKey);
        return result;
      }, {}),
      item: headerKeys,
    };
  }

  getTitleValue(selectedData, options = {}) {
    const roundValue = options.selectedRound || selectedData?.competition?.round;

    if (options.requiresRoundSelection && roundValue !== null && roundValue !== undefined && roundValue !== "") {
      return `Round ${roundValue}`;
    }

    return "Standing";
  }

  buildPoolPayloads(selectedData, selectedDataType, manifest, options = {}) {
    const pools = this.getPools(selectedData);
    const standingFields = Array.isArray(manifest?.standings_list?.fields) ? manifest.standings_list.fields : [];
    const standingKeys = this.getManifestSectionItemKeys(manifest?.standings_list);
    const titleValue = this.getTitleValue(selectedData, options);
    const standingRowLimit = Math.max(standingFields.length || 0, 1);

    return pools
      .flatMap((pool, poolIndex) => {
        const normalizedRows = pool.rows.map((row, rowIndex) => ({
          bonus: this.normalizeValue(this.getValueByAliases(row, ["bonus", "bonusPoints", "bonus_points", "b"])),
          difference: this.normalizeValue(this.getValueByAliases(row, ["difference", "pointsDifference", "pointDifference", "pointsDiff", "diff"])),
          drawn: this.normalizeValue(this.getValueByAliases(row, ["drawn", "draw", "draws", "tied"])),
          lost: this.normalizeValue(this.getValueByAliases(row, ["lost", "losses", "l"])),
          played: this.normalizeValue(this.getValueByAliases(row, ["played", "matchesPlayed", "p"])),
          points: this.normalizeValue(this.getValueByAliases(row, ["points", "pts", "tablePoints"])),
          pool_number: this.getPoolNumber(pool.source, row, poolIndex),
          position: this.normalizeValue(this.getValueByAliases(row, ["position", "rank", "pos"]) || rowIndex + 1),
          team_logo: this.normalizeValue(this.getValueByAliases(row, ["team_logo", "teamLogo", "team.logo", "team.image", "team.badge", "team.crest", "logo", "image"])),
          team_name: this.normalizeValue(this.getValueByAliases(row, ["team_name", "teamName", "team.shortName", "team.name", "name"])),
          won: this.normalizeValue(this.getValueByAliases(row, ["won", "wins", "w"])),
        }));

        const pageCount = Math.ceil(normalizedRows.length / standingRowLimit);

        return Array.from({ length: pageCount }, (_, pageIndex) => {
          const rows = normalizedRows
            .slice(pageIndex * standingRowLimit, (pageIndex + 1) * standingRowLimit)
            .map((row) =>
              standingKeys.reduce((result, itemKey) => {
                result[itemKey] = this.getItemValue(itemKey, row);
                return result;
              }, {})
            );

          if (!rows.length) {
            return null;
          }

          const poolName = pool.poolName;
          const payloadData = {
            standings_list: {
              data: rows,
              list_item: standingKeys,
            },
          };

          if (this.utils.isRecord(manifest?.column_headers)) {
            payloadData.column_headers = this.buildColumnHeaders(manifest);
          }

          if (this.utils.isRecord(manifest?.pool_name)) {
            payloadData.pool_name = this.buildManifestSectionData(manifest?.pool_name, poolName, ["pool_name", "poolName", "name"]);
          }

          if (this.utils.isRecord(manifest?.title)) {
            payloadData.title = this.buildManifestSectionData(manifest?.title, titleValue, ["title", "name"]);
          }

          const basePageTitle = this.utils.isRecord(manifest?.pool_name) ? `${titleValue} | ${poolName}` : titleValue;

          return {
            data: payloadData,
            pageNumber: pageIndex + 1,
            pageTitle: pageCount > 1 ? `${basePageTitle} | Page ${pageIndex + 1}` : basePageTitle,
            poolName,
            previewLabel: pageCount > 1 ? `${poolName} | Page ${pageIndex + 1}` : poolName,
            totalPages: pageCount,
          };
        });
      })
      .filter(Boolean);
  }
}
