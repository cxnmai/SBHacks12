import { useEffect, useMemo, useRef, useState } from "react";
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { TbCircleDashedLetterD } from "react-icons/tb";
import { FaRegMoon, FaRegSun } from "react-icons/fa";
import twitchLogo from "./assets/streaming-service-logos/Twitch_Logo.svg";
import youtubeLogo from "./assets/streaming-service-logos/YouTube_Logo.svg";
import "./App.css";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Filler,
  zoomPlugin,
  Tooltip,
  Legend,
);

const parseVideoId = (value) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }
    if (url.searchParams.has("v")) {
      return url.searchParams.get("v") || "";
    }
    const parts = url.pathname.split("/").filter(Boolean);
    const liveIndex = parts.indexOf("live");
    if (liveIndex !== -1 && parts[liveIndex + 1]) {
      return parts[liveIndex + 1];
    }
  } catch (err) {
    return "";
  }
  return "";
};

const parseTwitchChannel = (value) => {
  if (!value) return "";
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9_]+$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (!url.hostname.includes("twitch.tv")) return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (!parts.length) return "";
    const channel = parts[0];
    if (/^[a-zA-Z0-9_]+$/.test(channel)) return channel;
  } catch (err) {
    return "";
  }
  return "";
};

const getCssVar = (name, fallback) => {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
};

