function extractValue(source, key, index = 0) {
  if (source === null || source === undefined) {
    return undefined;
  }

  if (typeof key !== "string") {
    return source;
  }

  if (Array.isArray(source)) {
    const item = source[index];
    if (item === undefined) {
      return undefined;
    }
    if (item && typeof item === "object") {
      return item[key] ?? item.value;
    }
    return item;
  }

  if (typeof source === "object") {
    if (key in source) {
      return source[key];
    }

    const dottedValue = key.split(".").reduce((current, segment) => current?.[segment], source);
    if (dottedValue !== undefined) {
      return dottedValue;
    }

    return undefined;
  }

  return source;
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, codePoint) => String.fromCodePoint(Number(codePoint)))
    .replace(/&#x([0-9a-f]+);/gi, (_, codePoint) => String.fromCodePoint(parseInt(codePoint, 16)))
    .replace(/&([a-z][a-z0-9]+);/gi, (match, entityName) => {
      const namedEntities = {
        Aacute: "A",
        aacute: "a",
        Acirc: "A",
        acirc: "a",
        Agrave: "A",
        agrave: "a",
        Aring: "A",
        aring: "a",
        Atilde: "A",
        atilde: "a",
        Auml: "A",
        auml: "a",
        Ccedil: "C",
        ccedil: "c",
        Eacute: "E",
        eacute: "e",
        Ecirc: "E",
        ecirc: "e",
        Egrave: "E",
        egrave: "e",
        Euml: "E",
        euml: "e",
        Iacute: "I",
        iacute: "i",
        Icirc: "I",
        icirc: "i",
        Igrave: "I",
        igrave: "i",
        Iuml: "I",
        iuml: "i",
        Ntilde: "N",
        ntilde: "n",
        Oacute: "O",
        oacute: "o",
        Ocirc: "O",
        ocirc: "o",
        Ograve: "O",
        ograve: "o",
        Oslash: "O",
        oslash: "o",
        Otilde: "O",
        otilde: "o",
        Ouml: "O",
        ouml: "o",
        Uacute: "U",
        uacute: "u",
        Ucirc: "U",
        ucirc: "u",
        Ugrave: "U",
        ugrave: "u",
        Uuml: "U",
        uuml: "u",
        Yacute: "Y",
        yacute: "y",
        yuml: "y",
        szlig: "ss",
      };

      return namedEntities[entityName] ?? match;
    });
}

function normalizeFieldStringValue(value) {
  const decodedValue = decodeHtmlEntities(String(value));
  const normalizedLabelValue = {
    "Post Match": "Full-Time",
    "First Half": "Half-Time",
    "Second Half": "Full-Time",
  }[decodedValue.trim()];

  if (normalizedLabelValue) {
    return normalizedLabelValue;
  }

  if (decodedValue.trim() === "-") {
    return "-";
  }

  return decodedValue
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function setFieldValue(fieldValues, fieldId, value) {
  if (fieldId === null || fieldId === undefined || fieldId === "" || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    return;
  }

  fieldValues[String(fieldId)] = normalizeFieldStringValue(value);
}

function getManifestSectionData(sourceValue) {
  if (sourceValue && typeof sourceValue === "object" && "data" in sourceValue) {
    return sourceValue.data;
  }

  return sourceValue;
}

function getManifestSectionItemKeys(config) {
  if (Array.isArray(config?.list_item)) {
    return config.list_item;
  }

  if (Array.isArray(config?.item)) {
    return config.item;
  }

  if (typeof config?.item === "string" && config.item.trim()) {
    return [config.item.trim()];
  }

  return null;
}

function getManifestSourceKeys(sourceKey) {
  if (typeof sourceKey !== "string") {
    return [];
  }

  const normalizedKey = sourceKey.trim();
  if (!normalizedKey) {
    return [];
  }

  if (normalizedKey.startsWith("#img:")) {
    const imageKey = normalizedKey.slice(5).trim();
    return [normalizedKey, imageKey, imageKey.replace(/:/g, "_"), imageKey.replace(/:/g, ".")].filter(Boolean);
  }

  return [normalizedKey];
}

function getManifestObjectValue(sourceItem, sourceKey) {
  const candidateKeys = getManifestSourceKeys(sourceKey);

  for (const candidateKey of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(sourceItem, candidateKey)) {
      return sourceItem[candidateKey];
    }
  }

  return sourceItem.value ?? "";
}

function getSingleFieldIds(config) {
  if (!Array.isArray(config?.fields)) {
    return null;
  }

  if (config.fields.length === 1 && Array.isArray(config.fields[0])) {
    return config.fields[0];
  }

  return config.fields;
}

export class FieldValueBuilderWorker {
  build(mapping, selectedData) {
    const fieldValues = {};

    Object.entries(mapping || {}).forEach(([key, config]) => {
      if (typeof config === "number" || typeof config === "string") {
        setFieldValue(fieldValues, config, extractValue(selectedData, key));
        return;
      }

      if (!config || typeof config !== "object") {
        return;
      }

      if (config.field && Array.isArray(config.scores)) {
        const delimiter = config.delimiter || " ";
        const combinedValue = config.scores
          .map((scoreKey, index) => extractValue(selectedData, scoreKey, index))
          .filter((value) => value !== "" && value !== undefined && value !== null)
          .join(delimiter);
        setFieldValue(fieldValues, config.field, combinedValue);
        return;
      }

      const listFields = Array.isArray(config.list)
        ? config.list
        : Array.isArray(config.fields) && Array.isArray(config.fields[0])
          ? config.fields
          : null;
      const listItemKeys = getManifestSectionItemKeys(config);

      if (Array.isArray(listFields) && Array.isArray(listItemKeys)) {
        const sourceList = getManifestSectionData(extractValue(selectedData, key));
        const rows = Array.isArray(sourceList) ? sourceList : [];

        listFields.forEach((fieldRow, rowIndex) => {
          if (!Array.isArray(fieldRow)) {
            return;
          }

          fieldRow.forEach((fieldId, columnIndex) => {
            const sourceItem = rows[rowIndex];
            const sourceKey = listItemKeys[columnIndex];
            let value = "";

            if (Array.isArray(sourceItem)) {
              value = sourceItem[columnIndex] ?? "";
            } else if (sourceItem && typeof sourceItem === "object") {
              value = getManifestObjectValue(sourceItem, sourceKey);
            } else if (sourceItem !== undefined) {
              value = sourceItem;
            }

            setFieldValue(fieldValues, fieldId, value);
          });
        });

        return;
      }

      const singleFields = getSingleFieldIds(config);
      const singleItemKeys = getManifestSectionItemKeys(config);

      if (Array.isArray(singleFields) && Array.isArray(singleItemKeys)) {
        const sourceItem = getManifestSectionData(extractValue(selectedData, key));

        singleFields.forEach((fieldId, index) => {
          const sourceKey = singleItemKeys[index];
          let value = "";

          if (Array.isArray(sourceItem)) {
            value = sourceItem[index] ?? "";
          } else if (sourceItem && typeof sourceItem === "object") {
            value = getManifestObjectValue(sourceItem, sourceKey);
          } else if (sourceItem !== undefined) {
            value = sourceItem;
          }

          setFieldValue(fieldValues, fieldId, value);
        });
      }
    });

    return fieldValues;
  }
}

export const fieldValueBuilderWorker = new FieldValueBuilderWorker();

export function buildFieldValuesFromTemplate(mapping, selectedData) {
  return fieldValueBuilderWorker.build(mapping, selectedData);
}