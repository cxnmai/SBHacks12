const form = document.getElementById("summary-form");
const input = document.getElementById("youtube-link");
const resetBtn = document.getElementById("reset-btn");
const statusPill = document.getElementById("status-pill");
const videoPill = document.getElementById("video-pill");
const updatedPill = document.getElementById("updated-pill");
const errorText = document.getElementById("error-text");
const summaryContent = document.getElementById("summary-content");
const keywordPanel = document.getElementById("keyword-panel");
const keywordInput = document.getElementById("keyword-input");
const keywordThreshold = document.getElementById("keyword-threshold");
const keywordThresholdValue = document.getElementById("keyword-threshold-value");
const eventsPanel = document.getElementById("events-panel");
const eventsContent = document.getElementById("events-content");
const videoTitle = document.getElementById("video-title");
const videoChannel = document.getElementById("video-channel");
const historyPanel = document.getElementById("history-panel");
const historyContent = document.getElementById("history-content");
const rateChartCanvas = document.getElementById("rate-chart");

let pollTimer = null;
let currentVideoId = "";
let currentMode = "general";
let currentKeywords = "";
let currentThreshold = "2";
let rateChart = null;

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
      return url.searchParams.get("v");
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

const setStatus = (text) => {
  statusPill.textContent = text;
};

const showError = (message) => {
  errorText.textContent = message;
  errorText.classList.remove("hidden");
};

const clearError = () => {
  errorText.textContent = "";
  errorText.classList.add("hidden");
};

const updateSummary = (summary) => {
  const text = typeof summary === "string" ? summary : "";
  if (!text) {
    summaryContent.classList.add("muted");
    summaryContent.textContent = "Waiting for the first summary...";
    return;
  }
  summaryContent.classList.remove("muted");
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const list = document.createElement("ul");
  lines.forEach((line) => {
    const item = document.createElement("li");
    item.textContent = line;
    list.appendChild(item);
  });
  summaryContent.innerHTML = "";
  summaryContent.appendChild(list);
};

const updateEvents = (events) => {
  if (!Array.isArray(events) || events.length === 0) {
    eventsContent.classList.add("muted");
    eventsContent.textContent = "No keyword timestamps yet.";
    return;
  }
  eventsContent.classList.remove("muted");
  const list = document.createElement("ul");
  events.forEach((event) => {
    const item = document.createElement("li");
    const time =
      typeof event.timestamp === "string" && event.timestamp
        ? event.timestamp
        : "Unknown time";
    item.textContent = `${time} - ${event.keyword || "tag"}`;
    list.appendChild(item);
  });
  eventsContent.innerHTML = "";
  eventsContent.appendChild(list);
};

const updateHistory = (history) => {
  if (!Array.isArray(history) || history.length === 0) {
    historyContent.classList.add("muted");
    historyContent.classList.remove("history-content");
    historyContent.textContent = "Summaries will appear here as they update.";
    return;
  }
  historyContent.classList.remove("muted");
  historyContent.classList.add("history-content");
  const list = document.createElement("ul");
  [...history].reverse().forEach((entry) => {
    const summaryText = typeof entry.summary === "string" ? entry.summary : "";
    const timestamp = entry.timestamp
      ? new Date(entry.timestamp * 1000).toLocaleTimeString()
      : "Unknown time";
    const item = document.createElement("li");
    item.textContent = `${timestamp} - ${summaryText.replace(/\n/g, " ")}`;
    list.appendChild(item);
  });
  historyContent.innerHTML = "";
  historyContent.appendChild(list);
};

const initRateChart = () => {
  if (!rateChartCanvas) return;
  
  if (rateChart) {
    rateChart.destroy();
  }

  const ctx = rateChartCanvas.getContext("2d");
  rateChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Messages per second",
          data: [],
          borderColor: "rgba(130, 241, 255, 1)",
          backgroundColor: "rgba(130, 241, 255, 0.1)",
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
            color: "rgba(244, 246, 255, 0.9)",
            font: {
              family: '"Space Grotesk", "Segoe UI", sans-serif',
            },
          },
        },
        tooltip: {
          mode: "index",
          intersect: false,
          backgroundColor: "rgba(43, 15, 104, 0.95)",
          titleColor: "rgba(244, 246, 255, 1)",
          bodyColor: "rgba(244, 246, 255, 0.9)",
          borderColor: "rgba(130, 241, 255, 0.5)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          ticks: {
            color: "rgba(244, 246, 255, 0.7)",
            font: {
              family: '"Space Grotesk", "Segoe UI", sans-serif',
            },
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: "rgba(244, 246, 255, 0.7)",
            font: {
              family: '"Space Grotesk", "Segoe UI", sans-serif',
            },
          },
          grid: {
            color: "rgba(255, 255, 255, 0.1)",
          },
          title: {
            display: true,
            text: "Messages/sec",
            color: "rgba(244, 246, 255, 0.9)",
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
};

const updateRateChart = (rates) => {
  if (!rateChart || !Array.isArray(rates) || rates.length === 0) {
    return;
  }

  // Limit to last 100 points for performance
  const maxPoints = 100;
  const displayRates = rates.slice(-maxPoints);
  
  // Generate labels (just index numbers for simplicity)
  const labels = displayRates.map((_, index) => {
    const position = rates.length - displayRates.length + index;
    return position + 1;
  });

  rateChart.data.labels = labels;
  rateChart.data.datasets[0].data = displayRates;
  rateChart.update("none"); // 'none' mode for smooth updates without animation
};

