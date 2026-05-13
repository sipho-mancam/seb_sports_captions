import { BASE_URL, apiClient, throwRequestError } from "./apiClient";

function pickFirstArray(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) {
      return payload[key];
    }
  }

  return [];
}

function getLinkHref(entry, preferredRels = ["self", "alternate", "edit", "related"]) {
  const links = Array.isArray(entry?.links) ? entry.links : [];

  for (const rel of preferredRels) {
    const matchingLink = links.find((link) => link?.href && link?.rel === rel);
    if (matchingLink?.href) {
      return matchingLink.href;
    }
  }

  return links.find((link) => link?.href)?.href || null;
}

function getEntryUri(entry) {
  return (
    entry?.uri ||
    entry?.url ||
    entry?.href ||
    entry?.bucketUrl ||
    entry?.entryUrl ||
    entry?.link ||
    getLinkHref(entry) ||
    null
  );
}

function getEntryLabel(entry, fallback = "") {
  return entry?.title || entry?.name || entry?.displayName || fallback;
}

function normalizeShow(showEntry, index) {
  return {
    id: showEntry?.id || getEntryUri(showEntry) || `show-${index + 1}`,
    name: getEntryLabel(showEntry, `Show ${index + 1}`),
    uri: getEntryUri(showEntry),
    raw: showEntry,
  };
}

function getTemplateBucketUrl(payload) {
  if (typeof payload?.buckets?.templates === "string" && payload.buckets.templates) {
    return payload.buckets.templates;
  }

  const buckets = pickFirstArray(payload, ["buckets", "bucketEntries", "entries", "items", "data"]);
  const templateBucket = buckets.find((bucketEntry) => {
    const label = getEntryLabel(bucketEntry).toLowerCase();
    return label.includes("template");
  });

  return getEntryUri(templateBucket);
}

function normalizeTemplate(template, index, showName = "", bucketName = "", elementCollectionUri = "") {
  const templateTitle = template?.title || template?.template?.title || template?.raw?.title;
  const normalizedRaw =
    elementCollectionUri && template && typeof template === "object"
      ? { ...template, elementCollectionUri }
      : template;

  return {
    id: template.id || template.name || template.templateName || getEntryUri(template) || `template-${index + 1}`,
    name:
      templateTitle ||
      template.name ||
      template.templateName ||
      template.displayName ||
      `Template ${index + 1}`,
    uri: getEntryUri(template),
    showName,
    bucketName,
    elementCollectionUri,
    raw: normalizedRaw,
  };
}

function getAtomLinkHrefFromXml(xml, rel) {
  if (typeof xml !== "string" || !xml.trim() || !rel) {
    return "";
  }

  const escapedRel = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const directMatch = xml.match(new RegExp(`<link[^>]*href="([^"]+)"[^>]*rel="${escapedRel}"[^>]*\/?>`, "i"));
  if (directMatch?.[1]) {
    return directMatch[1];
  }

  const reverseMatch = xml.match(new RegExp(`<link[^>]*rel="${escapedRel}"[^>]*href="([^"]+)"[^>]*\/?>`, "i"));
  return reverseMatch?.[1] || "";
}

function toElementCollectionUri(uri) {
  if (typeof uri !== "string" || !uri.trim()) {
    return "";
  }

  try {
    const parsedUrl = new URL(uri);

    if (parsedUrl.pathname.includes("/element_collection/")) {
      return parsedUrl.toString();
    }

    if (!parsedUrl.pathname.includes("/template_collection/")) {
      return "";
    }

    parsedUrl.pathname = parsedUrl.pathname.replace("/template_collection/", "/element_collection/");
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/mastertemplates\/[^/]+$/i, "/elements");
    return parsedUrl.toString();
  } catch {
    return "";
  }
}

function getElementCollectionUri(payload, fallbackTemplate) {
  const candidateUris = [
    payload?.elementCollectionUri,
    payload?.element_collection_uri,
    payload?.collectionUri,
    getAtomLinkHrefFromXml(payload?.templateXml, "self"),
    getAtomLinkHrefFromXml(payload?.template_xml, "self"),
    fallbackTemplate?.elementCollectionUri,
    fallbackTemplate?.uri,
    fallbackTemplate?.raw?.uri,
    fallbackTemplate?.raw?.href,
  ].filter(Boolean);

  for (const candidateUri of candidateUris) {
    if (candidateUri.includes("/element_collection/")) {
      return candidateUri;
    }

    const derivedUri = toElementCollectionUri(candidateUri);
    if (derivedUri) {
      return derivedUri;
    }
  }

  return "";
}

function getPreparedTemplateMapping(payload) {
  const mappingCandidates = [payload?.mapping, payload?.template, payload?.fieldMapping, payload?.fields];

  return mappingCandidates.find((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate)) || {};
}

function normalizePreparedTemplate(payload, fallbackTemplate) {
  const templateTitle =
    payload?.title ||
    payload?.template?.title ||
    payload?.raw?.title ||
    fallbackTemplate?.title ||
    fallbackTemplate?.raw?.title;
  const elementCollectionUri = getElementCollectionUri(payload, fallbackTemplate);
  const modelUri =
    payload?.modelUri ||
    payload?.model_uri ||
    payload?.pageModelUri ||
    payload?.vdfUrl ||
    payload?.vdf_url ||
    getAtomLinkHrefFromXml(payload?.templateXml, "alternate") ||
    getAtomLinkHrefFromXml(payload?.template_xml, "alternate") ||
    "";

  return {
    templateName:
      templateTitle ||
      payload?.templateName ||
      payload?.name ||
      payload?.template?.name ||
      fallbackTemplate?.templateName ||
      fallbackTemplate?.name ||
      "Template",
    elementCollectionUri,
    modelUri,
    mapping: getPreparedTemplateMapping(payload),
    raw: payload,
  };
}

