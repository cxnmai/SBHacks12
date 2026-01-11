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
  const [videoInput, setVideoInput] = useState("");
  const [videoId, setVideoId] = useState("");
  const [source, setSource] = useState("youtube");
  const [mode, setMode] = useState("general");
  const [keywords, setKeywords] = useState("");
  const [threshold, setThreshold] = useState("2");
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
  const [theme, setTheme] = useState("default");

  const chartRef = useRef(null);
  const canvasRef = useRef(null);

  const showStreamerPanels = mode === "streamer";
  const isYouTube = source === "youtube";

  const summaryItems = useMemo(() => {
    if (!summary) return [];
    return summary
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
  }, [summary]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

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
          mode: "nearest",
          axis: "x",
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
  }, [rates]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const maxPoints = 100;
    const displayRates = Array.isArray(rates) ? rates.slice(-maxPoints) : [];
    const displayLabels = Array.isArray(rateLabels)
      ? rateLabels.slice(-maxPoints)
      : [];
    chart.data.labels = displayLabels;
    chart.data.datasets[0].data = displayRates;
    chart.update("none");
  }, [rates, rateLabels]);

  useEffect(() => {
    if (!videoId) return () => {};
    let active = true;
    let timerId;

    const fetchSummary = async () => {
      setStatus("Updating");
      setError("");
      try {
        const keywordParam =
          mode === "streamer" && keywords
            ? `&keywords=${encodeURIComponent(keywords)}`
            : "";
        const thresholdParam =
          mode === "streamer"
            ? `&keywordThreshold=${encodeURIComponent(threshold)}`
            : "";
        const response = await fetch(
          `/api/summary?videoId=${encodeURIComponent(
            videoId,
          )}&mode=${encodeURIComponent(mode)}&source=${encodeURIComponent(
            source,
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
  }, [videoId, mode, keywords, threshold, source]);

  const handleSubmit = (event) => {
    event.preventDefault();
    const id = isYouTube
      ? parseVideoId(videoInput)
      : parseTwitchChannel(videoInput);
    if (!id) {
      setError(
        isYouTube
          ? "Paste a valid YouTube livestream link or video ID."
          : "Paste a valid Twitch channel or link.",
      );
      return;
    }
    setVideoId(id);
    setStatus("Connecting");
    setError("");
    setSummary("");
    setEvents([]);
    setHistory([]);
    setRates([]);
    setRateLabels([]);
    setUpdatedAt(null);
  };

  const handleReset = () => {
    setVideoInput("");
    setVideoId("");
    setSource("youtube");
    setMode("general");
    setKeywords("");
    setThreshold("2");
    setStatus("Idle");
    setError("");
    setSummary("");
    setEvents([]);
    setHistory([]);
    setRates([]);
    setRateLabels([]);
    setVideoTitle("Waiting...");
    setVideoChannel("Waiting...");
    setUpdatedAt(null);
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
          <p className="eyebrow">Livestream Summarizer</p>
          <p className="subtitle">
            Paste your YouTube livestream link, pick a mode, and watch the
            summary update in real time.
          </p>
        </header>

        <section className="panel-grid">
          <div className="card">
            <form id="summary-form" onSubmit={handleSubmit}>
              <label htmlFor="youtube-link" className="platform-label">
                <span className="sr-only">Livestream link</span>
                <button
                  type="button"
                  className="platform-toggle"
                  onClick={() => setSource(isYouTube ? "twitch" : "youtube")}
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
                    className={`platform-knob ${
                      isYouTube ? "left" : "right"
                    }`}
                    aria-hidden="true"
                  >
                    <img
                      src={isYouTube ? youtubeLogo : twitchLogo}
                      alt=""
                    />
                  </span>
                </button>
              </label>
              <input
                id="youtube-link"
                type="text"
                placeholder={inputPlaceholder}
                required
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
              />

              <div className="toggle-row">
                <span className="toggle-label">Summary mode</span>
                <div className="toggle-group" role="radiogroup">
                  <label className="toggle">
                    <input
                      type="radio"
                      name="mode"
                      value="general"
                      checked={mode === "general"}
                      onChange={() => setMode("general")}
                    />
                    <span>Viewer</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="radio"
                      name="mode"
                      value="streamer"
                      checked={mode === "streamer"}
                      onChange={() => setMode("streamer")}
                    />
                    <span>Streamer</span>
                  </label>
                </div>
              </div>

              {showStreamerPanels && (
                <div id="keyword-panel" className="keyword-panel">
                  <label htmlFor="keyword-input">Streamer keywords</label>
                  <input
                    id="keyword-input"
                    type="text"
                    placeholder="funny, multikill, clutch"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
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
                      value={threshold}
                      onChange={(e) => setThreshold(e.target.value)}
                    />
                    <span id="keyword-threshold-value" className="pill">
                      {threshold}
                    </span>
                  </div>
                  <p className="hint">
                    Increase to require repeated mentions before logging a
                    timestamp.
                  </p>
                </div>
              )}

              <div className="actions">
                <button type="submit" className="primary">
                  Start summarizing
                </button>
                <button type="button" className="ghost" onClick={handleReset}>
                  Reset
                </button>
              </div>
            </form>
            <div className="status-row">
              <span id="status-pill" className="pill">
                {status}
              </span>
              {videoId ? (
                <span id="video-pill" className="pill">
                  {isYouTube ? "Video ID" : "Channel"}: {videoId}
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
          </div>

          <aside className="card side-panel">
            <h2>Video info</h2>
            <div className="side-item">
              <span className="side-label">Title</span>
              <span
                id="video-title"
                className={`side-value ${!videoTitle ? "muted" : ""}`}
              >
                {videoTitle || "Waiting..."}
              </span>
            </div>
            <div className="side-item">
              <span className="side-label">Channel</span>
              <span
                id="video-channel"
                className={`side-value ${!videoChannel ? "muted" : ""}`}
              >
                {videoChannel || "Waiting..."}
              </span>
            </div>
          </aside>
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
                <ul>
                  {[...history].reverse().map((entry, idx) => {
                    const summaryText =
                      typeof entry.summary === "string" ? entry.summary : "";
                    const timestamp = entry.timestamp
                      ? new Date(entry.timestamp * 1000).toLocaleTimeString()
                      : "Unknown time";
                    return (
                      <li
                        key={idx}
                      >{`${timestamp} - ${summaryText.replace(/\n/g, " ")}`}</li>
                    );
                  })}
                </ul>
              ) : (
                "Summaries will appear here as they update."
              )}
            </div>
          </section>
        ) : null}

        {showStreamerPanels ? (
          <section id="events-panel" className="card summary-box">
            <h2>Keyword timestamps</h2>
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
            <h2>Chat frequency</h2>
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
            <div className="chart-container">
              <canvas id="rate-chart" ref={canvasRef} />
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

export default App;