function App() {
  const [isEditing, setIsEditing] = useState(true);
  const [draftInput, setDraftInput] = useState("");
  const [draftSource, setDraftSource] = useState("youtube");
  const [draftMode, setDraftMode] = useState("general");
  const [draftKeywords, setDraftKeywords] = useState("");
  const [draftThreshold, setDraftThreshold] = useState("2");
  const [activeStreamId, setActiveStreamId] = useState("");
  const [activeSource, setActiveSource] = useState("youtube");
  const [activeMode, setActiveMode] = useState("general");
  const [activeKeywords, setActiveKeywords] = useState("");
  const [activeThreshold, setActiveThreshold] = useState("2");
  const [status, setStatus] = useState("Idle");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState("");
  const [events, setEvents] = useState([]);
  const [history, setHistory] = useState([]);
  const [videoTitle, setVideoTitle] = useState("Waiting...");
  const [videoChannel, setVideoChannel] = useState("Waiting...");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [rates, setRates] = useState([]);
  const [rateLabels, setRateLabels] = useState([]);
  const [ratePoints, setRatePoints] = useState([]);
  const [streamStartTs, setStreamStartTs] = useState(null);
  const [expandedHistoryIndex, setExpandedHistoryIndex] = useState(null);
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [hoveredSummary, setHoveredSummary] = useState("");
  const [hoveredRuntime, setHoveredRuntime] = useState("");
  const [theme, setTheme] = useState("default");

  const chartRef = useRef(null);
  const canvasRef = useRef(null);
  const historyRef = useRef([]);
  const ratePointsRef = useRef([]);
  const streamStartRef = useRef(null);

  const showStreamerPanels = activeMode === "streamer";
  const showDraftStreamerPanels = draftMode === "streamer";
  const isYouTube = draftSource === "youtube";
  const isActiveYouTube = activeSource === "youtube";

  const summaryItems = useMemo(() => {
    if (!summary) return [];
    return summary
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }, [summary]);

  const parseRuntimeSeconds = (value) => {
    if (!value || typeof value !== "string") return null;
    const parts = value.split(":").map((part) => Number.parseInt(part, 10));
    if (parts.some((part) => Number.isNaN(part))) return null;
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    return null;
  };

  const truncateSummary = (text, limit = 140) => {
    const trimmed = text.trim();
    if (trimmed.length <= limit) return trimmed;
    return `${trimmed.slice(0, limit - 1)}…`;
  };

  const splitIntoLines = (text, maxLength = 60) => {
    const words = text.trim().split(/\s+/);
    const lines = [];
    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }
      if ((current + " " + word).length > maxLength) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`;
      }
    }
    if (current) lines.push(current);
    return lines;
  };

  const getClosestHistorySummary = (index) => {
    const historyItems = historyRef.current || [];
    const points = ratePointsRef.current || [];
    if (!points.length || !points[index]) {
      return { summary: "", runtime: "" };
    }
    const startTs = streamStartRef.current || points[0]?.timestamp;
    if (!startTs) return { summary: "", runtime: "" };
    const elapsed = Math.max(0, Math.floor(points[index].timestamp - startTs));
    let closest = "";
    let closestRuntime = "";
    let closestDelta = Number.POSITIVE_INFINITY;
    for (const entry of historyItems) {
      const runtime = parseRuntimeSeconds(entry.timestamp);
      if (runtime === null) continue;
      const delta = Math.abs(runtime - elapsed);
      if (delta < closestDelta) {
        closestDelta = delta;
        closest = entry.summary || "";
        closestRuntime = entry.timestamp || "";
      }
    }
    return { summary: closest, runtime: closestRuntime };
  };

  const formatElapsed = (timestamp, startTs) => {
    if (!timestamp) return "";
    if (!startTs) {
      return new Date(timestamp * 1000).toLocaleTimeString();
    }
    const delta = Math.max(0, Math.floor(timestamp - startTs));
    const hours = Math.floor(delta / 3600);
    const minutes = Math.floor((delta % 3600) / 60);
    const seconds = delta % 60;
    if (hours) {
      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
    }
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    ratePointsRef.current = ratePoints;
  }, [ratePoints]);

  useEffect(() => {
    streamStartRef.current = streamStartTs;
  }, [streamStartTs]);

  useEffect(() => {
    const handlePointerUp = () => {
      setIsPointerDown(false);
      setExpandedHistoryIndex(null);
    };
    window.addEventListener("mouseup", handlePointerUp);
    window.addEventListener("touchend", handlePointerUp);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("mouseup", handlePointerUp);
      window.removeEventListener("touchend", handlePointerUp);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const handleThemeToggle = () => {
    setTheme((prev) => {
      if (prev === "default") return "dark";
      if (prev === "dark") return "light";
      return "default";
    });
  };

  const themeIcon = useMemo(() => {
    const baseProps = {
      size: 18,
      className: "theme-icon",
      "aria-hidden": true,
    };
    if (theme === "dark") {
      return (
        <FaRegMoon
          {...baseProps}
          style={{ color: "var(--color-accent)", fill: "var(--color-accent)" }}
        />
      );
    }
    if (theme === "light") {
      return (
        <FaRegSun
          {...baseProps}
          style={{ color: "var(--color-accent)", fill: "var(--color-accent)" }}
        />
      );
    }
    return (
      <TbCircleDashedLetterD
        {...baseProps}
        style={{
          color: "var(--color-accent)",
          fill: "none",
          stroke: "currentColor",
        }}
      />
    );
  }, [theme]);

  const applyChartTheme = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const accentStrong = getCssVar(
      "--color-accent-strong",
      "rgba(130, 241, 255, 1)",
    );
    const accentMuted = getCssVar(
      "--color-accent-muted",
      "rgba(130, 241, 255, 0.1)",
    );
    const textStrong = getCssVar(
      "--color-text-strong",
      "rgba(244, 246, 255, 0.9)",
    );
    const tooltipBg = getCssVar(
      "--color-tooltip-bg",
      "rgba(43, 15, 104, 0.95)",
    );
    const tooltipBorder = getCssVar(
      "--color-tooltip-border",
      "rgba(130, 241, 255, 0.5)",
    );
    const gridColor = getCssVar("--color-grid", "rgba(255, 255, 255, 0.1)");

    chart.data.datasets[0].borderColor = accentStrong;
    chart.data.datasets[0].backgroundColor = accentMuted;
    chart.options.plugins.legend.labels.color = textStrong;
    chart.options.plugins.legend.labels.font = {
      family: '"Space Grotesk", "Segoe UI", sans-serif',
      weight: "600",
    };
    chart.options.plugins.tooltip.backgroundColor = tooltipBg;
    chart.options.plugins.tooltip.titleColor = textStrong;
    chart.options.plugins.tooltip.bodyColor = textStrong;
    chart.options.plugins.tooltip.borderColor = tooltipBorder;
    chart.options.scales.x.ticks.color = textStrong;
    chart.options.scales.y.ticks.color = textStrong;
    chart.options.scales.x.grid.color = gridColor;
    chart.options.scales.y.grid.color = gridColor;
    chart.options.scales.y.title.color = textStrong;
    chart.update("none");
  };

  useEffect(() => {
    if (!showStreamerPanels) return () => {};
    if (!canvasRef.current) return () => {};
    if (chartRef.current) return () => {};
    chartRef.current = new Chart(canvasRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Messages per second",
            data: [],
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHitRadius: 12,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
          },
          tooltip: {
            mode: "index",
            intersect: false,
            borderWidth: 1,
          },
          zoom: {
            pan: {
              enabled: true,
              mode: "x",
            },
            zoom: {
              wheel: { enabled: false },
              pinch: { enabled: false },
              drag: { enabled: false },
              mode: "x",
            },
            limits: {
              x: { minRange: 5 },
              y: { min: 0 },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
            grid: {},
          },
          y: {
            beginAtZero: true,
            grace: "15%",
            ticks: {
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
            grid: {},
            title: {
              display: true,
              text: "Messages/sec",
              font: {
                family: '"Space Grotesk", "Segoe UI", sans-serif',
              },
            },
          },
        },
        interaction: {
          mode: "index",
          axis: "x",
          intersect: false,
        },
        hover: {
          mode: "index",
          intersect: false,
        },
      },
    });

    applyChartTheme();
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [showStreamerPanels]);

  useEffect(() => {
    applyChartTheme();
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.options.onHover = (event, elements) => {
      const activeElements =
        elements && elements.length
          ? elements
          : chart.getElementsAtEventForMode(
              event,
              "index",
              { intersect: false },
              false,
            );
      if (!activeElements.length) {
        setHoveredSummary("");
        setHoveredRuntime("");
        return;
      }
      const index = activeElements[0].index ?? 0;
      const match = getClosestHistorySummary(index);
      if (!match.summary) {
        setHoveredSummary("No summary history yet.");
        setHoveredRuntime("");
        return;
      }
      setHoveredSummary(match.summary);
      setHoveredRuntime(match.runtime);
    };
    chart.update("none");
  }, [history, ratePoints, streamStartTs]);

  useEffect(() => {
    if (Array.isArray(ratePoints) && ratePoints.length > 0) {
      setRateLabels(
        ratePoints.map((point) =>
          formatElapsed(point.timestamp, streamStartTs),
        ),
      );
      return;
    }
    setRateLabels((prev) => {
      if (!Array.isArray(rates)) return [];
      if (rates.length < prev.length) {
        const now = Date.now();
        return Array.from({ length: rates.length }, (_, i) =>
          new Date(now - (rates.length - 1 - i) * 1000).toLocaleTimeString(),
        );
      }
      if (rates.length === prev.length) return prev;
      const additions = rates.length - prev.length;
      const now = Date.now();
      const appended = Array.from({ length: additions }, (_, i) =>
        new Date(now - (additions - 1 - i) * 1000).toLocaleTimeString(),
      );
      return [...prev, ...appended];
    });
  }, [rates, ratePoints, streamStartTs]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const maxPoints = 20000;
    const seriesRates =
      Array.isArray(ratePoints) && ratePoints.length
        ? ratePoints.map((point) => point.rate)
        : rates;
    const displayRates = Array.isArray(seriesRates)
      ? seriesRates.slice(-maxPoints)
      : [];
    const displayLabels = Array.isArray(rateLabels)
      ? rateLabels.slice(-maxPoints)
      : [];
    chart.data.labels = displayLabels;
    chart.data.datasets[0].data = displayRates;
    chart.update("none");
  }, [rates, rateLabels]);

  useEffect(() => {
    if (!activeStreamId) return () => {};
    let active = true;
    let timerId;

    const fetchSummary = async () => {
      setStatus("Updating");
      setError("");
      try {
        const keywordParam =
          activeMode === "streamer" && activeKeywords
            ? `&keywords=${encodeURIComponent(activeKeywords)}`
            : "";
        const thresholdParam =
          activeMode === "streamer"
            ? `&keywordThreshold=${encodeURIComponent(activeThreshold)}`
            : "";
        const response = await fetch(
          `/api/summary?videoId=${encodeURIComponent(
            activeStreamId,
          )}&mode=${encodeURIComponent(activeMode)}&source=${encodeURIComponent(
            activeSource,
          )}${keywordParam}${thresholdParam}`,
        );
        const raw = await response.text();
        if (!raw) {
          throw new Error("Empty response from server.");
        }
        const payload = JSON.parse(raw);
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Unable to fetch summary.");
        }
        if (!active) return;
        setSummary(payload.summary || "");
        setEvents(payload.events || []);
        setHistory(payload.summaryHistory || []);
        setVideoTitle(payload.videoTitle || "Unknown");
        setVideoChannel(payload.videoChannel || "Unknown");
        setRates(Array.isArray(payload.rates) ? payload.rates : []);
        setRatePoints(
          Array.isArray(payload.ratePoints) ? payload.ratePoints : [],
        );
        setStreamStartTs(payload.streamStartTs || null);
        setStatus(payload.summary ? "Live" : "Waiting");
        setUpdatedAt(payload.updatedAt || null);
      } catch (err) {
        if (!active) return;
        setStatus("Offline");
        setError(err.message || "Unable to fetch summary.");
      }
      timerId = window.setTimeout(fetchSummary, 8000);
    };

    fetchSummary();

    return () => {
      active = false;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [
    activeStreamId,
    activeMode,
    activeKeywords,
    activeThreshold,
    activeSource,
  ]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const id = isYouTube
      ? parseVideoId(draftInput)
      : parseTwitchChannel(draftInput);
    if (!id) {
      setError(
        isYouTube
          ? "Paste a valid YouTube livestream link or video ID."
          : "Paste a valid Twitch channel or link.",
      );
      return;
    }
    const nextKey = `${draftSource}:${id}`;
    const currentKey = activeStreamId
      ? `${activeSource}:${activeStreamId}`
      : "";
    const streamChanged = nextKey !== currentKey;
    if (streamChanged) {
      setSummary("");
      setEvents([]);
      setHistory([]);
      setRates([]);
      setRateLabels([]);
      setRatePoints([]);
      setStreamStartTs(null);
      setUpdatedAt(null);
      setVideoTitle("Waiting...");
      setVideoChannel("Waiting...");
    }
    setActiveStreamId(id);
    setActiveSource(draftSource);
    setActiveMode(draftMode);
    setActiveKeywords(draftKeywords);
    setActiveThreshold(draftThreshold);
    setStatus("Connecting");
    setError("");
    setIsEditing(false);
  };

  const handleReset = () => {
    setDraftInput("");
    setDraftSource("youtube");
    setDraftMode("general");
    setDraftKeywords("");
    setDraftThreshold("2");
    setActiveStreamId("");
    setActiveSource("youtube");
    setActiveMode("general");
    setActiveKeywords("");
    setActiveThreshold("2");
    setStatus("Idle");
    setError("");
    setSummary("");
    setEvents([]);
    setHistory([]);
    setRates([]);
    setRateLabels([]);
    setRatePoints([]);
    setStreamStartTs(null);
    setVideoTitle("Waiting...");
    setVideoChannel("Waiting...");
    setUpdatedAt(null);
    setIsEditing(true);
    const chart = chartRef.current;
    if (chart) {
      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.update("none");
    }
  };

  const handleZoomIn = () => {
    const chart = chartRef.current;
    if (!chart || typeof chart.zoom !== "function") return;
    chart.zoom({ x: 1.2 });
  };

  const handleZoomOut = () => {
    const chart = chartRef.current;
    if (!chart || typeof chart.zoom !== "function") return;
    chart.zoom({ x: 0.8 });
  };

  const handleResetZoom = () => {
    const chart = chartRef.current;
    if (!chart || typeof chart.resetZoom !== "function") return;
    chart.resetZoom();
  };

  const updatedLabel = useMemo(() => {
    if (!updatedAt) return "";
    const date = new Date(updatedAt * 1000);
    return `Updated ${date.toLocaleTimeString()}`;
  }, [updatedAt]);

  const handleExportTimestamps = () => {
    if (!events.length) return;
    const header = "timestamp,keyword\n";
    const rows = events.map((event) => {
      const timestamp = event.timestamp || "";
      const keyword = (event.keyword || "").replace(/"/g, '""');
      return `"${timestamp}","${keyword}"`;
    });
    const csv = header + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "keyword-timestamps.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportRates = () => {
    if (!ratePoints.length && !rates.length) return;
    const header = "elapsed,rate\n";
    const rows = (ratePoints.length ? ratePoints : []).map((point) => {
      const elapsed = formatElapsed(point.timestamp, streamStartTs);
      return `"${elapsed}","${point.rate}"`;
    });
    const fallbackRows =
      rows.length === 0 && rates.length
        ? rates.map((rate, idx) => `"${idx}","${rate}"`)
        : rows;
    const csv = header + fallbackRows.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "chat-velocity.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const inputPlaceholder = isYouTube
    ? "https://www.youtube.com/watch?v=xxxxxxxxxxx"
    : "https://www.twitch.tv/channelname";

  return (
    <main className="app">
      <button
        type="button"
        className="theme-toggle"
        aria-label="Toggle theme"
        onClick={handleThemeToggle}
      >
        {themeIcon}
      </button>
      <section className="frame">
        <header>
          <h1>Spectator</h1>
          <p className="subtitle">
            An agentic integration for livestream chat analytics and viewer
            assistance.
          </p>
        </header>
        <section className="card config-panel">
          {isEditing ? (
            <form id="summary-form" onSubmit={handleSubmit}>
              <label htmlFor="youtube-link" className="platform-label">
                <span className="sr-only">Livestream link</span>
                <button
                  type="button"
                  className="platform-toggle"
                  onClick={() =>
                    setDraftSource(isYouTube ? "twitch" : "youtube")
                  }
                  aria-label="Toggle platform"
                  aria-pressed={!isYouTube}
                >
                  <span className="platform-option left" aria-hidden="true">
                    <img src={youtubeLogo} alt="" />
                  </span>
                  <span className="platform-option right" aria-hidden="true">
                    <img src={twitchLogo} alt="" />
                  </span>
                  <span
                    className={`platform-knob ${isYouTube ? "left" : "right"}`}
                    aria-hidden="true"
                  >
                    <img src={isYouTube ? youtubeLogo : twitchLogo} alt="" />
                  </span>
                </button>
              </label>
              <input
                id="youtube-link"
                type="text"
                placeholder={inputPlaceholder}
                required
                value={draftInput}
                onChange={(e) => setDraftInput(e.target.value)}
              />

              <div className="toggle-row">
                <span className="toggle-label">Summary mode</span>
                <div className="toggle-group" role="radiogroup">
                  <label className="toggle">
                    <input
                      type="radio"
                      name="mode"
                      value="general"
                      checked={draftMode === "general"}
                      onChange={() => setDraftMode("general")}
                    />
                    <span>Viewer</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="radio"
                      name="mode"
                      value="streamer"
                      checked={draftMode === "streamer"}
                      onChange={() => setDraftMode("streamer")}
                    />
                    <span>Streamer</span>
                  </label>
                </div>
              </div>

              {showDraftStreamerPanels ? (
                <div id="keyword-panel" className="keyword-panel">
                  <label htmlFor="keyword-input">Streamer keywords</label>
                  <input
                    id="keyword-input"
                    type="text"
                    placeholder="funny, rare moment, clutch"
                    value={draftKeywords}
                    onChange={(e) => setDraftKeywords(e.target.value)}
                  />
                  <p className="hint">
                    Add comma-separated keywords to tag moments for clips.
                  </p>
                  <label htmlFor="keyword-threshold">
                    Keyword match threshold
                  </label>
                  <div className="slider-row">
                    <input
                      id="keyword-threshold"
                      type="range"
                      min="1"
                      max="4"
                      step="1"
                      value={draftThreshold}
                      onChange={(e) => setDraftThreshold(e.target.value)}
                    />
                    <span id="keyword-threshold-value" className="pill">
                      {draftThreshold}
                    </span>
                  </div>
                  <p className="hint">
                    Increase to require repeated mentions before logging a
                    timestamp.
                  </p>
                </div>
              ) : null}

              <div className="actions">
                <button type="submit" className="primary">
                  Start
                </button>
                <button type="button" className="ghost" onClick={handleReset}>
                  Reset
                </button>
              </div>
            </form>
          ) : (
            <div className="config-compact">
              <div className="config-lines">
                <div className="config-line">
                  <img
                    className="config-logo"
                    src={isActiveYouTube ? youtubeLogo : twitchLogo}
                    alt=""
                    aria-hidden="true"
                  />
                  <span className="config-channel truncate">
                    {videoChannel || activeStreamId || "Unknown channel"}
                  </span>
                  <span className="config-title truncate">
                    {videoTitle || "Unknown title"}
                  </span>
                </div>
                {activeMode === "streamer" ? (
                  <div className="config-line config-sub">
                    <span className="truncate">
                      Keywords: {activeKeywords || "none"}
                    </span>
                    <span>Threshold: {activeThreshold}</span>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  setDraftInput(activeStreamId);
                  setDraftSource(activeSource);
                  setDraftMode(activeMode);
                  setDraftKeywords(activeKeywords);
                  setDraftThreshold(activeThreshold);
                  setIsEditing(true);
                }}
              >
                Edit
              </button>
            </div>
          )}
          {isEditing ? (
            <>
              <div className="status-row">
                <span id="status-pill" className="pill">
                  {status}
                </span>
                {activeStreamId ? (
                  <span id="video-pill" className="pill">
                    {isActiveYouTube ? "Video ID" : "Channel"}: {activeStreamId}
                  </span>
                ) : null}
                {updatedLabel ? (
                  <span id="updated-pill" className="pill">
                    {updatedLabel}
                  </span>
                ) : null}
              </div>
              {error ? (
                <p id="error-text" className="status error">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
        </section>

        <section className="card summary-box">
          <h2>Summary</h2>
          <div
            id="summary-content"
            className={`summary-content ${summaryItems.length ? "" : "muted"}`}
          >
            {summaryItems.length ? (
              <ul>
                {summaryItems.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            ) : (
              "Paste a livestream link to begin. Summaries refresh automatically once the backend starts streaming."
            )}
          </div>
        </section>

        {showStreamerPanels ? (
          <section id="history-panel" className="card summary-box">
            <h2>Summary history</h2>
            <div
              id="history-content"
              className={`summary-content ${history.length ? "history-content" : "muted"}`}
            >
              {history.length ? (
                <div className="history-grid">
                  {[...history].reverse().map((entry, idx) => {
                    const summaryText =
                      typeof entry.summary === "string" ? entry.summary : "";
                    const runtime =
                      typeof entry.timestamp === "string"
                        ? entry.timestamp
                        : "";
                    const isExpanded =
                      isPointerDown && expandedHistoryIndex === idx;
                    return (
                      <div
                        className={`history-card ${isExpanded ? "expanded" : ""}`}
                        key={idx}
                        onPointerDown={() => {
                          setIsPointerDown(true);
                          setExpandedHistoryIndex(idx);
                        }}
                      >
                        <span className="history-text">
                          {isExpanded
                            ? splitIntoLines(
                                summaryText.replace(/\n/g, " "),
                              ).map((line, lineIdx) => (
                                <span className="history-line" key={lineIdx}>
                                  {line}
                                </span>
                              ))
                            : summaryText.replace(/\n/g, " ")}
                        </span>
                        <span className="history-runtime">
                          {runtime || "--:--"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                "Summaries will appear here as they update."
              )}
            </div>
          </section>
        ) : null}

        {showStreamerPanels ? (
          <section id="events-panel" className="card summary-box">
            <div className="panel-title">
              <h2>Keyword timestamps</h2>
              <button
                type="button"
                className="ghost small"
                onClick={handleExportTimestamps}
                disabled={!events.length}
              >
                Export CSV
              </button>
            </div>
            <div
              id="events-content"
              className={`summary-content ${events.length ? "" : "muted"}`}
            >
              {events.length ? (
                <ul>
                  {events.map((event, idx) => {
                    const time =
                      typeof event.timestamp === "string" && event.timestamp
                        ? event.timestamp
                        : "Unknown time";
                    return (
                      <li key={`${event.keyword || "tag"}-${idx}`}>
                        {`${time} - ${event.keyword || "tag"}`}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                "Add keywords in streamer mode to start logging timestamps."
              )}
            </div>
          </section>
        ) : null}

        {showStreamerPanels ? (
          <section className="card summary-box">
            <div className="panel-title">
              <h2>Chat frequency</h2>
              <button
                type="button"
                className="ghost small"
                onClick={handleExportRates}
                disabled={!ratePoints.length && !rates.length}
              >
                Export CSV
              </button>
            </div>
            <div className="chart-layout">
              <div className="chart-main">
                <div className="chart-actions">
                  <button
                    type="button"
                    className="ghost small"
                    onClick={handleZoomIn}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={handleZoomOut}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    className="ghost small"
                    onClick={handleResetZoom}
                  >
                    Reset
                  </button>
                </div>
                <div
                  className="chart-container"
                  onMouseLeave={() => {
                    setHoveredSummary("");
                    setHoveredRuntime("");
                  }}
                >
                  <canvas id="rate-chart" ref={canvasRef} />
                </div>
              </div>
              {hoveredSummary ? (
                <aside className="chart-hover">
                  <div className="chart-hover-title">
                    Closest summary
                    {hoveredRuntime ? (
                      <span className="chart-hover-time">{hoveredRuntime}</span>
                    ) : null}
                  </div>
                  <div className="chart-hover-body">{hoveredSummary}</div>
                </aside>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export default App;