function buildGraphics(statsType, filterValue) {
  const cleanFilter = filterValue?.trim() || "General";
  return [
    {
      id: "g-1",
      name: `${statsType} Score Summary`,
      type: "Full Screen",
      description: `Primary score board for ${cleanFilter}`,
    },
    {
      id: "g-2",
      name: `${statsType} Team Comparison`,
      type: "Lower Third",
      description: `Head-to-head comparison focused on ${cleanFilter}`,
    },
    {
      id: "g-3",
      name: `${statsType} Key Performer`,
      type: "Player Card",
      description: `Top performer visualization for ${cleanFilter}`,
    },
  ];
}

export class GraphicsTemplateWorker {
  constructor(client = apiClient) {
    this.client = client;
  }

  async getGraphicShows() {
    const showsPayload = await this.client.getJson("/api/mse/shows", "Failed to load MSE shows");
    const shows = pickFirstArray(showsPayload, ["shows", "entries", "showEntries", "items", "data"]);

    return shows.map((showEntry, index) => normalizeShow(showEntry, index));
  }

  async getGraphicTemplates(showEntry) {
    if (!showEntry) {
      return {
        elementCollectionUri: "",
        templates: [],
      };
    }

    const bucketPayload = await this.client.postJson(
      "/api/mse/shows/buckets",
      { showEntry },
      "Failed to discover buckets"
    );
    const templateBucketUrl = getTemplateBucketUrl(bucketPayload);
    const elementCollectionUri = bucketPayload?.buckets?.elements || "";

    if (!templateBucketUrl) {
      return {
        elementCollectionUri,
        templates: [],
      };
    }

    const bucketEntriesPayload = await this.client.getJson(
      `/api/mse/buckets/entries?${new URLSearchParams({ bucketUrl: templateBucketUrl }).toString()}`,
      "Failed to load bucket entries"
    );
    const entries = pickFirstArray(bucketEntriesPayload, ["entries", "bucketEntries", "items", "data"]);

    return {
      elementCollectionUri,
      templates: entries.map((entry, index) =>
        normalizeTemplate(entry, index, getEntryLabel(showEntry), "templates", elementCollectionUri)
      ),
    };
  }

  async getGraphicManifest(manifestId) {
    if (!manifestId) {
      throw new Error("Manifest ID is required.");
    }

    return this.client.getJson(
      `/api/v1/sportscaption/graphics/manifests/${encodeURIComponent(manifestId)}`,
      "Failed to load graphic manifest"
    );
  }

  async prepareGraphicTemplate(templateEntry) {
    const payload = await this.client.postJson(
      "/api/mse/templates/prepare",
      { templateEntry },
      "Failed to prepare template"
    );

    return normalizePreparedTemplate(payload, templateEntry);
  }

  async createGraphicPage({ preparedTemplate, fieldValues }) {
    const payload = await this.client.postJson(
      "/api/mse/pages",
      {
        elementCollectionUri: preparedTemplate.elementCollectionUri,
        modelUri: preparedTemplate.modelUri,
        fieldValues,
        templateName: preparedTemplate.templateName,
      },
      "Failed to create page"
    );

    return {
      name: payload?.pageName || payload?.name || payload?.templateName || preparedTemplate.templateName,
      uri: payload?.pageUri || payload?.uri || payload?.url || "",
      raw: payload,
    };
  }
}

export class GraphicsDeliveryWorker {
  async fetchGraphicsData({ sport, source, tournament, statsType, statsQuery }) {
    await new Promise((resolve) => setTimeout(resolve, 650));

    return {
      context: { sport, source, tournament, statsType, statsQuery },
      graphics: buildGraphics(statsType, statsQuery),
    };
  }

  async sendToMseServer(payload, mseUrlOverride) {
    const mseEndpoint = mseUrlOverride || import.meta.env.VITE_MSE_SERVER_URL || `${BASE_URL}/mse/graphics`;

    try {
      const response = await fetch(mseEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        await throwRequestError(response, `MSE server returned ${response.status}`);
      }

      const data = await response.json().catch(() => ({}));
      return { ok: true, endpoint: mseEndpoint, data };
    } catch (error) {
      return {
        ok: false,
        endpoint: mseEndpoint,
        error: error.message,
        fallback: "Connection to MSE server failed. Start your MSE endpoint or set VITE_MSE_SERVER_URL.",
      };
    }
  }
}

export const graphicsTemplateWorker = new GraphicsTemplateWorker();
export const graphicsDeliveryWorker = new GraphicsDeliveryWorker();

export function getGraphicShows() {
  return graphicsTemplateWorker.getGraphicShows();
}

export function getGraphicTemplates(showEntry) {
  return graphicsTemplateWorker.getGraphicTemplates(showEntry);
}

export function getGraphicManifest(manifestId) {
  return graphicsTemplateWorker.getGraphicManifest(manifestId);
}

export function prepareGraphicTemplate(templateEntry) {
  return graphicsTemplateWorker.prepareGraphicTemplate(templateEntry);
}

export function createGraphicPage(payload) {
  return graphicsTemplateWorker.createGraphicPage(payload);
}

export function fetchGraphicsData(payload) {
  return graphicsDeliveryWorker.fetchGraphicsData(payload);
}

export function sendToMseServer(payload, mseUrlOverride) {
  return graphicsDeliveryWorker.sendToMseServer(payload, mseUrlOverride);
}