const setModeVisibility = (mode) => {
  if (mode === "streamer") {
    keywordPanel.classList.remove("hidden");
    eventsPanel.classList.remove("hidden");
    historyPanel.classList.remove("hidden");
  } else {
    keywordPanel.classList.add("hidden");
    eventsPanel.classList.add("hidden");
    historyPanel.classList.add("hidden");
  }
};

const fetchSummary = async () => {
  if (!currentVideoId) return;
  setStatus("Updating");
  clearError();
  try {
    const keywordParam =
      currentMode === "streamer" && currentKeywords
        ? `&keywords=${encodeURIComponent(currentKeywords)}`
        : "";
    const thresholdParam =
      currentMode === "streamer"
        ? `&keywordThreshold=${encodeURIComponent(currentThreshold)}`
        : "";
    const response = await fetch(
      `/api/summary?videoId=${encodeURIComponent(
        currentVideoId
      )}&mode=${encodeURIComponent(currentMode)}${keywordParam}${thresholdParam}`
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to fetch summary.");
    }
    if (payload.error) {
      throw new Error(payload.error);
    }
    updateSummary(payload.summary || "");
    if (currentMode === "streamer") {
      updateEvents(payload.events || []);
      updateHistory(payload.summaryHistory || []);
    }
    if (videoTitle && videoChannel) {
      videoTitle.textContent = payload.videoTitle || "Unknown";
      videoChannel.textContent = payload.videoChannel || "Unknown";
      videoTitle.classList.toggle("muted", !payload.videoTitle);
      videoChannel.classList.toggle("muted", !payload.videoChannel);
    }
    // Update rate chart with rates array
    if (Array.isArray(payload.rates)) {
      updateRateChart(payload.rates);
    }
    setStatus(payload.summary ? "Live" : "Waiting");
    if (payload.updatedAt) {
      const updated = new Date(payload.updatedAt * 1000);
      updatedPill.textContent = `Updated ${updated.toLocaleTimeString()}`;
      updatedPill.classList.remove("hidden");
    }
  } catch (err) {
    setStatus("Offline");
    showError(err.message || "Unable to fetch summary.");
  }
  pollTimer = window.setTimeout(fetchSummary, 8000);
};

const startPolling = () => {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
  fetchSummary();
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const id = parseVideoId(input.value);
  const modeInput = document.querySelector("input[name='mode']:checked");
  currentMode = modeInput ? modeInput.value : "general";
  currentKeywords = keywordInput ? keywordInput.value.trim() : "";
  currentThreshold = keywordThreshold ? keywordThreshold.value : "2";
  if (!id) {
    showError("Paste a valid YouTube livestream link or video ID.");
    return;
  }
  currentVideoId = id;
  clearError();
  setStatus("Connecting");
  videoPill.textContent = `Video ID: ${currentVideoId}`;
  videoPill.classList.remove("hidden");
  updatedPill.classList.add("hidden");
  updateSummary("");
  if (currentMode === "streamer") {
    updateEvents([]);
    updateHistory([]);
  }
  // Initialize chart when starting
  initRateChart();
  setModeVisibility(currentMode);
  startPolling();
});

resetBtn.addEventListener("click", () => {
  input.value = "";
  currentVideoId = "";
  currentMode = "general";
  currentKeywords = "";
  currentThreshold = "2";
  if (keywordInput) keywordInput.value = "";
  if (keywordThreshold) keywordThreshold.value = "2";
  if (keywordThresholdValue) keywordThresholdValue.textContent = "2";
  setStatus("Idle");
  clearError();
  updateSummary("");
  if (videoTitle && videoChannel) {
    videoTitle.textContent = "Waiting...";
    videoChannel.textContent = "Waiting...";
    videoTitle.classList.add("muted");
    videoChannel.classList.add("muted");
  }
  videoPill.classList.add("hidden");
  updatedPill.classList.add("hidden");
  // Reset chart
  initRateChart();
  setModeVisibility(currentMode);
  if (pollTimer) {
    clearTimeout(pollTimer);
  }
});

document.querySelectorAll("input[name='mode']").forEach((inputEl) => {
  inputEl.addEventListener("change", () => {
    currentMode = inputEl.value;
    currentKeywords = keywordInput ? keywordInput.value.trim() : "";
    currentThreshold = keywordThreshold ? keywordThreshold.value : "2";
    setModeVisibility(currentMode);
    if (currentVideoId) {
      startPolling();
    }
  });
});

if (keywordInput) {
  keywordInput.addEventListener("change", () => {
    currentKeywords = keywordInput.value.trim();
    if (currentVideoId && currentMode === "streamer") {
      startPolling();
    }
  });
}

if (keywordThreshold) {
  keywordThreshold.addEventListener("input", () => {
    currentThreshold = keywordThreshold.value;
    if (keywordThresholdValue) {
      keywordThresholdValue.textContent = currentThreshold;
    }
  });
  keywordThreshold.addEventListener("change", () => {
    currentThreshold = keywordThreshold.value;
    if (currentVideoId && currentMode === "streamer") {
      startPolling();
    }
  });
}

// Initialize chart on page load
initRateChart();
setModeVisibility(currentMode);
